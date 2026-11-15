import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

const SHA=/^[0-9a-f]{40}$/, HASH=/^[0-9a-f]{64}$/;
const digest=(role,value)=>new RegExp(`^ghcr\\.io/silviomasuccio6/fleetum-${role}@sha256:[0-9a-f]{64}$`).test(value);
const normalize=p=>p.split('?')[0].replace(/:[A-Za-z0-9_]+/g,':param');

// Read-only source analysis. It does not execute the client or contact an API.
export function inspectClientContract(source,{uiSourceSha}) {
 assert.ok(SHA.test(uiSourceSha),'A full reviewed UI source SHA is required');
 const file=ts.createSourceFile('platform-admin-usecases.ts',source,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TS);
 assert.equal(file.parseDiagnostics.length,0,'Client source cannot be parsed');
 let object;
 const find=n=>{if(ts.isVariableDeclaration(n)&&n.name.getText(file)==='platformAdminUseCases'&&n.initializer&&ts.isObjectLiteralExpression(n.initializer))object=n.initializer;ts.forEachChild(n,find);};
 find(file);assert.ok(object,'Platform usecase object is missing');
 const routes=[],behaviorHashes={};
 let invoiceEmailIdempotency=false;
 for(const property of object.properties){
  if(['logout','sendInvoiceEmail'].includes(property.name?.getText(file)))behaviorHashes[property.name.getText(file)]=createHash('sha256').update(property.getText(file)).digest('hex');
  const visit=n=>{
   if(ts.isCallExpression(n)&&n.expression.getText(file)==='platformFetch'){
    const url=n.arguments[0];let value='';
    if(ts.isTemplateExpression(url)){
     value=url.head.text;
     for(const span of url.templateSpans){
      value+=(span.expression.getText(file)==='apiBase'?'':':param')+span.literal.text;
     }
    }else if(ts.isStringLiteral(url))value=url.text;
    else throw new Error('Unresolved Platform URL requires manual contract review');
    value=normalize(value);assert.match(value,/^\/[A-Za-z0-9_:/.-]+$/,'Unexpected Platform route');
    const options=n.arguments[1];let method='GET';
    if(options){
     assert.ok(ts.isObjectLiteralExpression(options),'Dynamic request options need manual review');
     const member=options.properties.find(p=>p.name?.getText(file)==='method');
     if(member){assert.ok(ts.isPropertyAssignment(member)&&ts.isStringLiteral(member.initializer),'Dynamic method needs manual review');method=member.initializer.text;}
    }
    assert.ok(['GET','POST','PATCH','DELETE','PUT'].includes(method),'Unexpected HTTP method');
    routes.push({method,path:value});
    if(value==='/invoices/:param/send-email'&&options?.getText(file).includes('X-Idempotency-Key'))invoiceEmailIdempotency=true;
   }
   ts.forEachChild(n,visit);
  };visit(property);
 }
 assert.ok(routes.length,'No Platform requests were resolved');
 const unique=[...new Map(routes.map(r=>[r.method+' '+r.path,r])).values()].sort((a,b)=>(a.method+' '+a.path).localeCompare(b.method+' '+b.path));
 return {uiSourceSha,clientCodeSha256:createHash('sha256').update(source).digest('hex'),behaviorHashes,routes:unique,requires:{serverLogout:unique.some(r=>r.method==='POST'&&r.path==='/auth/logout'),invoiceEmailIdempotency}};
}

// Static evidence can block a release; it can never certify runtime acceptance.
export function assessProductionCompatibility(runtime,contract,{now=Date.now(),maxAgeMs=15*60*1000}={}) {
 const blockers=[];
 const observed=Date.parse(runtime?.observedAtUTC||'');
 if(!Number.isFinite(observed)||observed>now+60000||now-observed>maxAgeMs)blockers.push('PRODUCTION_BASELINE_STALE_OR_UNDATED');
 try {
  assert.ok(SHA.test(contract?.uiSourceSha)&&HASH.test(contract?.clientCodeSha256));
  assert.ok(Array.isArray(contract.routes)&&contract.routes.length>0);
  assert.ok(contract.routes.every(r=>['GET','POST','PATCH','PUT','DELETE'].includes(r.method)&&typeof r.path==='string'&&/^\/[A-Za-z0-9_:/.-]+$/.test(r.path)));
  assert.ok(typeof contract.requires?.serverLogout==='boolean'&&typeof contract.requires?.invoiceEmailIdempotency==='boolean');
  assert.equal(runtime.before.length,2);assert.deepEqual(runtime.before.map(r=>r.name),['/fleetum_backend','/fleetum_caddy']);
  assert.ok(runtime.containerIdentityUnchanged===true&&isDeepStrictEqual(runtime.before,runtime.after));
  for(const [i,c] of runtime.before.entries()){
   assert.ok(c.running===true&&HASH.test(c.id)&&/^sha256:[0-9a-f]{64}$/.test(c.imageId));
   const image=runtime.images.find(x=>x.id===c.imageId);
   assert.ok(image?.digests?.some(d=>digest(i===0?'backend':'frontend',d)));
  }
  for(const key of ['routes','controller','middleware','invoices']){
   const f=runtime.code.files[key];assert.ok(f.exists===true&&HASH.test(f.sha256)&&Number.isSafeInteger(f.bytes)&&f.bytes>0&&f.bytes<=524288);
  }
  assert.ok(Array.isArray(runtime.code.routes)&&runtime.code.routes.length>0);
 } catch {blockers.push('PRODUCTION_BASELINE_UNVERIFIED');}
 const actual=new Set((runtime?.code?.routes||[]).filter(r=>typeof r.path==='string').map(r=>r.method+' '+normalize(r.path)));
 const missingRoutes=(contract?.routes||[]).filter(r=>!actual.has(r.method+' '+r.path));
 if(missingRoutes.length)blockers.push('REQUIRED_PLATFORM_ROUTES_MISSING');
 const c=runtime?.code?.capabilities||{};
 if(contract?.requires?.serverLogout&&!(c.logoutRoute===true&&c.sessionService===true&&c.revocationCheck===true&&runtime?.code?.files?.session?.exists===true&&HASH.test(runtime.code.files.session.sha256||'')))blockers.push('PLATFORM_LOGOUT_UNSUPPORTED');
 if(contract?.requires?.invoiceEmailIdempotency&&!(c.invoiceRequestStore===true&&c.invoiceIdempotencyKey===true))blockers.push('INVOICE_EMAIL_IDEMPOTENCY_UNSUPPORTED');
 return {schemaVersion:1,uiSourceSha:contract?.uiSourceSha,observedAtUTC:runtime?.observedAtUTC,status:blockers.length?'blocked':'runtime-validation-required',staticCompatible:blockers.length===0,readyForDeploy:false,proofLevel:'read-only static contract evidence; no authenticated workflow, database or provider test',blockers,missingRoutes};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try {
  const {values}=parseArgs({options:{runtime:{type:'string'},'ui-ref':{type:'string'},out:{type:'string'}}});
  assert.ok(SHA.test(values['ui-ref']||'')&&values.runtime&&values.out,'Expected --runtime, --ui-ref and --out');
  assert.notEqual(path.resolve(values.runtime),path.resolve(values.out),'Output cannot replace evidence');
  const raw=readFileSync(values.runtime);assert.ok(raw.length<=1024*1024,'Runtime evidence too large');
  const source=execFileSync('git',['show',`${values['ui-ref']}:frontend/src/application/usecases/platform/platform-admin-usecases.ts`],{encoding:'utf8',maxBuffer:1024*1024});
  const contract=inspectClientContract(source,{uiSourceSha:values['ui-ref']});
  const assessment=assessProductionCompatibility(JSON.parse(raw),contract);
  writeFileSync(values.out,JSON.stringify({contract,assessment},null,2)+'\n',{mode:0o600,flag:'wx'});
  console.log(JSON.stringify(assessment));process.exitCode=assessment.staticCompatible?0:2;
 } catch {console.error('Production compatibility evidence is invalid or incomplete. No deployment is authorized.');process.exitCode=1;}
}
