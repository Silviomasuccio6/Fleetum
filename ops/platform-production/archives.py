"""Bounded inert source/artifact archives. Links and real env files are rejected."""
import gzip
from pathlib import Path, PurePosixPath
import re
import shutil
import tarfile


def path_name(value):
    name = value.removeprefix('./')
    if not name or PurePosixPath(name).is_absolute() or '\\' in name or '..' in name.split('/'):
        raise ValueError('Unsafe archive path')
    if any(ord(c) < 32 for c in name):
        raise ValueError('Control character in archive path')
    parts = name.split('/')
    if '.git' in parts or 'node_modules' in parts:
        raise ValueError('Repository state or installed dependencies in archive')
    if any(p.startswith('.env') and not p.endswith(('.example', '.sample')) for p in parts):
        raise ValueError('Real env file in archive')
    return name


def extract(archive, destination, max_bytes=256*1024*1024, max_files=50000):
    destination = Path(destination)
    if destination.exists() or destination.is_symlink():
        raise ValueError('New extraction directory required')
    with tarfile.open(archive, 'r:gz') as tar:
        members = tar.getmembers()
        if len(members) > max_files or sum(x.size for x in members) > max_bytes:
            raise ValueError('Archive exceeds limits')
        seen = set()
        checked = []
        for member in members:
            if member.size < 0:
                raise ValueError('Negative archive size')
            if member.isdir() and member.name in ('.', './'):
                continue
            name = path_name(member.name)
            if name in seen or not (member.isdir() or member.isfile()):
                raise ValueError('Duplicate, link or special archive entry')
            seen.add(name)
            checked.append((member, name))
        destination.mkdir(parents=True)
        try:
            for member, name in checked:
                target = destination/name
                if member.isdir():
                    target.mkdir(parents=True, exist_ok=True)
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with tar.extractfile(member) as source, target.open('xb') as out:
                        shutil.copyfileobj(source, out)
                    target.chmod(0o755 if member.mode & 0o111 else 0o644)
        except Exception:
            shutil.rmtree(destination)
            raise


def pack(directory, archive):
    directory, archive = Path(directory), Path(archive)
    if not directory.is_dir() or directory.is_symlink() or archive.exists():
        raise ValueError('New archive and regular source directory required')
    if directory == archive.parent or directory in archive.parents:
        raise ValueError('Archive must not be inside source')
    files = []
    for p in sorted(directory.rglob('*')):
        if p.is_symlink() or not (p.is_file() or p.is_dir()):
            raise ValueError('Source link or special file')
        if p.is_file():
            path_name(p.relative_to(directory).as_posix())
            files.append(p)
    with archive.open('xb') as output, gzip.GzipFile(filename='', mode='wb', fileobj=output, mtime=0) as gz:
        with tarfile.open(mode='w', fileobj=gz, format=tarfile.PAX_FORMAT) as tar:
            for p in files:
                info = tar.gettarinfo(str(p), p.relative_to(directory).as_posix())
                info.uid = info.gid = info.mtime = 0
                info.uname = info.gname = ''
                with p.open('rb') as f:
                    tar.addfile(info, f)


if __name__ == '__main__':
    import sys
    if len(sys.argv) != 4 or sys.argv[1] not in ('pack', 'extract'):
        raise SystemExit('Expected pack/extract, input, output')
    (pack if sys.argv[1] == 'pack' else extract)(sys.argv[2], sys.argv[3])
