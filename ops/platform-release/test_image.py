import json,shutil,tempfile,unittest
from pathlib import Path
import image
class ImageBoundary(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name);self.dist=self.root/'ui';self.base=self.root/'base';self.website=self.root/'website'
  for d in [self.dist,self.base]:
   (d/'assets').mkdir(parents=True);(d/'brand').mkdir()
   for rel in image.package.LOGOS:(d/rel).write_text('original logo')
  (self.base/'index.html').write_text('tenant');(self.base/'spa.html').write_text('tenant spa');(self.base/'platform.html').write_text('old Platform');(self.dist/'platform.html').write_text('<script src="/assets/new.js"></script>');(self.dist/'assets/new.js').write_text('export const qa=1')
  self.website.mkdir();(self.website/'index.html').write_text('public site')
  self.approval={'parentFrontend':'ghcr.io/silviomasuccio6/fleetum-frontend@sha256:'+'a'*64,'backendImage':'ghcr.io/silviomasuccio6/fleetum-backend@sha256:'+'b'*64,'appSha':'a'*40,'uiSha':'b'*40,'controlSha':'c'*40,'baselineTreeSha256':image.tree_hash(self.base)}
  self.calls=[];self.created={};self.bad_site=False;self.bad_tenant=False
 def docker(self,*args):
  self.calls.append(args)
  if args[0]=='create':self.created[args[2]]=args[-1]
  if args[0]=='cp':
   name,source=args[1].split(':',1);target=Path(args[2]);is_target=':platform-' in self.created[name]
   src=self.website if source.endswith('fleetum-website') else (self.root/'out/package/rehearsal-static-root' if is_target else self.base)
   shutil.copytree(src,target)
   if is_target and self.bad_site and source.endswith('fleetum-website'):(target/'index.html').write_text('tampered')
   if is_target and self.bad_tenant and source.endswith('/fleetum'):(target/'index.html').write_text('tampered')
  if args[:2]==('image','inspect'):return json.dumps(['ghcr.io/silviomasuccio6/fleetum-frontend@sha256:'+'d'*64])
  return ''
 def test_image_is_verified_before_push_and_never_started(self):
  r=image.build(self.dist,self.root/'out',self.approval,21,self.docker);self.assertIn('@sha256:',r['targetImage'])
  self.assertFalse(any(c[0] in ['run','start','exec'] for c in self.calls));self.assertEqual(self.calls[-2][0],'push')
 def test_website_change_blocks_publication(self):
  self.bad_site=True
  with self.assertRaisesRegex(ValueError,'preserve'):image.build(self.dist,self.root/'out',self.approval,21,self.docker)
  self.assertFalse(any(c[0]=='push' for c in self.calls))
 def test_tenant_change_blocks_publication(self):
  self.bad_tenant=True
  with self.assertRaisesRegex(ValueError,'preserve'):image.build(self.dist,self.root/'out',self.approval,21,self.docker)
  self.assertFalse(any(c[0]=='push' for c in self.calls))
 def test_parent_drift_blocks_build_and_push(self):
  self.approval['baselineTreeSha256']='0'*64
  with self.assertRaisesRegex(ValueError,'baseline'):image.build(self.dist,self.root/'out',self.approval,21,self.docker)
  self.assertFalse(any(c[0] in ['build','push'] for c in self.calls))
if __name__=='__main__':unittest.main()
