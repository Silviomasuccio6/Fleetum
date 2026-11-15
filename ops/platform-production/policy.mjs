import assert from 'node:assert/strict';
import { verifyCIProof } from '../ci-release-identity.mjs';
import { verifyProductionCIRun } from '../production-release-policy.mjs';

export const SHA = /^[0-9a-f]{40}$/;
export const HASH = /^[0-9a-f]{64}$/;
export const JOBS = ['sources','backend','frontend','image','security'];
export const ROLES = ['backend','satin','fallback'];
export const PLATFORM_API = 'https://platform.fleetum.it/platform-api';
export const CI_PATH = '.github/workflows/platform-production-candidate-ci.yml';
export const RELEASE_PATH = '.github/workflows/deploy-platform-production.yml';
export const positiveId = n => /^[1-9][0-9]*$/.test(String(n)) && Number.isSafeInteger(Number(n));
const immutable = role => new RegExp(`^ghcr\\.io/silviomasuccio6/fleetum-${role}@sha256:[0-9a-f]{64}$`);
const object = x => x && typeof x==='object' && !Array.isArray(x);

function checkContext(c) {
  assert.equal(c.repository,'Silviomasuccio6/Fleetum');
  assert.ok(SHA.test(c.controlSha) && positiveId(c.runId),'Full control identity and run required');
}
function checkReport(report, source, c, manifest, role) {
  assert.ok(object(report) && report.schemaVersion===1 && report.role===role && report.passed===true,'Successful role report required');
  assert.equal(report.controlSha,c.controlSha); assert.equal(report.runId,String(c.runId));
  assert.equal(report.manifestSha256,manifest);
  assert.equal(report.sourceSha,source.sourceSha); assert.equal(report.treeSha,source.treeSha);
  assert.ok(HASH.test(report.archiveSha256),'Compiled artifact checksum required');
  assert.equal(report.runtime?.node,'22.23.1');
  assert.equal(report.runtime?.platform,'linux'); assert.equal(report.runtime?.arch,'x64');
}

export function candidateProof({source,reports,needs,context:c}) {
  checkContext(c);
  assert.ok(object(source) && source.schemaVersion===1 && source.kind==='platform-production-source-export');
  assert.equal(source.controlSha,c.controlSha); assert.equal(source.runId,String(c.runId));
  assert.ok(HASH.test(source.manifestSha256));
  assert.deepEqual(Object.keys(source.sources).sort(),[...ROLES].sort());
  assert.deepEqual(Object.keys(needs).sort(),[...JOBS].sort());
  for (const job of JOBS) assert.equal(needs[job]?.result,'success',`${job} did not succeed`);
  for (const role of ROLES) {
    const s=source.sources[role],r=reports[role];
    assert.ok(SHA.test(s?.sourceSha) && SHA.test(s.treeSha));
    assert.equal(s.archiveName,role+'.source.tar.gz');assert.ok(HASH.test(s.archiveSha256));
    checkReport(r,s,c,source.manifestSha256,role);
    assert.equal(r.audit?.high,0); assert.equal(r.audit?.critical,0);
    if (role==='backend') {
      assert.ok(Number.isSafeInteger(r.unitTests) && r.unitTests>=182);
      assert.ok(Number.isSafeInteger(r.databaseTests) && r.databaseTests>=13);
      const chain=r.migrationChain;
      assert.ok(chain?.baseline===42 && chain.patched===43 && chain.future===48 && chain.preserved===true && chain.canonical===true,'Complete migration trial required');
    } else {
      assert.ok(Number.isSafeInteger(r.tests) && r.tests>=(role==='satin'?129:118));
      assert.equal(r.platformApi,PLATFORM_API);
    }
  }
  checkReport(reports.image,source.sources.backend,c,source.manifestSha256,'image');
  assert.equal(reports.image.platform,'linux/amd64'); assert.equal(reports.image.smokePassed,true);
  assert.ok(/^sha256:[0-9a-f]{64}$/.test(reports.image.imageId) && HASH.test(reports.image.dockerfileSha256));
  assert.match(reports.image.scanner?.image??'',/^aquasec\/trivy@sha256:[0-9a-f]{64}$/);
  assert.equal(reports.image.scanner.high,0);assert.equal(reports.image.scanner.critical,0);
  const security=reports.security;
  assert.ok(security?.schemaVersion===1&&security.role==='security'&&security.passed===true);
  assert.equal(security.controlSha,c.controlSha);assert.equal(security.runId,String(c.runId));
  assert.equal(security.manifestSha256,source.manifestSha256);
  for(const role of ROLES)assert.equal(security.sources[role],source.sources[role].sourceSha);
  assert.match(security.tools?.gitleaks??'',/^ghcr\.io\/gitleaks\/gitleaks@sha256:[0-9a-f]{64}$/);
  assert.match(security.tools?.semgrep??'',/^semgrep\/semgrep@sha256:[0-9a-f]{64}$/);
  assert.ok(['push','pull_request'].includes(c.event));
  return {schemaVersion:1,kind:'platform-production-candidate-ci',recipeVersion:1,repository:c.repository,
    controlSha:c.controlSha,runId:String(c.runId),event:c.event,branch:c.branch,
    workflowPath:CI_PATH,sourceProof:source,reports,jobResults:needs,readyForDeployment:false};
}

export function verifyCandidateProof(p,c) {
  assert.equal(p?.schemaVersion,1); assert.equal(p.kind,'platform-production-candidate-ci');
  assert.equal(p.recipeVersion,1); assert.equal(p.workflowPath,CI_PATH); assert.equal(p.readyForDeployment,false);
  const expected=candidateProof({source:p.sourceProof,reports:p.reports,needs:p.jobResults,context:{...c,event:p.event,branch:p.branch}});
  assert.deepEqual(p,expected,'Candidate CI proof contains unexpected or inconsistent fields');
  return true;
}

const APPROVAL_KEYS=['schemaVersion','kind','repository','controlSha','manifestSha256','candidateCiRunId','controlCiRunId',
  'parentBackend','parentFrontend','parentStaticSha256','parentWebsiteSha256','profileSha256','preflightSha256','backupSha256','approvedUntil'];
export function verifyProductionApproval(a,c) {
  checkContext(c);
  assert.ok(object(a)); assert.deepEqual(Object.keys(a).sort(),[...APPROVAL_KEYS].sort());
  assert.equal(a.schemaVersion,1); assert.equal(a.kind,'platform-production-approval'); assert.equal(a.repository,c.repository);
  assert.equal(c.event,'workflow_dispatch'); assert.equal(c.ref,'refs/heads/main'); assert.equal(c.attempt,'1');
  assert.equal(c.confirm,'RELEASE_PLATFORM_PRODUCTION');
  assert.equal(c.mainSha,c.controlSha); assert.equal(c.workflowSha,c.controlSha); assert.equal(a.controlSha,c.controlSha);
  assert.ok(positiveId(a.candidateCiRunId) && positiveId(a.controlCiRunId));
  assert.ok(immutable('backend').test(a.parentBackend) && immutable('frontend').test(a.parentFrontend));
  for(const key of ['manifestSha256','parentStaticSha256','parentWebsiteSha256','profileSha256','preflightSha256','backupSha256']) assert.ok(HASH.test(a[key]),`Missing ${key}`);
  const expiry=Date.parse(a.approvedUntil),now=c.now??Date.now();
  assert.ok(Number.isFinite(expiry) && expiry>now && expiry-now<=6*3600000,'Approval expired or exceeds six hours');
  return true;
}

export function verifyPreparedRelease({approval:a,candidate:p,context:c,run,control,controlRun,manifestSha256,descriptor}) {
  verifyProductionApproval(a,c);
  verifyCandidateProof(p,{repository:c.repository,controlSha:c.controlSha,runId:a.candidateCiRunId});
  assert.equal(p.event,'push'); assert.equal(p.branch,'main');
  assert.ok(run?.status==='completed' && run.conclusion==='success' && run.event==='push' && run.head_branch==='main');
  assert.equal(run.head_sha,c.controlSha); assert.equal(String(run.id),a.candidateCiRunId); assert.equal(run.path,CI_PATH);
  assert.equal(run.repository?.full_name,c.repository); assert.equal(run.head_repository?.full_name,c.repository);
  assert.equal(manifestSha256,a.manifestSha256); assert.equal(p.sourceProof.manifestSha256,a.manifestSha256);
  for(const role of ROLES) for(const field of ['sourceSha','treeSha']) assert.equal(p.sourceProof.sources[role][field],descriptor?.sources?.[role]?.[field]);
  verifyCIProof(control,{repository:c.repository,sourceSha:c.controlSha,runId:a.controlCiRunId});
  assert.ok(verifyProductionCIRun(controlRun,{repository:c.repository,sourceSha:c.controlSha}).ok);
  assert.equal(String(controlRun.id),a.controlCiRunId);
  return true;
}
