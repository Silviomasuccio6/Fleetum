"""One frontend-only completion of an independently attested partial install.

No application/backend/database lifecycle or permission mutation is available.
Original application provenance and the new controller identity stay distinct.
"""
import contextlib
import datetime
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path,PurePosixPath
import re
import sys
import time
import urllib.request

HERE=Path(__file__).parent
def load(name):
    spec=importlib.util.spec_from_file_location(name,HERE/(name+'.py'))
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
preflight=load('host_preflight');identity=load('image_identity');need=preflight.need
def fingerprint(value):return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
def immutable(role,value):return bool(re.fullmatch(r'ghcr\.io/silviomasuccio6/fleetum-'+role+r'@sha256:[0-9a-f]{64}',value or ''))

def validate(r,now=None):
    now=now or datetime.datetime.now(datetime.timezone.utc)
    need(r.get('schemaVersion')==1 and r.get('kind')=='platform-production-frontend-completion-request','Dedicated frontend request required')
    need(r.get('confirm')=='COMPLETE_PLATFORM_FRONTEND' and re.fullmatch('[1-9][0-9]*',str(r.get('runId',''))),'Explicit frontend completion required')
    a=r['approval'];old=r['originalRequest'];state=r['currentState'];p=r['prepared'];profile=old['profile'];previous=old['approval']
    need(a.get('schemaVersion')==1 and a.get('kind')=='platform-production-frontend-completion-approval' and a.get('repository')=='Silviomasuccio6/Fleetum','Reviewed completion required')
    need(a.get('allowVisualFallback') is True,'Exactly one compatible visual fallback must be approved')
    need(re.fullmatch('[0-9a-f]{40}',a['controlSha']) and re.fullmatch('[0-9a-f]{40}',a['applicationControlSha']) and re.fullmatch('[0-9a-f]{40}',r['backendTreeSha']),'Full source identities required')
    until=datetime.datetime.fromisoformat(a['approvedUntil'].replace('Z','+00:00'))
    observed=datetime.datetime.fromisoformat(state['observedAtUTC'].replace('Z','+00:00'))
    need(0<(until-now).total_seconds()<=21600 and 0<=(now-observed).total_seconds()<=21600,'Completion window or observation expired')
    need(fingerprint(old)==a['originalRequestSha256'] and fingerprint(state)==a['currentStateSha256'],'Bound original and current evidence required')
    need(old['kind']=='platform-production-install-request' and old['confirm']=='RELEASE_PLATFORM_PRODUCTION','Original protected installation required')
    need(str(old['runId'])==str(a['failedInstallRunId']) and str(r['runId'])!=str(old['runId']),'Distinct failed installation identity required')
    need(p==old['prepared'] and p['controlSha']==previous['controlSha']==a['applicationControlSha'],'Do not rewrite original prepared provenance')
    need(str(p['prepareRunId'])==str(a['prepareRunId']) and p['imagesPublished'] is True and p['installationExecuted'] is False,'Original inert prepared artifact required')
    for key,value in [('profileSha256',profile),('backupSha256',old['backup']),('preflightSha256',old['backupRequest'])]:need(fingerprint(value)==previous[key],'Original evidence changed')
    need(p['profileSha256']==previous['profileSha256'] and p['candidateManifestSha256']==previous['manifestSha256'],'Original prepared evidence mismatch')
    need(p['parentStaticSha256']==previous['parentStaticSha256'] and p['parentWebsiteSha256']==previous['parentWebsiteSha256'],'Original static baseline mismatch')
    preflight.validate(old['backupRequest'])
    patch=old['expectedPatchMigration']
    need(set(patch)=={'20260921150000_final_release_blocker_atomicity'} and all(re.fullmatch('[0-9a-f]{64}',v) for v in patch.values()),'Canonical patch checksum required')
    need(profile['appDir']=='/opt/fleetum/app' and profile['ingressMode']=='shared' and profile['staticRootMounts']==[],'Reviewed shared ingress required')
    need(re.fullmatch(r'/opt/fleetum/ingress-control/[0-9a-f]{64}\.shared\.json',profile['frontendCompose']),'Pinned standalone gateway required')
    need(immutable('backend',p['backendImage']) and re.fullmatch('sha256:[0-9a-f]{64}',p['backendImageId']),'Immutable tested backend required')
    for role in ['satin','fallback']:
        v=p['variants'][role];need(immutable('frontend',v['image']) and re.fullmatch('[0-9a-f]{40}',v['sourceSha']),'Immutable frontend source required')
        need(all(re.fullmatch('[0-9a-f]{64}',v[key]) for key in ['manifestSha256','targetStaticSha256']),'Reviewed frontend content hashes required')
    need(state['kind']=='platform-production-frontend-state' and set(state['baseline'])==set(preflight.NAMES),'Exact current runtime required')
    baseline=state['baseline'];original=old['backupRequest']['baseline']
    need(baseline['fleetum_postgres']==original['fleetum_postgres'] and baseline['fleetum_caddy']==original['fleetum_caddy'],'Only the backend may have changed in the partial installation')
    need(baseline['fleetum_backend']['running'] is True and baseline['fleetum_backend']['id']!=original['fleetum_backend']['id'],'Updated running backend required')
    need(baseline['fleetum_backend']['imageId'] in {p['backendImageId'],p['backendImage'].split('@')[1]},'Current backend identity differs')
    return a,p,profile


class Runtime(preflight.Runtime):
    def __init__(self,r):
        self.r=r;self.old=r['originalRequest'];self.p=r['prepared'];self.profile=self.old['profile']
        self.directory=Path('/opt/fleetum/platform-frontend-completion')/str(r['runId']);self.caddy_contact=None
    @contextlib.contextmanager
    def lock(self):
        need(preflight.canonical(Path('/opt/fleetum')),'Canonical production root required')
        fd=os.open('/opt/fleetum/deploy.lock',os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
        with os.fdopen(fd,'r+') as f:fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);yield
    def configs(self):
        for item in self.profile['configFingerprints']:
            p=Path(item['path']);need(preflight.canonical(p) and p.is_file() and p.stat().st_size<=1024*1024,'Bounded canonical config required')
            need(preflight.digest(p)==item['sha256'],'Production configuration changed')
    def layout(self,name,role,target):
        fmt='{"image":{{json .Config.Image}},"mounts":{{json .Mounts}},"networks":{{json .NetworkSettings.Networks}}}'
        value=json.loads(self.docker('inspect','--format',fmt,name));expected=self.profile[role]
        mounts=sorted([{'source':m['Source'],'destination':m['Destination'],'rw':m['RW']} for m in value['mounts']],key=lambda m:m['destination'])
        allowed=[*expected['mounts'],*([{'source':'/opt/fleetum/uploads','destination':'/app/backend/uploads','rw':True}] if role=='backend' else [])]
        need(mounts==sorted(allowed,key=lambda m:m['destination']) and sorted(value['networks'])==expected['networks'],'Production persistence or network changed')
        need(value['image']==target,'Unexpected runtime image reference')
    def verify_invariants(self):
        current=self.snapshot()
        for name in ['fleetum_backend','fleetum_postgres']:need(current[name]==self.r['currentState']['baseline'][name],'Backend/database runtime changed')
        self.configs();self.layout('fleetum_backend','backend',self.p['backendImage'])
        db=self.database();expected={**self.old['backupRequest']['migrations'],**self.old['expectedPatchMigration']}
        need(db['failedMigrations']==0 and {m['name']:m['checksum'] for m in db['migrations']}==expected and len(expected)==43,'Canonical expanded database changed')
        upload=Path('/opt/fleetum/uploads');need(preflight.canonical(upload) and upload.is_dir(),'Canonical upload bind required')
        st=upload.stat();need((st.st_uid,st.st_gid,st.st_mode&0o7777)==(1001,1000,0o775),'Upload permissions changed')
        code="const fs=require('node:fs'),path=require('node:path');const root=path.resolve(process.env.UPLOAD_DIR||'uploads');fs.accessSync(root,fs.constants.R_OK|fs.constants.W_OK);console.log(JSON.stringify({root,provider:process.env.STORAGE_PROVIDER||'local',uid:process.getuid(),gid:process.getgid()}))"
        need(json.loads(self.docker('exec','fleetum_backend','node','-e',code))=={'root':'/app/backend/uploads','provider':'local','uid':1000,'gid':1000},'Persistent storage access changed')
    def verify_initial(self):
        need(self.snapshot()==self.r['currentState']['baseline'],'Current runtime changed before frontend completion')
        phase=Path('/opt/fleetum/platform-production-control')/str(self.old['runId'])/'phase.json'
        need(preflight.canonical(phase) and phase.is_file() and phase.stat().st_size<=4096,'Original phase journal required')
        need(json.loads(phase.read_text())=={'phase':'schema-expanded','runId':self.old['runId'],'controlSha':self.old['approval']['controlSha']},'Unexpected original installation phase')
        self.layout('fleetum_caddy','frontend',self.p['parentFrontend']);self.verify_invariants()
        need(self.tree('/srv/fleetum')==self.p['parentStaticSha256'] and self.tree('/srv/fleetum-website')==self.p['parentWebsiteSha256'],'Static baseline changed')
        directory=Path(self.old['backup']['directory'])
        need(re.fullmatch(r'/var/backups/fleetum-platform-production/[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}',str(directory)) and preflight.canonical(directory),'Original private backup required')
        for role,name in [('database','database.dump'),('uploads','uploads.tar.gz'),('backendUploads','backend-uploads.tar')]:
            item=self.old['backup'][role];p=directory/name
            need(item['path']==str(p) and preflight.canonical(p) and p.is_file() and p.stat().st_size==item['bytes'] and preflight.digest(p)==item['sha256'],'Original backup integrity changed')
    def verify_images(self):
        # Resolve all registry metadata before changing the shared gateway.
        identity.verify_backend(self.docker,self.p,self.r['backendTreeSha'])
        for role in ['satin','fallback']:
            v=self.p['variants'][role];self.docker('pull',v['image'])
            fmt='{"digests":{{json .RepoDigests}},"os":{{json .Os}},"arch":{{json .Architecture}},"source":{{json (index .Config.Labels "it.fleetum.platform.source")}},"control":{{json (index .Config.Labels "it.fleetum.platform.control")}},"manifest":{{json (index .Config.Labels "it.fleetum.platform.manifest")}}}'
            info=json.loads(self.docker('image','inspect','--format',fmt,v['image']))
            need(v['image'] in info['digests'] and info['os']=='linux' and info['arch']=='amd64','Prepared frontend platform/reference changed')
            need(info['source']==v['sourceSha'] and info['control']==self.p['controlSha'] and info['manifest']==v['manifestSha256'],'Prepared frontend provenance changed')
    def begin(self):
        self.caddy_contact=self.docker('exec','fleetum_caddy','printenv','CADDY_EMAIL').strip()
        need(re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',self.caddy_contact) and len(self.caddy_contact)<=254,'Existing certificate contact required')
        parent=self.directory.parent;need(preflight.canonical(parent),'Canonical private completion root required')
        parent.mkdir(mode=0o700,exist_ok=True);need(parent.stat().st_uid==0 and parent.stat().st_mode&0o077==0,'Private completion root required')
        self.directory.mkdir(mode=0o700)
    def journal(self,phase):
        p=self.directory/'phase.json';tmp=self.directory/'phase.pending'
        with tmp.open('w') as f:
            json.dump({'phase':phase,'runId':str(self.r['runId']),'controlSha':self.r['approval']['controlSha'],'applicationControlSha':self.p['controlSha']},f);f.flush();os.fsync(f.fileno())
        os.replace(tmp,p)
    def write_overlay(self,role):
        need(role in ['satin','fallback'],'Only two reviewed frontend targets allowed')
        p=self.directory/'frontend.json';p.write_text(json.dumps({'services':{'caddy':{'image':self.p['variants'][role]['image']}}}));p.chmod(0o600)
    def activate(self,role):
        self.write_overlay(role)
        self.docker('compose','--project-name','app','--project-directory','/opt/fleetum/app','--env-file','/opt/fleetum/env/compose.env',
            '-f',self.profile['frontendCompose'],'-f',str(self.directory/'frontend.json'),
            'up','-d','--no-deps','--no-build','--pull','never','caddy',
            env={**os.environ,'FLEETUM_BACKEND_IMAGE':self.p['backendImage'],'FLEETUM_FRONTEND_IMAGE':self.p['variants'][role]['image'],'CADDY_EMAIL':self.caddy_contact})
    def tree(self,root):
        need(root in ['/srv/fleetum','/srv/fleetum-website'],'Static root allowlist')
        raw=self.docker('exec','fleetum_caddy','sh','-c',"test ! -L /srv && test ! -L "+root+" && find "+root+" -xdev -exec stat -c '%F|%s|%n' {} +")
        files={}
        for line in raw.splitlines():
            kind,size,p=line.split('|',2);need(kind in ['regular file','directory'],'Static links/special files rejected')
            if kind=='regular file':need(re.fullmatch(re.escape(root)+r'/[A-Za-z0-9_./-]+',p),'Unsupported static path');files[p]=int(size)
        need(0<len(files)<20000,'Bounded static inventory required');rows=[]
        for line in self.docker('exec','fleetum_caddy','sha256sum',*sorted(files)).splitlines():
            sha,p=line.split(None,1);p=p.strip();need(p in files and re.fullmatch('[0-9a-f]{64}',sha),'Static checksum invalid');rows.append([p[len(root)+1:],files[p],sha])
        need(len(rows)==len(files),'Static inventory incomplete')
        return hashlib.sha256(json.dumps(sorted(rows,key=lambda row:PurePosixPath(row[0]).parts),separators=(',',':')).encode()).hexdigest()
    def health(self):
        for url in ['https://api.fleetum.it/api/ready','https://platform.fleetum.it/platform-api/health','https://staging.fleetum.it/','https://api-staging.fleetum.it/api/ready']:
            deadline=time.monotonic()+60
            while True:
                try:
                    with urllib.request.urlopen(url,timeout=10) as response:need(response.status==200,'Invalid health status')
                    break
                except Exception:
                    if time.monotonic()>deadline:raise ValueError('Shared gateway health failed')
                    time.sleep(2)
    def verify_frontend(self,role):
        self.layout('fleetum_caddy','frontend',self.p['variants'][role]['image'])
        need(self.tree('/srv/fleetum')==self.p['variants'][role]['targetStaticSha256'],'Frontend content mismatch')
        need(self.tree('/srv/fleetum-website')==self.p['parentWebsiteSha256'],'Public website changed')
        self.health()


def complete(r,runtime,now=None):
    a,p,profile=validate(r,now)
    with runtime.lock():
        runtime.verify_initial();runtime.verify_images();runtime.verify_invariants();runtime.begin();runtime.journal('verified')
        outcome='satin'
        try:
            runtime.journal('satin-starting');runtime.activate('satin');runtime.verify_frontend('satin')
        except Exception:
            # A UI failure never authorizes repair/restart of backend or DB.
            runtime.verify_invariants();runtime.journal('single-visual-fallback-starting')
            runtime.activate('fallback');runtime.verify_frontend('fallback');outcome='fallback'
        runtime.verify_invariants();runtime.journal('completed-'+outcome)
        return {'schemaVersion':1,'kind':'platform-production-frontend-completion','completed':True,'outcome':outcome,
            'runId':str(r['runId']),'controlSha':a['controlSha'],'applicationControlSha':p['controlSha'],
            'prepareRunId':str(p['prepareRunId']),'originalInstallRunId':str(r['originalRequest']['runId']),
            'backendImage':p['backendImage'],'frontendImage':p['variants'][outcome]['image'],
            'backendContainerUnchanged':True,'databaseContainerUnchanged':True,'websitePreserved':True,
            'tenantStaticPreserved':True,'sharedIngressPreserved':True,'authenticatedAcceptancePending':True,
            'visualFallbackExecuted':outcome=='fallback','backendRestarted':False,'databaseWritten':False}

if __name__=='__main__':
    try:
        need(os.geteuid()==0,'Protected administrator session required')
        raw=sys.stdin.buffer.read(2*1024*1024+1);need(len(raw)<=2*1024*1024,'Bounded frontend request required')
        r=json.loads(raw);validate(r);print(json.dumps(complete(r,Runtime(r))))
    except Exception:raise SystemExit('Frontend completion stopped; preserve its private journal. No backend/database repair or automatic retry.')
