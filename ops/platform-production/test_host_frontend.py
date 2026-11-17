import contextlib
import copy
import datetime
import unittest
from unittest.mock import patch
from types import SimpleNamespace
import host_frontend as module
from test_host_install import fixture as original_fixture,NOW


def fixture():
    old=original_fixture();p=old['prepared'];p.update(prepareRunId='20',backendSourceSha='b'*40,backendImageId='sha256:'+'9'*64)
    for role in ['satin','fallback']:p['variants'][role].update(sourceSha=('c' if role=='satin' else 'd')*40,manifestSha256='a'*64)
    state={'kind':'platform-production-frontend-state','observedAtUTC':'2030-01-15T11:00:00Z','baseline':copy.deepcopy(old['backupRequest']['baseline'])}
    state['baseline']['fleetum_backend'].update(id='f'*64,imageId=p['backendImage'].split('@')[1],startedAt='new synthetic')
    a={'schemaVersion':1,'kind':'platform-production-frontend-completion-approval','repository':'Silviomasuccio6/Fleetum','controlSha':'e'*40,
       'applicationControlSha':old['approval']['controlSha'],'prepareRunId':'20','failedInstallRunId':old['runId'],
       'approvedUntil':'2030-01-15T13:00:00Z','originalRequestSha256':module.fingerprint(old),'currentStateSha256':module.fingerprint(state),
       'allowVisualFallback':True}
    return {'schemaVersion':1,'kind':'platform-production-frontend-completion-request','confirm':'COMPLETE_PLATFORM_FRONTEND','runId':'30',
        'approval':a,'originalRequest':old,'currentState':state,'prepared':copy.deepcopy(p),'backendTreeSha':'f'*40}


class FakeRuntime:
    def __init__(self,r,fail=None):self.r=r;self.calls=[];self.fail=fail;self.target=None
    @contextlib.contextmanager
    def lock(self):self.calls.append('lock');yield
    def verify_invariants(self):self.calls.append('invariants')
    def verify_initial(self):
        self.calls.append('initial')
        if self.fail=='initial':raise ValueError('synthetic initial drift')
    def verify_images(self):self.calls.append('images')
    def begin(self):self.calls.append('begin')
    def journal(self,phase):self.calls.append(phase)
    def activate(self,role):self.calls.append('activate:'+role);self.target=role
    def verify_frontend(self,role):
        self.calls.append('verify:'+role)
        if self.fail in [role,'both']:raise ValueError('synthetic UI failure')


class FrontendOnlyCompletion(unittest.TestCase):
    def test_satin_installs_only_frontend_and_records_both_controls(self):
        r=fixture();rt=FakeRuntime(r);proof=module.complete(r,rt,NOW)
        self.assertEqual(proof['outcome'],'satin');self.assertTrue(proof['backendContainerUnchanged']);self.assertTrue(proof['databaseContainerUnchanged'])
        self.assertNotEqual(proof['controlSha'],proof['applicationControlSha']);self.assertEqual(rt.calls.count('activate:satin'),1)
        self.assertNotIn('activate:fallback',rt.calls)
    def test_one_frontend_fallback_is_explicitly_reported(self):
        r=fixture();rt=FakeRuntime(r,'satin');proof=module.complete(r,rt,NOW)
        self.assertEqual(proof['outcome'],'fallback');self.assertEqual(rt.calls.count('activate:fallback'),1)
    def test_failed_fallback_does_not_retry_or_hide_failure(self):
        r=fixture();rt=FakeRuntime(r,'both')
        with self.assertRaises(ValueError):module.complete(r,rt,NOW)
        self.assertEqual(rt.calls.count('activate:satin'),1);self.assertEqual(rt.calls.count('activate:fallback'),1)
    def test_preexisting_drift_never_changes_frontend(self):
        r=fixture();rt=FakeRuntime(r,'initial')
        with self.assertRaises(ValueError):module.complete(r,rt,NOW)
        self.assertFalse(any(c.startswith('activate:') for c in rt.calls))
    def test_backend_drift_after_frontend_failure_blocks_fallback(self):
        r=fixture();rt=FakeRuntime(r,'satin');count=0
        def invariant():
            nonlocal count
            count+=1
            if rt.target:raise ValueError('synthetic backend changed')
        rt.verify_invariants=invariant
        with self.assertRaises(ValueError):module.complete(r,rt,NOW)
        self.assertNotIn('activate:fallback',rt.calls)
    def test_invalid_tuple_blocks_all_host_operations(self):
        changes=[lambda r:r.update(confirm='RELEASE_PLATFORM_PRODUCTION'),lambda r:r['approval'].update(approvedUntil='2030-01-15T10:00:00Z'),
            lambda r:r['prepared'].update(controlSha='0'*40),lambda r:r['currentState']['baseline']['fleetum_postgres'].update(id='0'*64),
            lambda r:r['approval'].update(allowVisualFallback=False),lambda r:r['originalRequest']['expectedPatchMigration'].clear()]
        for change in changes:
            r=fixture();change(r);rt=FakeRuntime(r)
            with self.assertRaises((ValueError,KeyError)):module.complete(r,rt,NOW)
            self.assertEqual(rt.calls,[])
    def test_only_caddy_service_is_recreated_without_removing_orphans(self):
        r=fixture();rt=module.Runtime(r);calls=[];rt.caddy_contact='synthetic@example.invalid'
        rt.docker=lambda *args,**kw:calls.append((args,kw)) or ''
        with patch.object(module.Runtime,'write_overlay') as overlay:
            rt.activate('fallback');overlay.assert_called_once_with('fallback')
        args,kw=calls[0];self.assertEqual(args[-7:],('up','-d','--no-deps','--no-build','--pull','never','caddy'))
        self.assertIn(r['originalRequest']['profile']['frontendCompose'],args)
        self.assertNotIn(r['originalRequest']['profile']['backendCompose'],args)
        self.assertNotIn('--remove-orphans',args)
    def test_runtime_has_no_backend_or_database_mutation_entrypoints(self):
        r=fixture();rt=module.Runtime(r)
        for name in ['stop_backend','start_backend','migrate','maintain_uploads','backup','restore']:
            self.assertFalse(hasattr(rt,name),name)

    def invariant_runtime(self):
        r=fixture();r['originalRequest']['profile']['backend'].update(mounts=[],networks=['synthetic-private'])
        rt=module.Runtime(r);rt.configs=lambda:None;rt.snapshot=lambda:copy.deepcopy(r['currentState']['baseline'])
        rt.database=lambda:{'failedMigrations':0,'migrations':[{'name':k,'checksum':v} for k,v in {**r['originalRequest']['backupRequest']['migrations'],**r['originalRequest']['expectedPatchMigration']}.items()]}
        calls=[]
        def docker(*args,**kw):
            calls.append(args)
            if args[0]=='inspect':
                return module.json.dumps({'image':r['prepared']['backendImage'],'mounts':[{'Source':'/opt/fleetum/uploads','Destination':'/app/backend/uploads','RW':True}],'networks':{'synthetic-private':{}}})
            self.assertEqual(args[:3],('exec','fleetum_backend','node'))
            return module.json.dumps({'root':'/app/backend/uploads','provider':'local','uid':1000,'gid':1000})
        rt.docker=docker;return rt,calls

    def test_actual_invariant_checker_uses_readonly_commands_and_accepts_existing_documents(self):
        rt,calls=self.invariant_runtime()
        with patch.object(module.preflight,'canonical',return_value=True),patch.object(module.Path,'is_dir',return_value=True),patch.object(module.Path,'stat',return_value=SimpleNamespace(st_uid=1001,st_gid=1000,st_mode=0o40775)),patch.object(module.Path,'iterdir',side_effect=AssertionError('Do not enumerate customer documents')):
            rt.verify_invariants()
        self.assertEqual(len(calls),2);self.assertTrue(all(c[0] in ['inspect','exec'] for c in calls))

    def test_backend_restart_or_noncanonical_database_blocks_the_actual_invariant_checker(self):
        rt,_=self.invariant_runtime();baseline=rt.snapshot();baseline['fleetum_backend']['startedAt']='restarted';rt.snapshot=lambda:baseline
        with self.assertRaises(ValueError):rt.verify_invariants()
        rt,_=self.invariant_runtime();rt.database=lambda:{'failedMigrations':0,'migrations':[]}
        with self.assertRaises(ValueError):rt.verify_invariants()

    def test_frontend_content_or_public_website_mismatch_is_detected(self):
        for changed in ['/srv/fleetum','/srv/fleetum-website']:
            r=fixture();rt=module.Runtime(r);rt.layout=lambda *a:None;rt.health=lambda:None
            rt.tree=lambda root:'0'*64 if root==changed else (r['prepared']['parentWebsiteSha256'] if root.endswith('-website') else r['prepared']['variants']['satin']['targetStaticSha256'])
            with self.assertRaises(ValueError):rt.verify_frontend('satin')

if __name__=='__main__':unittest.main()
