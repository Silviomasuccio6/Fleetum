import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import {translateText,reverseTranslateText} from '../src/presentation/i18n/fleetum-language';
// Synthetic-only fixture; no external account or real authentication credential.
const QA_PASSWORD = ['Synthetic', 'Strong', '22'].join('-');
function harness(kind:'forgot'|'reset'|'invite'|'signup', options:{token?:string;analyticsThrows?:boolean}={}) {
 const files={forgot:'forgot-password-page',reset:'reset-password-page',invite:'accept-invite-page',signup:'signup-page'};
 const names={forgot:'ForgotPasswordPage',reset:'ResetPasswordPage',invite:'AcceptInvitePage',signup:'SignupPage'};
 const root=new URL('../src/presentation/pages/auth/',import.meta.url);
 let source=readFileSync(process.env.B10_BASELINE ? new URL('file://'+process.env.B10_BASELINE+'/frontend/src/presentation/pages/auth/'+files[kind]+'.tsx') : new URL(files[kind]+'.tsx',root),'utf8').replaceAll('import.meta.env','({})');
 const ast=ts.createSourceFile('page.tsx',source,ts.ScriptTarget.Latest,true);
 const declaration=ast.statements.filter(ts.isVariableStatement).flatMap(s=>[...s.declarationList.declarations]).find(d=>d.name.getText(ast)===names[kind])!;
 const body=(declaration.initializer as import('typescript').ArrowFunction).body as import('typescript').Block;
 const ret=body.statements.filter(ts.isReturnStatement).at(-1)!;
 const namesToExpose=kind==='signup'?'onSubmit,setForm,setCurrentStep,setPrivacyAccepted,tenantId,error':'onSubmit,message,error';
 source=source.slice(0,ret.getFullStart())+'\nexpose({'+namesToExpose+'});'+source.slice(ret.getFullStart());
 let index=0,refIndex=0,functions:any,tree:any;const states:any[]=[],refs:any[]=[],effects:any[]=[],pending:any[]=[],timers:any[]=[],destinations:any[]=[],sessions:any[]=[];
 const fields:Record<string,string>={email:'qa@fleetum-qa.invalid',firstName:'Synthetic',lastName:'Member',password:QA_PASSWORD,confirmPassword:QA_PASSWORD};
 const api=new Proxy({},{get:(_,method)=>(...args:any[])=>new Promise((resolve,reject)=>pending.push({method,args,resolve,reject}))});
 const browser={location:new URL('https://qa.invalid/'+files[kind]+'?next=%2Fbooking'),history:{state:{},replaceState(){}},matchMedia:()=>({matches:false}),requestAnimationFrame:(f:any)=>f(),addEventListener(){},removeEventListener(){}};
 const load=(src:string):any=>{const exports:any={};runInNewContext(ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,URL,URLSearchParams,Promise,console,window:browser,document:{getElementById:()=>({focus(){}}),documentElement:{getAttribute:()=>null,setAttribute(){},removeAttribute(){}}},setTimeout:(f:any)=>{timers.push(f);return timers.length},clearTimeout(){},FormData:class{get(k:string){return fields[k]}},expose:(f:any)=>functions=f,require(id:string){
  if(id==='react')return{...React,useId:()=> 'qa-id',useState:(value:any)=>{const i=index++;if(!(i in states))states[i]=typeof value==='function'?value():value;return[states[i],(v:any)=>states[i]=typeof v==='function'?v(states[i]):v]},useEffect:(f:any)=>effects.push(f),useRef:(v:any)=>{const i=refIndex++;return refs[i]??(refs[i]={current:v})},useMemo:(f:any)=>f(),useCallback:(f:any)=>f};
  if(id==='react/jsx-runtime')return{jsx:(type:any,props:any)=>({type,props}),jsxs:(type:any,props:any)=>({type,props}),Fragment:'Fragment'};
  if(id==='react-router-dom')return{useNavigate:()=> (path:any)=>destinations.push(path),useSearchParams:()=>[new URLSearchParams({token:options.token??'synthetic-token-00000000'})],useLocation:()=>({search:browser.location.search})};
  if(id.endsWith('auth-usecases'))return{authUseCases:api};if(id.endsWith('tenant-profile-usecases'))return{tenantProfileUseCases:api};
  if(id.endsWith('auth-store'))return{useAuthStore:(fn:any)=>fn({setSession:(u:any)=>sessions.push(u)})};
  if(id.endsWith('public-analytics-usecases'))return{trackPublicEvent(){if(options.analyticsThrows)throw Error('Synthetic unavailable analytics')}};
  if(id.endsWith('api-base-url'))return{getApiBaseUrl:()=> 'https://qa.invalid/api'};
  if(id.endsWith('company-registration'))return{validateCompanyRegistrationDraft:()=>[],normalizeVatNumberForCountry:(v:any)=>v,normalizeItalianVatNumber:(v:any)=>v,normalizeTaxCode:(v:any)=>v,normalizeSdiCode:(v:any)=>v,normalizePostalCodeForCountry:(v:any)=>v};
  if(id.endsWith('countries'))return{COUNTRIES:[]};
  if(id.endsWith('access-flow'))return load(readFileSync(new URL('access-flow.ts',root),'utf8'));
  if(id.endsWith('safe-return-to'))return load(readFileSync(new URL('../../routes/safe-return-to.ts',root),'utf8'));
  return new Proxy({},{get:(_,key)=>String(key)});
 }});return exports};
 const exports=load(source);const render=()=>{index=0;refIndex=0;tree=exports[names[kind]]()};render();
 return{get functions(){return functions},get tree(){return tree},pending,timers,destinations,sessions,fields,effects,render};
}
const submit=()=>({preventDefault(){},currentTarget:{reset(){}}});
const forms=(tree:any):number=>!tree||typeof tree!=='object'?0:(tree.type==='form'?1:0)+[tree.props?.children].flat(Infinity).reduce((n:number,c:any)=>n+forms(c),0);
test('recovery serializes requests before the next React render',async()=>{const h=harness('forgot');const a=h.functions.onSubmit(submit()),b=h.functions.onSubmit(submit());assert.equal(h.pending.length,1);h.pending[0].reject(Error('Synthetic unavailable'));await a;await b});
test('reset serializes token consumption requests',async()=>{const h=harness('reset');const a=h.functions.onSubmit(submit()),b=h.functions.onSubmit(submit());assert.equal(h.pending.length,1);h.pending[0].reject(Error('Synthetic unavailable'));await a;await b});
test('invite serializes account activation requests',async()=>{const h=harness('invite');const a=h.functions.onSubmit(submit()),b=h.functions.onSubmit(submit());assert.equal(h.pending.length,1);h.pending[0].reject(Error('Synthetic unavailable'));await a;await b});
test('missing reset token does not show a usable password form',()=>{const h=harness('reset',{token:''});assert.equal(forms(h.tree),0)});
test('reset rejects a mismatched confirmation without sending a request',async()=>{const h=harness('reset');h.fields.confirmPassword='Different';const p=h.functions.onSubmit(submit());assert.equal(h.pending.length,0);await p});
test('reset success gives time to read the result and prevents replay',async()=>{const h=harness('reset');const a=h.functions.onSubmit(submit());h.pending[0].resolve({updated:true});await a;assert.equal(h.timers.length,0);const b=h.functions.onSubmit(submit());assert.equal(h.pending.length,1);await b});
function readySignup(h:ReturnType<typeof harness>){h.functions.setCurrentStep(2);h.functions.setPrivacyAccepted(true);h.functions.setForm((f:any)=>({...f,tenantName:'Synthetic Mobility',firstName:'Synthetic',lastName:'Member',email:'member@fleetum-qa.invalid',password:QA_PASSWORD,chamberOfCommerceFile:{name:'synthetic.pdf'}}));h.render()}
test('signup failure after optional document upload retains the created account',async()=>{const h=harness('signup');readySignup(h);const p=h.functions.onSubmit(submit());h.pending[0].resolve({tenantId:'synthetic-created',user:{id:'synthetic-user'}});await new Promise(r=>setImmediate(r));h.pending[1].reject(Error('Synthetic document failure'));await p;h.render();assert.equal(h.functions.tenantId,'synthetic-created');assert.equal(h.sessions.length,1);await h.functions.onSubmit(submit());assert.equal(h.pending.length,2)});
test('signup creation is locked synchronously across duplicate submits',async()=>{const h=harness('signup');readySignup(h);const a=h.functions.onSubmit(submit()),b=h.functions.onSubmit(submit());assert.equal(h.pending.length,1);h.pending[0].reject(Error('Synthetic unavailable'));await a;await b});

test('pressing Enter on an earlier signup step does not create an account',async()=>{const h=harness('signup');readySignup(h);h.functions.setCurrentStep(0);h.render();const p=h.functions.onSubmit(submit());assert.equal(h.pending.length,0);await p});
test('analytics failure cannot interrupt a successfully created signup',async()=>{const h=harness('signup',{analyticsThrows:true});readySignup(h);h.functions.setForm((form:any)=>({...form,chamberOfCommerceFile:null}));h.render();const p=h.functions.onSubmit(submit());h.pending[0].resolve({tenantId:'synthetic-created',user:{id:'synthetic-user'}});await p;assert.equal(h.sessions.length,1);assert.match(h.destinations[0],/^\/activate\?welcome=billing/)});
test('a recovery response is ignored after the page is unmounted',async()=>{const h=harness('forgot');const cleanups=h.effects.map(f=>f()).filter(Boolean);const p=h.functions.onSubmit(submit());cleanups.forEach(f=>f());h.pending[0].resolve({sent:true});await p;h.render();assert.equal(h.functions.message,null)});
test('network failure during reset preserves a retryable form',async()=>{const h=harness('reset');const p=h.functions.onSubmit(submit());h.pending[0].reject(Error('Synthetic unavailable'));await p;h.render();assert.equal(forms(h.tree),1);assert.equal(h.functions.message,null);const retry=h.functions.onSubmit(submit());assert.equal(h.pending.length,2);h.pending[1].reject(Error('Synthetic unavailable'));await retry});

test('expired reset and invite links remove their forms',async()=>{for(const kind of ['reset','invite'] as const){const h=harness(kind);const p=h.functions.onSubmit(submit());h.pending[0].reject(Object.assign(Error('Synthetic expired link'),{code:kind==='reset'?'INVALID_TOKEN':'INVALID_INVITE'}));await p;h.render();assert.equal(forms(h.tree),0);await h.functions.onSubmit(submit());assert.equal(h.pending.length,1)}});
test('missing invitation token offers no activation form',()=>{assert.equal(forms(harness('invite',{token:''}).tree),0)});
test('invitation cannot activate without valid names',async()=>{const h=harness('invite');h.fields.firstName='X';await h.functions.onSubmit(submit());assert.equal(h.pending.length,0)});
test('access destinations preserve same-origin business queries across the first-access flow',()=>{const h=accessHelpers();const target='/rental-bookings/demo?tab=contract';const search='?next='+encodeURIComponent(target);assert.equal(h.getAccessDestination(search),target);assert.equal(h.getAccessLoginPath(search),'/login?next='+encodeURIComponent(target));const onboard=h.getCompanyOnboardingPath(target);assert.equal(h.getAccessDestination(new URL(onboard,'https://qa.invalid').search),target);const activation=h.getActivationPath(new URL(onboard,'https://qa.invalid').search,true);assert.equal(h.getAccessDestination(new URL(activation,'https://qa.invalid').search),target);assert.match(activation,/profile=completed/)});
test('unsafe destinations and access loops fall back to the dashboard',()=>{const h=accessHelpers();for(const path of ['https://outside.invalid/booking','//outside.invalid/x','javascript:alert(1)','/login','/LOGIN/','/%6cogin','/%E0%A4%A','/signup?next=/booking','/reset-password/child','/accept-invite','/auth/social-callback','/onboarding/azienda','/activate','/upgrade','/billing/recovery'])assert.equal(h.getAccessReturnTo(path),'/dashboard',path);assert.equal(h.getAccessLoginPath(''),'/login');assert.equal(h.getActivationPath(''),'/activate?welcome=billing')});
test('password validation matches existing backend policy and confirmation',()=>{const h=accessHelpers();for(const value of ['short','no-uppercase-123','NONUMBER!!','NOSYMBOL123'])assert.ok(h.validateAccessPassword(value,value).password);assert.deepEqual(Object.keys(h.validateAccessPassword('Valid-Password-22','Valid-Password-22')),[]);assert.ok(h.validateAccessPassword('Valid-Password-22','Other').confirmPassword)});
function accessHelpers():any{const root=new URL('../src/presentation/pages/auth/',import.meta.url);const load=(file:URL):any=>{const exports:any={};runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,URL,URLSearchParams,window:{location:new URL('https://qa.invalid/')},require:()=>load(new URL('../../routes/safe-return-to.ts',root))});return exports};return load(new URL('access-flow.ts',root))}

test('access copy returns to Italian without changing its meaning',()=>{for(const text of ['Recupera la password','Email di accesso','Accetta l’invito','Imposta la nuova password','Richiedi un nuovo collegamento','Controlla i campi evidenziati prima di continuare.']){const english=translateText(text,'en');assert.notEqual(english,text);assert.equal(reverseTranslateText(english),text)}});
test('signup progress translates and reverses as one message',()=>{for(let step=1;step<=3;step++){assert.equal(translateText(`Passaggio ${step} di 3`,'en'),`Step ${step} of 3`);assert.equal(reverseTranslateText(`Step ${step} of 3`),`Passaggio ${step} di 3`)}});
