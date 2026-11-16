import contextlib
import datetime
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
from types import SimpleNamespace

spec=importlib.util.spec_from_file_location('host_install',Path(__file__).with_name('host_install.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
NOW=datetime.datetime(2030,1,15,12,tzinfo=datetime.timezone.utc)

def fixture():
    baseline={name:{'id':str(i+1)*64,'imageId':'sha256:'+'a'*64,'running':True,'startedAt':'synthetic'} for i,name in enumerate(module.preflight.NAMES)}
    b={'schemaVersion':1,'kind':'platform-production-backup-request','manifestSha256':'b'*64,'baseline':baseline,'migrations':{f'synthetic_{i}':'c'*64 for i in range(42)},'uploadPermissionPolicy':dict(module.UPLOAD_POLICY)}
    backend='ghcr.io/silviomasuccio6/fleetum-backend@sha256:'+'1'*64;frontend='ghcr.io/silviomasuccio6/fleetum-frontend@sha256:'+'2'*64
    profile={'target':'production','appDir':'/opt/fleetum/app','backendCompose':'/opt/fleetum/app/docker-compose.prod.yml','frontendCompose':'/opt/fleetum/ingress-control/'+'d'*64+'.shared.json','ingressMode':'shared','staticRootMounts':[],
        'backend':{'project':'app','imageDigest':backend,'containerId':baseline['fleetum_backend']['id'],'imageId':baseline['fleetum_backend']['imageId']},
        'frontend':{'project':'app','imageDigest':frontend,'containerId':baseline['fleetum_caddy']['id'],'imageId':baseline['fleetum_caddy']['imageId']}}
    backup={'kind':'platform-production-backup','baseline':baseline,'containersUnchanged':True,'createdAtUTC':'2030-01-15T11:00:00Z','manifestSha256':'b'*64,
        'backendUploads':{'files':0,'sourcePath':'/app/backend/uploads','fullArchiveParsePassed':True}}
    a={'kind':'platform-production-approval','repository':'Silviomasuccio6/Fleetum','controlSha':'a'*40,'approvedUntil':'2030-01-15T13:00:00Z',
        'profileSha256':module.fingerprint(profile),'backupSha256':module.fingerprint(backup),'preflightSha256':module.fingerprint(b),
        'parentBackend':backend,'parentFrontend':frontend,'manifestSha256':'b'*64,'parentStaticSha256':'3'*64,'parentWebsiteSha256':'4'*64,'candidateCiRunId':'11'}
    p={'kind':'platform-production-prepared-images','controlSha':'a'*40,'imagesPublished':True,'installationExecuted':False,'candidateCiRunId':'11',
        'parentBackend':backend,'parentFrontend':frontend,'candidateManifestSha256':'b'*64,'profileSha256':a['profileSha256'],
        'parentStaticSha256':a['parentStaticSha256'],'parentWebsiteSha256':a['parentWebsiteSha256'],'backendImage':backend[:-64]+'5'*64,
        'variants':{role:{'image':frontend[:-64]+digit*64,'targetStaticSha256':'6'*64} for role,digit in [('satin','6'),('fallback','7')]}}
    return {'schemaVersion':1,'kind':'platform-production-install-request','confirm':'RELEASE_PLATFORM_PRODUCTION','runId':'12','approval':a,'prepared':p,'profile':profile,'backup':backup,'backupRequest':b,'expectedPatchMigration':{'20260921150000_final_release_blocker_atomicity':'e'*64}}

class FakeRuntime:
    def __init__(self,r,fail=None):self.r=r;self.calls=[];self.fail=fail;self.after=False
    @contextlib.contextmanager
    def lock(self):self.calls.append('lock');yield
    def snapshot(self):return self.r['backupRequest']['baseline']
    def database(self):return {'serverVersion':'16.14','failedMigrations':0,'invoiceQueuePending':0,'invoiceQueueFailed':0,'migrations':[{'name':k,'checksum':v} for k,v in self.r['backupRequest']['migrations'].items()]}
    def tree(self,root):return self.r['approval']['parentWebsiteSha256'] if root.endswith('-website') else ('6'*64 if self.after else '3'*64)
    def __getattr__(self,name):
        def operation(*args):
            self.calls.append(name)
            if name==self.fail:raise ValueError('synthetic failure')
            if name=='start_frontend':self.after=True
        return operation

class ProductionTransaction(unittest.TestCase):
    def test_old_consumer_stops_before_migration_and_new_consumer_start(self):
        r=fixture();runtime=FakeRuntime(r);result=module.install(r,runtime,NOW)
        self.assertTrue(result['completed']);self.assertTrue(result['sharedIngressPreserved']);self.assertTrue(result['authenticatedAcceptancePending'])
        for first,second in [('verify_backup','begin'),('pull','stop_backend'),('stop_backend','migrate'),('migrate','expanded_schema'),('expanded_schema','start_backend'),('start_backend','start_frontend')]:self.assertLess(runtime.calls.index(first),runtime.calls.index(second))
    def test_wrong_confirmation_expired_window_and_changed_proofs_prevent_any_host_operation(self):
        for change in [lambda r:r.update(confirm='STAGING'),lambda r:r['approval'].update(approvedUntil='2030-01-15T11:00:00Z'),lambda r:r['backup'].update(containersUnchanged=False),lambda r:r['prepared'].update(imagesPublished=False),lambda r:r['prepared'].update(controlSha='0'*40)]:
            r=fixture();change(r);runtime=FakeRuntime(r)
            with self.assertRaises((ValueError,KeyError)):module.install(r,runtime,NOW)
            self.assertEqual(runtime.calls,[])
    def test_failure_never_retries_migrates_twice_or_downgrades_backend(self):
        for phase in ['stop_backend','migrate','expanded_schema','start_backend','start_frontend','health']:
            r=fixture();runtime=FakeRuntime(r,phase)
            with self.assertRaises(ValueError):module.install(r,runtime,NOW)
            self.assertEqual(runtime.calls.count(phase),1);self.assertNotIn('rollback',runtime.calls)
    def test_backend_and_gateway_use_distinct_existing_compose_manifests(self):
        r=fixture();runtime=module.Runtime(r);calls=[];environments=[]
        def docker(*args,**kwargs):calls.append(args);environments.append(kwargs['env'])
        runtime.docker=docker
        runtime.compose('backend','up','-d','--no-deps','backend');runtime.compose('frontend','up','-d','--no-deps','caddy')
        self.assertIn(r['profile']['backendCompose'],calls[0]);self.assertNotIn(r['profile']['frontendCompose'],calls[0])
        self.assertIn(r['profile']['frontendCompose'],calls[1]);self.assertNotIn(r['profile']['backendCompose'],calls[1])
        self.assertTrue(all('--env-file' in c and '/opt/fleetum/env/compose.env' in c for c in calls))
        for env in environments:
            self.assertEqual(env['FLEETUM_BACKEND_IMAGE'],r['prepared']['backendImage'])
            self.assertEqual(env['FLEETUM_FRONTEND_IMAGE'],r['prepared']['variants']['satin']['image'])
    def test_upload_fix_preserves_owner_and_targets_only_the_open_empty_directory(self):
        runtime=module.Runtime(fixture());runtime.journal=lambda phase:None
        with patch.object(module.preflight,'canonical',return_value=True),patch.object(module.os,'open',return_value=42),patch.object(module.os,'fstat',return_value=SimpleNamespace(st_uid=1001,st_gid=1001,st_mode=0o40755)),patch.object(module.os,'listdir',return_value=[]),patch.object(module.os,'close'),patch.object(module.os,'fchown') as owner,patch.object(module.os,'fchmod') as mode:
            runtime.maintain_uploads();owner.assert_called_once_with(42,-1,1000);mode.assert_called_once_with(42,0o775)
    def test_upload_fix_refuses_existing_documents_without_changing_any_permission(self):
        runtime=module.Runtime(fixture())
        with patch.object(module.preflight,'canonical',return_value=True),patch.object(module.os,'open',return_value=42),patch.object(module.os,'fstat',return_value=SimpleNamespace(st_uid=1001,st_gid=1001,st_mode=0o40755)),patch.object(module.os,'listdir',return_value=['synthetic-existing.pdf']),patch.object(module.os,'close'),patch.object(module.os,'fchown') as owner,patch.object(module.os,'fchmod') as mode:
            with self.assertRaises(ValueError):runtime.maintain_uploads()
            owner.assert_not_called();mode.assert_not_called()
    def test_a_document_admitted_during_drain_blocks_before_migration_or_container_replacement(self):
        r=fixture();runtime=FakeRuntime(r,'verify_stopped_uploads_empty')
        with self.assertRaises(ValueError):module.install(r,runtime,NOW)
        self.assertIn('stop_backend',runtime.calls);self.assertNotIn('migrate',runtime.calls);self.assertNotIn('start_backend',runtime.calls)

if __name__=='__main__':unittest.main()
