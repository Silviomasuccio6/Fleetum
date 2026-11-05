import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as React from 'react';

function pageHarness(kind: 'contracts' | 'pricing', permissions = ['*'], initial:Record<number,any> = {}) {
 const file = kind === 'contracts' ? 'contracts/rental-contracts-page' : 'pricing/rental-pricing-page';
 let source = readFileSync(new URL('../src/presentation/pages/' + file + '.tsx', import.meta.url), 'utf8');
 const exposed = kind === 'contracts' ? 'loadContracts,runMarkSigned,runSendEmail,runSendWhatsapp' : 'loadLists,loadListDetails,selectList,toDateInput';
 const guard=source.indexOf('  if(!canRead)return <section');
 const at = guard>=0?guard:source.lastIndexOf('  return ('); assert.ok(at >= 0);
 source = source.slice(0, at) + `  expose({${exposed}});\n` + source.slice(at);
 const initialStates=initial;
 const states: any[] = [], pending: Array<{method:string;args:any[];resolve:(x:any)=>void;reject:(e:Error)=>void}> = [];
 let functions:any, stateIndex = 0;
 const api = new Proxy({}, { get: (_, method:string) => (...args:any[]) => new Promise((resolve,reject)=>pending.push({method,args,resolve,reject})) });
 const compiled = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const exports:any = {};
 runInNewContext(compiled, {exports, Date, Intl, URLSearchParams, console, expose:(value:any)=>{functions=value;}, require(id:string){
  if(id==='react')return {...React,useState:(initial:any)=>{const i=stateIndex++;states[i]=i in initialStates?initialStates[i]:typeof initial==='function'?initial():initial;return[states[i],(next:any)=>{states[i]=typeof next==='function'?next(states[i]):next}]},useRef:(initial:any)=>({current:initial}),useMemo:(fn:any)=>fn(),useCallback:(fn:any)=>fn,useEffect:()=>{}};
  if(id==='react/jsx-runtime')return {jsx:(type:any,props:any)=>({type,props}),jsxs:(type:any,props:any)=>({type,props}),Fragment:'Fragment'};
  if(id==='react-router-dom')return {useNavigate:()=>()=>{}};
  if(id.endsWith('auth-store'))return {useAuthStore:(fn:any)=>fn({user:{permissions}})};
  if(id.endsWith('rental-bookings-usecases'))return {rentalBookingsUseCases:api};
  if(id.endsWith('master-data-usecases'))return {masterDataUseCases:api};
  return new Proxy({},{get:(_,key)=>String(key)});
 }});
 exports[kind==='contracts'?'RentalContractsPage':'RentalPricingPage']();
 return {functions,states,pending};
}
test('a late contracts response cannot replace a newer filtered list',async()=>{
 const h=pageHarness('contracts');const old=h.functions.loadContracts(1),current=h.functions.loadContracts(2);
 h.pending[1].resolve({data:[{id:'new'}],timeline:[],kpis:{},total:1});await current;
 h.pending[0].resolve({data:[{id:'old'}],timeline:[],kpis:{},total:90});await old;
 assert.equal(h.states[0][0].id,'new');
});
test('a late pricing response cannot replace a newer search',async()=>{
 const h=pageHarness('pricing');const old=h.functions.loadLists(),current=h.functions.loadLists();
 h.pending[1].resolve({data:[{id:'new'}]});await current;h.pending[0].resolve({data:[{id:'old'}]});await old;
 assert.equal(h.states[2][0].id,'new');
});
test('packages and policies from a prior selection cannot attach to the current price list',async()=>{
 const h=pageHarness('pricing');const a={id:'a',name:'A',scope:'GLOBAL'},b={id:'b',name:'B',scope:'GLOBAL'};
 h.functions.selectList(a);const old=h.functions.loadListDetails('a');h.functions.selectList(b);const current=h.functions.loadListDetails('b');
 h.pending[2].resolve({data:[{id:'package-b'}]});h.pending[3].resolve({data:[{id:'policy-b'}]});await current;
 h.pending[0].resolve({data:[{id:'package-a'}]});h.pending[1].resolve({data:[{id:'policy-a'}]});await old;
 assert.equal(h.states[4][0].id,'package-b');assert.equal(h.states[5][0].id,'policy-b');
});
test('contracts and pricing make no read request without the server-matching read permission',async()=>{
 for(const kind of ['contracts','pricing'] as const){const h=pageHarness(kind,[]);const result=kind==='contracts'?h.functions.loadContracts(1):h.functions.loadLists();assert.equal(h.pending.length,0);await result;}
});
test('editing a validity date preserves the local calendar day',()=>{
 const h=pageHarness('pricing');const date=new Date(2026,9,23,0,0,0);assert.equal(h.functions.toDateInput(date.toISOString()),'2026-10-23');
});

test('reopening the same price list reloads its packages and policies',async()=>{
 const h=pageHarness('pricing',['*'],{3:'same'});h.functions.selectList({id:'same',name:'Same',scope:'GLOBAL'});
 assert.equal(h.pending.length,2);assert.deepEqual(h.pending.map(x=>x.method),['listPricePackages','listExtraKmPolicies']);
 h.pending[0].resolve({data:[{id:'fresh-package'}]});h.pending[1].resolve({data:[{id:'fresh-policy'}]});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.states[4][0].id,'fresh-package');assert.equal(h.states[5][0].id,'fresh-policy');
});
test('a failed signature remains a failed operation and can be retried',async()=>{
 const h=pageHarness('contracts');const row={id:'contract',bookingId:'booking',booking:{code:'QA'},status:'READY'};
 const result=h.functions.runMarkSigned(row,'data:image/png;base64,synthetic');h.pending[0].reject(new Error('Temporary failure'));
 assert.equal(await result,false);assert.equal(h.pending.length,1);
});
test('read-only contract roles cannot invoke email, WhatsApp or signature mutations',async()=>{
 const h=pageHarness('contracts',['vehicles:read']);for(const name of ['runSendEmail','runSendWhatsapp','runMarkSigned'])await h.functions[name]({id:'contract',bookingId:'booking'});
 assert.equal(h.pending.length,0);
});
