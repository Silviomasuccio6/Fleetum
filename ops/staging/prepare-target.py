#!/usr/bin/env python3
"""Create staging directories only. Never read env files or repair existing paths.

Protected workflow contract:
  sudo -n python3 - SOURCE_SHA PREPARE_STAGING OPERATOR_UID OPERATOR_GID < this-file
The command line has no path, platform, resource or ownership override.
"""
import dataclasses
import json
import os
import pathlib
import platform
import re
import stat
import sys

CANONICAL_ROOT = pathlib.Path("/opt/fleetum-staging")
GIB = 1024 ** 3


class UnsafeTarget(Exception):
    pass


@dataclasses.dataclass(frozen=True)
class Metadata:
    device: int
    inode: int
    uid: int
    gid: int
    mode: int
    kind: int
    links: int


@dataclasses.dataclass(frozen=True)
class Directory:
    path: pathlib.Path
    uid: int
    gid: int
    mode: int


class Host:
    def runtime(self):
        return platform.system(), os.geteuid()

    def metadata(self, path):
        try:
            value = os.lstat(path)
        except FileNotFoundError:
            return None
        return Metadata(value.st_dev, value.st_ino, value.st_uid, value.st_gid,
                        stat.S_IMODE(value.st_mode), stat.S_IFMT(value.st_mode),
                        value.st_nlink if stat.S_ISREG(value.st_mode) else 0)

    def ancestor_paths(self, root):
        return list(reversed(root.parents))

    def mount_points(self):
        # Kernel metadata only; no runtime env, Docker inspection or user files.
        with open("/proc/self/mountinfo", encoding="utf8") as handle:
            records = handle.read().splitlines()
        result = []
        for record in records:
            fields = record.split()
            if len(fields) < 7:
                raise UnsafeTarget("Malformed host mount metadata.")
            result.append(re.sub(r"\\([0-7]{3})", lambda match: chr(int(match[1], 8)), fields[4]))
        return result

    def resources(self, path):
        disk = os.statvfs(path)
        with open("/proc/meminfo", encoding="ascii") as handle:
            memory = handle.read()
        match = re.search(r"^MemAvailable:\s+([0-9]+) kB$", memory, re.MULTILINE)
        if not match:
            raise UnsafeTarget("MemAvailable host metadata is required.")
        return disk.f_bavail * disk.f_frsize, int(match[1]) * 1024

    def create_directory(self, path, expected_parent, uid, gid, mode):
        # Anchor to the checked parent descriptor. Never chown/chmod a path
        # that already existed, even if another process created it meanwhile.
        flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
        descriptor = os.open(path.parent, flags)
        try:
            parent = os.fstat(descriptor)
            if (parent.st_dev, parent.st_ino) != (expected_parent.device, expected_parent.inode):
                raise UnsafeTarget("Staging parent changed during preparation.")
            os.mkdir(path.name, mode=0o700, dir_fd=descriptor)
            child = os.open(path.name, flags, dir_fd=descriptor)
            try:
                created = os.fstat(child)
                if created.st_uid != 0 or stat.S_IMODE(created.st_mode) != 0o700:
                    raise UnsafeTarget("New staging directory changed during preparation.")
                os.fchown(child, uid, gid)
                os.fchmod(child, mode)
            finally:
                os.close(child)
        finally:
            os.close(descriptor)


def arguments(argv):
    if len(argv) != 4 or not re.fullmatch(r"[0-9a-f]{40}", argv[0]) or argv[1] != "PREPARE_STAGING":
        raise UnsafeTarget("Expected full source SHA, PREPARE_STAGING and numeric operator UID/GID.")
    ids = []
    for value in argv[2:]:
        if not re.fullmatch(r"[1-9][0-9]{0,9}", value) or int(value) > 2147483647:
            raise UnsafeTarget("Operator UID/GID must be positive numeric identifiers.")
        ids.append(int(value))
    return argv[0], *ids


def directory_plan(root, operator_uid, operator_gid):
    return [
        Directory(root, operator_uid, operator_gid, 0o750),
        Directory(root / "app", operator_uid, operator_gid, 0o750),
        Directory(root / "env", operator_uid, operator_gid, 0o700),
        Directory(root / "postgres", 70, operator_gid, 0o700),
        Directory(root / "uploads", 1000, operator_gid, 0o750),
        Directory(root / "logs", 1000, operator_gid, 0o750),
        Directory(root / "docker-config", operator_uid, operator_gid, 0o700),
    ]


def inspect_plan(host, directories, operator_uid, operator_gid):
    root = directories[0].path
    snapshot = {}
    identities = set()
    for path in host.ancestor_paths(root):
        value = host.metadata(path)
        if value is None or value.kind != stat.S_IFDIR or value.uid != 0 or value.mode & 0o022:
            raise UnsafeTarget("Staging ancestors must be real root-owned directories without write access for others.")
        snapshot[path] = value
        identities.add((value.device, value.inode))
    anchor = snapshot.get(root.parent)
    if anchor is None:
        raise UnsafeTarget("The staging parent directory must already exist.")
    mounts = {pathlib.Path(path) for path in host.mount_points()}
    for mount in mounts:
        if mount != pathlib.Path("/") and (mount == root or root in mount.parents or mount in root.parents):
            raise UnsafeTarget("Staging paths cannot cross a mount or bind-mount alias.")
    for directory in directories:
        value = host.metadata(directory.path)
        snapshot[directory.path] = value
        if value is None:
            continue
        if (value.kind, value.uid, value.gid, value.mode) != (stat.S_IFDIR, directory.uid, directory.gid, directory.mode):
            raise UnsafeTarget("Existing staging directory ownership or mode does not match the isolated plan.")
        identity = value.device, value.inode
        if value.device != anchor.device or identity in identities:
            raise UnsafeTarget("Existing staging paths must have distinct identities on the checked filesystem.")
        identities.add(identity)
    if snapshot[root] is not None:
        allowed = {"app", "env", "postgres", "uploads", "logs", "docker-config", "deploy.lock"}
        if set(os.listdir(root)) - allowed:
            raise UnsafeTarget("Unexpected entries exist in the canonical staging root.")
    allowed_files = {
        root / "env": {"backend.env", "compose.env"},
        root / "docker-config": {"config.json"},
    }
    for directory, names in allowed_files.items():
        if snapshot[directory] is not None and set(os.listdir(directory)) - names:
            raise UnsafeTarget("Unexpected entries exist in a protected staging directory.")
    for path in [root / "env/backend.env", root / "env/compose.env",
                 root / "docker-config/config.json", root / "deploy.lock"]:
        value = host.metadata(path)
        snapshot[path] = value
        if value is None:
            continue
        allowed_owner = {(operator_uid, operator_gid)}
        if path == root / "docker-config/config.json":
            # sudo-mode Docker writes this file as root in its dedicated config
            # directory. The directory remains private to the operator.
            allowed_owner.add((0, 0))
        if (value.kind, value.mode, value.links) != (stat.S_IFREG, 0o600, 1) or (value.uid, value.gid) not in allowed_owner:
            raise UnsafeTarget("Protected staging files must be operator-owned, mode 0600 and single-link regular files.")
        if value.device != anchor.device or (value.device, value.inode) in identities:
            raise UnsafeTarget("Protected staging files cannot alias another checked path.")
        identities.add((value.device, value.inode))
    free_bytes, available_memory = host.resources(root.parent)
    if free_bytes < 20 * GIB or available_memory < 2 * GIB:
        raise UnsafeTarget("Staging requires at least 20 GiB free disk and 2 GiB MemAvailable before preparation.")
    return snapshot


def prepare(source_sha, operator_uid, operator_gid, *, host=None, root=CANONICAL_ROOT):
    # Dependency injection is a module-level test seam, never a CLI option.
    arguments([source_sha, "PREPARE_STAGING", str(operator_uid), str(operator_gid)])
    host = host or Host()
    if host.runtime() != ("Linux", 0):
        raise UnsafeTarget("Staging preparation requires Linux and effective UID 0.")
    root = pathlib.Path(root)
    if not root.is_absolute() or str(root) != os.path.normpath(root):
        raise UnsafeTarget("Staging root must be an absolute normalized path.")
    directories = directory_plan(root, operator_uid, operator_gid)
    initial = inspect_plan(host, directories, operator_uid, operator_gid)
    # Recheck the entire plan before the first write; reject concurrent drift.
    if inspect_plan(host, directories, operator_uid, operator_gid) != initial:
        raise UnsafeTarget("Staging metadata changed before preparation.")
    created = []
    for directory in directories:
        if initial[directory.path] is not None:
            continue
        # All prior checked paths must still have the same identity/metadata.
        if any(host.metadata(path) != value for path, value in initial.items() if value is not None):
            raise UnsafeTarget("Staging metadata changed during preparation.")
        parent = host.metadata(directory.path.parent)
        if parent is None:
            raise UnsafeTarget("Missing checked parent during preparation.")
        host.create_directory(directory.path, parent, directory.uid, directory.gid, directory.mode)
        initial[directory.path] = host.metadata(directory.path)
        created.append(str(directory.path))
    inspect_plan(host, directories, operator_uid, operator_gid)
    return {"schemaVersion": 1, "sourceSha": source_sha,
            "root": str(root), "createdDirectories": created,
            "runtimeConfigured": False,
            "nextStep": "Provision separate protected staging env files before deployment preflight."}


def main(argv):
    try:
        source_sha, operator_uid, operator_gid = arguments(argv)
        print(json.dumps(prepare(source_sha, operator_uid, operator_gid), sort_keys=True))
        return 0
    except (UnsafeTarget, OSError, ValueError) as error:
        # No file contents, credentials or provider metadata are ever logged.
        print("Staging directory preparation rejected: " + str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
