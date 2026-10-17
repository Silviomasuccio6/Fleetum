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

SOURCE = Path(__file__).resolve().parents[1] / 'provider-qa/verify-stripe-startup.py'
SPEC = importlib.util.spec_from_file_location('qa_startup_process', SOURCE)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


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
