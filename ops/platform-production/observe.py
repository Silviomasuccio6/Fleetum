"""Read-only production inventory. No env, database, logs or document contents."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

NAMES = ('fleetum_backend', 'fleetum_caddy', 'fleetum_postgres', 'fleetum_db')
ROOTS = ('/opt/fleetum/app', '/srv/fleetum')
FORMAT = ('{"id":{{json .Id}},"imageId":{{json .Image}},"imageRef":{{json .Config.Image}},'
          '"running":{{json .State.Running}},"startedAt":{{json .State.StartedAt}},'
          '"restartCount":{{json .RestartCount}},'
          '"project":{{json (index .Config.Labels "com.docker.compose.project")}},'
          '"service":{{json (index .Config.Labels "com.docker.compose.service")}},'
          '"workingDir":{{json (index .Config.Labels "com.docker.compose.project.working_dir")}},'
          '"configFiles":{{json (index .Config.Labels "com.docker.compose.project.config_files")}},'
          '"mounts":[{{range $i,$m := .Mounts}}{{if $i}},{{end}}'
          '{"source":{{json .Source}},"destination":{{json .Destination}},"rw":{{json .RW}}}{{end}}],'
          '"networks":{{json .NetworkSettings.Networks}}}')


def checked_file(path):
    """Only hash bounded compose/Caddy files; never read an env file."""
    p = Path(path)
    allowed_paths = {root + '/' + rel for root in ROOTS for rel in (
        'docker-compose.prod.yml', 'docker-compose.prod.shared.yml',
        'deploy/caddy/Caddyfile', 'deploy/caddy/Caddyfile.production-shared',
        'deploy/caddy/Caddyfile.staging-ingress')}
    allowed = str(p) in allowed_paths
    if not allowed or any(x.is_symlink() for x in (p, *p.parents)):
        return {'path': str(p), 'verified': False}
    try:
        stat = p.stat()
        if not p.is_file() or stat.st_size > 1024 * 1024:
            return {'path': str(p), 'verified': False}
        return {'path': str(p), 'verified': True, 'bytes': stat.st_size,
                'sha256': hashlib.sha256(p.read_bytes()).hexdigest(),
                'uid': stat.st_uid, 'mode': oct(stat.st_mode & 0o777)}
    except OSError:
        return {'path': str(p), 'verified': False}


class Docker:
    def __init__(self):
        self.prefix = ['docker', '--host', 'unix:///var/run/docker.sock']
        trial = subprocess.run(self.prefix + ['version', '--format', '{{.Server.Version}}'],
                               capture_output=True, timeout=10)
        if trial.returncode:
            self.prefix = ['sudo', '-n', 'docker', '--host', 'unix:///var/run/docker.sock']

    def __call__(self, *args):
        result = subprocess.run(self.prefix + list(args), capture_output=True, timeout=20)
        if result.returncode:
            raise ValueError('Read-only Docker observation unavailable')
        if len(result.stdout) > 512 * 1024:
            raise ValueError('Read-only result exceeds limit')
        return result.stdout.decode()


def observe(docker, inspect_file=checked_file):
    available = docker('ps', '-a', '--format', '{{.Names}}').splitlines()
    if not all(name in available for name in NAMES[:2]):
        raise ValueError('Canonical production containers missing')
    containers = {}
    configs = set()
    for name in NAMES:
        if name not in available:
            continue
        item = json.loads(docker('inspect', '--format', FORMAT, name))
        if not re.fullmatch(r'sha256:[0-9a-f]{64}', item.get('imageId', '')):
            raise ValueError('Invalid image identity')
        item['networks'] = sorted((item.get('networks') or {}).keys())
        item['repoDigests'] = json.loads(docker('image', 'inspect', '--format',
                                               '{{json .RepoDigests}}', item['imageId']))
        containers[name] = item
        for rel in str(item.get('configFiles') or '').split(','):
            if rel:
                configs.add(rel)
        for mount in item.get('mounts', []):
            if mount.get('destination') == '/etc/caddy/Caddyfile':
                configs.add(mount['source'])
    frontend = containers['fleetum_caddy']
    static_mounts = [m['destination'] for m in frontend.get('mounts', [])
                     if any(m['destination'].rstrip('/') == '' or
                            m['destination'].rstrip('/') == root or
                            root.startswith(m['destination'].rstrip('/') + '/') or
                            m['destination'].startswith(root + '/')
                            for root in ('/srv/fleetum', '/srv/fleetum-website'))]
    disks = []
    for root in ROOTS:
        p = Path(root)
        if p.is_dir() and p.resolve() == p:
            usage = shutil.disk_usage(p)
            disks.append({'path': root, 'total': usage.total, 'free': usage.free})
    return {'schemaVersion': 1, 'kind': 'platform-production-readonly-observation',
            'observedAtUTC': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'containers': containers, 'configFingerprints': [inspect_file(p) for p in sorted(configs)],
            'staticRootMounts': static_mounts, 'requiresReview': True,
            'host': {'machine': os.uname().machine, 'disks': disks},
            'databaseRead': False, 'envRead': False, 'writes': False, 'readyForDeployment': False}


if __name__ == '__main__':
    try:
        print(json.dumps(observe(Docker())))
    except Exception:
        raise SystemExit('Bounded production observation failed; no changes made.')
