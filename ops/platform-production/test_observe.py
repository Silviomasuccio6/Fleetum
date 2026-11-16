import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('observe', Path(__file__).with_name('observe.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ObservationSafety(unittest.TestCase):
    def docker(self, *args):
        self.calls.append(args)
        if args[0] == 'ps':
            return 'fleetum_backend\nfleetum_caddy\nfleetum_staging_backend\n'
        if args[0] == 'image':
            self.assertEqual(args[1:4], ('inspect', '--format', '{{json .RepoDigests}}'))
            return json.dumps(['ghcr.io/silviomasuccio6/fleetum-backend@sha256:'+'b'*64])
        self.assertEqual(args[0], 'inspect')
        self.assertEqual(args[1], '--format')
        return json.dumps({'id': 'a'*64, 'imageId': 'sha256:'+'b'*64,
                           'imageRef': 'synthetic', 'mounts': self.mounts,
                           'configFiles': '/srv/fleetum/docker-compose.prod.yml'})

    def setUp(self):
        self.calls = []
        self.mounts = []

    def test_only_explicit_production_names_and_formatted_inspect(self):
        result = module.observe(self.docker, lambda p: {'path': p})
        self.assertEqual(list(result['containers']), ['fleetum_backend', 'fleetum_caddy'])
        self.assertTrue(all(c[0] in ('ps', 'inspect', 'image') for c in self.calls))
        self.assertNotIn('.Config.Env', module.FORMAT)
        self.assertFalse(result['writes'])
        self.assertFalse(result['databaseRead'])
        self.assertFalse(result['readyForDeployment'])

    def test_static_root_bind_is_reported_as_an_unreviewed_layout(self):
        self.mounts = [{'destination': '/srv/fleetum', 'source': '/synthetic/static'}]
        result = module.observe(self.docker, lambda p: {'path': p})
        self.assertEqual(result['staticRootMounts'], ['/srv/fleetum'])
        self.assertTrue(result['requiresReview'])

    def test_missing_production_never_falls_back_to_staging(self):
        with self.assertRaisesRegex(ValueError, 'production containers'):
            module.observe(lambda *args: 'fleetum_staging_backend\nfleetum_staging_caddy\n')

    def test_env_files_are_rejected_without_reading(self):
        for name in ['/srv/fleetum/.env', '/opt/fleetum/app/backend.env',
                     '/etc/environment', '/srv/fleetum/uploads/Caddyfile']:
            self.assertFalse(module.checked_file(name)['verified'])

    def test_only_format_never_requests_all_container_configuration(self):
        module.observe(self.docker, lambda p: {})
        for call in self.calls:
            if call[0] == 'inspect':
                self.assertEqual(call[2], module.FORMAT)
                self.assertIn(call[-1], module.NAMES)

    def test_inaccessible_disk_metadata_does_not_hide_container_observation(self):
        with patch.object(module.Path,'is_dir',side_effect=PermissionError):
            result=module.observe(self.docker,lambda p:{})
        self.assertTrue(all(d.get('readable') is False for d in result['host']['disks']))


if __name__ == '__main__':
    unittest.main()
