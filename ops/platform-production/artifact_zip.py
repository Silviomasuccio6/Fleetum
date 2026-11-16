"""Extract exactly one digest-verified artifact file, never paths or links."""
import hashlib
from pathlib import Path
import re
import shutil
import stat
import sys
import zipfile

def extract(archive,destination,expected,digest,max_bytes):
    archive,destination=Path(archive),Path(destination)
    if not re.fullmatch(r'[A-Za-z0-9._-]+',expected) or destination.exists():
        raise ValueError('New exact artifact destination required')
    if not re.fullmatch('sha256:[0-9a-f]{64}',digest):
        raise ValueError('GitHub artifact digest missing')
    h=hashlib.sha256()
    with archive.open('rb') as f:
        for part in iter(lambda:f.read(1024*1024),b''):h.update(part)
    if 'sha256:'+h.hexdigest()!=digest:raise ValueError('GitHub ZIP digest mismatch')
    with zipfile.ZipFile(archive) as z:
        entries=z.infolist()
        if len(entries)!=1:raise ValueError('Exactly one artifact file required')
        item=entries[0];mode=(item.external_attr>>16)&0o170000
        if item.filename!=expected or item.is_dir() or mode not in (0,stat.S_IFREG) or not 0<item.file_size<=max_bytes:
            raise ValueError('Unexpected artifact entry')
        owned=False
        try:
            with z.open(item) as source,destination.open('xb') as target:
                owned=True
                destination.chmod(0o600)
                shutil.copyfileobj(source,target)
        except Exception:
            if owned:destination.unlink(missing_ok=True)
            raise

if __name__=='__main__':
    try:
        if len(sys.argv)!=6:raise ValueError('Expected ZIP, destination, name, digest and size limit')
        extract(sys.argv[1],sys.argv[2],sys.argv[3],sys.argv[4],int(sys.argv[5]))
    except Exception:raise SystemExit('Artifact integrity validation failed.')
