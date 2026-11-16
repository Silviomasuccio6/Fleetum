import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtempSync,readFileSync,rmSync,writeSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {collectMetadata,downloadArtifact,profileHash} from '../platform-production/prepare.mjs';

const repo='Silviomasuccio6/Fleetum',sha='a'.repeat(40),hash='b'.repeat(64);
function fixture(){
 const make=(id,file)=>({id,workflow_id:id===11?100:200,path:'.github/workflows/'+file,status:'completed',conclusion:'success',event:'push',head_branch:'main',head_sha:sha,repository:{full_name:repo},head_repository:{full_name:repo}});
 const runs={11:make(11,'platform-production-candidate-ci.yml'),12:make(12,'ci.yml')};
 const names={11:['platform-candidate-proof-11','platform-candidate-backend-image-11','platform-candidate-compiled-satin-11','platform-candidate-compiled-fallback-11'],12:['ci-source-proof-12']};
 const artifacts=Object.fromEntries(Object.entries(names).map(([id,names])=>[id,names.map((name,n)=>({id:Number(id)*10+n,name,expired:false,digest:'sha256:'+hash,size_in_bytes:400}))]));
 const github={rest:{actions:{getWorkflowRun:async({run_id})=>({data:runs[run_id]}),getWorkflow:async({workflow_id})=>({data:{id:workflow_id==='ci.yml'?200:100,path:'.github/workflows/'+workflow_id}}),listWorkflowRunArtifacts:()=>{}}},paginate:async(_fn,{run_id})=>artifacts[run_id]};
 return {github,runs,artifacts,approval:{candidateCiRunId:'11',controlCiRunId:'12'},context:{repository:repo,controlSha:sha}};
}
test('artifact metadata is bound to independent successful current main workflows',async()=>{
 const f=fixture(),result=await collectMetadata(f.github,f.approval,f.context);
 assert.equal(Object.keys(result.artifacts).length,5);assert.equal(result.candidateRun.head_sha,sha);
});
test('foreign repositories, PR runs, missing digests and expired artifacts stop collection',async()=>{
 for(const change of [f=>f.runs[11].event='pull_request',f=>f.runs[11].head_repository.full_name='other/repo',f=>f.artifacts[11][0].expired=true,f=>f.artifacts[12][0].digest=null]){
  const f=fixture();change(f);await assert.rejects(()=>collectMetadata(f.github,f.approval,f.context));
 }
});
test('profile formatting and property order do not silently change its canonical approval hash',()=>{
 assert.equal(profileHash({b:2,a:{d:4,c:3}}),profileHash({a:{c:3,d:4},b:2}));
 assert.notEqual(profileHash({b:2}),profileHash({b:3}));
});
test('real ZIP extraction follows digest validation and forwards no server credentials',t=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'fleetum-artifact-test-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const zip=path.join(root,'fixture.zip');
 const made=spawnSync('python3',['-c','import zipfile,sys;z=zipfile.ZipFile(sys.argv[1],"w");z.writestr("ci-source.json",b"{\\"synthetic\\":true}");z.close()',zip],{encoding:'utf8'});
 assert.equal(made.status,0,made.stderr);const bytes=readFileSync(zip),digest='sha256:'+createHash('sha256').update(bytes).digest('hex');
 const execute=(command,args,options)=>{
  assert.equal(command,'gh');assert.equal(args[1],'repos/Silviomasuccio6/Fleetum/actions/artifacts/123/zip');
  assert.deepEqual(Object.keys(options.env).sort(),['GH_TOKEN','HOME','PATH']);writeSync(options.stdio[1],bytes);return {status:0};
 };
 const out=path.join(root,'ci-source.json');downloadArtifact({id:123,digest,size_in_bytes:bytes.length},'ci-source.json',out,{env:{PATH:process.env.PATH,HOME:process.env.HOME,GH_TOKEN:'synthetic',UNRELATED_SERVER_SECRET:'must-not-forward'},execute});
 assert.equal(JSON.parse(readFileSync(out,'utf8')).synthetic,true);
});
