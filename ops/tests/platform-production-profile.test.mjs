import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { profileFromObservation,verifyProfile } from '../platform-production/profile.mjs';
const base=JSON.parse(readFileSync(new URL('../platform-production/recorded-base.json',import.meta.url),'utf8'));
const now=Date.parse('2030-01-15T12:00:00Z');
function observation(){
 const make=(service,image)=>({id:(service==='backend'?'a':'b').repeat(64),imageId:'sha256:'+'c'.repeat(64),running:true,startedAt:'synthetic',project:'fleetum',service,repoDigests:[image],workingDir:'/opt/fleetum/app'});
 return {schemaVersion:1,kind:'platform-production-readonly-observation',observedAtUTC:'2030-01-15T11:00:00Z',envRead:false,databaseRead:false,writes:false,staticRootMounts:[],host:{machine:'x86_64'},
  containers:{fleetum_backend:make('backend',base.backendImage),fleetum_caddy:make('caddy',base.frontendImage)},
  configFingerprints:['docker-compose.prod.yml','deploy/caddy/Caddyfile'].map(path=>({path:'/opt/fleetum/app/'+path,verified:true,sha256:'d'.repeat(64),bytes:128,uid:0,mode:'0o644'}))};
}
test('a bounded fresh observation can describe a plan without authorizing execution',()=>{
 const p=profileFromObservation(observation(),{now});assert.equal(p.readyForDeployment,false);assert.equal(p.executionReviewed,false);
 assert.equal(verifyProfile(p,{parentBackend:base.backendImage,parentFrontend:base.frontendImage},{now}),true);
});
test('a changed production image cannot be accepted merely by editing protected variables',()=>{
 const o=observation();o.containers.fleetum_backend.repoDigests=['ghcr.io/silviomasuccio6/fleetum-backend@sha256:'+'0'.repeat(64)];assert.throws(()=>profileFromObservation(o,{now}));
});
test('staging, unverified config paths, static mounts and unknown layouts require a new review',()=>{
 for(const change of [o=>o.containers.fleetum_caddy.project='fleetum-staging',o=>o.staticRootMounts=['/srv/fleetum'],o=>o.containers.fleetum_backend.workingDir='/unknown',o=>o.configFingerprints[0].verified=false,o=>o.host.machine='aarch64',o=>o.observedAtUTC='2029-01-01T00:00:00Z']){
  const o=observation();change(o);assert.throws(()=>profileFromObservation(o,{now}));
 }
});
