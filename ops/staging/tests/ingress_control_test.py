"""Synthetic state-machine tests; subprocesses and all live paths are replaced."""
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / 'ingress-control.py'
spec = importlib.util.spec_from_file_location('ingress_control', SOURCE)
control = importlib.util.module_from_spec(spec)
spec.loader.exec_module(control)

def network():
    return {'Name': control.NETWORK, 'Id': 'a' * 64, 'Driver': 'bridge', 'Internal': True,
            'EnableIPv6': False, 'Labels': {'com.fleetum.environment': 'staging', 'com.fleetum.purpose': 'shared-ingress'},
            'IPAM': {'Config': [{'Subnet': '10.203.91.0/28', 'Gateway': '10.203.91.1'}]}, 'Containers': {}}

class FakeGateway(control.Gateway):
    def __init__(self, bundle, request, app, state):
        super().__init__(bundle, request)
        self.paths = {'app': app, 'state': state, 'lock': app.parent / 'deploy.lock'}
        self.calls = []; self.shared = False; self.ingress = None; self.gateway_id = 'baseline-id'
        self.app_change = False; self.gateway_absent = False; self.gateway_running = True
        self.foreign_gateway = False; self.fail_shared = False; self.fail_base = False
        self.fail_network = False; self.fail_health_after = False; self.extra_networks = []
        self.routes = [{'dst': 'default', 'dev': 'eth0'}]; self.version = 'v2.11.4 synthetic'
        self.email_matches = True
        self.compose_version = '2.40.3+ds1-0ubuntu'
        self.image_command = ['caddy', 'run', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile']

    def container(self, name):
        state = {'Running': True, 'StartedAt': '2026-10-10T00:00:00Z', 'RestartCount': 0}
        if name != 'fleetum_caddy':
            if self.app_change: state['RestartCount'] = 1
            return {'Id': name + '-id', 'Image': 'sha256:' + 'c' * 64, 'State': state,
                    'Labels': {'com.docker.compose.project': 'app'}, 'Networks': {control.PRIVATE: {'NetworkID': 'b' * 64}}}
        state['Running'] = self.gateway_running
        mounts = [{'Type': 'volume', 'Name': 'app_caddy_' + n, 'Destination': '/' + n, 'RW': True} for n in ['config', 'data']]
        mounts += [{'Type': 'bind', 'Source': str(self.paths['app'] / 'deploy/caddy' / ('Caddyfile.production-shared' if self.shared else 'Caddyfile')), 'Destination': '/etc/caddy/Caddyfile', 'RW': False}]
        if self.shared:
            mounts += [{'Type': 'bind', 'Source': str(self.paths['app'] / 'deploy/caddy' / source), 'Destination': target, 'RW': False}
                       for source, target in [('Caddyfile', '/etc/caddy/production-baseline'), ('Caddyfile.staging-ingress', '/etc/caddy/staging-ingress')]]
        nets = {control.PRIVATE: {'NetworkID': 'b' * 64}}
        if self.shared: nets[control.NETWORK] = {'NetworkID': 'a' * 64, 'IPAddress': '10.203.91.2'}
        return {'Id': self.gateway_id, 'Image': 'sha256:' + 'd' * 64, 'State': state,
                'Labels': {'com.docker.compose.project': 'foreign' if self.foreign_gateway else 'app', 'com.docker.compose.service': 'caddy'},
                'Cmd': ['caddy', 'run', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'], 'Entrypoint': None, 'User': '',
                'Mounts': mounts, 'Networks': nets, 'Ports': {p + '/tcp': [{'HostPort': p, 'HostIp': ''}] for p in ['80', '443']},
                'Restart': {'Name': 'unless-stopped', 'MaximumRetryCount': 0}, 'Privileged': False, 'Readonly': False,
                'CapAdd': None, 'CapDrop': None, 'SecurityOpt': None, 'Memory': 0, 'NanoCpus': 0, 'PidsLimit': None,
                'Logs': {'Type': 'json-file', 'Config': {}}}

    def run(self, args, input_data=None, email=None):
        self.calls.append((args, input_data, email))
        args = args[3:] if args[:1] == ['docker'] else args
        if args[:2] == ['image', 'inspect']: return json.dumps({'Id': 'sha256:' + 'd' * 64, 'Cmd': self.image_command, 'Entrypoint': None, 'User': ''})
        if args[:1] == ['inspect']:
            if args[-1] == 'fleetum_caddy' and self.gateway_absent: raise control.Refused('command-failed')
            return json.dumps(self.container(args[-1]))
        if args[:1] == ['exec']:
            if args[-1] == 'version': return self.version
            if args[-1].startswith('[ "$CADDY_EMAIL"') and not self.email_matches: raise control.Refused('command-failed')
            return ''
        if args[:2] == ['network', 'ls']: return '\n'.join(['b' * 64] + (['a' * 64] if self.ingress else []) + [n['Id'] for n in self.extra_networks])
        if args[:2] == ['network', 'inspect']:
            if args[-1] == control.PRIVATE: return json.dumps({'Name': control.PRIVATE, 'Driver': 'bridge', 'Id': 'b' * 64})
            nets = [{'Name': control.PRIVATE, 'Id': 'b' * 64, 'IPAM': {'Config': [{'Subnet': '172.18.0.0/16'}]}}] + self.extra_networks
            if self.ingress: nets.append(self.ingress)
            return '\n'.join(json.dumps(n) for n in nets)
        if args[:2] == ['network', 'create']:
            if self.fail_network: raise control.Refused('command-failed')
            self.ingress = network(); return self.ingress['Id']
        if args[:1] == ['ip']: return json.dumps(self.routes)
        if args[:1] == ['curl']:
            if self.shared and self.fail_health_after: raise control.Refused('command-failed')
            return ''
        if args[:1] == ['ps']: return '' if self.gateway_absent else self.gateway_id
        if args[:3] == ['compose', 'version', '--short']: return self.compose_version
        if args[:1] == ['compose']:
            manifest = json.loads(Path(args[args.index('-f') + 1]).read_text())
            desired = control.NETWORK in manifest['networks']
            if (desired and self.fail_shared) or (not desired and self.fail_base): raise control.Refused('command-failed')
            self.shared = desired; self.gateway_absent = False; self.gateway_running = True
            self.gateway_id = 'shared-id' if desired else 'recovered-id'
            if self.ingress:
                self.ingress['Containers'] = {'shared-id': {'Name': 'fleetum_caddy', 'IPv4Address': '10.203.91.2/28', 'IPv6Address': ''}} if desired else {}
            return ''
        raise AssertionError('Unexpected subprocess: ' + repr(args))

    def health(self, wait=False):
        # No real sleep in fault injection; retry behavior has its own test.
        return super().health(wait=False)

class IngressTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='fleetum-ingress-unit-', dir='/private/tmp' if Path('/private/tmp').exists() else None)
        self.root = Path(self.temp.name).resolve(); self.app = self.root / 'app'; self.bundle = self.root / 'bundle'; self.state = self.root / 'state'
        (self.app / 'deploy/caddy').mkdir(parents=True); (self.bundle / '.docker-noauth').mkdir(parents=True)
        self.app.joinpath('docker-compose.prod.yml').write_text('synthetic compose baseline')
        for name in control.FILES: self.bundle.joinpath(name).write_text('synthetic ' + name)
        self.app.joinpath('deploy/caddy/Caddyfile').write_bytes(self.bundle.joinpath('Caddyfile').read_bytes())
        self.request = {'mode': 'plan', 'sourceSha': 'e' * 40, 'image': 'ghcr.io/silviomasuccio6/fleetum-frontend@sha256:' + 'f' * 64,
                        'composeHash': control.file_hash(self.app / 'docker-compose.prod.yml'), 'caddyHash': control.file_hash(self.bundle / 'Caddyfile'),
                        'bundleHashes': {name: control.file_hash(self.bundle / name) for name in control.FILES}}
        self.g = FakeGateway(self.bundle, self.request, self.app, self.state)
        # Ownership is synthetic only: tests never require sudo or touch /opt.
        original = Path.stat
        def fixture_stat(path, *a, **kw):
            result = original(path, *a, **kw)
            if path == self.state or self.state in path.parents:
                values = list(result); values[4] = 0; result = os.stat_result(values)
            return result
        self.owner = patch.object(Path, 'stat', fixture_stat); self.owner.start()
        self.uid = patch.object(control.os, 'geteuid', return_value=0); self.uid.start()

    def tearDown(self):
        self.uid.stop(); self.owner.stop(); self.temp.cleanup()

    def applying(self):
        plan = self.g.execute()
        self.request.update(mode='apply', confirm='ACTIVATE_STAGING_INGRESS', planDigest=plan['planDigest'], email='synthetic@example.invalid')
        control.validate_request(self.request)
        return plan

    def recovering(self):
        self.request.update(mode='recover', confirm='RECOVER_STAGING_INGRESS')

    def compose_calls(self): return [c for c in self.g.calls if 'compose' in c[0] and 'up' in c[0]]
    def refused(self, code, action=None):
        with self.assertRaisesRegex(control.Refused, '^' + code + '$'): (action or self.g.execute)()

    def test_plan_has_no_mutations_or_files(self):
        result = self.g.execute(); self.assertFalse(result['mutations']); self.assertFalse(self.state.exists())
        self.assertEqual(self.compose_calls(), []); self.assertFalse(any('create' in c[0] for c in self.g.calls))
    def test_request_rejects_extra_fields(self):
        self.request['password'] = 'synthetic'; self.refused('invalid-request', lambda: control.validate_request(self.request))
    def test_request_rejects_mutable_image(self):
        self.request['image'] = 'caddy:latest'; self.refused('invalid-image', lambda: control.validate_request(self.request))
    def test_request_rejects_short_source(self):
        self.request['sourceSha'] = 'e' * 7; self.refused('invalid-source', lambda: control.validate_request(self.request))
    def test_request_rejects_confirmation(self):
        self.applying(); self.request['confirm'] = 'yes'; self.refused('confirmation-required', lambda: control.validate_request(self.request))
    def test_request_rejects_email_control_characters(self):
        self.applying(); self.request['email'] = 'test@example.invalid\nSECRET'; self.refused('protected-email-required', lambda: control.validate_request(self.request))
    def test_baseline_drift_prevents_mutation(self):
        self.applying(); (self.app / 'deploy/caddy/Caddyfile').write_text('changed'); self.refused('baseline-drift'); self.assertFalse(self.state.exists())
    def test_bundle_drift_prevents_mutation(self):
        self.applying(); (self.bundle / control.FILES[1]).write_text('changed'); self.refused('bundle-drift'); self.assertFalse(self.state.exists())
    def test_existing_foreign_config_preserved(self):
        path = self.app / 'deploy/caddy' / control.FILES[1]; path.write_text('foreign')
        self.refused('foreign-config'); self.assertEqual(path.read_text(), 'foreign')
    def test_baseline_symlink_rejected(self):
        path = self.app / 'deploy/caddy/Caddyfile'; path.unlink(); path.symlink_to(self.bundle / 'Caddyfile'); self.refused('unsafe-file')
    def test_baseline_hardlink_rejected(self):
        path = self.app / 'deploy/caddy/Caddyfile'; os.link(path, self.root / 'other'); self.refused('unsafe-file')
    def test_nonempty_docker_config_rejected(self):
        (self.bundle / '.docker-noauth/config.json').write_text('{}'); self.refused('docker-auth-refused')
    def test_unsafe_state_permissions_rejected(self):
        self.state.mkdir(mode=0o755); self.refused('unsafe-state')
    def test_version_drift_rejected(self):
        self.g.version = 'v2.11.3 '; self.refused('caddy-version-drift')
    def test_compose_version_drift_prevents_any_mutation(self):
        self.g.compose_version = '5.1.0'; self.refused('compose-version-drift'); self.assertFalse(self.state.exists())
    def test_image_defaults_differing_from_container_prevent_mutation(self):
        self.g.image_command = ['unexpected']; self.refused('image-command-drift'); self.assertFalse(self.state.exists())
    def test_gateway_owner_drift_rejected(self):
        self.g.foreign_gateway = True; self.refused('gateway-owner-drift')
    def test_stale_gateway_plan_rejected(self):
        self.applying(); self.g.gateway_id = 'changed'; self.refused('stale-plan'); self.assertFalse(self.state.exists())
    def test_stale_application_plan_rejected(self):
        self.applying(); self.g.app_change = True; self.refused('stale-plan'); self.assertFalse(self.state.exists())
    def test_health_wait_retries_transient_startup(self):
        with patch.object(self.g, 'run', side_effect=[control.Refused('command-failed')] + [''] * 6) as run, patch.object(control.time, 'sleep') as sleep:
            control.Gateway.health(self.g, wait=True)
            self.assertEqual(run.call_count, 7); sleep.assert_called_once_with(1)
    def test_health_checks_local_gateway_and_public_routes_without_disabling_tls(self):
        with patch.object(self.g, 'run', return_value='') as run:
            control.Gateway.health(self.g)
            self.assertEqual(run.call_count, 6)
            for i, call in enumerate(run.call_args_list):
                args = call.args[0]; self.assertNotIn('--insecure', args)
                self.assertEqual('--resolve' in args, i % 2 == 0)
    def test_health_wait_has_deadline(self):
        with patch.object(self.g, 'run', side_effect=control.Refused('command-failed')), patch.object(control.time, 'monotonic', side_effect=[0, 61]):
            self.refused('command-failed', lambda: control.Gateway.health(self.g, wait=True))
    def test_busy_production_lock_prevents_execute(self):
        lock = self.root / 'deploy.lock'; lock.write_text('')
        fd = os.open(lock, os.O_RDONLY)
        try:
            control.fcntl.flock(fd, control.fcntl.LOCK_EX | control.fcntl.LOCK_NB)
            with patch.object(control, 'LOCK', lock), patch.object(control.sys, 'platform', 'linux'), patch.object(control.sys, 'argv', ['control.py']), \
                    patch.object(control.sys, 'stdin', SimpleNamespace(buffer=io.BytesIO(json.dumps(self.request).encode()))), \
                    patch.object(control, 'Gateway', return_value=self.g), patch.object(self.g, 'execute') as execute:
                with self.assertRaises(BlockingIOError): control.main()
                execute.assert_not_called()
        finally: os.close(fd)
    def test_missing_production_lock_is_not_created(self):
        lock = self.root / 'missing.lock'
        with patch.object(control, 'LOCK', lock), patch.object(control.sys, 'platform', 'linux'), patch.object(control.sys, 'argv', ['control.py']), \
                patch.object(control.sys, 'stdin', SimpleNamespace(buffer=io.BytesIO(json.dumps(self.request).encode()))), patch.object(control, 'Gateway', return_value=self.g):
            self.refused('production-lock-unavailable', control.main)
            self.assertFalse(lock.exists())
    def test_extra_cli_argument_refused_before_input(self):
        with patch.object(control.sys, 'platform', 'linux'), patch.object(control.sys, 'argv', ['control.py', '--override']):
            self.refused('unsupported-runtime', control.main)
    def test_request_size_bounded_before_execute(self):
        with patch.object(control.sys, 'platform', 'linux'), patch.object(control.sys, 'argv', ['control.py']), \
                patch.object(control.sys, 'stdin', SimpleNamespace(buffer=io.BytesIO(b' ' * 16385))):
            self.refused('invalid-request', control.main)
    def test_wrong_protected_email_prevents_mutation(self):
        self.applying(); self.g.email_matches = False; self.refused('command-failed'); self.assertFalse(self.state.exists())
    def test_apply_and_retry_only_one_caddy_recreation(self):
        self.applying(); result = self.g.execute(); self.assertEqual(result['status'], 'applied')
        self.assertEqual(self.g.execute()['status'], 'already-active'); self.assertEqual(len(self.compose_calls()), 1)
        args = self.compose_calls()[0][0]; self.assertEqual(args[-1], 'caddy'); self.assertIn('--no-deps', args); self.assertIn('--no-build', args)
        self.assertEqual(args[args.index('--pull') + 1], 'never'); self.assertEqual(args[args.index('--env-file') + 1], '/dev/null')
        for path in self.state.iterdir(): self.assertNotIn(self.request['email'], path.read_text()); self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(self.state.stat().st_mode), 0o700)
    def test_manifests_contain_only_caddy_and_existing_volumes(self):
        for shared in [False, True]:
            model = self.g.manifest(shared); self.assertEqual(set(model['services']), {'caddy'})
            self.assertNotIn('env_file', model['services']['caddy']); self.assertNotIn('depends_on', model['services']['caddy'])
            self.assertTrue(all(v['external'] for v in model['volumes'].values())); self.assertEqual(model['services']['caddy']['ports'], ['80:80', '443:443'])
    def test_network_create_failure_does_not_restart_caddy(self):
        self.applying(); self.g.fail_network = True; self.refused('activation-failed'); self.assertEqual(self.compose_calls(), [])
    def test_failed_start_automatically_recovers(self):
        self.applying(); self.g.fail_shared = True; self.refused('activation-failed'); self.assertFalse(self.g.shared)
        record = json.loads((self.state / (self.request['planDigest'] + '.json')).read_text()); self.assertEqual(record['phase'], 'recovered')
        self.assertEqual(len(self.compose_calls()), 2); self.assertIsNotNone(self.g.ingress)
    def test_failed_start_and_recovery_record_failure(self):
        self.applying(); self.g.fail_shared = self.g.fail_base = True; self.refused('recovery-failed')
        record = json.loads((self.state / (self.request['planDigest'] + '.json')).read_text()); self.assertEqual(record['phase'], 'recovery-failed')
    def test_failed_health_recovers(self):
        self.applying(); self.g.fail_health_after = True; self.refused('activation-failed'); self.assertFalse(self.g.shared)
    def test_recover_stopped_gateway(self):
        self.applying(); self.g.execute(); self.recovering(); self.g.gateway_running = False
        self.assertEqual(self.g.execute()['status'], 'recovered'); self.assertFalse(self.g.shared)
    def test_recover_absent_gateway(self):
        self.applying(); self.g.execute(); self.recovering(); self.g.gateway_absent = True
        self.assertEqual(self.g.execute()['status'], 'recovered')
    def test_recovery_refuses_foreign_gateway(self):
        self.applying(); self.g.execute(); self.recovering(); self.g.foreign_gateway = True
        self.refused('gateway-owner-drift'); self.assertEqual(len(self.compose_calls()), 1)
    def test_recovery_refuses_changed_application(self):
        self.applying(); self.g.execute(); self.recovering(); self.g.app_change = True
        self.refused('application-changed'); self.assertEqual(len(self.compose_calls()), 1)
    def test_recovery_refuses_wrong_contact(self):
        self.applying(); self.g.execute(); self.recovering(); self.request['email'] = 'other@example.invalid'
        self.refused('protected-email-mismatch'); self.assertEqual(len(self.compose_calls()), 1)
    def test_recovery_refuses_changed_manifest(self):
        self.applying(); self.g.execute(); self.recovering(); (self.state / (self.request['planDigest'] + '.baseline.json')).write_text('{}')
        self.refused('manifest-drift'); self.assertEqual(len(self.compose_calls()), 1)
    def test_recovery_refuses_route_conflict_before_compose(self):
        self.applying(); self.g.execute(); self.recovering(); self.g.routes.append({'dst': '10.203.91.0/24', 'dev': 'eth0'})
        self.refused('route-conflict'); self.assertEqual(len(self.compose_calls()), 1)
    def test_inspection_never_reads_environment_or_health_output(self):
        self.g.execute()
        templates = [c[0][c[0].index('--format') + 1] for c in self.g.calls if 'inspect' in c[0] and '--format' in c[0]]
        self.assertFalse(any('.Config.Env' in t or '.State.Health' in t or '.Output' in t for t in templates))
    def test_application_docker_overlap_rejected(self):
        self.g.extra_networks = [{'Name': 'other', 'Id': 'c' * 64, 'IPAM': {'Config': [{'Subnet': '10.203.0.0/16'}]}}]; self.refused('subnet-conflict')
    def test_network_options_rejected_and_inspected(self):
        self.g.ingress = network(); self.g.ingress['Options'] = {'com.docker.network.bridge.name': 'foreign'}
        self.refused('foreign-network')
        templates = [c[0][c[0].index('--format') + 1] for c in self.g.calls if 'network' in c[0] and 'inspect' in c[0]]
        self.assertTrue(any('{{json .Options}}' in t for t in templates))
    def test_missing_network_metadata_refused(self):
        original = self.g.run
        def run(args, **kwargs):
            if 'network' in args and 'inspect' in args and args[-1] != control.PRIVATE: return ''
            return original(args, **kwargs)
        with patch.object(self.g, 'run', side_effect=run): self.refused('network-metadata-failed')
    def test_network_rejects_third_member(self):
        n = network(); n['Containers']['foreign'] = {'Name': 'backend', 'IPv4Address': '10.203.91.4/28'}
        self.refused('foreign-network', lambda: control.network_valid(n))
    def test_network_rejects_ipv6(self):
        n = network(); n['EnableIPv6'] = True; self.refused('foreign-network', lambda: control.network_valid(n))
    def test_network_rejects_wrong_labels(self):
        n = network(); n['Labels'] = {}; self.refused('foreign-network', lambda: control.network_valid(n))
    def test_network_rejects_wrong_ip(self):
        n = network(); n['Containers']['id'] = {'Name': 'fleetum_caddy', 'IPv4Address': '10.203.91.4/28'}
        self.refused('foreign-network', lambda: control.network_valid(n))
    def test_network_allows_staging_only_for_recovery(self):
        n = network(); n['Containers']['id'] = {'Name': 'fleetum_staging_caddy', 'IPv4Address': '10.203.91.3/28'}; control.network_valid(n)
    def test_routes_allow_only_owned_bridge(self):
        n = network(); control.verify_routes([n], [{'dst': '10.203.91.0/28', 'dev': 'br-' + 'a' * 12}, {'dst': '10.203.91.1/32', 'dev': 'br-' + 'a' * 12}])
        self.refused('route-conflict', lambda: control.verify_routes([n], [{'dst': '10.203.91.0/28', 'dev': 'vpn0'}]))

if __name__ == '__main__': unittest.main(verbosity=2)
