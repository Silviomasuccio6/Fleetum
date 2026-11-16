"""Start/stop one isolated CI PostgreSQL. No production environment or defaults."""
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import time


def docker(*args):
    if os.environ.get('GITHUB_ACTIONS')!='true' or sys.platform!='linux':
        raise ValueError('Docker lifecycle is limited to the isolated Linux CI runner')
    result = subprocess.run(['docker', '--host', 'unix:///var/run/docker.sock', *args], capture_output=True, timeout=120)
    if result.returncode:
        raise ValueError('Synthetic database container operation failed')
    return result.stdout.decode().strip()


def start(file, run):
    if not re.fullmatch('[1-9][0-9]*', run) or Path(file).exists():
        raise ValueError('New synthetic session file and run required')
    name = 'fleetum-platform-ci-' + run + '-' + secrets.token_hex(4)
    password = secrets.token_urlsafe(24)
    docker('run', '--rm', '-d', '--name', name, '-e', 'POSTGRES_USER=fleetum_qa',
           '-e', 'POSTGRES_PASSWORD='+password, '-e', 'POSTGRES_DB=postgres',
           '-p', '127.0.0.1::5432', 'postgres:16-alpine',
           '-c', 'cluster_name=fleetum_platform_synthetic_20261115')
    try:
        for _ in range(40):
            try:
                docker('exec', name, 'pg_isready', '-U', 'fleetum_qa', '-d', 'postgres')
                break
            except ValueError:
                time.sleep(0.5)
        else:
            raise ValueError('Temporary PostgreSQL did not become ready')
        address = docker('port', name, '5432/tcp')
        if not re.fullmatch(r'127\.0\.0\.1:[0-9]+', address):
            raise ValueError('Synthetic database is not loopback-only')
        value = {'syntheticOnly': True, 'cluster': 'fleetum_platform_synthetic_20261115',
                 'host': '127.0.0.1', 'port': int(address.split(':')[1]),
                 'user': 'fleetum_qa', 'password': password, 'container': name}
        with Path(file).open('x') as f:
            json.dump(value, f)
        Path(file).chmod(0o600)
    except Exception:
        docker('rm', '-f', '-v', name)
        raise


def stop(file):
    p = Path(file)
    if not p.exists():
        return
    value = json.loads(p.read_text())
    if value.get('syntheticOnly') is not True or not re.fullmatch(r'fleetum-platform-ci-[1-9][0-9]*-[0-9a-f]{8}', value.get('container','')):
        raise ValueError('Refusing to stop an unrecognized database')
    docker('rm', '-f', '-v', value['container'])
    p.unlink()


if __name__ == '__main__':
    try:
        if len(sys.argv) == 4 and sys.argv[1] == 'start':
            start(sys.argv[2], sys.argv[3])
        elif len(sys.argv) == 3 and sys.argv[1] == 'stop':
            stop(sys.argv[2])
        else:
            raise ValueError('Expected synthetic database start/stop')
        print('Synthetic database lifecycle step complete; no credential output.')
    except Exception:
        raise SystemExit('Synthetic database lifecycle failed; inspect only the task-owned container.')
