"""Exercise local QA process cleanup without Docker, credentials or network."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / 'provider-qa/verify-stripe-startup.py'
SPEC = importlib.util.spec_from_file_location('qa_startup_process', SOURCE)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
OFFLINE_SPEC = importlib.util.spec_from_file_location('qa_offline_process', SOURCE.with_name('verify-offline.py'))
OFFLINE = importlib.util.module_from_spec(OFFLINE_SPEC)
OFFLINE_SPEC.loader.exec_module(OFFLINE)


class OfflineEnvironmentChecks(unittest.TestCase):
    def refuses_dotenv_before_processes_or_evidence(self, relative_path):
        with tempfile.TemporaryDirectory(prefix='fleetum-qa-env-', dir='/private/tmp') as temporary:
            repository = Path(temporary)
            dotenv = repository / relative_path
            dotenv.parent.mkdir(parents=True, exist_ok=True)
            dotenv.write_text('SYNTHETIC_FIXTURE_ONLY=true\n')
            evidence = repository / 'evidence'
            with patch.object(OFFLINE, '__file__', str(repository / 'ops/provider-qa/verify-offline.py')), \
                    patch.object(OFFLINE.sys, 'platform', 'darwin'), \
                    patch.object(OFFLINE.sys, 'argv', ['verify-offline.py', '--evidence-dir', str(evidence)]), \
                    patch.object(OFFLINE.subprocess, 'check_output',
                                 side_effect=RuntimeError('EXTERNAL_PROCESS_MUST_NOT_START')) as process, \
                    self.assertRaisesRegex(RuntimeError, '^REAL_ENV_DISCOVERY_REFUSED$'):
                OFFLINE.main()
            process.assert_not_called()
            self.assertFalse(evidence.exists())

    def test_root_dotenv_prevents_offline_startup(self):
        self.refuses_dotenv_before_processes_or_evidence('.env')

    def test_backend_dotenv_prevents_offline_startup(self):
        self.refuses_dotenv_before_processes_or_evidence('backend/.env')

    def test_prisma_dotenv_prevents_offline_startup(self):
        self.refuses_dotenv_before_processes_or_evidence('backend/prisma/.env')

    def test_example_configuration_does_not_block_a_clean_checkout(self):
        with tempfile.TemporaryDirectory(prefix='fleetum-qa-env-', dir='/private/tmp') as temporary:
            repository = Path(temporary)
            (repository / '.env.example').write_text('SYNTHETIC_EXAMPLE_ONLY=true\n')
            evidence = repository / 'evidence'
            with patch.object(OFFLINE, '__file__', str(repository / 'ops/provider-qa/verify-offline.py')), \
                    patch.object(OFFLINE.sys, 'platform', 'darwin'), \
                    patch.object(OFFLINE.sys, 'argv', ['verify-offline.py', '--evidence-dir', str(evidence)]), \
                    patch.object(OFFLINE.subprocess, 'check_output',
                                 side_effect=RuntimeError('CLEAN_CHECKOUT_ACCEPTED')) as process, \
                    self.assertRaisesRegex(RuntimeError, '^CLEAN_CHECKOUT_ACCEPTED$'):
                OFFLINE.main()
            process.assert_called_once()
            self.assertTrue(evidence.is_dir())


class LocalProcessChecks(unittest.TestCase):
    def test_success_captures_only_requested_local_output(self):
        result = MODULE.run_node([sys.executable, '-B', '-c', 'print("synthetic-ready")'],
                                 cwd=SOURCE.parent, env={'PATH': '/usr/bin:/bin'}, timeout=3, text=True)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout.strip(), 'synthetic-ready')
        self.assertEqual(result.stderr, '')

    def test_timeout_terminates_the_fixture_child_process_group(self):
        with tempfile.TemporaryDirectory(prefix='fleetum-qa-process-', dir='/private/tmp') as temporary:
            pid_file = Path(temporary) / 'child.json'
            program = '''import subprocess,sys,time,json
from pathlib import Path
child=subprocess.Popen([sys.executable,'-B','-c','import time;time.sleep(60)'])
Path(sys.argv[1]).write_text(json.dumps({'child':child.pid}))
time.sleep(60)
'''
            with self.assertRaisesRegex(RuntimeError, '^LOCAL_NODE_STAGE_TIMEOUT$'):
                MODULE.run_node([sys.executable, '-B', '-c', program, str(pid_file)], cwd=temporary,
                                env={'PATH': '/usr/bin:/bin'}, timeout=0.7, text=True)
            self.assertTrue(pid_file.exists())
            child = json.loads(pid_file.read_text())['child']
            running = True
            for _ in range(20):
                state = subprocess.run(['/bin/ps', '-o', 'stat=', '-p', str(child)], capture_output=True,
                                       text=True, timeout=2).stdout.strip()
                running = bool(state) and not state.startswith('Z')
                if not running:
                    break
                time.sleep(0.05)
            self.assertFalse(running, 'Timed-out fixture child must not remain active')


if __name__ == '__main__':
    unittest.main()
