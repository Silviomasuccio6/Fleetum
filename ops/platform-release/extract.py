"""Extract a compiled UI artifact as inert regular files; never extract links or execute code."""
import shutil,tarfile
from pathlib import Path,PurePosixPath

def extract(archive,destination):
 destination=Path(destination)
 if destination.exists():raise ValueError('New extraction directory required')
 with tarfile.open(archive,'r:gz') as tar:
  entries=tar.getmembers()
  if len(entries)>20000 or sum(x.size for x in entries)>128*1024*1024:raise ValueError('Compiled artifact too large')
  seen=set()
  for member in entries:
   name=member.name.removeprefix('./')
   if name in ['','.'] and member.isdir():continue
   if not name or PurePosixPath(name).is_absolute() or '..' in name.split('/') or '\\' in name or name in seen:raise ValueError('Invalid artifact path')
   if not member.isfile() and not member.isdir():raise ValueError('Artifact links and special files rejected')
   if any(part.startswith('.') for part in name.split('/')) or name.endswith('.map'):raise ValueError('Private or source-map artifact rejected')
   seen.add(name)
  destination.mkdir(parents=True)
  for member in entries:
   name=member.name.removeprefix('./')
   if name in ['','.']:continue
   target=destination/name
   if member.isdir():target.mkdir(parents=True,exist_ok=True)
   else:
    target.parent.mkdir(parents=True,exist_ok=True)
    with tar.extractfile(member) as source,target.open('xb') as output:shutil.copyfileobj(source,output)
    target.chmod(0o644)

if __name__=='__main__':
 import sys
 if len(sys.argv)!=3:raise SystemExit('Compiled archive and new destination required')
 extract(sys.argv[1],sys.argv[2])
