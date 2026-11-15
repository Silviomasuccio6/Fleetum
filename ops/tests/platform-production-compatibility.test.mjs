import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectClientContract, assessProductionCompatibility } from '../platform-release/production-compatibility.mjs';
const sha=c=>c.repeat(40), hash=c=>c.repeat(64);
const route={method:'POST',path:'/auth/logout'};
const source='export const platformAdminUseCases={logout:async()=>platformFetch(`${apiBase}/auth/logout`,{method:"POST"}),sendInvoiceEmail:async(id,key)=>platformFetch(`${apiBase}/invoices/${id}/send-email`,{method:"POST",headers:{"X-Idempotency-Key":key}}),overview:async()=>platformFetch(`${apiBase}/overview`)};';
const contract=()=>inspectClientContract(source,{uiSourceSha:sha('a')});
function snapshot(){
 const before=['backend','caddy'].map((name,i)=>({name:'/fleetum_'+name,id:hash(String(i+1)),imageId:'sha256:'+hash(String(i+3)),imageRef:`ghcr.io/silviomasuccio6/fleetum-${i?'frontend':'backend'}@sha256:${hash(String(i+3))}`,running:true,startedAt:'2026-11-15T10:00:00Z'}));
 return {observedAtUTC:'2026-11-15T12:00:00Z',before,after:structuredClone(before),images:before.map(x=>({id:x.imageId,digests:[x.imageRef]})),containerIdentityUnchanged:true,code:{files:Object.fromEntries(['routes','controller','middleware','invoices','session'].map(k=>[k,{exists:true,bytes:200,sha256:hash('e')}])),routes:[route,{method:'POST',path:'/invoices/:invoiceId/send-email'},{method:'GET',path:'/overview'}],capabilities:{logoutRoute:true,sessionService:true,revocationCheck:true,invoiceRequestStore:true,invoiceIdempotencyKey:true}}};
}
const assess=s=>assessProductionCompatibility(s,contract(),{now:Date.parse('2026-11-15T12:01:00Z')});
test('client requirements come from actual call expressions, methods and parameterized routes',()=>{
 const c=contract();assert.equal(c.uiSourceSha,sha('a'));assert.equal(c.routes.length,3);assert.equal(c.requires.serverLogout,true);assert.equal(c.requires.invoiceEmailIdempotency,true);
 assert.ok(c.routes.some(r=>r.method==='POST'&&r.path==='/invoices/:param/send-email'));
});
test('an empty or unrecognizable client cannot pass a compatibility review',()=>{
 assert.throws(()=>inspectClientContract('export const ignored={}',{uiSourceSha:sha('a')}));
 assert.throws(()=>inspectClientContract(source,{uiSourceSha:'main'}));
});
test('dynamic requests cannot be silently dropped from the source contract',()=>{
 assert.throws(()=>inspectClientContract('export const platformAdminUseCases={run:()=>platformFetch(url,options)}',{uiSourceSha:sha('a')}));
});
test('an incomplete contract artifact cannot obtain a static compatibility result',()=>{
 const c=contract();c.routes=[];assert.equal(assessProductionCompatibility(snapshot(),c,{now:Date.parse('2026-11-15T12:01:00Z')}).staticCompatible,false);
});
test('legacy production is blocked for logout and invoice email without silently inferring compatibility',()=>{
 const s=snapshot();s.code.routes=s.code.routes.filter(r=>r.path!=='/auth/logout');
 for(const k of Object.keys(s.code.capabilities))s.code.capabilities[k]=false;s.code.files.session={exists:false};
 const r=assess(s);assert.equal(r.staticCompatible,false);assert.equal(r.readyForDeploy,false);
 assert.ok(r.blockers.includes('PLATFORM_LOGOUT_UNSUPPORTED'));assert.ok(r.blockers.includes('INVOICE_EMAIL_IDEMPOTENCY_UNSUPPORTED'));
 assert.deepEqual(r.missingRoutes,[route]);
});
test('even complete static evidence requires runtime acceptance and never authorizes a deployment',()=>{
 const r=assess(snapshot());assert.equal(r.staticCompatible,true);assert.equal(r.readyForDeploy,false);assert.equal(r.status,'runtime-validation-required');
});
test('a route with no durable revocation check cannot satisfy logout',()=>{
 const s=snapshot();s.code.capabilities.revocationCheck=false;assert.ok(assess(s).blockers.includes('PLATFORM_LOGOUT_UNSUPPORTED'));
});
test('unknown invoice idempotency is blocked rather than treated as an optional feature',()=>{
 const s=snapshot();delete s.code.capabilities.invoiceRequestStore;assert.ok(assess(s).blockers.includes('INVOICE_EMAIL_IDEMPOTENCY_UNSUPPORTED'));
});
test('staging container names cannot be mistaken for the production baseline',()=>{
 const s=snapshot();s.before[0].name='/fleetum_staging_backend';assert.equal(assess(s).staticCompatible,false);
});
test('runtime drift between opening and closing observations blocks publication',()=>{
 const s=snapshot();s.after[0].id=hash('9');assert.equal(assess(s).staticCompatible,false);
});
test('the image must be tied to the observed container by an immutable repository digest',()=>{
 const s=snapshot();s.images[0].id='sha256:'+hash('9');assert.equal(assess(s).staticCompatible,false);
 s.images[0].id=s.before[0].imageId;s.images[0].digests=['ghcr.io/silviomasuccio6/fleetum-backend:latest'];assert.equal(assess(s).staticCompatible,false);
});
test('stale or future evidence cannot be reused as a current baseline',()=>{
 const s=snapshot();s.observedAtUTC='2026-11-14T12:00:00Z';assert.equal(assess(s).staticCompatible,false);
 s.observedAtUTC='2026-11-16T12:00:00Z';assert.equal(assess(s).staticCompatible,false);
});
test('missing or invalid compiled source hashes are not accepted as proof of the backend contract',()=>{
 const s=snapshot();s.code.files.routes.sha256='unknown';assert.equal(assess(s).staticCompatible,false);
 delete s.code.files.controller;assert.equal(assess(s).staticCompatible,false);
});
