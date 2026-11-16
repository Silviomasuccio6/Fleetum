import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import tarfile
from unittest.mock import patch
from types import SimpleNamespace

spec=importlib.util.spec_from_file_location('host_preflight',Path(__file__).with_name('host_preflight.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class FakeRuntime:
    def __init__(self,baseline,db):self.baseline=baseline;self.db=db;self.calls=[]
    def snapshot(self):return self.baseline
    def database(self):return self.db
    def active_storage(self):return {'root':'/app/backend/uploads','provider':'local','empty':True}
    def docker(self,*args,input_file=None,output_file=None):
        self.calls.append(args)
        if output_file:
            if args[0]=='cp':
                with tarfile.open(fileobj=output_file,mode='w:') as tar:
                    item=tarfile.TarInfo('.');item.type=tarfile.DIRTYPE;tar.addfile(item)
            else:output_file.write(b'SYNTHETIC ONLY\n'*300)
        if input_file:assert input_file.read().startswith(b'SYNTHETIC ONLY')
        return ''

class PrivateBackupSafety(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(dir='/private/tmp' if Path('/private/tmp').is_dir() else None);self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
        disk=patch.object(module.shutil,'disk_usage',return_value=SimpleNamespace(free=50*1024**3));disk.start();self.addCleanup(disk.stop)
        self.uploads=self.root/'uploads';self.uploads.mkdir();(self.uploads/'synthetic.pdf').write_bytes(b'Synthetic document fixture')
        self.baseline={name:{'id':str(i+1)*64,'imageId':'sha256:'+'a'*64,'running':True,'startedAt':'synthetic'} for i,name in enumerate(module.NAMES)}
        self.migrations={f'synthetic_{i}':'b'*64 for i in range(42)}
        self.db={'serverVersion':'16.14','failedMigrations':0,'invoiceQueuePending':0,'invoiceQueueFailed':0,'migrations':[{'name':k,'checksum':v} for k,v in self.migrations.items()]}
        self.request={'schemaVersion':1,'kind':'platform-production-backup-request','manifestSha256':'c'*64,'baseline':self.baseline,'migrations':self.migrations}
        self.runtime=FakeRuntime(self.baseline,self.db)
    def test_private_roundtrip_preserves_upload_bytes_without_restore_or_service_changes(self):
        result=module.backup(self.request,self.runtime,self.root/'backup',self.uploads)
        self.assertTrue(result['database']['fullArchiveParsePassed']);self.assertFalse(result['database']['restoreExecuted'])
        self.assertEqual(result['uploads']['files'],1);self.assertTrue(result['containersUnchanged'])
        self.assertFalse(result['dataCopiedOffHost'])
        self.assertEqual(len(self.runtime.calls),3);self.assertEqual(self.runtime.calls[1][-2:],('--file','/dev/null'))
        self.assertEqual(result['backendUploads']['files'],0)
        self.assertEqual(Path(result['directory']).stat().st_mode&0o077,0)
    def test_backlog_schema_drift_and_failed_migration_stop_before_backup(self):
        for changes in [{'invoiceQueuePending':1},{'invoiceQueueFailed':1},{'failedMigrations':1},{'serverVersion':'17.1'},{'migrations':[]}]:
            db={**self.db,**changes};runtime=FakeRuntime(self.baseline,db)
            with self.assertRaises(ValueError):module.backup(self.request,runtime,self.root/'backup',self.uploads)
            self.assertEqual(runtime.calls,[])
    def test_links_and_env_like_files_cannot_be_silently_included(self):
        for filename in ['link','.env']:
            p=self.uploads/filename
            if filename=='link':p.symlink_to(self.root/'outside')
            else:p.write_text('synthetic only')
            with self.assertRaises(ValueError):module.backup(self.request,self.runtime,self.root/('backup-'+filename),self.uploads)
            p.unlink()
    def test_restore_never_targets_a_database(self):
        result=module.backup(self.request,self.runtime,self.root/'backup',self.uploads)
        serialized=json.dumps(self.runtime.calls)
        self.assertNotIn('restore --dbname',serialized);self.assertNotIn('up',self.runtime.calls)
        self.assertNotIn('recipient',json.dumps(result));self.assertNotIn('synthetic.pdf',json.dumps(result))
    def test_insufficient_disk_stops_before_dump(self):
        with patch.object(module.shutil,'disk_usage',return_value=SimpleNamespace(free=1024)):
            with self.assertRaisesRegex(ValueError,'free space'):module.backup(self.request,self.runtime,self.root/'backup',self.uploads)
        self.assertEqual(self.runtime.calls,[])
    def test_nonempty_active_storage_blocks_before_dump_or_container_change(self):
        self.runtime.active_storage=lambda:{'root':'/app/backend/uploads','provider':'local','empty':False}
        with self.assertRaisesRegex(ValueError,'Active storage'):module.backup(self.request,self.runtime,self.root/'backup',self.uploads)
        self.assertEqual(self.runtime.calls,[])

if __name__=='__main__':unittest.main()
