import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('ci_database',Path(__file__).with_name('ci-database.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)


class SyntheticLifecycle(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.file=Path(self.temp.name)/'session.json';self.calls=[]
        self.original=module.docker;module.docker=self.docker
        self.addCleanup(lambda:setattr(module,'docker',self.original))

    def docker(self,*args):
        self.calls.append(args)
        return '127.0.0.1:60001' if args[0]=='port' else 'synthetic'

    def test_private_session_and_loopback_server_are_cleaned(self):
        module.start(self.file,'12');data=json.loads(self.file.read_text())
        self.assertEqual(data['host'],'127.0.0.1');self.assertTrue(data['syntheticOnly'])
        self.assertEqual(self.file.stat().st_mode & 0o777,0o600)
        self.assertIn('127.0.0.1::5432',self.calls[0])
        self.assertIn('cluster_name=fleetum_platform_synthetic_20261115',self.calls[0])
        module.stop(self.file);self.assertFalse(self.file.exists())
        self.assertEqual(self.calls[-1][0:2],('rm','-f'))
        self.assertEqual(self.calls[-1][2],data['container'])

    def test_a_production_name_cannot_be_stopped(self):
        self.file.write_text(json.dumps({'syntheticOnly':True,'container':'fleetum_backend'}))
        with self.assertRaises(ValueError):module.stop(self.file)
        self.assertEqual(self.calls,[])

    def test_a_failed_port_guard_removes_only_its_new_container(self):
        original=self.docker
        def bad(*args):return '0.0.0.0:5432' if args[0]=='port' else original(*args)
        module.docker=bad
        with self.assertRaises(ValueError):module.start(self.file,'12')
        self.assertEqual(self.calls[-1][0:2],('rm','-f'));self.assertFalse(self.file.exists())


if __name__=='__main__':unittest.main()
