import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, image, sha } from './helpers/platform-release-fixture.mjs';
import { validateApproval, verifyOverlayProof } from '../platform-release/policy.mjs';
import { verifyBoundDocuments } from '../e2e/staging-release-binding.mjs';

test('a complete composite proof binds application, UI, parent, controls and exact CI sources',()=>{
 const f=fixture();assert.equal(validateApproval(f.approval,f.context).ok,true);
 assert.equal(verifyOverlayProof(f.proof,f.metadata,f.approval,f.context).ok,true);
 assert.equal(verifyBoundDocuments(f.proof,f.metadata,f.context,{platformApproval:f.approval}).ok,true);
});
for (const [label,change] of [
 ['UI source',f=>f.proof.uiSha=sha('e')],['backend',f=>f.proof.backendImage=image('backend','0')],
 ['parent image',f=>f.proof.parent.frontendImage=image('frontend','0')],['parent run',f=>f.metadata.parent.run.id=99],
 ['parent control',f=>f.metadata.parent.run.head_sha=sha('0')],['parent incomplete',f=>f.proof.parent.completed=false],
 ['wrong platform workflow',f=>f.metadata.platform.workflow.path='.github/workflows/deploy-staging.yml'],
 ['platform run failure',f=>f.metadata.platform.run.conclusion='failure'],['different repository',f=>f.metadata.platform.run.head_repository.full_name='other/repo'],
 ['UI CI source',f=>f.metadata.uiCI.head_sha=sha('0')],['UI CI failure',f=>f.metadata.uiCI.conclusion='failure'],
 ['control CI source',f=>f.proof.controlCI.checkoutSha=sha('0')],['missing security job',f=>delete f.proof.uiCI.jobResults.sast],
 ['website modified',f=>f.proof.targetWebsiteSha256='0'.repeat(64)],['baseline drift',f=>f.proof.parentStaticSha256='0'.repeat(64)],
 ['mutable target',f=>f.proof.frontendImage='ghcr.io/silviomasuccio6/fleetum-frontend:latest'],
 ['incomplete overlay',f=>f.proof.completed=false],['missing approval',f=>f.approval=null],['wrong current workflow',f=>f.context.controlSha=sha('0')]
]) test(`composite binding rejects ${label}`,()=>{const f=fixture();change(f);assert.equal(verifyBoundDocuments(f.proof,f.metadata,f.context,{platformApproval:f.approval}).ok,false);});

test('legacy proofs never substitute for an explicitly selected overlay',()=>{
 const f=fixture();assert.equal(verifyBoundDocuments(f.proof.parent,f.metadata.parent,f.context,{platformApproval:f.approval}).ok,false);
 const legacy={...f.context,controlSha:f.approval.parentControlSha};delete legacy.platformRunId;
 assert.equal(verifyBoundDocuments(f.proof.parent,f.metadata.parent,legacy).ok,true);
});
test('an overlay is rejected without an explicit platform run selector',()=>{const f=fixture();delete f.context.platformRunId;assert.equal(verifyBoundDocuments(f.proof,f.metadata,f.context,{platformApproval:f.approval}).ok,false);});
test('malformed approvals fail without printing their values',()=>{const f=fixture();f.approval.secret='DO-NOT-PRINT';const r=validateApproval(f.approval,f.context);assert.equal(r.ok,false);assert.doesNotMatch(JSON.stringify(r),/DO-NOT-PRINT/);});

test('rollback requires the exact completed prior overlay and restores only its approved parent',()=>{
 const f=fixture();const prior=structuredClone(f.proof);f.proof.operation='rollback';f.proof.frontendImage=f.approval.parentFrontend;f.proof.targetStaticSha256=f.approval.baselineTreeSha256;f.proof.rolledBackRunId=prior.deployRunId;f.proof.priorOverlay=prior;
 f.metadata.priorPlatform=structuredClone(f.metadata.platform);f.metadata.platform.run.id=22;f.proof.deployRunId=22;f.context.platformRunId='22';
 assert.equal(verifyBoundDocuments(f.proof,f.metadata,f.context,{platformApproval:f.approval}).ok,true);
 f.proof.frontendImage=image('frontend','0');assert.equal(verifyBoundDocuments(f.proof,f.metadata,f.context,{platformApproval:f.approval}).ok,false);
 f.proof.frontendImage=f.approval.parentFrontend;f.proof.priorOverlay.operation='rollback';assert.equal(verifyBoundDocuments(f.proof,f.metadata,f.context,{platformApproval:f.approval}).ok,false);
});
