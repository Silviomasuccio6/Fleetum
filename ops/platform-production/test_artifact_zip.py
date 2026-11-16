import hashlib
import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

spec=importlib.util.spec_from_file_location('artifact_zip',Path(__file__).with_name('artifact_zip.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)


class ArtifactIntegrity(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
    def archive(self,names=['ci-source.json']):
        file=self.root/'artifact.zip'
        with zipfile.ZipFile(file,'w') as z:
            for name in names:z.writestr(name,b'{"synthetic":true}')
        return file,'sha256:'+hashlib.sha256(file.read_bytes()).hexdigest()
    def test_real_cli_roundtrip_accepts_exact_digest_and_single_filename(self):
        file,digest=self.archive();out=self.root/'ci-source.json'
        result=subprocess.run([sys.executable,str(Path(module.__file__)),str(file),str(out),'ci-source.json',digest,'65536'],capture_output=True)
        self.assertEqual(result.returncode,0,result.stderr);self.assertEqual(out.read_bytes(),b'{"synthetic":true}')
    def test_tampered_zip_is_never_written(self):
        file,digest=self.archive();file.write_bytes(file.read_bytes()+b'changed')
        with self.assertRaises(ValueError):module.extract(file,self.root/'out','ci-source.json',digest,65536)
        self.assertFalse((self.root/'out').exists())
    def test_paths_extra_entries_and_wrong_names_are_rejected(self):
        for names in [['../ci-source.json'],['unexpected.json'],['ci-source.json','extra.txt']]:
            file,digest=self.archive(names)
            with self.assertRaises(ValueError):module.extract(file,self.root/'out','ci-source.json',digest,65536)
    def test_existing_output_is_preserved(self):
        file,digest=self.archive();out=self.root/'out';out.write_text('keep')
        with self.assertRaises(ValueError):module.extract(file,out,'ci-source.json',digest,65536)
        self.assertEqual(out.read_text(),'keep')
    def test_invalid_crc_cannot_leave_a_partial_verified_output(self):
        file,_=self.archive()
        raw=file.read_bytes().replace(b'{"synthetic":true}',b'{"synthetic":fals}',1)
        file.write_bytes(raw);digest='sha256:'+hashlib.sha256(raw).hexdigest()
        out=self.root/'out'
        with self.assertRaises(zipfile.BadZipFile):module.extract(file,out,'ci-source.json',digest,65536)
        self.assertFalse(out.exists())


if __name__=='__main__':unittest.main()
