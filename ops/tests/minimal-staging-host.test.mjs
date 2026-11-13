import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, chmodSync, symlinkSync, linkSync, statSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const helper = new URL("../staging/prepare-target.py", import.meta.url).pathname;
const pythonExecutable = spawnSync("python3", ["-B", "-c", "import sys; print(sys.executable)"], { encoding: "utf8" }).stdout.trim();
const fixture = String.raw`
import dataclasses, importlib.util, json, os, pathlib, shutil, stat, sys, tempfile
spec = importlib.util.spec_from_file_location("prepare_target", sys.argv[1])
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
root = pathlib.Path(tempfile.mkdtemp(prefix="fleetum-host-synthetic-"))
base = root / "opt" / "fleetum-staging"
(root / "opt").mkdir(mode=0o755)
class SyntheticHost(module.Host):
    def __init__(self):
        self.owners = {}
        self.writes = []
        self.free_bytes = 24 * module.GIB
        self.available_memory = 3 * module.GIB
        self.mounts = []
        self.os_name, self.effective_uid = "Linux", 0
    def metadata(self, path):
        value = super().metadata(path)
        if value is None: return None
        uid, gid = self.owners.get(str(path), (0, 0))
        return dataclasses.replace(value, uid=uid, gid=gid)
    def resources(self, path): return (self.free_bytes, self.available_memory)
    def mount_points(self): return self.mounts
    def ancestor_paths(self, root): return [root.parent]
    def runtime(self): return (self.os_name, self.effective_uid)
    def create_directory(self, path, expected_parent, uid, gid, mode):
        self.writes.append(str(path))
        path.mkdir(mode=mode)
        path.chmod(mode)
        self.owners[str(path)] = (uid, gid)
host = SyntheticHost()
def prepare(): return module.prepare("a" * 40, 1001, 1001, host=host, root=base)
def prepared():
    prepare()
    host.writes = []
def optional_file(relative, mode=0o600):
    path = base / relative
    path.write_text("SYNTHETIC-DO-NOT-READ")
    path.chmod(mode)
    host.owners[str(path)] = (1001, 1001)
    return path
result = {}
try:
    CASE_BODY
    result.setdefault("accepted", True)
except module.UnsafeTarget as error:
    result.update(accepted=False, error=str(error))
finally:
    result["writes"] = host.writes
    result["exists"] = base.exists()
    if base.exists() and not base.is_symlink():
        result["directories"] = sorted(str(p.relative_to(base)) for p in base.iterdir() if p.is_dir())
    shutil.rmtree(root)
print(json.dumps(result))
`;
function run(body) {
  const execution = spawnSync("python3", ["-B", "-c", fixture.replace("    CASE_BODY", body.split("\n").map((line) => `    ${line}`).join("\n")), helper], { encoding: "utf8", env: { PATH: process.env.PATH } });
  assert.equal(execution.status, 0, execution.stderr);
  return JSON.parse(execution.stdout);
}

test("host preparation creates only the canonical directory plan and is idempotent", () => {
  const result = run(`first = prepare()\nresult["first"] = first\nprepared()\nresult["second"] = prepare()`);
  assert.equal(result.accepted, true);
  assert.equal(result.first.createdDirectories.length, 7);
  assert.equal(result.second.createdDirectories.length, 0);
  assert.deepEqual(result.directories, ["app", "docker-config", "env", "logs", "postgres", "uploads"]);
  assert.deepEqual(result.writes, []);
  assert.equal(result.first.runtimeConfigured, false);
});

for (const [label, change] of [
  ["low disk", "host.free_bytes = 20 * module.GIB - 1"],
  ["low memory", "host.available_memory = 2 * module.GIB - 1"],
  ["non Linux", 'host.os_name = "Darwin"'],
  ["non root", "host.effective_uid = 1001"],
]) test(`host preparation rejects ${label} before creating directories`, () => {
  const result = run(`${change}\nprepare()`);
  assert.equal(result.accepted, false);
  assert.deepEqual(result.writes, []);
  assert.equal(result.exists, false);
});

for (const [label, change] of [
  ["wrong owner", 'host.owners[str(base / "uploads")] = (1001, 1001)'],
  ["wrong group", 'host.owners[str(base / "env")] = (1001, 1002)'],
  ["permissive directory", '(base / "postgres").chmod(0o750)'],
  ["world writable ancestor", '(root / "opt").chmod(0o777)'],
  ["unexpected root entry", '(base / "unrecognized").mkdir()'],
  ["mount alias", 'host.mounts = [str(base / "uploads")]'],
]) test(`host preparation refuses ${label} without repairing or writing`, () => {
  const result = run(`prepared()\n${change}\nprepare()`);
  assert.equal(result.accepted, false);
  assert.deepEqual(result.writes, []);
});

test("host preparation rejects a symlinked staging root without touching its destination", () => {
  const result = run(`sentinel = root / "production"\nsentinel.mkdir()\n(sentinel / "keep").write_text("UNCHANGED")\nbase.symlink_to(sentinel, target_is_directory=True)\nprepare()`);
  assert.equal(result.accepted, false);
  assert.deepEqual(result.writes, []);
});

test("host preparation rejects a symlinked optional protected env without reading contents", () => {
  const result = run(`prepared()\n(base / "env" / "backend.env").symlink_to(root / "missing-secret")\nprepare()`);
  assert.equal(result.accepted, false);
  assert.deepEqual(result.writes, []);
});

test("host preparation rejects a hard linked env file before any missing directories are created", () => {
  const result = run(`prepared()\npath = optional_file("env/backend.env")\nos.link(path, root / "other-secret")\n(base / "app").rmdir()\nprepare()`);
  assert.equal(result.accepted, false);
  assert.deepEqual(result.writes, []);
});

test("host preparation accepts protected single link env files but never reads or changes them", () => {
  const result = run(`prepared()\npath = optional_file("env/backend.env")\noptional_file("env/compose.env")\noptional_file("docker-config/config.json")\noptional_file("deploy.lock")\nbefore = path.stat()\noriginal = pathlib.Path.read_text\ndef forbidden_read(self, *args, **kwargs): raise AssertionError("content read forbidden")\npathlib.Path.read_text = forbidden_read\ntry: prepare()\nfinally: pathlib.Path.read_text = original\nresult["unchanged"] = path.stat() == before`);
  assert.equal(result.accepted, true);
  assert.equal(result.unchanged, true);
  assert.deepEqual(result.writes, []);
});

test("host preparation rejects an existing protected file with permissive mode", () => {
  const result = run(`prepared()\noptional_file("env/backend.env", mode=0o644)\nprepare()`);
  assert.equal(result.accepted, false);
  assert.deepEqual(result.writes, []);
});

test("sudo Docker configuration may be root owned but must retain its dedicated protected mode", () => {
  const result = run(`prepared()\nfile = optional_file("docker-config/config.json")\nhost.owners[str(file)] = (0, 0)\nprepare()`);
  assert.equal(result.accepted, true);
  assert.deepEqual(result.writes, []);
});

test("host preparation rejects a symlinked ancestor before creating its root", () => {
  const result = run(`original = root / "actual-opt"\n(root / "opt").rename(original)\n(root / "opt").symlink_to(original, target_is_directory=True)\nprepare()`);
  assert.equal(result.accepted, false);
  assert.deepEqual(result.writes, []);
});

test("host preparation rejects a mount alias on an ancestor", () => {
  const result = run(`host.mounts = [str(root / "opt")]\nprepare()`);
  assert.equal(result.accepted, false);
  assert.deepEqual(result.writes, []);
});

test("host preparation CLI rejects unsupported confirmation, identity and path arguments", () => {
  for (const args of [["a".repeat(40), "WRONG", "1001", "1001"], ["main", "PREPARE_STAGING", "1001", "1001"], ["a".repeat(40), "PREPARE_STAGING", "0", "1001"], ["a".repeat(40), "PREPARE_STAGING", "1001;touch x", "1001"], ["a".repeat(40), "PREPARE_STAGING", "1001", "1001", "/tmp/override"]]) {
    const execution = spawnSync("python3", ["-B", helper, ...args], { encoding: "utf8", env: { PATH: process.env.PATH } });
    assert.equal(execution.status, 1);
    assert.doesNotMatch(execution.stdout, /createdDirectories/);
  }
});

function withSharedPreflight(fn) {
  const scratch = realpathSync(mkdtempSync(path.join(tmpdir(), "fleetum-shared-host-synthetic-")));
  try {
    const base = path.join(scratch, "staging");
    const bin = path.join(scratch, "bin"); mkdirSync(bin);
    for (const name of ["app", "env", "postgres", "uploads", "logs", "docker-config"]) mkdirSync(path.join(base, name), { recursive: true });
    chmodSync(base, 0o750);
    for (const name of ["app", "uploads", "logs"]) chmodSync(path.join(base, name), 0o750);
    for (const name of ["env", "postgres", "docker-config"]) chmodSync(path.join(base, name), 0o700);
    for (const name of ["backend.env", "compose.env"]) writeFileSync(path.join(base, "env", name), "SYNTHETIC-NOT-READ");
    for (const name of ["backend.env", "compose.env"]) chmodSync(path.join(base, "env", name), 0o600);
    const script = readFileSync(new URL("../staging/target-preflight.sh", import.meta.url), "utf8").replaceAll("/opt/fleetum-staging", base);
    const file = path.join(scratch, "check.sh"); writeFileSync(file, script);
    const mock = path.join(bin, "docker");
    writeFileSync(mock, `#!${process.execPath}\nconst fs=require('node:fs');const a=process.argv.slice(2), data=JSON.parse(fs.readFileSync(process.env.SYNTHETIC_DOCKER_DATA)); fs.appendFileSync(process.env.SYNTHETIC_DOCKER_CALLS,JSON.stringify(a)+'\\n');const format=a[a.indexOf('--format')+1],name=a.at(-1);let value;if(a[0]==='ps')value=data.members.join('\\n');else if(a[0]==='network'&&a[1]==='ls')value=Object.keys(data.networks).join('\\n');else if(a[0]==='container'&&a[1]==='inspect')value=data.containers[name]?.id;else if(a[0]==='inspect') {const c=data.containers[name];if(c) {if(format.includes('com.docker.compose.project'))value=c.project;else if(format.includes('PortBindings'))value=c.ports;else if(format.includes('if index')){if(!data.gatewayMetadataFailure)value=(c.networks||[]).includes('fleetum_staging_ingress')?'shared':'';}else if(format.includes('.Aliases'))value=(c.aliases||[]).join('\\n');else if(format.includes('printf'))value=c.networks.join('\\n');else if(format.includes('IPAddress'))value=c.ip;}}else if(a[0]==='network'&&a[1]==='inspect'){const n=data.networks[name];if(n){if(format==='{{.Id}}')value=n.id;else if(format.includes('com.docker.compose.project'))value=n.project;else if(format.includes('com.fleetum.environment'))value=n.environment;else if(format.includes('com.fleetum.purpose'))value=n.purpose;else if(format==='{{.Driver}}')value=n.driver;else if(format==='{{.Internal}}')value=n.internal;else if(format.includes('.Subnet'))value=n.subnet;else if(format.includes('.Gateway'))value=n.gateway;else if(format.includes('.Containers'))value=n.members.join('\\n');}}if(value===undefined)process.exit(1);process.stdout.write(String(value)+'\\n');\n`, { mode: 0o700 });
    writeFileSync(path.join(bin, "realpath"), `#!${process.execPath}\nprocess.stdout.write(require('node:fs').realpathSync(process.argv.at(-1))+'\\n');\n`, { mode: 0o700 });
    writeFileSync(path.join(bin, "stat"), `#!${process.execPath}\nprocess.stdout.write(String(require('node:fs').lstatSync(process.argv.at(-1)).nlink)+'\\n');\n`, { mode: 0o700 });
    writeFileSync(path.join(bin, "sudo"), '#!/bin/sh\n[ "$1" = -n ] || exit 1\nshift\nexec "$@"\n', { mode: 0o700 });
    writeFileSync(path.join(bin, "id"), '#!/bin/sh\ncase "$1" in -u|-g) echo 1001;; *) exit 1;; esac\n', { mode: 0o700 });
    // Preserve real path types, inode identities, modes and hard-link counts.
    // Only Linux ownership and mount metadata are substituted on the Mac.
    const prefix = String.raw`
import builtins, io, json, os, pathlib
synthetic = json.loads(pathlib.Path(os.environ["SYNTHETIC_DOCKER_DATA"]).read_text())
base = pathlib.Path(os.environ["SYNTHETIC_STAGING_BASE"])
original_lstat = os.lstat
def synthetic_lstat(path, *args, **kwargs):
    value = original_lstat(path, *args, **kwargs)
    fields = list(value)
    parsed = pathlib.Path(path)
    if parsed in base.parents:
        fields[4] = 0
        fields[0] = (fields[0] & ~0o777) | 0o755
    elif parsed == base or base in parsed.parents:
        fields[4], fields[5] = 1001, 1001
        if parsed == base / "postgres": fields[4] = 70
        elif parsed in {base / "uploads", base / "logs"}: fields[4] = 1000
    for name, changes in synthetic.get("metadataChanges", {}).items():
        if parsed == base / name:
            for field, index in [("uid", 4), ("gid", 5), ("links", 3), ("inode", 1), ("device", 2)]:
                if field in changes: fields[index] = changes[field]
    return os.stat_result(fields)
os.lstat = synthetic_lstat
original_open = builtins.open
def synthetic_open(path, *args, **kwargs):
    if str(path) == "/proc/self/mountinfo":
        return io.StringIO("\n".join(synthetic.get("mountinfo", [])))
    return original_open(path, *args, **kwargs)
builtins.open = synthetic_open
`;
    writeFileSync(path.join(bin, "python3"), `#!${process.execPath}\nconst fs=require('node:fs'),{spawnSync}=require('node:child_process');const input=fs.readFileSync(0,'utf8'); const result=spawnSync(${JSON.stringify(pythonExecutable)},['-B','-',...process.argv.slice(3)],{input:${JSON.stringify(prefix)}+'\\n'+input,env:process.env,encoding:'utf8'});process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');process.exit(result.status??1);\n`, { mode: 0o700 });
    const data = {
      members: ["fleetum_staging_backend", "fleetum_staging_caddy", "fleetum_staging_postgres"],
      containers: Object.fromEntries(["backend", "caddy", "postgres"].map((name) => [`fleetum_staging_${name}`, { id: name, project: "fleetum-staging", ports: 0, networks: name === "caddy" ? ["fleetum_staging_private", "fleetum_staging_ingress"] : ["fleetum_staging_private"], ip: "10.203.91.3", aliases: ["fleetum-staging-ingress"] }])),
      networks: {
        fleetum_staging_private: { id: "private", project: "fleetum-staging", internal: true },
        fleetum_staging_ingress: { id: "ingress", environment: "staging", purpose: "shared-ingress", driver: "bridge", internal: true, subnet: "10.203.91.0/28", gateway: "10.203.91.1", members: ["fleetum_caddy", "fleetum_staging_caddy"] },
      },
    };
    data.containers.fleetum_caddy = { id: "production", ip: "10.203.91.2" };
    const dataFile = path.join(scratch, "docker.json"), callsFile = path.join(scratch, "calls.jsonl");
    const run = (mode = "direct", profile = "shared") => {
      writeFileSync(dataFile, JSON.stringify(data)); writeFileSync(callsFile, "");
      return spawnSync("sh", [file, "a".repeat(40), profile, mode], { env: { PATH: `${path.dirname(mock)}:/usr/bin:/bin`, SYNTHETIC_DOCKER_DATA: dataFile, SYNTHETIC_DOCKER_CALLS: callsFile, SYNTHETIC_STAGING_BASE: base }, encoding: "utf8" });
    };
    fn({ base, scratch, data, run, callsFile });
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

test("shared host preflight accepts only the isolated networks and fixed ingress peers in direct and sudo mode", () => {
  withSharedPreflight(({ run, callsFile }) => {
    for (const mode of ["direct", "sudo"]) {
      const result = run(mode); assert.equal(result.status, 0, result.stderr);
      const calls = readFileSync(callsFile, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      for (const call of calls) {
        assert.notEqual(call[0], "compose");
        assert.ok(call[0] === "inspect" || call[0] === "ps" || (call[0] === "network" && ["ls", "inspect"].includes(call[1])) || (call[0] === "container" && call[1] === "inspect"));
        assert.doesNotMatch(call.join(" "), /Config\.Env/);
      }
    }
  });
});

for (const [label, change] of [
  ["an unknown ingress member", (data) => data.networks.fleetum_staging_ingress.members.push("foreign_backend")],
  ["a wrong ingress ownership label", (data) => data.networks.fleetum_staging_ingress.environment = "production"],
  ["a wrong ingress purpose label", (data) => data.networks.fleetum_staging_ingress.purpose = "other"],
  ["an external private network", (data) => data.networks.fleetum_staging_private.internal = false],
  ["an external ingress network", (data) => data.networks.fleetum_staging_ingress.internal = false],
  ["a different ingress subnet", (data) => data.networks.fleetum_staging_ingress.subnet = "10.0.0.0/24"],
  ["a different ingress gateway", (data) => data.networks.fleetum_staging_ingress.gateway = "10.203.91.4"],
  ["a wrong production ingress IP", (data) => data.containers.fleetum_caddy.ip = "10.203.91.9"],
  ["a missing ingress alias", (data) => data.containers.fleetum_staging_caddy.aliases = []],
  ["a public backend port", (data) => data.containers.fleetum_staging_backend.ports = 1],
  ["a backend attached to ingress", (data) => data.containers.fleetum_staging_backend.networks.push("fleetum_staging_ingress")],
  ["an extra staging edge network", (data) => data.containers.fleetum_staging_caddy.networks.push("fleetum_staging_edge")],
  ["an uninspectable existing container", (data) => delete data.containers.fleetum_staging_backend],
  ["an uninspectable existing network", (data) => data.networks.fleetum_staging_ingress.id = undefined],
  ["an absent external ingress network", (data) => delete data.networks.fleetum_staging_ingress],
]) test(`shared host preflight rejects ${label}`, () => {
  withSharedPreflight(({ data, run }) => { change(data); assert.equal(run().status, 1); });
});

test("shared host preflight permits a new stack only after its external ingress is provisioned", () => {
  withSharedPreflight(({ data, run }) => {
    const ingress = { ...data.networks.fleetum_staging_ingress, members: [] };
    data.members = []; data.containers = {}; data.networks = { fleetum_staging_ingress: ingress };
    const result = run(); assert.equal(result.status, 0, result.stderr);
  });
});

test("shared host preflight rejects symlink and hard link protected paths without changing targets", () => {
  withSharedPreflight(({ base, scratch, run }) => {
    const marker = path.join(scratch, "outside"); writeFileSync(marker, "UNCHANGED");
    symlinkSync(marker, path.join(base, "docker-config", "config.json"));
    assert.equal(run().status, 1);
    assert.equal(readFileSync(marker, "utf8"), "UNCHANGED");
  });
  withSharedPreflight(({ base, scratch, run }) => {
    linkSync(path.join(base, "env", "backend.env"), path.join(scratch, "outside"));
    assert.equal(run().status, 1);
  });
});

test("shared host preflight rejects unsupported profiles and arbitrary Docker prefixes before metadata access", () => {
  withSharedPreflight(({ run, callsFile }) => {
    assert.equal(run("sudo; touch /tmp/forbidden").status, 1);
    assert.equal(readFileSync(callsFile, "utf8"), "");
    assert.equal(run("direct", "production").status, 1);
    assert.equal(readFileSync(callsFile, "utf8"), "");
  });
});

for (const [label, alter] of [
  ["wrong env owner", ({ data }) => data.metadataChanges = { "env/backend.env": { uid: 0 } }],
  ["wrong directory group", ({ data }) => data.metadataChanges = { env: { gid: 1002 } }],
  ["permissive env file", ({ base }) => chmodSync(path.join(base, "env/backend.env"), 0o644)],
  ["permissive env directory", ({ base }) => chmodSync(path.join(base, "env"), 0o755)],
  ["wrong Postgres mode", ({ base }) => chmodSync(path.join(base, "postgres"), 0o750)],
  ["wrong root mode", ({ base }) => chmodSync(base, 0o755)],
  ["an extra protected file", ({ base }) => writeFileSync(path.join(base, "env/backup.env"), "SYNTHETIC")],
  ["a mount alias", ({ base, data }) => data.mountinfo = [`100 80 8:1 / ${base}/uploads rw - ext4 /dev/synthetic rw`]],
  ["a cross-device path", ({ data }) => data.metadataChanges = { uploads: { device: 99999 } }],
  ["a repeated inode alias", ({ base, data }) => data.metadataChanges = { env: { inode: statSync(path.join(base, "app")).ino } }],
]) test(`shared metadata guard rejects ${label} before Docker access`, () => {
  withSharedPreflight((fixture) => {
    alter(fixture);
    const result = fixture.run(); assert.equal(result.status, 1);
    assert.equal(readFileSync(fixture.callsFile, "utf8"), "");
  });
});

test("shared metadata guard allows root-owned dedicated Docker credentials without reading them", () => {
  withSharedPreflight(({ base, data, run }) => {
    writeFileSync(path.join(base, "docker-config/config.json"), "SYNTHETIC-NOT-READ", { mode: 0o600 });
    data.metadataChanges = { "docker-config/config.json": { uid: 0, gid: 0 } };
    const result = run(); assert.equal(result.status, 0, result.stderr);
  });
});

test("dedicated preflight refuses to detach an already shared staging proxy", () => {
  withSharedPreflight(({ base, run, callsFile }) => {
    const before = readFileSync(path.join(base, "env/backend.env"), "utf8");
    const result = run("direct", "dedicated");
    assert.equal(result.status, 1);
    assert.equal(readFileSync(path.join(base, "env/backend.env"), "utf8"), before);
    const calls = readFileSync(callsFile, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.ok(calls.some((call) => call.includes('{{if index .NetworkSettings.Networks "fleetum_staging_ingress"}}shared{{end}}')));
    assert.ok(calls.every((call) => call[0] === "ps" || call[0] === "inspect" || (call[0] === "container" && call[1] === "inspect")));
  });
});

test("dedicated preflight still accepts an existing dedicated staging proxy", () => {
  withSharedPreflight(({ data, run }) => {
    data.containers.fleetum_staging_caddy.networks = ["fleetum_staging_private", "fleetum_staging_edge"];
    const result = run("direct", "dedicated");
    assert.equal(result.status, 0, result.stderr);
  });
});

test("dedicated preflight fails closed when shared ingress metadata is unavailable", () => {
  withSharedPreflight(({ data, run }) => {
    data.gatewayMetadataFailure = true;
    assert.equal(run("direct", "dedicated").status, 1);
  });
  withSharedPreflight(({ data, run }) => {
    delete data.containers.fleetum_staging_caddy;
    assert.equal(run("direct", "dedicated").status, 1);
  });
});
