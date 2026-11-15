import contextlib,copy,hashlib,json,unittest
import apply as transaction
class TransactionBoundary(unittest.TestCase):
 def setUp(self):
  self.a={'repository':'Silviomasuccio6/Fleetum','appSha':'a'*40,'uiSha':'b'*40,'controlSha':'c'*40,'parentControlSha':'d'*40,'parentFrontend':'ghcr.io/silviomasuccio6/fleetum-frontend@sha256:'+'e'*64,'backendImage':'ghcr.io/silviomasuccio6/fleetum-backend@sha256:'+'f'*64,'ingressMode':'shared'}
  self.base=[['index.html',1,'1'*64],['spa.html',1,'2'*64],['platform.html',1,'3'*64]];self.target=copy.deepcopy(self.base);self.target[2][2]='4'*64;self.web=[['index.html',1,'5'*64]]
  self.a['baselineTreeSha256']=transaction.hash_rows(self.base)
  self.m={'candidateSource':self.a['uiSha'],'appSha':self.a['appSha'],'controlSha':self.a['controlSha'],'parentFrontend':self.a['parentFrontend'],'backendImage':self.a['backendImage'],'parentStaticSha256':self.a['baselineTreeSha256'],'targetStaticSha256':transaction.hash_rows(self.target),'parentWebsiteSha256':transaction.hash_rows(self.web),'targetWebsiteSha256':transaction.hash_rows(self.web)}
  text=json.dumps(self.m);self.p={k:self.m[k] for k in ['parentStaticSha256','targetStaticSha256','parentWebsiteSha256','targetWebsiteSha256']};self.p.update({'targetImage':'ghcr.io/silviomasuccio6/fleetum-frontend@sha256:'+'6'*64,'manifestSha256':hashlib.sha256(text.encode()).hexdigest()})
  self.backend={'image':self.a['backendImage'],'containerId':'7'*64,'startedAt':'2026-01-01T00:00:00Z','restartCount':0,'running':True,'project':'fleetum-staging','service':'backend','mounts':[]}
  self.front={**self.backend,'image':self.a['parentFrontend'],'containerId':'8'*64,'service':'caddy','mounts':[{'source':str(transaction.APP/'deploy/caddy/Caddyfile.staging-shared'),'destination':'/etc/caddy/Caddyfile'}]}
  before={}
  for name,obj in [('backend',self.backend),('frontend',self.front)]:before[name]={**obj,'digest':obj['image'].split('@')[1]}
  self.r={'schemaVersion':1,'operation':'install','runId':21,'approval':self.a,'preparedImage':self.p,'manifestText':text,'beforeRuntime':before,'configHashes':{}}
  self.calls=[];self.switched=False;self.fail_health=False;self.drift_backend=False
 def lock(self):return contextlib.nullcontext()
 def inspect(self,name):
  obj=copy.deepcopy(self.backend if name==transaction.BACK else self.front)
  if self.switched and name==transaction.FRONT:obj['image']=self.switch_target
  if self.switched and self.drift_backend and name==transaction.BACK:obj['restartCount']=1
  return obj
 def static_tree(self,root):return self.web if root.endswith('-website') else (self.target if self.switched and self.switch_target==self.p['targetImage'] else self.base)
 def verify_configs(self,hashes,ingress_mode):pass
 def pull(self,target):self.calls.append(('pull',target))
 def switch(self,target,a):self.calls.append(('switch',target));self.switched=True;self.switch_target=target
 def health(self,sha):
  self.calls.append(('health',sha))
  if self.fail_health:raise ValueError('unhealthy')
 def test_only_frontend_switch_is_requested(self):
  result=transaction.apply(self.r,self);self.assertTrue(result['backendUnchanged']);self.assertEqual([x[0] for x in self.calls],['pull','switch','health'])
 def test_backend_drift_blocks_before_any_mutation(self):
  self.backend['restartCount']=1
  with self.assertRaisesRegex(ValueError,'Backend identity'):transaction.apply(self.r,self)
  self.assertEqual(self.calls,[])
 def test_static_drift_blocks_before_any_mutation(self):
  self.base[0][2]='0'*64
  with self.assertRaisesRegex(ValueError,'baseline'):transaction.apply(self.r,self)
  self.assertEqual(self.calls,[])
 def test_runtime_mount_blocks_apply(self):
  self.front['mounts'].append({'source':'unexpected','destination':'/srv/fleetum'})
  with self.assertRaisesRegex(ValueError,'runtime mount'):transaction.apply(self.r,self)
  self.assertEqual(self.calls,[])
 def test_failure_never_retries_or_rolls_back_automatically(self):
  self.fail_health=True
  with self.assertRaisesRegex(ValueError,'unhealthy'):transaction.apply(self.r,self)
  self.assertEqual(sum(x[0]=='switch' for x in self.calls),1)
 def test_backend_restart_during_apply_is_a_failure(self):
  self.drift_backend=True
  with self.assertRaisesRegex(ValueError,'Backend changed'):transaction.apply(self.r,self)
 def test_explicit_rollback_restores_parent_only(self):
  self.r['operation']='rollback';self.r['priorOverlay']={'operation':'install','completed':True,'manifestSha256':self.p['manifestSha256'],'frontendImage':self.p['targetImage'],'backendImage':self.a['backendImage']}
  self.front['image']=self.p['targetImage'];self.r['beforeRuntime']['frontend']['image']=self.p['targetImage'];self.r['beforeRuntime']['frontend']['digest']=self.p['targetImage'].split('@')[1]
  self.switched=True;self.switch_target=self.p['targetImage']
  result=transaction.apply(self.r,self);self.assertEqual(result['targetImage'],self.a['parentFrontend']);self.assertEqual(result['targetStaticSha256'],self.a['baselineTreeSha256'])

class ConfigBoundary(unittest.TestCase):
 def test_config_hashes_are_checked_without_executing_compose(self):
  import tempfile
  from pathlib import Path
  original=transaction.APP
  with tempfile.TemporaryDirectory() as temp:
   try:
    transaction.APP=Path(temp).resolve();(transaction.APP/'deploy/caddy').mkdir(parents=True)
    names=['docker-compose.staging.yml','docker-compose.staging.shared.yml','deploy/caddy/Caddyfile.staging-shared']
    hashes={}
    for name in names:
     p=transaction.APP/name;p.write_text('synthetic config');hashes[name]=hashlib.sha256(p.read_bytes()).hexdigest()
    runtime=transaction.Runtime(21);runtime.verify_configs(hashes,'shared')
    (transaction.APP/names[0]).write_text('changed')
    with self.assertRaisesRegex(ValueError,'configuration drift'):runtime.verify_configs(hashes,'shared')
   finally:transaction.APP=original

class HostDockerBoundary(unittest.TestCase):
 def test_static_symlink_is_rejected_before_hashing_any_target(self):
  runtime=transaction.Runtime(21);calls=[]
  def docker(*args):
   calls.append(args);return 'directory|0|/srv/fleetum\nsymbolic link|4|/srv/fleetum/escape\n'
  runtime.docker=docker
  with self.assertRaisesRegex(ValueError,'symlink'):runtime.static_tree('/srv/fleetum')
  self.assertEqual(len(calls),1);self.assertIn('test ! -L /srv',calls[0][-1])
 def test_host_docker_is_pinned_to_local_socket_and_does_not_inherit_context_or_proxy(self):
  from unittest.mock import patch
  class Result:returncode=0;stdout=b''
  with patch.dict(transaction.os.environ,{'DOCKER_HOST':'tcp://synthetic-other.invalid:2375','DOCKER_CONTEXT':'synthetic-other'}),patch.object(transaction.subprocess,'run',return_value=Result()) as execute:
   transaction.Runtime(21).docker('ps')
   args=execute.call_args
   self.assertEqual(args.args[0][:3],['/usr/bin/docker','--host','unix:///var/run/docker.sock'])
   self.assertNotIn('DOCKER_HOST',args.kwargs['env']);self.assertNotIn('DOCKER_CONTEXT',args.kwargs['env'])

if __name__=='__main__':unittest.main()
