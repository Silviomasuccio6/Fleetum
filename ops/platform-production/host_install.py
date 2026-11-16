"""Single protected production transaction; never invoked by candidate/image CI.

No automatic retry, original-backend downgrade, database restore or config
replacement. The host's distinct backend and shared gateway manifests survive.
"""
import contextlib
import datetime
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tarfile
import time
import urllib.request

HERE=Path(__file__).parent
spec=importlib.util.spec_from_file_location('host_preflight',HERE/'host_preflight.py')
preflight=importlib.util.module_from_spec(spec);spec.loader.exec_module(preflight)
spec=importlib.util.spec_from_file_location('image_identity',HERE/'image_identity.py')
identity=importlib.util.module_from_spec(spec);spec.loader.exec_module(identity)
need=preflight.need
UPLOAD_POLICY={'action':'grant-backend-group-write','path':'/opt/fleetum/uploads','expectedOwnerUid':1001,'expectedGroupGid':1001,
    'expectedMode':0o755,'targetGroupGid':1000,'targetMode':0o775,'ownerPreserved':True,'onlyIfEmpty':True,'recursive':False,
    'containerPath':'/app/backend/uploads','addPersistentBind':True}
def fingerprint(value):return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
def image(role,value):return bool(re.fullmatch(r'ghcr\.io/silviomasuccio6/fleetum-'+role+r'@sha256:[0-9a-f]{64}',value or ''))
def validate(r,now=None):
    now=now or datetime.datetime.now(datetime.timezone.utc)
    need(r.get('schemaVersion')==1 and r.get('kind')=='platform-production-install-request','Protected install request required')
    need(r.get('confirm')=='RELEASE_PLATFORM_PRODUCTION' and re.fullmatch('[1-9][0-9]*',str(r.get('runId',''))),'Explicit install confirmation and run required')
    patch=r.get('expectedPatchMigration',{})
    need(set(patch)=={'20260921150000_final_release_blocker_atomicity'} and all(re.fullmatch('[0-9a-f]{64}',v) for v in patch.values()),'Exact canonical patch checksum required')
    a=r['approval'];p=r['prepared'];profile=r['profile'];backup=r['backup'];b=r['backupRequest']
    need(a['kind']=='platform-production-approval' and a['repository']=='Silviomasuccio6/Fleetum','Production approval required')
    need(re.fullmatch('[0-9a-f]{40}',a['controlSha']) and p['controlSha']==a['controlSha'],'Reviewed control mismatch')
    until=datetime.datetime.fromisoformat(a['approvedUntil'].replace('Z','+00:00'))
    need(0<(until-now).total_seconds()<=6*3600,'Expired or excessive install window')
    for key,value in [('profileSha256',profile),('backupSha256',backup),('preflightSha256',b)]:need(fingerprint(value)==a[key],'Protected evidence hash mismatch')
    preflight.validate(b)
    need(b.get('uploadPermissionPolicy')==UPLOAD_POLICY,'Explicit reviewed empty-directory permission policy required')
    need(backup['kind']=='platform-production-backup' and backup['baseline']==b['baseline'] and backup['containersUnchanged'] is True,'Backup baseline mismatch')
    need(backup.get('backendUploads',{}).get('files')==0 and backup['backendUploads'].get('sourcePath')=='/app/backend/uploads' and backup['backendUploads'].get('fullArchiveParsePassed') is True,'Actual active upload directory backup required')
    at=datetime.datetime.fromisoformat(backup['createdAtUTC'].replace('Z','+00:00'))
    need(0<=(now-at).total_seconds()<=6*3600,'Fresh backup required')
    need(profile['target']=='production' and profile['appDir']=='/opt/fleetum/app' and profile['backend']['project']==profile['frontend']['project']=='app','Reviewed host layout required')
    need(profile['ingressMode']=='shared' and re.fullmatch(r'/opt/fleetum/ingress-control/[0-9a-f]{64}\.shared\.json',profile['frontendCompose']),'Reviewed shared gateway required')
    need(profile['backendCompose']=='/opt/fleetum/app/docker-compose.prod.yml' and profile['staticRootMounts']==[],'Canonical production manifest required')
    need(p['kind']=='platform-production-prepared-images' and p['imagesPublished'] is True and p['installationExecuted'] is False,'Published inert images required')
    for key in ['parentBackend','parentFrontend','candidateManifestSha256','profileSha256']:
        need(p[key]==a['manifestSha256' if key=='candidateManifestSha256' else key],'Prepared image approval mismatch')
    need(p['parentStaticSha256']==a['parentStaticSha256'] and p['parentWebsiteSha256']==a['parentWebsiteSha256'],'Reviewed static parent mismatch')
    need(profile['backend']['imageDigest']==a['parentBackend'] and profile['frontend']['imageDigest']==a['parentFrontend'],'Host parent mismatch')
    need(str(p['candidateCiRunId'])==str(a['candidateCiRunId']),'Candidate CI mismatch')
    need(image('backend',p['backendImage']) and image('frontend',p['variants']['satin']['image']) and image('frontend',p['variants']['fallback']['image']),'Immutable prepared targets required')
    need(backup['manifestSha256']==b['manifestSha256']==a['manifestSha256'],'Backup candidate mismatch')
    for name,role in [('fleetum_backend','backend'),('fleetum_caddy','frontend')]:
        need(b['baseline'][name]['id']==profile[role]['containerId'] and b['baseline'][name]['imageId']==profile[role]['imageId'],'Host/backup runtime mismatch')
    return a,p,profile

class Runtime(preflight.Runtime):
    def __init__(self,request):self.r=request;self.profile=request['profile'];self.directory=Path('/opt/fleetum/platform-production-control')/str(request['runId']);self.caddy_contact=None
    def docker(self,*args,input_file=None,output_file=None,env=None):
        return super().docker(*args,input_file=input_file,output_file=output_file,env=env)
    @contextlib.contextmanager
    def lock(self):
        need(Path('/opt/fleetum').resolve()==Path('/opt/fleetum'),'Canonical production root required')
        fd=os.open('/opt/fleetum/deploy.lock',os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
        with os.fdopen(fd,'r+') as f:
            fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);yield
    def configs(self):
        for item in self.profile['configFingerprints']:
            p=Path(item['path']);need(preflight.canonical(p) and p.is_file() and p.stat().st_size<=1024*1024,'Canonical bounded config required')
            need(preflight.digest(p)==item['sha256'],'Production manifest/configuration drift')
    def verify_upload_policy(self):
        p=Path(UPLOAD_POLICY['path']);need(preflight.canonical(p) and p.is_dir(),'Canonical upload directory required')
        st=p.stat();need((st.st_uid,st.st_gid,st.st_mode&0o7777)==(1001,1001,0o755) and not any(p.iterdir()),'Upload ownership/content changed; review the permission plan again')
        code="const fs=require('node:fs'),path=require('node:path');const root=path.resolve(process.env.UPLOAD_DIR||'uploads');console.log(JSON.stringify({root,provider:process.env.STORAGE_PROVIDER||'local',empty:fs.readdirSync(root).length===0}))"
        value=json.loads(self.docker('exec','fleetum_backend','node','-e',code))
        need(value=={'root':'/app/backend/uploads','provider':'local','empty':True},'Active upload storage changed; preserve container and review migration')
    def verify_stopped_uploads_empty(self):
        p=self.directory/'old-backend-uploads.tar'
        with p.open('xb') as f:os.chmod(p,0o600);self.docker('cp','fleetum_backend:/app/backend/uploads/.','-',output_file=f)
        need(p.stat().st_size<=1024*1024,'Active storage changed during worker drain')
        with tarfile.open(p,'r:') as archive:need(all(m.isdir() for m in archive),'Documents admitted during drain; preserve old container and backup, do not replace')
    def maintain_uploads(self):
        p=Path(UPLOAD_POLICY['path']);need(preflight.canonical(p),'Upload directory link rejected')
        fd=os.open(p,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        try:
            st=os.fstat(fd);need((st.st_uid,st.st_gid,st.st_mode&0o7777)==(1001,1001,0o755) and os.listdir(fd)==[],'Empty upload directory policy drift')
            self.journal('upload-group-permission-changing')
            # Preserve UID1001/operator ownership. Only node's existing GID1000
            # gains write access to this empty directory; never recurse.
            os.fchown(fd,-1,1000);os.fchmod(fd,0o775)
            self.journal('upload-group-permission-granted')
        finally:os.close(fd)
    def verify_backup(self):
        b=self.r['backup'];directory=Path(b['directory'])
        need(re.fullmatch(r'/var/backups/fleetum-platform-production/[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}',str(directory)) and preflight.canonical(directory),'Private backup directory required')
        for role,name in [('database','database.dump'),('uploads','uploads.tar.gz')]:
            item=b[role];p=directory/name
            need(item['path']==str(p) and preflight.canonical(p) and p.is_file() and p.stat().st_size==item['bytes'] and preflight.digest(p)==item['sha256'],'Backup changed or incomplete')
        item=b['backendUploads'];p=directory/'backend-uploads.tar'
        need(item['path']==str(p) and preflight.canonical(p) and p.is_file() and p.stat().st_size==item['bytes'] and preflight.digest(p)==item['sha256'],'Active storage backup changed')
        need(b['database']['fullArchiveParsePassed'] is True and b['uploads']['fullContentComparisonPassed'] is True,'Verified archive integrity required')
    def begin(self):
        # Preserve only this non-secret existing certificate contact in memory.
        # Never read/copy the compose/backend env files, persist or print it.
        self.caddy_contact=self.docker('exec','fleetum_caddy','printenv','CADDY_EMAIL').strip()
        need(re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',self.caddy_contact) and len(self.caddy_contact)<=254,'Existing certificate contact unavailable')
        parent=self.directory.parent;need(preflight.canonical(parent),'Canonical transaction directory required')
        parent.mkdir(mode=0o700,exist_ok=True);need(parent.stat().st_mode&0o077==0,'Private transaction state required')
        self.directory.mkdir(mode=0o700) # Existing run is never replayed.
        for role,service in [('backend','backend'),('frontend','caddy')]:
            target=self.r['prepared']['backendImage'] if role=='backend' else self.r['prepared']['variants']['satin']['image']
            settings={'image':target}
            if role=='backend':settings['volumes']=[{'type':'bind','source':'/opt/fleetum/uploads','target':'/app/backend/uploads','bind':{'create_host_path':False}}]
            (self.directory/(role+'.json')).write_text(json.dumps({'services':{service:settings}}))
    def journal(self,phase):
        p=self.directory/'phase.json';tmp=self.directory/'phase.pending'
        with tmp.open('w') as f:json.dump({'phase':phase,'runId':self.r['runId'],'controlSha':self.r['approval']['controlSha']},f);f.flush();os.fsync(f.fileno())
        os.replace(tmp,p)
    def compose(self,role,*args):
        # Separate invocations are necessary: merging the legacy app model with
        # the standalone shared gateway can change network/volume semantics.
        public={'FLEETUM_BACKEND_IMAGE':self.r['prepared']['backendImage'],'FLEETUM_FRONTEND_IMAGE':self.r['prepared']['variants']['satin']['image']}
        if self.caddy_contact:public['CADDY_EMAIL']=self.caddy_contact
        return self.docker('compose','--project-name','app','--project-directory','/opt/fleetum/app','--env-file','/opt/fleetum/env/compose.env',
            '-f',self.profile['backendCompose' if role=='backend' else 'frontendCompose'],'-f',str(self.directory/(role+'.json')),*args,
            env={**os.environ,**public})
    def pull(self):
        for value in [self.r['prepared']['backendImage'],self.r['prepared']['variants']['satin']['image'],self.r['prepared']['variants']['fallback']['image']]:self.docker('pull',value)
        # Verify the manifest-to-tested-config bridge before any lifecycle step;
        # keep it for the post-start check rather than adding a network dependency.
        self.backend_registry=identity.verify_published_backend(self.docker,self.r['prepared'],self.r['backendTreeSha'])
    def stop_backend(self):
        self.docker('stop','--time','45','fleetum_backend')
        need(self.snapshot()['fleetum_backend']['running'] is False,'Old invoice consumer did not stop')
    def migrate(self):
        # This command starts only the Prisma CLI, never the app/worker. No
        # dependency download, provider call or database service recreation.
        self.compose('backend','run','--rm','--no-deps','--pull','never','-T','backend','/app/node_modules/.bin/prisma','migrate','deploy','--schema','prisma/schema.prisma')
    def start_backend(self):self.compose('backend','up','-d','--no-deps','--no-build','--pull','never','backend')
    def start_frontend(self):self.compose('frontend','up','-d','--no-deps','--no-build','--pull','never','caddy')
    def expanded_schema(self):
        db=self.database();expected={**self.r['backupRequest']['migrations'],**self.r['expectedPatchMigration']}
        need(db['failedMigrations']==0 and {m['name']:m['checksum'] for m in db['migrations']}==expected,'Expanded schema differs from canonical 43-migration chain')
    def image_and_layout(self,name,role):
        raw=self.docker('inspect','--format','{"image":{{json .Config.Image}},"mounts":{{json .Mounts}},"networks":{{json .NetworkSettings.Networks}}}',name)
        value=json.loads(raw);expected=self.profile[role]
        mounts=sorted([{'source':m['Source'],'destination':m['Destination'],'rw':m['RW']} for m in value['mounts']],key=lambda m:m['destination'])
        allowed=[*expected['mounts'],*([{'source':'/opt/fleetum/uploads','destination':'/app/backend/uploads','rw':True}] if role=='backend' else [])]
        need(mounts==sorted(allowed,key=lambda m:m['destination']) and sorted(value['networks'])==expected['networks'],'Unexpected production persistence or shared network change')
        target=self.r['prepared']['backendImage'] if role=='backend' else self.r['prepared']['variants']['satin']['image']
        need(value['image']==target,'Unexpected installed image')
        if role=='backend':
            identity.verify_backend(self.docker,self.r['prepared'],self.r['backendTreeSha'],self.backend_registry)
    def tree(self,root):
        need(root in ['/srv/fleetum','/srv/fleetum-website'],'Static root allowlist')
        raw=self.docker('exec','fleetum_caddy','sh','-c',"test ! -L /srv && test ! -L "+root+" && find "+root+" -xdev -exec stat -c '%F|%s|%n' {} +")
        files={}
        for line in raw.splitlines():
            kind,size,p=line.split('|',2);need(kind in ['regular file','directory'],'Static links/special files rejected')
            if kind=='regular file':need(re.fullmatch(re.escape(root)+r'/[A-Za-z0-9_./-]+',p),'Unsupported static path');files[p]=int(size)
        need(0<len(files)<20000,'Bounded static inventory required')
        rows=[]
        for line in self.docker('exec','fleetum_caddy','sha256sum',*sorted(files)).splitlines():
            sha,p=line.split(None,1);p=p.strip();need(p in files and re.fullmatch('[0-9a-f]{64}',sha),'Static checksum invalid');rows.append([p[len(root)+1:],files[p],sha])
        need(len(rows)==len(files),'Static hash inventory incomplete')
        return hashlib.sha256(json.dumps(sorted(rows,key=lambda row:PurePosixPath(row[0]).parts),separators=(',',':')).encode()).hexdigest()
    def health(self):
        for url in ['https://api.fleetum.it/api/ready','https://platform.fleetum.it/platform-api/health','https://staging.fleetum.it/','https://api-staging.fleetum.it/api/ready']:
            deadline=time.monotonic()+60
            while True:
                try:
                    with urllib.request.urlopen(url,timeout=10) as response:need(response.status==200,'Health status invalid')
                    break
                except Exception:
                    if time.monotonic()>deadline:raise ValueError('Production/shared staging health failed')
                    time.sleep(2)

def install(r,runtime,now=None):
    a,p,profile=validate(r,now)
    with runtime.lock():
        runtime.configs();runtime.verify_backup();runtime.verify_upload_policy()
        need(runtime.snapshot()==r['backupRequest']['baseline'],'Runtime drift before install')
        preflight.check_database(runtime.database(),r['backupRequest']['migrations'])
        need(runtime.tree('/srv/fleetum')==a['parentStaticSha256'] and runtime.tree('/srv/fleetum-website')==a['parentWebsiteSha256'],'Actual static parent differs from prepared images')
        runtime.begin();runtime.journal('verified');runtime.pull()
        # Stop the old worker before any new schema/consumer is started, then
        # recheck pending invoices to catch commands admitted during the drain.
        runtime.stop_backend();runtime.journal('old-backend-stopped')
        runtime.verify_stopped_uploads_empty()
        preflight.check_database(runtime.database(),r['backupRequest']['migrations'])
        runtime.maintain_uploads()
        runtime.migrate();runtime.expanded_schema();runtime.journal('schema-expanded')
        runtime.start_backend();runtime.image_and_layout('fleetum_backend','backend');runtime.journal('new-backend-started')
        runtime.health();runtime.start_frontend();runtime.image_and_layout('fleetum_caddy','frontend')
        need(runtime.tree('/srv/fleetum')==p['variants']['satin']['targetStaticSha256'],'Installed Platform/static tree differs')
        need(runtime.tree('/srv/fleetum-website')==a['parentWebsiteSha256'],'Public website changed')
        need(runtime.snapshot()['fleetum_postgres']==r['backupRequest']['baseline']['fleetum_postgres'],'Database container changed')
        runtime.configs();runtime.health();runtime.journal('completed')
        return {'schemaVersion':1,'kind':'platform-production-installation','completed':True,'runId':str(r['runId']),'controlSha':a['controlSha'],
            'backendImage':p['backendImage'],'frontendImage':p['variants']['satin']['image'],'databaseContainerUnchanged':True,
            'websitePreserved':True,'sharedIngressPreserved':True,'authenticatedAcceptancePending':True,'automaticRollbackExecuted':False}

if __name__=='__main__':
    try:
        need(os.geteuid()==0,'Protected administrator session required')
        raw=sys.stdin.buffer.read(2*1024*1024+1);need(len(raw)<=2*1024*1024,'Bounded install request required')
        request=json.loads(raw);validate(request)
        print(json.dumps(install(request,Runtime(request))))
    except Exception:raise SystemExit('Production transaction stopped. Preserve its phase journal; no automatic retry, backend downgrade or database restore.')
