"""Prepare inert images from verified CI payloads. Never executes application code."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

HERE=Path(__file__).parent
def load(name,file):
    spec=importlib.util.spec_from_file_location(name,file)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
legacy=load('platform_image_tools',HERE.parent/'platform-release/image.py')
archives=load('platform_source_archives',HERE/'archives.py')
package=legacy.package

def need(value,message):
    if not value:raise ValueError(message)
def digest(file):
    h=hashlib.sha256()
    with Path(file).open('rb') as source:
        for part in iter(lambda:source.read(1024*1024),b''):h.update(part)
    return h.hexdigest()
def payload(file,expected):
    p=Path(file);need(p.is_file() and not p.is_symlink() and p.stat().st_size<=2*1024*1024*1024,'Unexpected payload file')
    need(re.fullmatch('[0-9a-f]{64}',expected) and digest(p)==expected,'CI payload checksum mismatch')

class Docker:
    def __call__(self,*args):
        need(os.environ.get('GITHUB_ACTIONS')=='true' and sys.platform=='linux','Real image operations require the isolated GitHub Linux runner')
        result=subprocess.run(['docker','--host','unix:///var/run/docker.sock',*args],capture_output=True,timeout=600)
        need(result.returncode==0,'Trusted inert image operation failed')
        return result.stdout.decode()

def metadata(docker,image):
    value=json.loads(docker('image','inspect','--format',
        '{"id":{{json .Id}},"os":{{json .Os}},"arch":{{json .Architecture}},"onBuild":{{json .Config.OnBuild}},"source":{{json (index .Config.Labels "it.fleetum.platform.source")}},"tree":{{json (index .Config.Labels "it.fleetum.platform.tree")}},"manifest":{{json (index .Config.Labels "it.fleetum.platform.manifest")}},"control":{{json (index .Config.Labels "it.fleetum.platform.control")}}}',image))
    need(value['os']=='linux' and value['arch']=='amd64','Actual Linux AMD64 image required')
    return value

def prepare(request,output,docker=None,publish=False):
    docker=docker or Docker();out=Path(output)
    need(not out.exists(),'New production preparation directory required')
    need(request.get('schemaVersion')==1 and request.get('kind')=='platform-production-image-request','Unsupported image request')
    a=request['approval'];candidate=request['candidate'];run=str(request['runId'])
    need(re.fullmatch('[1-9][0-9]*',run),'Explicit run required')
    need(re.fullmatch('[0-9a-f]{40}',a['controlSha']),'Control SHA required')
    need(a['kind']=='platform-production-image-approval' and a['repository']=='Silviomasuccio6/Fleetum','Production image approval required')
    parent=a['parentFrontend']
    need(re.fullmatch(r'ghcr\.io/silviomasuccio6/fleetum-frontend@sha256:[0-9a-f]{64}',parent),'Immutable reviewed frontend parent required')
    need(candidate['controlSha']==a['controlSha'] and candidate['sourceProof']['manifestSha256']==a['manifestSha256'],'Candidate proof mismatch')
    sources=candidate['sourceProof']['sources'];reports=candidate['reports']
    for role in ['backend','satin','fallback']:
        need(re.fullmatch('[0-9a-f]{40}',sources[role]['sourceSha']),'Source SHA required')
    payload(request['payloads']['backend'],reports['image']['archiveSha256'])
    for role in ['satin','fallback']:payload(request['payloads'][role],reports[role]['archiveSha256'])
    if publish:
        need(os.environ.get('GITHUB_ACTIONS')=='true' and os.environ.get('GITHUB_EVENT_NAME')=='workflow_dispatch' and
             os.environ.get('GITHUB_REF')=='refs/heads/main' and os.environ.get('GITHUB_RUN_ATTEMPT')=='1' and
             os.environ.get('GITHUB_WORKFLOW_SHA')==a['controlSha'] and os.environ.get('GITHUB_RUN_ID')==run,'Protected first dispatch required before publishing')
    out.mkdir(parents=True)
    docker('load','--input',request['payloads']['backend'])
    backend_id=reports['image']['imageId'];need(re.fullmatch(r'sha256:[0-9a-f]{64}',backend_id),'CI image ID required')
    info=metadata(docker,backend_id)
    need(info['id']==backend_id and info['source']==sources['backend']['sourceSha'] and info['tree']==sources['backend']['treeSha'],'Loaded backend differs from tested image')
    docker('pull',parent)
    parent_info=metadata(docker,parent)
    # FROM may execute inherited ONBUILD instructions even when our Dockerfile
    # contains no RUN. Refuse this before a registry-privileged build.
    need(not parent_info.get('onBuild'),'Inherited ONBUILD instructions rejected')
    legacy.extract_image(parent,out/'parent',docker)
    base=out/'parent/fleetum';website=out/'parent/fleetum-website'
    base_hash=legacy.tree_hash(base);website_hash=legacy.tree_hash(website)
    variants={};tags={}
    for role in ['satin','fallback']:
        folder=out/role;folder.mkdir()
        compiled=folder/'compiled';archives.extract(request['payloads'][role],compiled)
        manifest=package.prepare(compiled,base,folder/'package',sources[role]['sourceSha'])
        manifest.update({'schemaVersion':1,'kind':'production-platform-static-overlay','role':role,
            'controlSha':a['controlSha'],'candidateManifestSha256':a['manifestSha256'],
            'parentFrontend':parent,'parentStaticSha256':base_hash,
            'targetStaticSha256':legacy.tree_hash(folder/'package/rehearsal-static-root'),
            'parentWebsiteSha256':website_hash,'targetWebsiteSha256':website_hash})
        manifest.pop('baseline',None)
        file=folder/'manifest.json';file.write_text(json.dumps(manifest,sort_keys=True,indent=2)+'\n');manifest_hash=digest(file)
        context=folder/'context';context.mkdir();shutil.copytree(folder/'package/platform-closure',context/'closure')
        (context/'Dockerfile').write_text('FROM '+parent+'\nLABEL it.fleetum.platform.source="'+sources[role]['sourceSha']+'" it.fleetum.platform.control="'+a['controlSha']+'" it.fleetum.platform.manifest="'+manifest_hash+'"\nCOPY closure/ /srv/fleetum/\n')
        tag='ghcr.io/silviomasuccio6/fleetum-frontend:platform-prod-'+role+'-'+sources[role]['sourceSha']+'-'+run
        docker('build','--platform','linux/amd64','--network','none','--pull=false','--tag',tag,str(context))
        target_info=metadata(docker,tag)
        need(not target_info.get('onBuild') and target_info.get('source')==sources[role]['sourceSha'] and
             target_info.get('control')==a['controlSha'] and target_info.get('manifest')==manifest_hash,'Target source/manifest labels differ from reviewed image')
        legacy.extract_image(tag,folder/'target',docker)
        need(legacy.tree_hash(folder/'target/fleetum')==manifest['targetStaticSha256'],'Actual frontend image differs from package')
        need(legacy.tree_hash(folder/'target/fleetum-website')==website_hash,'Public website changed in image')
        variants[role]={'sourceSha':sources[role]['sourceSha'],'manifestSha256':manifest_hash,'targetStaticSha256':manifest['targetStaticSha256'],'localImage':tag}
        tags[role]=tag
    backend_tag='ghcr.io/silviomasuccio6/fleetum-backend:platform-prod-'+sources['backend']['sourceSha']+'-'+run
    docker('tag',backend_id,backend_tag);tags['backend']=backend_tag
    result={'schemaVersion':1,'kind':'platform-production-prepared-images','repository':a['repository'],
        'controlSha':a['controlSha'],'prepareRunId':run,'candidateCiRunId':a['candidateCiRunId'],
        'candidateManifestSha256':a['manifestSha256'],'profileSha256':a['profileSha256'],
        'parentBackend':a['parentBackend'],'parentFrontend':parent,'backendImageId':backend_id,
        'backendSourceSha':sources['backend']['sourceSha'],
        'parentStaticSha256':base_hash,'parentWebsiteSha256':website_hash,'variants':variants,
        'imagesPublished':False,'installationExecuted':False,'readyForDeployment':False}
    if publish:
        # No publication occurs until *both* real overlay images have passed
        # preservation checks and the backend exactly matches the tested ID.
        for role in ['backend','satin','fallback']:
            docker('push',tags[role]);repo='backend' if role=='backend' else 'frontend'
            refs=json.loads(docker('image','inspect','--format','{{json .RepoDigests}}',tags[role]))
            matches=[r for r in refs if re.fullmatch(r'ghcr\.io/silviomasuccio6/fleetum-'+repo+r'@sha256:[0-9a-f]{64}',r)]
            need(len(matches)==1,'Exactly one published immutable image required')
            if role=='backend':result['backendImage']=matches[0]
            else:result['variants'][role]['image']=matches[0]
        result['imagesPublished']=True
    (out/'prepared-production.json').write_text(json.dumps(result,indent=2)+'\n')
    return result

if __name__=='__main__':
    try:
        need(len(sys.argv)==2,'Output directory required')
        raw=sys.stdin.buffer.read(1024*1024+1);need(len(raw)<=1024*1024,'Image request too large')
        prepare(json.loads(raw),sys.argv[1],publish=True)
        print('Verified production images prepared; no server operation performed.')
    except Exception:
        raise SystemExit('Production image preparation failed; no installation or automatic retry.')
