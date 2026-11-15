import tempfile, unittest
from pathlib import Path
from package import prepare, LOGOS

class PackageSafety(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        root=Path(self.tmp.name);self.build=root/'build';self.base=root/'baseline';self.out=root/'out'
        for p in [self.build,self.base]:
            (p/'assets').mkdir(parents=True);(p/'brand').mkdir()
            for rel in LOGOS:(p/rel).write_text('<svg>original</svg>')
            (p/'favicon.ico').write_bytes(b'original-favicon')
        (self.base/'platform.html').write_text('previous Platform')
        (self.base/'index.html').write_text('tenant unchanged')
        (self.base/'spa.html').write_text('SPA unchanged')
        (self.build/'platform.html').write_text('<link href="/favicon.ico"><script src="/assets/new.js"></script>')
        (self.build/'assets/new.js').write_text('import "./shared.js";import "./new.css";')
        (self.build/'assets/shared.js').write_text('export const value=1;')
        (self.build/'assets/new.css').write_text('body{src:url(/assets/type.woff2)}')
        (self.build/'assets/type.woff2').write_bytes(b'font')
    def run_package(self):return prepare(self.build,self.base,self.out,"a"*40)
    def test_preserves_every_existing_non_platform_file(self):
        result=self.run_package();self.assertEqual(result['changedExistingFiles'],['platform.html'])
        for name in ['index.html','spa.html','favicon.ico']:self.assertEqual((self.out/'rehearsal-static-root'/name).read_bytes(),(self.base/name).read_bytes())
        self.assertFalse((self.out/'platform-closure/index.html').exists())
    def test_follows_nested_js_css_font_and_original_logos(self):
        result=self.run_package();self.assertEqual(len(result['closure']),7)
        self.assertTrue((self.out/'platform-closure/assets/type.woff2').is_file())
    def test_rejects_asset_collision_before_writing_output(self):
        (self.base/'assets/shared.js').write_text('existing tenant dependency')
        with self.assertRaisesRegex(ValueError,'collision'):self.run_package()
        self.assertFalse(self.out.exists())
    def test_rejects_changed_original_logo(self):
        (self.build/sorted(LOGOS)[0]).write_text('changed logo')
        with self.assertRaisesRegex(ValueError,'collision'):self.run_package()
    def test_rejects_changed_shared_favicon(self):
        (self.build/'favicon.ico').write_bytes(b'new icon')
        with self.assertRaisesRegex(ValueError,'Shared static'):self.run_package()
    def test_rejects_missing_transitive_dependency(self):
        (self.build/'assets/new.js').write_text('import "./missing.js";')
        with self.assertRaisesRegex(ValueError,'Missing asset'):self.run_package()
    def test_rejects_symlink(self):
        (self.build/'assets/link.js').symlink_to(self.base/'index.html')
        with self.assertRaisesRegex(ValueError,'Symlink'):self.run_package()
    def test_rejects_symlink_input_root(self):
        link=self.base.parent/"alias";link.symlink_to(self.build,target_is_directory=True)
        with self.assertRaisesRegex(ValueError,"Symlink"):prepare(link,self.base,self.out,"a"*40)
    def test_rejects_output_inside_baseline(self):
        with self.assertRaisesRegex(ValueError,'separate'):prepare(self.build,self.base,self.base/'out',"a"*40)
    def test_refuses_existing_output(self):
        self.out.mkdir()
        with self.assertRaisesRegex(ValueError,'new and separate'):self.run_package()

if __name__=='__main__':unittest.main(verbosity=2)
