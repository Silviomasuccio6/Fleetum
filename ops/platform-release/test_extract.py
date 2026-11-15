import io,tarfile,tempfile,unittest
from pathlib import Path
from extract import extract
class ArchiveBoundary(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
 def archive(self,name='assets/bundle.js',link=False):
  p=self.root/'ui.tgz'
  with tarfile.open(p,'w:gz') as tar:
   member=tarfile.TarInfo(name)
   if link:member.type=tarfile.SYMTYPE;member.linkname='/etc/passwd';tar.addfile(member)
   else:member.size=4;tar.addfile(member,io.BytesIO(b'data'))
  return p
 def test_extracts_inert_regular_data(self):
  extract(self.archive(),self.root/'out');self.assertEqual((self.root/'out/assets/bundle.js').read_bytes(),b'data')
 def test_rejects_traversal_without_creating_output(self):
  with self.assertRaisesRegex(ValueError,'path'):extract(self.archive('../escape.js'),self.root/'out')
  self.assertFalse((self.root/'out').exists())
 def test_rejects_symlink_without_reading_its_target(self):
  with self.assertRaisesRegex(ValueError,'links'):extract(self.archive(link=True),self.root/'out')
 def test_rejects_private_env_file(self):
  with self.assertRaisesRegex(ValueError,'Private'):extract(self.archive('.env'),self.root/'out')
if __name__=='__main__':unittest.main()
