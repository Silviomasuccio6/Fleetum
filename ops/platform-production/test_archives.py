import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('archives', Path(__file__).with_name('archives.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ArchiveSafety(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def archive(self, name='safe.txt', kind=tarfile.REGTYPE, content=b'synthetic'):
        path = self.root/'payload.tar.gz'
        with tarfile.open(path, 'w:gz') as tar:
            info = tarfile.TarInfo(name); info.type = kind; info.size = len(content) if kind == tarfile.REGTYPE else 0
            if kind == tarfile.SYMTYPE: info.linkname = '/etc/passwd'
            tar.addfile(info, io.BytesIO(content) if kind == tarfile.REGTYPE else None)
        return path

    def test_inert_round_trip_preserves_dot_config_and_executable(self):
        folder = self.root/'source'; folder.mkdir()
        (folder/'.node-version').write_text('22.23.1')
        (folder/'test.sh').write_text('exit 0'); (folder/'test.sh').chmod(0o755)
        module.pack(folder, self.root/'source.tar.gz')
        module.extract(self.root/'source.tar.gz', self.root/'out')
        self.assertEqual((self.root/'out/.node-version').read_text(), '22.23.1')
        self.assertTrue((self.root/'out/test.sh').stat().st_mode & 0o111)

    def test_traversal_absolute_and_links_are_rejected_before_output(self):
        for name,kind in [('../escape',tarfile.REGTYPE),('/absolute',tarfile.REGTYPE),('link',tarfile.SYMTYPE)]:
            with self.assertRaises(ValueError): module.extract(self.archive(name,kind),self.root/'out')
            self.assertFalse((self.root/'out').exists())

    def test_env_and_git_state_are_not_extracted(self):
        for name in ['.env','backend/.env.production','.git/config','node_modules/pkg/index.js']:
            with self.assertRaises(ValueError): module.extract(self.archive(name),self.root/'out')

    def test_limits_are_enforced_before_writes(self):
        with self.assertRaises(ValueError): module.extract(self.archive(),self.root/'out',max_bytes=1)
        self.assertFalse((self.root/'out').exists())

    def test_existing_output_is_preserved(self):
        folder=self.root/'out';folder.mkdir();(folder/'keep').write_text('existing')
        with self.assertRaises(ValueError): module.extract(self.archive(),folder)
        self.assertEqual((folder/'keep').read_text(),'existing')


if __name__ == '__main__':
    unittest.main()
