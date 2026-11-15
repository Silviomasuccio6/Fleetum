"""Staging-only frontend transaction, invoked only by the protected workflow."""
import contextlib,fcntl,hashlib,json,os,re,subprocess,sys,time
from pathlib import Path
APP=Path('/opt/fleetum-staging/app')
FRONT='fleetum_staging_caddy';BACK='fleetum_staging_backend'
REF=lambda role:r'ghcr.io/silviomasuccio6/fleetum-'+role+r'@sha256:[0-9a-f]{64}'

def need(condition,message):
 if not condition:raise ValueError(message)
def hash_rows(rows):return hashlib.sha256(json.dumps(sorted(rows),separators=(',',':')).encode()).hexdigest()
def backend_equal(observed,baseline):
 return all(observed.get(k)==baseline.get(k) for k in ['containerId','startedAt','restartCount','running']) and observed['image'].split('@')[-1]==baseline['digest']

def validate_request(r):
 need(r.get('schemaVersion')==1 and r.get('operation') in ['install','rollback'],'Invalid Platform operation')
 need(re.fullmatch('[1-9][0-9]*',str(r.get('runId',''))),'Invalid run ID')
 a=r['approval'];p=r['preparedImage'];m=json.loads(r['manifestText'])
 for field in ['appSha','uiSha','controlSha','parentControlSha']:need(re.fullmatch('[0-9a-f]{40}',a.get(field,'')),'Invalid source binding')
 need(a.get('repository')=='Silviomasuccio6/Fleetum' and a.get('ingressMode') in ['shared','dedicated'],'Invalid staging approval')
 need(re.fullmatch(REF('frontend'),a['parentFrontend']) and re.fullmatch(REF('backend'),a['backendImage']),'Invalid parent/backend reference')
 need(re.fullmatch(REF('frontend'),p['targetImage']),'Invalid target reference')
 need(hashlib.sha256(r['manifestText'].encode()).hexdigest()==p['manifestSha256'],'Package manifest mismatch')
 need(m['candidateSource']==a['uiSha'] and m['controlSha']==a['controlSha'] and m['appSha']==a['appSha'],'Manifest source mismatch')
 need(m['parentFrontend']==a['parentFrontend'] and m['backendImage']==a['backendImage'],'Manifest parent mismatch')
 need(m['parentStaticSha256']==a['baselineTreeSha256'] and m['parentWebsiteSha256']==m['targetWebsiteSha256'],'Manifest static bindings mismatch')
 for k in ['parentStaticSha256','targetStaticSha256','parentWebsiteSha256','targetWebsiteSha256']:
  need(p[k]==m[k] and re.fullmatch('[0-9a-f]{64}',p[k]),'Prepared static hashes mismatch')
 if r['operation']=='install':need(p['targetImage']!=a['parentFrontend'],'Install target equals parent')
 else:
  prior=r['priorOverlay'];need(prior.get('operation')=='install' and prior.get('completed') is True,'Rollback requires completed install')
  need(prior['manifestSha256']==p['manifestSha256'] and prior['frontendImage']==p['targetImage'] and prior['backendImage']==a['backendImage'],'Rollback prior identity mismatch')
 return a,p,m

class Runtime:
 def __init__(self,run_id):self.run_id=str(run_id)
 def docker(self,*args,env=None):
  safe_env={'PATH':'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','HOME':'/root','LC_ALL':'C',**(env or {})}
  r=subprocess.run(['/usr/bin/docker','--host','unix:///var/run/docker.sock','--config','/opt/fleetum-staging/docker-config',*args],env=safe_env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=180)
  need(r.returncode==0,'Staging container operation failed');return r.stdout.decode()
 @contextlib.contextmanager
 def lock(self):
  need(APP.is_dir() and APP.resolve()==APP,'Canonical staging app required')
  fd=os.open('/opt/fleetum-staging/deploy.lock',os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
  with os.fdopen(fd,'r+') as f:
   fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);yield
 def inspect(self,name):
  need(name in [FRONT,BACK],'Unexpected container')
  fmt='{"image":{{json .Config.Image}},"containerId":{{json .Id}},"startedAt":{{json .State.StartedAt}},"restartCount":{{json .RestartCount}},"running":{{json .State.Running}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"mounts":[{{range $i,$m := .Mounts}}{{if $i}},{{end}}{"source":{{json .Source}},"destination":{{json .Destination}}}{{end}}]}'
  return json.loads(self.docker('inspect','--format',fmt,name))
 def static_tree(self,root):
  need(root in ['/srv/fleetum','/srv/fleetum-website'],'Unexpected static root')
  info=self.docker('exec',FRONT,'sh','-c',"test ! -L /srv && test ! -L "+root+" && find "+root+" -xdev -exec stat -c '%F|%s|%n' {} +")
  files=[]
  for line in info.splitlines():
   kind,size,path=line.split('|',2)
   need(kind in ['directory','regular file'],'Static tree symlink or special file')
   if kind=='regular file':
    need(path.startswith(root+'/') and re.fullmatch(r'[A-Za-z0-9_./-]+',path),'Unsafe static path');files.append((path,int(size)))
  need(0<len(files)<20000,'Static tree inventory invalid')
  hashes=self.docker('exec',FRONT,'sha256sum',*[x[0] for x in files]);rows=[];sizes=dict(files)
  for line in hashes.splitlines():
   sha,path=line.split(None,1);path=path.strip();need(path in sizes and re.fullmatch('[0-9a-f]{64}',sha),'Invalid static hash result');rows.append([path[len(root)+1:],sizes[path],sha])
  need(len(rows)==len(files),'Static hash coverage incomplete');return rows
 def verify_configs(self,hashes,ingress_mode):
  expected={'docker-compose.staging.yml','deploy/caddy/Caddyfile.staging-shared' if ingress_mode=='shared' else 'deploy/caddy/Caddyfile.staging'}
  if ingress_mode=='shared':expected.add('docker-compose.staging.shared.yml')
  need(set(hashes)==expected,'Canonical config hash coverage required')
  for rel,sha in hashes.items():
   path=APP/rel
   need(path.is_file() and not path.is_symlink() and all(not p.is_symlink() for p in path.parents if p!=APP.parent),'Canonical config symlink rejected')
   need(path.stat().st_size<=1024*1024 and re.fullmatch('[0-9a-f]{64}',sha) and hashlib.sha256(path.read_bytes()).hexdigest()==sha,'Canonical compose or ingress configuration drift')
 def pull(self,target):self.docker('pull',target)
 def switch(self,target,a):
  directory=APP/'.deploy-platform'/self.run_id
  need(directory.is_dir() and directory.resolve()==directory,'Trusted run directory missing')
  override=directory/'frontend-image.json'
  with override.open('x') as f:json.dump({'services':{'caddy':{'image':target}}},f)
  args=['compose','--project-name','fleetum-staging','--env-file','/opt/fleetum-staging/env/compose.env','-f',str(APP/'docker-compose.staging.yml')]
  if a['ingressMode']=='shared':args+=['-f',str(APP/'docker-compose.staging.shared.yml')]
  args+=['-f',str(override),'up','-d','--no-build','--no-deps','--pull','never','caddy']
  # Only public, strictly validated image identities are added to the environment.
  env={'FLEETUM_BACKEND_IMAGE':a['backendImage'],'FLEETUM_FRONTEND_IMAGE':target}
  self.docker(*args,env=env)
 def health(self,platform_sha):
  import urllib.request
  health=APP/'.deploy-platform'/self.run_id/'health.sh'
  r=subprocess.run(['bash',str(health),'direct'],env={'PATH':'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','HOME':'/root','LC_ALL':'C','DOCKER_HOST':'unix:///var/run/docker.sock'},stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=40)
  need(r.returncode==0,'Strict Platform health check failed')
  with urllib.request.urlopen('https://platform-staging.fleetum.it/platform.html',timeout=20) as response:
   body=response.read(131073);need(response.status==200 and len(body)<=131072 and hashlib.sha256(body).hexdigest()==platform_sha,'HTTPS Platform entry does not match target')

def apply(r,runtime):
 a,p,m=validate_request(r);before=r['beforeRuntime'];expected_before=a['parentFrontend'] if r['operation']=='install' else r['priorOverlay']['frontendImage'];target=p['targetImage'] if r['operation']=='install' else a['parentFrontend']
 with runtime.lock():
  backend=runtime.inspect(BACK);front=runtime.inspect(FRONT)
  need(backend['image']==a['backendImage'] and backend_equal(backend,before['backend']),'Backend identity changed before apply')
  need(front['image']==expected_before and backend_equal(front,before['frontend']),'Frontend identity changed before apply')
  for item,name,service in [(backend,BACK,'backend'),(front,FRONT,'caddy')]:need(item['project']=='fleetum-staging' and item['service']==service and item['running'] is True,'Container is not the canonical staging service')
  roots=['/srv/fleetum','/srv/fleetum-website']
  for mount in front['mounts']:
   dest=mount['destination'].rstrip('/') or '/'
   need(not any(dest=='/' or dest==root or dest.startswith(root+'/') or root.startswith(dest+'/') for root in roots),'Static root runtime mount')
  expected_config=str(APP/('deploy/caddy/Caddyfile.staging-shared' if a['ingressMode']=='shared' else 'deploy/caddy/Caddyfile.staging'))
  need(any(x['destination']=='/etc/caddy/Caddyfile' and x['source']==expected_config for x in front['mounts']),'Staging ingress configuration mismatch')
  baseline=runtime.static_tree(roots[0]);website=runtime.static_tree(roots[1]);base_sha=hash_rows(baseline)
  need(base_sha==(a['baselineTreeSha256'] if r['operation']=='install' else p['targetStaticSha256']),'Live baseline static tree drift')
  need(hash_rows(website)==p['parentWebsiteSha256'],'Live website tree drift')
  runtime.verify_configs(r['configHashes'],a['ingressMode'])
  runtime.pull(target);runtime.switch(target,a)
  after_backend=runtime.inspect(BACK);after_front=runtime.inspect(FRONT)
  need(after_backend==backend,'Backend changed during frontend transaction')
  need(after_front['image']==target and after_front['running'] is True,'Frontend target not running')
  target_rows=runtime.static_tree(roots[0]);target_sha=hash_rows(target_rows)
  need(target_sha==(p['targetStaticSha256'] if r['operation']=='install' else a['baselineTreeSha256']),'Installed static tree mismatch')
  need(hash_rows(runtime.static_tree(roots[1]))==hash_rows(website),'Public website changed')
  platform_sha=next(x[2] for x in target_rows if x[0]=='platform.html');runtime.health(platform_sha)
  return {'schemaVersion':1,'operation':r['operation'],'backendUnchanged':True,'parentStaticSha256':a['baselineTreeSha256'],'targetStaticSha256':target_sha,'targetImage':target,'websiteSha256':hash_rows(website),'completed':True}

if __name__=='__main__':
 try:
  data=sys.stdin.buffer.read(4*1024*1024+1);need(len(data)<=4*1024*1024,'Request too large');request=json.loads(data);validate_request(request)
  result=apply(request,Runtime(request['runId']));print(json.dumps(result))
 except Exception:
  # Never retry or restore implicitly; caller must retain evidence and request rollback.
  print('Platform-only staging transaction failed; no automatic retry or rollback.',file=sys.stderr);sys.exit(1)
