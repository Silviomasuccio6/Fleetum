#!/usr/bin/env python3
"""Gateway-only control. No production env file or database access, no pull/build."""
import fcntl
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import sys
import time

APP = Path('/opt/fleetum/app')
STATE = Path('/opt/fleetum/ingress-control')
LOCK = Path('/opt/fleetum/deploy.lock')
NETWORK = 'fleetum_staging_ingress'
PRIVATE = 'app_fleetum_private'
FILES = ['Caddyfile', 'Caddyfile.production-shared', 'Caddyfile.staging-ingress']
SHA = re.compile(r'[a-f0-9]{40}')
DIGEST = re.compile(r'[a-f0-9]{64}')

class Refused(Exception):
    pass

def require(value, code):
    if not value:
        raise Refused(code)

def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()

def file_hash(path):
    require(path.is_file() and not path.is_symlink(), 'unsafe-file')
    info = path.stat()
    require(info.st_nlink == 1 and info.st_size < 262144, 'unsafe-file')
    return hashlib.sha256(path.read_bytes()).hexdigest()

def validate_request(request):
    require(isinstance(request, dict), 'invalid-request')
    common = {'mode', 'sourceSha', 'image', 'composeHash', 'caddyHash', 'bundleHashes'}
    mode = request.get('mode')
    extra = set() if mode == 'plan' else {'confirm', 'planDigest', 'email'}
    require(mode in {'plan', 'apply', 'recover'} and set(request) == common | extra, 'invalid-request')
    require(SHA.fullmatch(request.get('sourceSha', '')), 'invalid-source')
    require(re.fullmatch(r'ghcr.io/silviomasuccio6/fleetum-frontend@sha256:[a-f0-9]{64}', request.get('image', '')), 'invalid-image')
    for name in ['composeHash', 'caddyHash']:
        require(DIGEST.fullmatch(request.get(name, '')), 'invalid-baseline')
    require(isinstance(request['bundleHashes'], dict) and set(request['bundleHashes']) == set(FILES), 'invalid-bundle')
    require(all(isinstance(v, str) and DIGEST.fullmatch(v) for v in request['bundleHashes'].values()), 'invalid-bundle')
    require(request['bundleHashes']['Caddyfile'] == request['caddyHash'], 'baseline-source-mismatch')
    if mode != 'plan':
        expected = 'ACTIVATE_STAGING_INGRESS' if mode == 'apply' else 'RECOVER_STAGING_INGRESS'
        require(request.get('confirm') == expected and DIGEST.fullmatch(request.get('planDigest', '')), 'confirmation-required')
        email = request.get('email')
        require(isinstance(email, str) and re.fullmatch(r'[A-Za-z0-9.!#$%&*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+', email)
                and len(email) <= 254, 'protected-email-required')
    return request

def network_valid(network):
    require(network.get('Name') == NETWORK and network.get('Driver') == 'bridge' and network.get('Internal') is True
            and network.get('EnableIPv6') is False, 'foreign-network')
    require(re.fullmatch(r'[a-f0-9]{64}', network.get('Id', '')) and not network.get('Options')
            and (network.get('IPAM') or {}).get('Driver', 'default') == 'default', 'foreign-network')
    labels = network.get('Labels') or {}
    require(labels.get('com.fleetum.environment') == 'staging' and labels.get('com.fleetum.purpose') == 'shared-ingress', 'foreign-network')
    config = (network.get('IPAM') or {}).get('Config')
    require(not (network.get('IPAM') or {}).get('Options'), 'foreign-network')
    require(isinstance(config, list) and len(config) == 1 and config[0].get('Subnet') == '10.203.91.0/28'
            and config[0].get('Gateway') == '10.203.91.1' and config[0].get('IPRange') in {None, ''}
            and not config[0].get('AuxiliaryAddresses'), 'foreign-network')
    members = network.get('Containers') or {}
    require(isinstance(members, dict) and len(members) <= 2, 'foreign-network')
    seen = set()
    for member in members.values():
        name = member.get('Name')
        expected = {'fleetum_caddy': '10.203.91.2/28', 'fleetum_staging_caddy': '10.203.91.3/28'}
        require(name in expected and name not in seen and member.get('IPv4Address') == expected[name]
                and not member.get('IPv6Address'), 'foreign-network')
        seen.add(name)

def verify_routes(networks, routes):
    desired = ipaddress.ip_network('10.203.91.0/28')
    bridge = None
    for network in networks:
        if network.get('Name') == NETWORK:
            network_valid(network)
            bridge = 'br-' + network['Id'][:12]
        else:
            for config in (network.get('IPAM') or {}).get('Config') or []:
                subnet = ipaddress.ip_network(config['Subnet'], strict=False)
                require(subnet.version != 4 or not subnet.overlaps(desired), 'subnet-conflict')
    for route in routes:
        destination = route.get('dst', 'default')
        if destination != 'default':
            subnet = ipaddress.ip_network(destination, strict=False)
            if subnet.version == 4 and subnet.overlaps(desired):
                require(bridge is not None and route.get('dev') == bridge and subnet.subnet_of(desired), 'route-conflict')

class Gateway:
    def __init__(self, bundle, request):
        self.bundle = Path(bundle)
        self.request = validate_request(request)
        self.docker = ['docker', '--config', str(self.bundle / '.docker-noauth')]
        self.paths = {'app': APP, 'state': STATE, 'lock': LOCK}

    def run(self, args, input_data=None, email=None):
        env = {'PATH': '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL': 'C', 'COMPOSE_DISABLE_ENV_FILE': 'true'}
        if email is not None:
            env['CADDY_EMAIL'] = email
        try:
            result = subprocess.run(args, input=input_data, text=True, capture_output=True, timeout=90, env=env)
        except (OSError, subprocess.TimeoutExpired):
            raise Refused('command-unavailable') from None
        require(result.returncode == 0 and len(result.stdout.encode()) <= 262144, 'command-failed')
        return result.stdout

    def inspect(self, name):
        # Deliberately excludes .Config.Env, inspect never prints credentials.
        template = '{"Id":{{json .Id}},"Image":{{json .Image}},"State":{"Running":{{json .State.Running}},"StartedAt":{{json .State.StartedAt}},"RestartCount":{{json .RestartCount}}},"Labels":{"com.docker.compose.project":{{json (index .Config.Labels "com.docker.compose.project")}},"com.docker.compose.service":{{json (index .Config.Labels "com.docker.compose.service")}}},"Cmd":{{json .Config.Cmd}},"Entrypoint":{{json .Config.Entrypoint}},"User":{{json .Config.User}},"Mounts":{{json .Mounts}},"Networks":{{json .NetworkSettings.Networks}},"Ports":{{json .HostConfig.PortBindings}},"Restart":{{json .HostConfig.RestartPolicy}},"Privileged":{{json .HostConfig.Privileged}},"Readonly":{{json .HostConfig.ReadonlyRootfs}},"CapAdd":{{json .HostConfig.CapAdd}},"CapDrop":{{json .HostConfig.CapDrop}},"SecurityOpt":{{json .HostConfig.SecurityOpt}},"Memory":{{json .HostConfig.Memory}},"NanoCpus":{{json .HostConfig.NanoCpus}},"PidsLimit":{{json .HostConfig.PidsLimit}},"Logs":{{json .HostConfig.LogConfig}}}'
        if name != 'fleetum_caddy':
            template = '{"Id":{{json .Id}},"Image":{{json .Image}},"State":{"Running":{{json .State.Running}},"StartedAt":{{json .State.StartedAt}},"RestartCount":{{json .RestartCount}}},"Labels":{"com.docker.compose.project":{{json (index .Config.Labels "com.docker.compose.project")}}},"Networks":{{json .NetworkSettings.Networks}}}'
        return json.loads(self.run(self.docker + ['inspect', '--format', template, name]))

    def filesystem(self):
        app = self.paths['app']
        for path in [app, app / 'deploy', app / 'deploy/caddy', self.paths['state'].parent]:
            require(path.is_dir() and path.resolve() == path and not path.stat().st_mode & 0o022, 'unsafe-path')
        require(file_hash(app / 'docker-compose.prod.yml') == self.request['composeHash'], 'baseline-drift')
        require(file_hash(app / 'deploy/caddy/Caddyfile') == self.request['caddyHash'], 'baseline-drift')
        noauth = self.bundle / '.docker-noauth'
        require(noauth.is_dir() and not noauth.is_symlink() and not list(noauth.iterdir()), 'docker-auth-refused')
        for name in FILES:
            require(file_hash(self.bundle / name) == self.request['bundleHashes'][name], 'bundle-drift')
        for name in FILES[1:]:
            target = app / 'deploy/caddy' / name
            if target.exists() or target.is_symlink():
                require(file_hash(target) == self.request['bundleHashes'][name], 'foreign-config')
        state = self.paths['state']
        if state.exists() or state.is_symlink():
            require(state.is_dir() and not state.is_symlink() and state.stat().st_uid == 0
                    and stat.S_IMODE(state.stat().st_mode) == 0o700, 'unsafe-state')

    def snapshot(self):
        self.filesystem()
        compose_version = self.run(self.docker + ['compose', 'version', '--short']).strip()
        require(re.fullmatch(r'v?2\.40\.3(?:\+[A-Za-z0-9.-]+)?', compose_version), 'compose-version-drift')
        image = self.request['image']
        image_id = self.image_identity()
        containers = {name: self.inspect(name) for name in ['fleetum_caddy', 'fleetum_backend', 'fleetum_postgres']}
        gateway = containers['fleetum_caddy']
        require(gateway['Image'] == image_id and gateway['State']['Running'] is True, 'gateway-drift')
        require(self.run(self.docker + ['exec', 'fleetum_caddy', 'caddy', 'version']).startswith('v2.11.4 '), 'caddy-version-drift')
        labels = gateway['Labels']
        require(labels.get('com.docker.compose.project') == 'app' and labels.get('com.docker.compose.service') == 'caddy', 'gateway-owner-drift')
        require(gateway['Cmd'] == ['caddy', 'run', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile']
                and gateway['Entrypoint'] in (None, []) and gateway['User'] == '', 'gateway-command-drift')
        require(gateway['Restart'] == {'Name': 'unless-stopped', 'MaximumRetryCount': 0}, 'gateway-policy-drift')
        require(not gateway['Privileged'] and not gateway['Readonly'] and not gateway['CapAdd'] and not gateway['CapDrop']
                and not gateway['SecurityOpt'] and gateway['Memory'] == 0 and gateway['NanoCpus'] == 0
                and gateway['PidsLimit'] in {None, 0, -1} and gateway['Logs'] == {'Type': 'json-file', 'Config': {}}, 'gateway-policy-drift')
        ports = gateway['Ports']
        require(set(ports) == {'80/tcp', '443/tcp'}, 'gateway-ports-drift')
        for port, bindings in ports.items():
            require(bindings and all(v['HostPort'] == port.split('/')[0] and v['HostIp'] in {'', '0.0.0.0', '::'} for v in bindings), 'gateway-ports-drift')
        networks = gateway['Networks']
        require(set(networks) in [{PRIVATE}, {PRIVATE, NETWORK}], 'gateway-network-drift')
        shared = NETWORK in networks
        if shared:
            require(networks[NETWORK]['IPAddress'] == '10.203.91.2', 'gateway-network-drift')
        expected_mounts = {'/config': ('volume', 'app_caddy_config', True), '/data': ('volume', 'app_caddy_data', True),
            '/etc/caddy/Caddyfile': ('bind', str(self.paths['app'] / 'deploy/caddy' / ('Caddyfile.production-shared' if shared else 'Caddyfile')), False)}
        if shared:
            expected_mounts['/etc/caddy/production-baseline'] = ('bind', str(self.paths['app'] / 'deploy/caddy/Caddyfile'), False)
            expected_mounts['/etc/caddy/staging-ingress'] = ('bind', str(self.paths['app'] / 'deploy/caddy/Caddyfile.staging-ingress'), False)
        require(len(gateway['Mounts']) == len(expected_mounts), 'gateway-mount-drift')
        for mount in gateway['Mounts']:
            identifier = mount.get('Name') if mount['Type'] == 'volume' else mount['Source']
            require(expected_mounts.get(mount['Destination']) == (mount['Type'], identifier, mount['RW']), 'gateway-mount-drift')
        private = json.loads(self.run(self.docker + ['network', 'inspect', '--format', '{"Name":{{json .Name}},"Driver":{{json .Driver}},"Id":{{json .Id}}}', PRIVATE]))
        require(private['Name'] == PRIVATE and private['Driver'] == 'bridge' and networks[PRIVATE]['NetworkID'] == private['Id'], 'private-network-drift')
        for name in ['fleetum_backend', 'fleetum_postgres']:
            container = containers[name]
            require(container['State']['Running'] is True and container['Labels'].get('com.docker.compose.project') == 'app'
                    and set(container['Networks']) == {PRIVATE} and container['Networks'][PRIVATE]['NetworkID'] == private['Id'], 'application-drift')
        ingress = self.network_preflight()
        require(not shared or ingress is not None, 'network-metadata-failed')
        return {'sourceSha': self.request['sourceSha'], 'image': image, 'composeVersion': compose_version, 'gateway': gateway['Id'], 'gatewayState': gateway['State'], 'shared': shared,
                'applications': {name: {key: containers[name][key] for key in ['Id', 'Image', 'State']} for name in ['fleetum_backend', 'fleetum_postgres']},
                'network': ingress, 'privateId': private['Id'], 'composeHash': self.request['composeHash'],
                'caddyHash': self.request['caddyHash'], 'bundleHashes': self.request['bundleHashes']}

    def network_preflight(self):
        ids = self.run(self.docker + ['network', 'ls', '-q']).split()
        require(ids and all(re.fullmatch(r'[a-f0-9]{12,64}', item) for item in ids), 'network-metadata-failed')
        network_output = self.run(self.docker + ['network', 'inspect', '--format', '{"Name":{{json .Name}},"Id":{{json .Id}},"Driver":{{json .Driver}},"Internal":{{json .Internal}},"EnableIPv6":{{json .EnableIPv6}},"IPAM":{{json .IPAM}},"Options":{{json .Options}},"Labels":{"com.fleetum.environment":{{json (index .Labels "com.fleetum.environment")}},"com.fleetum.purpose":{{json (index .Labels "com.fleetum.purpose")}}},"Containers":{{json .Containers}}}', *ids])
        all_networks = [json.loads(line) for line in network_output.splitlines() if line.strip()]
        require(len(all_networks) == len(ids) and all(isinstance(n, dict) and isinstance(n.get('Name'), str)
                and re.fullmatch(r'[a-f0-9]{64}', n.get('Id', '')) for n in all_networks)
                and len({n['Id'] for n in all_networks}) == len(ids), 'network-metadata-failed')
        require(sum(n['Name'] == PRIVATE for n in all_networks) == 1
                and sum(n['Name'] == NETWORK for n in all_networks) <= 1, 'network-metadata-failed')
        routes = json.loads(self.run(['ip', '-j', '-4', 'route', 'show', 'table', 'all']))
        verify_routes(all_networks, routes)
        return next((n for n in all_networks if n['Name'] == NETWORK), None)

    def image_identity(self):
        # Compose inherits these image defaults: prove they match the live
        # gateway before relying on them, without inspecting image Env.
        template = '{"Id":{{json .Id}},"Cmd":{{json .Config.Cmd}},"Entrypoint":{{json .Config.Entrypoint}},"User":{{json .Config.User}}}'
        image = json.loads(self.run(self.docker + ['image', 'inspect', '--format', template, self.request['image']]))
        require(re.fullmatch(r'sha256:[a-f0-9]{64}', image.get('Id', '')), 'invalid-image-metadata')
        require(image.get('Cmd') == ['caddy', 'run', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile']
                and image.get('Entrypoint') in (None, []) and image.get('User') == '', 'image-command-drift')
        return image['Id']

    def config_check(self):
        # adapt parses without provision/validate, no certificate writes or env output.
        combined = (self.bundle / 'Caddyfile').read_text() + '\n' + (self.bundle / 'Caddyfile.staging-ingress').read_text()
        self.run(self.docker + ['exec', '-i', 'fleetum_caddy', 'sh', '-c', 'caddy adapt --config - --adapter caddyfile >/dev/null 2>/dev/null'], input_data=combined)

    def read_journal(self, journal):
        require(file_hash(journal) and journal.stat().st_uid == 0 and stat.S_IMODE(journal.stat().st_mode) == 0o600, 'unsafe-journal')
        record = json.loads(journal.read_text())
        require(record['before']['sourceSha'] == self.request['sourceSha'] and record['before']['image'] == self.request['image'], 'journal-source-mismatch')
        require(fingerprint(record['before']) == self.request['planDigest'], 'journal-plan-mismatch')
        require(record['emailDigest'] == hashlib.sha256(self.request['email'].encode()).hexdigest(), 'protected-email-mismatch')
        return record

    def recover(self):
        # Recovery must work even when the replacement gateway cannot start.
        self.filesystem()
        require(os.geteuid() == 0, 'root-required')
        require(re.fullmatch(r'v?2\.40\.3(?:\+[A-Za-z0-9.-]+)?', self.run(self.docker + ['compose', 'version', '--short']).strip()), 'compose-version-drift')
        state = self.paths['state']; journal = state / (self.request['planDigest'] + '.json')
        record = self.read_journal(journal)
        require(record['phase'] in {'prepared', 'network-created', 'gateway-started', 'applied', 'recovery-failed', 'recovered'}, 'recovery-unavailable')
        self.check_applications(record['before'])
        self.network_preflight()
        image_id = self.image_identity()
        ids = self.run(self.docker + ['ps', '-a', '--filter', 'name=^/fleetum_caddy$', '--format', '{{.ID}}']).split()
        require(len(ids) <= 1, 'gateway-owner-drift')
        if ids:
            gateway = self.inspect('fleetum_caddy')
            require(gateway['Image'] == image_id and gateway['Labels'].get('com.docker.compose.project') == 'app'
                    and gateway['Labels'].get('com.docker.compose.service') == 'caddy', 'gateway-owner-drift')
        private = json.loads(self.run(self.docker + ['network', 'inspect', '--format', '{"Name":{{json .Name}},"Driver":{{json .Driver}},"Id":{{json .Id}}}', PRIVATE]))
        require(private['Name'] == PRIVATE and private['Id'] == record['before']['privateId'] and private['Driver'] == 'bridge', 'private-network-drift')
        base = state / (self.request['planDigest'] + '.baseline.json')
        require(file_hash(base) and json.loads(base.read_text()) == self.manifest(False), 'manifest-drift')
        try:
            self.compose(base); self.health(wait=True); self.check_applications(record['before'])
            require(not self.snapshot()['shared'], 'recovery-incomplete')
            record['phase'] = 'recovered'; self.write_state(journal, record)
            return {'status': 'recovered', 'planDigest': self.request['planDigest']}
        except Exception:
            record['phase'] = 'recovery-failed'; self.write_state(journal, record)
            raise Refused('recovery-failed') from None

    def health(self, wait=False):
        deadline = time.monotonic() + (60 if wait else 0)
        while True:
            try:
                for url in ['https://fleetum.it/', 'https://api.fleetum.it/api/ready', 'https://platform.fleetum.it/platform-api/health']:
                    host = url.split('/')[2]
                    base = ['curl', '--fail', '--silent', '--show-error', '--max-time', '5', '--output', '/dev/null']
                    self.run(base + ['--resolve', host + ':443:127.0.0.1', url])
                    self.run(base + [url])
                return
            except Refused:
                if not wait or time.monotonic() >= deadline:
                    raise
                time.sleep(1)

    def email_check(self):
        # Compare protected input inside Caddy. Never emit or copy its environment.
        self.run(self.docker + ['exec', '-i', 'fleetum_caddy', 'sh', '-c', '[ "$CADDY_EMAIL" = "$(cat)" ]'], input_data=self.request['email'])

    def manifest(self, shared):
        app = self.paths['app']
        mounts = [f'{app}/deploy/caddy/{"Caddyfile.production-shared" if shared else "Caddyfile"}:/etc/caddy/Caddyfile:ro', 'caddy_data:/data', 'caddy_config:/config']
        networks = {'fleetum_private': {}}
        external = {'fleetum_private': {'external': True, 'name': PRIVATE}}
        if shared:
            mounts += [f'{app}/deploy/caddy/Caddyfile:/etc/caddy/production-baseline:ro', f'{app}/deploy/caddy/Caddyfile.staging-ingress:/etc/caddy/staging-ingress:ro']
            networks[NETWORK] = {'ipv4_address': '10.203.91.2'}
            external[NETWORK] = {'external': True, 'name': NETWORK}
        return {'services': {'caddy': {'image': self.request['image'], 'container_name': 'fleetum_caddy', 'restart': 'unless-stopped',
                'environment': {'CADDY_EMAIL': '${CADDY_EMAIL:?protected input required}'}, 'ports': ['80:80', '443:443'], 'volumes': mounts, 'networks': networks}},
                'networks': external, 'volumes': {'caddy_data': {'external': True, 'name': 'app_caddy_data'}, 'caddy_config': {'external': True, 'name': 'app_caddy_config'}}}

    def write_state(self, path, value):
        fd, filename = tempfile.mkstemp(prefix=path.name + '-pending-', dir=path.parent)
        temporary = Path(filename)
        try:
            with os.fdopen(fd, 'w') as handle:
                json.dump(value, handle, sort_keys=True); handle.write('\n'); handle.flush(); os.fsync(handle.fileno())
            os.replace(temporary, path)
            directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        finally:
            temporary.unlink(missing_ok=True)

    def compose(self, path):
        self.run(self.docker + ['compose', '--project-name', 'app', '--env-file', '/dev/null', '-f', str(path),
                               'up', '-d', '--no-deps', '--no-build', '--pull', 'never', 'caddy'], email=self.request['email'])

    def check_applications(self, before):
        for name, expected in before['applications'].items():
            current = self.inspect(name)
            require(all(current[key] == value for key, value in expected.items()), 'application-changed')

    def execute(self):
        if self.request['mode'] == 'recover':
            return self.recover()
        before = self.snapshot()
        self.config_check()
        self.health()
        plan_digest = fingerprint(before)
        if self.request['mode'] == 'plan':
            return {'status': 'already-active' if before['shared'] else 'planned', 'planDigest': plan_digest, 'snapshot': before, 'mutations': False}
        require(os.geteuid() == 0, 'root-required')
        self.email_check()
        state = self.paths['state']; journal = state / (self.request['planDigest'] + '.json')
        previous = None
        if journal.exists() or journal.is_symlink():
            previous = self.read_journal(journal)
        if previous and previous['phase'] == 'applied' and before['shared'] and previous['afterGateway'] == before['gateway']:
            self.check_applications(previous['before'])
            return {'status': 'already-active', 'mutations': False, 'planDigest': self.request['planDigest']}
        require(plan_digest == self.request['planDigest'], 'stale-plan')
        if before['shared']:
            return {'status': 'already-active', 'mutations': False, 'planDigest': plan_digest}
        require(previous is None, 'recovery-required')
        state.mkdir(mode=0o700, exist_ok=True)
        record = previous or {'before': before, 'phase': 'prepared', 'emailDigest': hashlib.sha256(self.request['email'].encode()).hexdigest()}
        self.write_state(journal, record)
        base = state / (self.request['planDigest'] + '.baseline.json')
        desired = state / (self.request['planDigest'] + '.shared.json')
        for path, shared in [(base, False), (desired, True)]:
            if not path.exists() and not path.is_symlink():
                self.write_state(path, self.manifest(shared))
            else:
                require(file_hash(path) and json.loads(path.read_text()) == self.manifest(shared), 'manifest-drift')
        gateway_started = False
        try:
            if before['network'] is None:
                self.run(self.docker + ['network', 'create', '--driver', 'bridge', '--internal', '--subnet', '10.203.91.0/28', '--gateway', '10.203.91.1',
                         '--label', 'com.fleetum.environment=staging', '--label', 'com.fleetum.purpose=shared-ingress', NETWORK])
                record['phase'] = 'network-created'; self.write_state(journal, record)
                self.network_preflight()
            owner = self.paths['app'].stat()
            for name in FILES[1:]:
                target = self.paths['app'] / 'deploy/caddy' / name
                if not target.exists():
                    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
                    with os.fdopen(fd, 'wb') as handle:
                        handle.write((self.bundle / name).read_bytes()); handle.flush(); os.fsync(handle.fileno()); os.fchown(handle.fileno(), owner.st_uid, owner.st_gid)
            gateway_started = True
            record['phase'] = 'gateway-started'; self.write_state(journal, record)
            self.compose(desired); self.health(wait=True); self.check_applications(before)
            after = self.snapshot(); require(after['shared'], 'activation-incomplete')
            record['phase'] = 'applied'; record['afterGateway'] = after['gateway']; self.write_state(journal, record)
            return {'status': 'applied', 'planDigest': plan_digest, 'gateway': after['gateway']}
        except Exception:
            if gateway_started:
                try:
                    self.compose(base); self.health(wait=True); self.check_applications(before)
                    require(not self.snapshot()['shared'], 'recovery-incomplete')
                    record['phase'] = 'recovered'; self.write_state(journal, record)
                except Exception:
                    record['phase'] = 'recovery-failed'; self.write_state(journal, record)
                    raise Refused('recovery-failed') from None
            raise Refused('activation-failed') from None

def main():
    require(sys.platform == 'linux' and len(sys.argv) == 1, 'unsupported-runtime')
    raw = sys.stdin.buffer.read(16385)
    require(len(raw) <= 16384, 'invalid-request')
    gateway = Gateway(Path(__file__).resolve().parent, json.loads(raw))
    require(LOCK.exists() and not LOCK.is_symlink() and LOCK.resolve() == LOCK, 'production-lock-unavailable')
    fd = os.open(LOCK, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, 'production-lock-unavailable')
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        print(json.dumps(gateway.execute(), sort_keys=True))
    finally:
        os.close(fd)

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'status': 'rejected', 'code': str(error) if isinstance(error, Refused) else 'control-failed'}))
        sys.exit(1)
