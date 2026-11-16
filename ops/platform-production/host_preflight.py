"""Aggregate-only PostgreSQL preflight and private, non-destructive host backup.

No environment files, notifications, offsite transfer, pruning or DB restore.
The CLI runs only through an explicitly authorized SSH maintenance session.
"""
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tarfile

BACKUP_ROOT=Path('/var/backups/fleetum-platform-production')
UPLOADS=Path('/opt/fleetum/uploads')
NAMES=('fleetum_backend','fleetum_caddy','fleetum_postgres')
FORMAT='{"id":{{json .Id}},"imageId":{{json .Image}},"running":{{json .State.Running}},"startedAt":{{json .State.StartedAt}}}'
QUERY='''BEGIN READ ONLY; SET LOCAL statement_timeout='10s';
SELECT json_build_object(
 'serverVersion',current_setting('server_version'),
 'databaseBytes',pg_database_size(current_database()),
 'failedMigrations',(SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL),
 'migrations',(SELECT json_agg(json_build_object('name',migration_name,'checksum',checksum) ORDER BY migration_name) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
 'invoiceQueuePending',(SELECT count(*) FROM "EmailQueue" WHERE type='SAAS_INVOICE_EMAIL' AND status='PENDING'),
 'invoiceQueueFailed',(SELECT count(*) FROM "EmailQueue" WHERE type='SAAS_INVOICE_EMAIL' AND status='FAILED')
); COMMIT;'''

def need(value,message):
    if not value:raise ValueError(message)
def digest(file):
    h=hashlib.sha256()
    with Path(file).open('rb') as f:
        for part in iter(lambda:f.read(1024*1024),b''):h.update(part)
    return h.hexdigest()
def canonical(path):
    return not any(p.is_symlink() for p in (path,*path.parents))

class Runtime:
    def docker(self,*args,input_file=None,output_file=None,env=None):
        p=subprocess.run(['/usr/bin/docker','--host','unix:///var/run/docker.sock',*args],
            stdin=input_file or subprocess.DEVNULL,stdout=output_file or subprocess.PIPE,
            stderr=subprocess.PIPE,timeout=600,env=env)
        need(p.returncode==0,'Bounded backup/database operation failed')
        return (p.stdout or b'').decode()
    def snapshot(self):
        return {name:json.loads(self.docker('inspect','--format',FORMAT,name)) for name in NAMES}
    def database(self):
        raw=self.docker('exec','-u','postgres','fleetum_postgres','psql','-X','-w','-q','-A','-t',
            '-v','ON_ERROR_STOP=1','-U','fleetum','-d','fleetum','-c',QUERY)
        need(len(raw)<=128*1024,'Aggregate result exceeds bound')
        return json.loads(raw)
    def active_storage(self):
        code="const fs=require('node:fs'),path=require('node:path');const root=path.resolve(process.env.UPLOAD_DIR||'uploads');console.log(JSON.stringify({root,provider:process.env.STORAGE_PROVIDER||'local',empty:fs.readdirSync(root).length===0}))"
        return json.loads(self.docker('exec','fleetum_backend','node','-e',code))

def validate(request):
    need(request.get('schemaVersion')==1 and request.get('kind')=='platform-production-backup-request','Backup request required')
    need(re.fullmatch('[0-9a-f]{64}',request.get('manifestSha256','')),'Candidate manifest binding required')
    expected=request.get('baseline',{})
    need(set(expected)==set(NAMES),'Exactly production application/database containers required')
    for item in expected.values():
        need(re.fullmatch('[0-9a-f]{64}',item.get('id','')) and re.fullmatch('sha256:[0-9a-f]{64}',item.get('imageId','')) and item.get('running') is True,'Running baseline required')
    migrations=request.get('migrations',{})
    need(len(migrations)==42 and all(re.fullmatch('[0-9a-f]{64}',v) for v in migrations.values()),'Reviewed baseline migration checksums required')
    return expected

def check_database(db,expected):
    need(re.fullmatch(r'16\.[0-9]+',db.get('serverVersion','')),'PostgreSQL 16 required')
    need(db.get('failedMigrations')==0,'Unfinished database migration requires review')
    need(db.get('invoiceQueuePending')==0 and db.get('invoiceQueueFailed')==0,'Legacy invoice backlog requires reconciliation')
    need({m['name']:m['checksum'] for m in db['migrations']}==expected,'Actual baseline migration history differs')

def backup(request,runtime,root=BACKUP_ROOT,uploads=UPLOADS):
    expected=validate(request);before=runtime.snapshot();need(before==expected,'Runtime changed before backup')
    db=runtime.database();check_database(db,request['migrations'])
    need(runtime.active_storage()=={'root':'/app/backend/uploads','provider':'local','empty':True},'Active storage changed; review the backup/persistence plan')
    need(canonical(root) and canonical(uploads) and uploads.is_dir(),'Canonical backup/upload roots required')
    root.mkdir(mode=0o700,parents=True,exist_ok=True)
    need(root.stat().st_mode&0o077==0 and root.stat().st_uid==os.geteuid(),'Private owned backup root required')
    need(shutil.disk_usage(root).free>=20*1024**3+2*db.get('databaseBytes',0),'Insufficient free space for bounded backup')
    label=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+os.urandom(4).hex()
    out=root/label;out.mkdir(mode=0o700)
    database=out/'database.dump';pending=out/'database.dump.part'
    with pending.open('xb') as f:
        os.chmod(pending,0o600)
        runtime.docker('exec','-u','postgres','fleetum_postgres','pg_dump','-U','fleetum','-d','fleetum','--format=custom','--no-owner','--no-privileges',output_file=f)
    need(pending.stat().st_size>=1024,'Database backup is unexpectedly small')
    # Decompress and parse the complete archive into /dev/null. This never
    # connects to, creates, truncates or restores any database.
    with pending.open('rb') as f:runtime.docker('exec','-i','fleetum_postgres','pg_restore','--file','/dev/null',input_file=f)
    pending.rename(database)
    archive=out/'uploads.tar.gz';entries={};total=0
    with tarfile.open(archive,'x:gz') as tar:
        os.chmod(archive,0o600)
        for p in sorted(uploads.rglob('*')):
            need(canonical(p),'Upload link rejected')
            if p.is_dir():continue
            info=p.stat();need(stat.S_ISREG(info.st_mode) and info.st_nlink==1,'Upload special file or hardlink rejected')
            need(not p.name.startswith('.env'),'Environment-like upload requires manual backup review')
            total+=info.st_size;need(total<=5*1024**3 and len(entries)<100000,'Bounded backup exceeded')
            name=p.relative_to(uploads).as_posix()
            need(not any(ord(c)<32 for c in name),'Unsafe upload path')
            with os.fdopen(os.open(p,os.O_RDONLY|os.O_NOFOLLOW),'rb') as f:
                item=tar.gettarinfo(str(p),name);tar.addfile(item,f)
            entries[name]={'size':info.st_size,'sha256':digest(p)}
    seen=set()
    with tarfile.open(archive,'r:gz') as tar:
        for item in tar:
            need(item.isfile() and item.name in entries and item.name not in seen,'Unexpected backup member')
            h=hashlib.sha256()
            with tar.extractfile(item) as f:
                for part in iter(lambda:f.read(1024*1024),b''):h.update(part)
            need(h.hexdigest()==entries[item.name]['sha256'] and item.size==entries[item.name]['size'],'Upload changed while archiving')
            seen.add(item.name)
    need(seen==set(entries),'Incomplete upload backup')
    active=out/'backend-uploads.tar'
    with active.open('xb') as f:os.chmod(active,0o600);runtime.docker('cp','fleetum_backend:/app/backend/uploads/.','-',output_file=f)
    need(active.stat().st_size<=1024*1024,'Active storage changed during backup')
    with tarfile.open(active,'r:') as tar:need(all(m.isdir() for m in tar),'Active documents found; preserve backup and review, never silently replace the container')
    need(runtime.active_storage()=={'root':'/app/backend/uploads','provider':'local','empty':True},'Active storage changed during backup')
    need(runtime.snapshot()==before,'Production services changed during backup')
    result={'schemaVersion':1,'kind':'platform-production-backup','createdAtUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'directory':str(out),'manifestSha256':request['manifestSha256'],'baseline':before,
        'database':{'path':str(database),'sha256':digest(database),'bytes':database.stat().st_size,'fullArchiveParsePassed':True,'restoreExecuted':False},
        'uploads':{'path':str(archive),'sha256':digest(archive),'bytes':archive.stat().st_size,'files':len(entries),'sourceBytes':total,'fullContentComparisonPassed':True},
        'backendUploads':{'path':str(active),'sha256':digest(active),'bytes':active.stat().st_size,'sourceContainer':'fleetum_backend','sourcePath':'/app/backend/uploads','files':0,'fullArchiveParsePassed':True,'sourceState':'empty-verified'},
        'containersUnchanged':True,'backupContainsProductionData':True,'dataCopiedOffHost':False,'environmentFilesRead':False,'retentionOrProviderChanged':False}
    receipt=out/'receipt.json'
    with receipt.open('x') as f:os.chmod(receipt,0o600);json.dump(result,f,indent=2);f.write('\n')
    return result

if __name__=='__main__':
    try:
        need(os.geteuid()==0,'Authorized administrative session required')
        raw=sys.stdin.buffer.read(256*1024+1);need(len(raw)<=256*1024,'Bounded request required')
        r=json.loads(raw);validate(r)
        print(json.dumps(backup(r,Runtime())))
    except Exception:raise SystemExit('Private backup/preflight failed; no service restart, restore or automatic retry.')
