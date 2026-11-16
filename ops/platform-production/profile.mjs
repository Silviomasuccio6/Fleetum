import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { HASH } from './policy.mjs';

const recorded=JSON.parse(readFileSync(new URL('./recorded-base.json',import.meta.url),'utf8'));

const ROOTS=['/opt/fleetum/app','/srv/fleetum'];
const roleDigest=(role,value)=>new RegExp(`^ghcr\\.io/silviomasuccio6/fleetum-${role}@sha256:[0-9a-f]{64}$`).test(value);
const container=(value,role)=>{
  assert.ok(value?.running===true&&HASH.test(value.id)&&/^sha256:[0-9a-f]{64}$/.test(value.imageId));
  assert.equal(value.service,role==='backend'?'backend':'caddy');
  assert.ok(typeof value.project==='string'&&/^[A-Za-z0-9_-]+$/.test(value.project)&&!value.project.toLowerCase().includes('staging'));
  const digests=value.repoDigests.filter(x=>roleDigest(role,x));assert.equal(digests.length,1);
  return {containerId:value.id,imageId:value.imageId,imageDigest:digests[0],project:value.project,service:value.service,startedAt:value.startedAt};
};
export function profileFromObservation(observed,{now=Date.now()}={}) {
  assert.equal(observed?.schemaVersion,1);assert.equal(observed.kind,'platform-production-readonly-observation');
  assert.equal(observed.envRead,false);assert.equal(observed.databaseRead,false);assert.equal(observed.writes,false);
  const at=Date.parse(observed.observedAtUTC);assert.ok(Number.isFinite(at)&&at<=now+60000&&now-at<=24*3600000,'Fresh observation required');
  assert.deepEqual(observed.staticRootMounts,[],'Image overlay is unsupported with runtime mounts on static roots');
  assert.ok(['x86_64','amd64'].includes(observed.host?.machine),'Reviewed Linux AMD64 host required');
  const backend=container(observed.containers.fleetum_backend,'backend'),frontend=container(observed.containers.fleetum_caddy,'frontend');
  assert.equal(backend.imageDigest,recorded.backendImage,'Production backend changed; do not backport onto an unreviewed base');
  assert.equal(frontend.imageDigest,recorded.frontendImage,'Production frontend changed; baseline must be reviewed again');
  assert.equal(backend.project,frontend.project);
  const app=observed.containers.fleetum_backend.workingDir;
  assert.ok(ROOTS.includes(app));assert.equal(observed.containers.fleetum_caddy.workingDir,app);
  const fingerprints=observed.configFingerprints;
  assert.ok(Array.isArray(fingerprints)&&fingerprints.length>=2&&fingerprints.every(f=>f.verified===true&&HASH.test(f.sha256)&&f.path.startsWith(app+'/')));
  assert.ok(fingerprints.some(f=>f.path===app+'/docker-compose.prod.yml'));
  assert.ok(fingerprints.some(f=>f.path.startsWith(app+'/deploy/caddy/Caddyfile')));
  return {schemaVersion:1,kind:'platform-production-profile',target:'production',observedAtUTC:observed.observedAtUTC,
    appDir:app,backend,frontend,configFingerprints:fingerprints.map(({path,sha256,bytes,uid,mode})=>({path,sha256,bytes,uid,mode})),
    staticRootMounts:[],hostArchitecture:'linux/amd64',observationSha256:createHash('sha256').update(JSON.stringify(observed)).digest('hex'),
    executionReviewed:false,readyForDeployment:false};
}
export function verifyProfile(profile,approval,{now=Date.now()}={}) {
  assert.ok(profile?.schemaVersion===1&&profile.kind==='platform-production-profile'&&profile.target==='production');
  assert.equal(profile.readyForDeployment,false);assert.deepEqual(profile.staticRootMounts,[]);assert.equal(profile.hostArchitecture,'linux/amd64');
  assert.ok(ROOTS.includes(profile.appDir)&&HASH.test(profile.observationSha256));
  const at=Date.parse(profile.observedAtUTC);assert.ok(Number.isFinite(at)&&at<=now+60000&&now-at<=24*3600000);
  assert.equal(profile.backend.imageDigest,approval.parentBackend);assert.equal(profile.frontend.imageDigest,approval.parentFrontend);
  assert.equal(profile.backend.imageDigest,recorded.backendImage);assert.equal(profile.frontend.imageDigest,recorded.frontendImage);
  assert.ok(roleDigest('backend',profile.backend.imageDigest)&&roleDigest('frontend',profile.frontend.imageDigest));
  assert.ok(HASH.test(profile.backend.containerId)&&HASH.test(profile.frontend.containerId));
  assert.equal(profile.backend.project,profile.frontend.project);assert.ok(!profile.backend.project.toLowerCase().includes('staging'));
  assert.ok(Array.isArray(profile.configFingerprints)&&profile.configFingerprints.length>=2&&profile.configFingerprints.every(f=>HASH.test(f.sha256)&&f.path.startsWith(profile.appDir+'/')));
  assert.ok(profile.configFingerprints.some(f=>f.path===profile.appDir+'/docker-compose.prod.yml'));
  assert.ok(profile.configFingerprints.some(f=>f.path.startsWith(profile.appDir+'/deploy/caddy/Caddyfile')));
  return true;
}
