"""Trusted CI image construction; never runs the candidate or parent entrypoint."""
import hashlib,json,os,re,shutil,subprocess,tempfile,uuid
from pathlib import Path
from importlib.util import spec_from_file_location,module_from_spec
spec=spec_from_file_location('platform_package',Path(__file__).with_name('package.py'));package=module_from_spec(spec);spec.loader.exec_module(package)

def tree(root):
 package.clean_tree(root)
 result=[]
 for path in sorted(root.rglob('*')):
  if path.is_file():
   rel=path.relative_to(root).as_posix()
   if not re.fullmatch(r'[A-Za-z0-9_./-]+',rel):raise ValueError('Unsupported static path')
   result.append([rel,path.stat().st_size,package.digest(path)])
 return result

def tree_hash(root):
 return hashlib.sha256(json.dumps(tree(root),separators=(',',':')).encode()).hexdigest()

class Docker:
 def __call__(self,*args):
  r=subprocess.run(['docker',*args],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=300)
  if r.returncode:raise ValueError('Isolated image operation failed')
  return r.stdout.decode()

def extract_image(image,destination,docker):
 if not re.fullmatch(r'ghcr.io/silviomasuccio6/fleetum-frontend(?:@sha256:[0-9a-f]{64}|:platform-[a-z0-9-]+)',image):raise ValueError('Unexpected frontend image')
 name='fleetum-platform-extract-'+uuid.uuid4().hex
 created=False
 try:
  docker('create','--name',name,'--network','none','--entrypoint','/bin/false',image);created=True
  destination.mkdir()
  for folder in ['fleetum','fleetum-website']:
   docker('cp',name+':/srv/'+folder,str(destination/folder))
  for folder in ['fleetum','fleetum-website']:package.clean_tree(destination/folder)
 finally:
  if created:docker('rm','-v',name)

def build(ui_dist,output,approval,run_id,docker=None):
 docker=docker or Docker()
 if not re.fullmatch('[1-9][0-9]*',str(run_id)):raise ValueError('Invalid run identity')
 parent=approval['parentFrontend']
 if not re.fullmatch(r'ghcr.io/silviomasuccio6/fleetum-frontend@sha256:[0-9a-f]{64}',parent):raise ValueError('Immutable parent required')
 output=Path(output)
 if output.exists():raise ValueError('New output directory required')
 output.mkdir(parents=True)
 docker('pull',parent)
 extract_image(parent,output/'parent',docker)
 parent_static=output/'parent/fleetum';website=output/'parent/fleetum-website'
 if tree_hash(parent_static)!=approval['baselineTreeSha256']:raise ValueError('Image parent differs from approved live baseline')
 manifest=package.prepare(ui_dist,parent_static,output/'package',approval['uiSha'])
 for root in ['index.html','spa.html']:
  if (output/'package/rehearsal-static-root'/root).read_bytes()!=(parent_static/root).read_bytes():raise ValueError('Tenant entry changed')
 manifest.update({'schemaVersion':1,'parentFrontend':parent,'backendImage':approval['backendImage'],'appSha':approval['appSha'],'controlSha':approval['controlSha'],'parentStaticSha256':tree_hash(parent_static),'targetStaticSha256':tree_hash(output/'package/rehearsal-static-root'),'parentWebsiteSha256':tree_hash(website),'targetWebsiteSha256':tree_hash(website),'buildRecipe':{'version':1,'node':'22.23.1','mode':'production','platformApiBase':'/platform-api'}})
 # Local absolute directory names are not evidence or deployment inputs.
 manifest.pop('baseline',None)
 manifest_path=output/'package-manifest.json';manifest_path.write_text(json.dumps(manifest,sort_keys=True,indent=2)+'\n')
 manifest_sha=package.digest(manifest_path)
 context=output/'context';context.mkdir();shutil.copytree(output/'package/platform-closure',context/'closure')
 dockerfile='FROM '+parent+'\nLABEL it.fleetum.platform.source="'+approval['uiSha']+'" it.fleetum.platform.control="'+approval['controlSha']+'" it.fleetum.platform.manifest="'+manifest_sha+'"\nCOPY closure/ /srv/fleetum/\n'
 (context/'Dockerfile').write_text(dockerfile)
 tag='ghcr.io/silviomasuccio6/fleetum-frontend:platform-'+approval['uiSha']+'-'+str(run_id)
 docker('build','--network','none','--pull=false','--tag',tag,str(context))
 extract_image(tag,output/'target',docker)
 if tree_hash(output/'target/fleetum')!=manifest['targetStaticSha256'] or tree_hash(output/'target/fleetum-website')!=manifest['parentWebsiteSha256']:raise ValueError('Built image does not preserve approved static trees')
 # Publish only after the actual built image has passed both tree checks.
 docker('push',tag)
 refs=json.loads(docker('image','inspect','--format','{{json .RepoDigests}}',tag))
 candidates=[r for r in refs if re.fullmatch(r'ghcr.io/silviomasuccio6/fleetum-frontend@sha256:[0-9a-f]{64}',r)]
 if len(candidates)!=1:raise ValueError('Exactly one immutable published target required')
 result={'targetImage':candidates[0],'manifestSha256':manifest_sha,**{k:manifest[k] for k in ['parentStaticSha256','targetStaticSha256','parentWebsiteSha256','targetWebsiteSha256']}}
 (output/'prepared-image.json').write_text(json.dumps(result,indent=2)+'\n');return result
