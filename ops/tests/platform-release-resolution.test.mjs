import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/platform-release-fixture.mjs';
import { resolveRuns,verifyDownloaded,collectE2EOverlayMetadata } from '../platform-release/resolve.mjs';
import { readApproval } from '../platform-release/driver.mjs';
const api=f=>({
 rest:{actions:{
  getWorkflowRun:async({run_id})=>({data:[f.metadata.parent.run,f.metadata.uiCI,f.metadata.controlCI,f.metadata.platform.run].find(r=>r.id===run_id)}),
  getWorkflow:async({workflow_id})=>({data:workflow_id==='deploy-staging.yml'?f.metadata.parent.workflow:f.metadata.platform.workflow}),
  listWorkflowRunArtifacts:()=>{}
 },repos:{getContent:async()=>({data:{type:'file',encoding:'base64',content:Buffer.from('synthetic public config').toString('base64')}})}},
 paginate:async(_method,{run_id})=>[{name:run_id===11?'staging-release-proof-11':run_id===21?'platform-release-proof-21':`ci-source-proof-${run_id}`,expired:false}]
});
test('source resolution accepts only completed exact runs and records only fixed public app config hashes',async()=>{
 const f=fixture();const m=await resolveRuns(api(f),f.approval,f.context);
 assert.equal(Object.keys(m.configHashes).length,3);assert.ok(Object.values(m.configHashes).every(v=>/^[0-9a-f]{64}$/.test(v)));
 assert.equal(m.parent.run.id,11);assert.equal(m.uiCI.head_sha,f.approval.uiSha);
});
for(const [label,change] of [
 ['fork CI',f=>f.metadata.uiCI.head_repository.full_name='other/repo'],
 ['unfinished CI',f=>f.metadata.controlCI.status='in_progress'],
 ['unrelated CI path',f=>f.metadata.uiCI.path='.github/workflows/other.yml'],
 ['parent failure',f=>f.metadata.parent.run.conclusion='failure']
])test(`resolution rejects ${label}`,async()=>{const f=fixture();change(f);await assert.rejects(resolveRuns(api(f),f.approval,f.context));});
test('ambiguous or expired artifacts fail before source publication',async()=>{
 const f=fixture();const client=api(f);client.paginate=async()=>[{name:'staging-release-proof-11',expired:true}];await assert.rejects(resolveRuns(client,f.approval,f.context));
 client.paginate=async()=>[{name:'staging-release-proof-11',expired:false},{name:'staging-release-proof-11',expired:false}];await assert.rejects(resolveRuns(client,f.approval,f.context));
});
test('Nightly metadata binds the parent and the independent Platform run',async()=>{
 const f=fixture();const m=await collectE2EOverlayMetadata(api(f),f.approval,f.context);assert.equal(m.parent.run.id,11);assert.equal(m.platform.run.id,21);
});
test('downloaded parent and both CI proofs are required; a stale checkout is rejected',()=>{
 const f=fixture();assert.equal(verifyDownloaded(f.proof.parent,f.proof.uiCI,f.proof.controlCI,f.metadata,f.approval,f.context).parent.releaseSha,f.approval.appSha);
 f.proof.uiCI.checkoutSha='0'.repeat(40);assert.throws(()=>verifyDownloaded(f.proof.parent,f.proof.uiCI,f.proof.controlCI,f.metadata,f.approval,f.context));
});
test('the driver rejects retries, unknown approval fields and a different checked-out control revision',()=>{
 const f=fixture();const env={GITHUB_REPOSITORY:f.context.repository,GITHUB_WORKFLOW_SHA:f.context.controlSha,FLEETUM_STAGING_TRUSTED_WORKFLOW_SHA:f.context.controlSha,FLEETUM_STAGING_APPROVED_RELEASE_SHA:f.approval.appSha,FLEETUM_PLATFORM_APPROVED_UI_SHA:f.approval.uiSha,E2E_STAGING_RUN_ID:'11',GITHUB_RUN_ATTEMPT:'1',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_WORKFLOW:'Deploy Platform Staging',GITHUB_RUN_ID:'21',FLEETUM_PLATFORM_APPROVAL_JSON:JSON.stringify(f.approval)};
 assert.deepEqual(readApproval(env,()=>f.context.controlSha),f.approval);
 assert.throws(()=>readApproval({...env,GITHUB_RUN_ATTEMPT:'2'},()=>f.context.controlSha));
 assert.throws(()=>readApproval(env,()=>'0'.repeat(40)));
});

test('SSH transport pins the host, uses private temporary credentials, fixes the staging path and cleans up',async()=>{
 const {executeApply}=await import('../platform-release/driver.mjs');const {existsSync}=await import('node:fs');const calls=[];
 const env={FLEETUM_STAGING_HOST:'staging.example.test',FLEETUM_STAGING_USER:'ubuntu',FLEETUM_STAGING_SSH_KEY:'SYNTHETIC-PRIVATE-KEY',FLEETUM_STAGING_KNOWN_HOSTS:'synthetic-pinned-host'};
 const result=executeApply({runId:21},env,(command,args,options)=>{calls.push({command,args,options});return args.at(-1).startsWith('sudo -n python3')?'{}':'';});
 assert.deepEqual(result,{});assert.equal(calls.length,4);
 const keyIndex=calls[0].args.indexOf('-i');assert.equal(existsSync(calls[0].args[keyIndex+1]),false);
 assert.match(calls[0].args.at(-1),/^set -eu;/);assert.match(calls[0].args.at(-1),/readlink -f \/opt\/fleetum-staging\/app/);
 assert.ok(calls.every(c=>c.args.includes('StrictHostKeyChecking=yes')));assert.doesNotMatch(JSON.stringify(calls),/SYNTHETIC-PRIVATE-KEY/);
 assert.throws(()=>executeApply({runId:'21;id'},env,()=>{throw new Error('must not execute');}));
});

test('the proof actually emitted by the transaction passes the complete composite verifier',async()=>{
 const {createCompositeProof}=await import('../platform-release/driver.mjs');const {verifyBoundDocuments}=await import('../e2e/staging-release-binding.mjs');
 const f=fixture();const prepared={targetImage:f.proof.frontendImage,...Object.fromEntries(['manifestSha256','parentStaticSha256','targetStaticSha256','parentWebsiteSha256','targetWebsiteSha256'].map(k=>[k,f.proof[k]]))};
 const generated=createCompositeProof({approval:f.approval,files:{parent:f.proof.parent,uiCI:f.proof.uiCI,controlCI:f.proof.controlCI},prepared,applied:{targetStaticSha256:prepared.targetStaticSha256},operation:'install',runId:21});
 assert.equal(verifyBoundDocuments(generated,f.metadata,f.context,{platformApproval:f.approval}).ok,true);
 const rollback=createCompositeProof({approval:f.approval,files:{parent:f.proof.parent,uiCI:f.proof.uiCI,controlCI:f.proof.controlCI,prior:generated},prepared,applied:{targetStaticSha256:f.approval.baselineTreeSha256},operation:'rollback',runId:22});
 f.metadata.priorPlatform=structuredClone(f.metadata.platform);f.metadata.platform.run.id=22;
 assert.equal(verifyBoundDocuments(rollback,f.metadata,{...f.context,platformRunId:'22'},{platformApproval:f.approval}).ok,true);
});
