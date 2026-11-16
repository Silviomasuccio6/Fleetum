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
test('the observed standalone shared gateway retains its own manifest and all three Caddy mounts',()=>{
 const o=observation(),front=o.containers.fleetum_caddy;
 front.workingDir='/opt/fleetum/ingress-control';front.configFiles=front.workingDir+'/'+'e'.repeat(64)+'.shared.json';front.networks=['app_fleetum_private','fleetum_staging_ingress'];
 front.mounts=[['Caddyfile.production-shared','/etc/caddy/Caddyfile'],['Caddyfile','/etc/caddy/production-baseline'],['Caddyfile.staging-ingress','/etc/caddy/staging-ingress']].map(([name,destination])=>({source:'/opt/fleetum/app/deploy/caddy/'+name,destination,rw:false}));
 o.configFingerprints=['/opt/fleetum/app/docker-compose.prod.yml',front.configFiles,...front.mounts.map(m=>m.source)].map(path=>({path,verified:true,sha256:'d'.repeat(64)}));
 const profile=profileFromObservation(o,{now});assert.equal(profile.ingressMode,'shared');assert.notEqual(profile.frontendCompose,profile.backendCompose);
 assert.equal(verifyProfile(profile,{parentBackend:base.backendImage,parentFrontend:base.frontendImage},{now}),true);
 for(const change of [x=>x.containers.fleetum_caddy.mounts.pop(),x=>x.containers.fleetum_caddy.configFiles='/opt/fleetum/ingress-control/unreviewed.json',x=>x.configFingerprints.push({path:'/opt/fleetum/env/compose.env',verified:true,sha256:'d'.repeat(64)})]){
  const copy=structuredClone(o);change(copy);assert.throws(()=>profileFromObservation(copy,{now}));
 }
});
