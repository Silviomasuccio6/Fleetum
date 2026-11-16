import importlib.util
import json
import re
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('prepare_images',Path(__file__).with_name('prepare_images.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)


class FakeDocker:
    def __init__(self,root,parent,backend,source,tree):
        self.root=root;self.parent=parent;self.backend=backend;self.source=source;self.tree=tree
        self.calls=[];self.containers={};self.images={};self.labels={};self.on_build=[];self.corrupt_website=False
    def __call__(self,*args):
        self.calls.append(args)
        if args[0] in ('pull','load','tag','push','rm'):return ''
        if args[0]=='image':
            image=args[-1]
            if args[3]=='{{json .RepoDigests}}':
                repo='backend' if 'backend:' in image else 'frontend'
                return json.dumps(['ghcr.io/silviomasuccio6/fleetum-'+repo+'@sha256:'+'5'*64])
            return json.dumps({'id':self.backend,'os':'linux','arch':'amd64','onBuild':self.on_build if image==self.parent else [],'source':self.source,'tree':self.tree,**self.labels.get(image,{})})
        if args[0]=='create':
            self.containers[args[2]]=args[-1];return 'synthetic-container'
        if args[0]=='cp':
            name,source=args[1].split(':',1);image=self.containers[name]
            base=self.images.get(image,self.root/'parent');shutil.copytree(base/Path(source).name,Path(args[2]));return ''
        if args[0]=='build':
            context=Path(args[-1]);tag=args[args.index('--tag')+1];target=self.root/('image-'+str(len(self.images)))
            text=(context/'Dockerfile').read_text();self.labels[tag]={key:re.search('it.fleetum.platform.'+key+'="([^"]+)"',text).group(1) for key in ['source','control','manifest']}
            shutil.copytree(self.root/'parent',target)
            shutil.copytree(context/'closure',target/'fleetum',dirs_exist_ok=True)
            if self.corrupt_website:(target/'fleetum-website/index.html').write_text('corruption')
            self.images[tag]=target;return ''
        raise AssertionError('Unexpected Docker operation '+repr(args))


class ImagePreparationSafety(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
        parent=self.root/'parent';(parent/'fleetum/assets').mkdir(parents=True);(parent/'fleetum/brand').mkdir();(parent/'fleetum-website').mkdir()
        for name in ['index.html','spa.html','platform.html']:(parent/'fleetum'/name).write_text('old '+name)
        (parent/'fleetum-website/index.html').write_text('public website retained')
        (parent/'fleetum/favicon.ico').write_bytes(b'original')
        for logo in module.package.LOGOS:(parent/'fleetum'/logo).write_text('<svg>original</svg>')
        backend=self.root/'backend.tar';backend.write_bytes(b'synthetic inert OCI fixture')
        sources={role:{'sourceSha':c*40,'treeSha':'d'*40} for role,c in [('backend','a'),('satin','b'),('fallback','c')]}
        reports={'image':{'archiveSha256':module.digest(backend),'imageId':'sha256:'+'e'*64}}
        payloads={'backend':str(backend)}
        for role in ['satin','fallback']:
            folder=self.root/role;(folder/'assets').mkdir(parents=True);(folder/'brand').mkdir()
            (folder/'platform.html').write_text('<script src="/assets/'+role+'.js"></script><link href="/favicon.ico">')
            (folder/'assets'/f'{role}.js').write_text('const synthetic=true;')
            (folder/'favicon.ico').write_bytes(b'original')
            for logo in module.package.LOGOS:(folder/logo).write_text('<svg>original</svg>')
            archive=self.root/(role+'.tar.gz');module.archives.pack(folder,archive)
            reports[role]={'archiveSha256':module.digest(archive)};payloads[role]=str(archive)
        approval={'kind':'platform-production-image-approval','repository':'Silviomasuccio6/Fleetum','controlSha':'f'*40,
            'parentFrontend':'ghcr.io/silviomasuccio6/fleetum-frontend@sha256:'+'1'*64,'parentBackend':'ghcr.io/silviomasuccio6/fleetum-backend@sha256:'+'2'*64,
            'manifestSha256':'3'*64,'profileSha256':'4'*64,'candidateCiRunId':'11'}
        self.request={'schemaVersion':1,'kind':'platform-production-image-request','runId':'12','approval':approval,
            'candidate':{'controlSha':approval['controlSha'],'sourceProof':{'manifestSha256':approval['manifestSha256'],'sources':sources},'reports':reports},'payloads':payloads}
        self.docker=FakeDocker(self.root,approval['parentFrontend'],reports['image']['imageId'],sources['backend']['sourceSha'],sources['backend']['treeSha'])

    def test_both_static_trees_preserved_in_fake_docker_without_application_execution_or_publication(self):
        result=module.prepare(self.request,self.root/'out',self.docker)
        self.assertFalse(result['imagesPublished']);self.assertFalse(result['installationExecuted'])
        self.assertEqual(result['backendSourceSha'],self.request['candidate']['sourceProof']['sources']['backend']['sourceSha'])
        self.assertEqual(set(result['variants']),{'satin','fallback'})
        self.assertTrue(all(c[0] not in ['run','push','exec'] for c in self.docker.calls))
        for role in ['satin','fallback']:
            path=self.root/'out'/role/'target'
            self.assertEqual((path/'fleetum/index.html').read_text(),'old index.html')
            self.assertEqual((path/'fleetum-website/index.html').read_text(),'public website retained')

    def test_parent_onbuild_cannot_execute_with_publisher_privileges(self):
        self.docker.on_build=['RUN unsafe']
        with self.assertRaisesRegex(ValueError,'ONBUILD'):module.prepare(self.request,self.root/'out',self.docker)
        self.assertFalse(any(c[0] in ['build','push'] for c in self.docker.calls))

    def test_different_loaded_backend_is_rejected_before_any_frontend_build_or_push(self):
        self.docker.source='0'*40
        with self.assertRaisesRegex(ValueError,'tested image'):module.prepare(self.request,self.root/'out',self.docker)
        self.assertFalse(any(c[0] in ['build','push','pull'] for c in self.docker.calls))

    def test_tampered_ci_payload_is_rejected_before_docker(self):
        Path(self.request['payloads']['backend']).write_bytes(b'tampered')
        with self.assertRaisesRegex(ValueError,'checksum'):module.prepare(self.request,self.root/'out',self.docker)
        self.assertEqual(self.docker.calls,[])

    def test_website_drift_prevents_any_publication(self):
        self.docker.corrupt_website=True
        with self.assertRaisesRegex(ValueError,'website'):module.prepare(self.request,self.root/'out',self.docker)
        self.assertFalse(any(c[0]=='push' for c in self.docker.calls))

    def test_publication_requires_the_protected_first_dispatch(self):
        with self.assertRaisesRegex(ValueError,'dispatch'):module.prepare(self.request,self.root/'out',self.docker,publish=True)
        self.assertEqual(self.docker.calls,[])

    def test_approved_publication_uses_only_three_immutable_images_after_both_checks(self):
        env={'GITHUB_ACTIONS':'true','GITHUB_EVENT_NAME':'workflow_dispatch','GITHUB_REF':'refs/heads/main',
             'GITHUB_RUN_ATTEMPT':'1','GITHUB_RUN_ID':'12','GITHUB_WORKFLOW_SHA':'f'*40}
        with patch.dict(module.os.environ,env,clear=True):
            result=module.prepare(self.request,self.root/'out',self.docker,publish=True)
        self.assertTrue(result['imagesPublished']);self.assertFalse(result['installationExecuted'])
        self.assertEqual(len([c for c in self.docker.calls if c[0]=='push']),3)
        self.assertIn('@sha256:',result['backendImage'])
        self.assertTrue(all('image' in value for value in result['variants'].values()))


if __name__=='__main__':unittest.main()
