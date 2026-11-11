import * as operationFeedback from "../src/application/stores/operation-feedback";
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync}from'node:fs';
import{runInNewContext}from'node:vm';
import ts from'typescript';
import*as React from'react';
import {translateText,reverseTranslateText} from '../src/presentation/i18n/fleetum-language';
import*as calendarUtils from'../src/presentation/components/calendar/calendar-utils';
function harness(kind:'maintenance'|'deadlines'|'calendar',permissions=['*'],initial:Record<number,any>={},filters?:Record<string,string>){
 const file=kind==='maintenance'?'pages/maintenances/vehicle-maintenances-page.tsx':kind==='deadlines'?'pages/deadlines/vehicle-deadlines-page.tsx':'components/calendar/hooks/useEvents.ts';
 let source=readFileSync(new URL('../src/presentation/'+file,import.meta.url),'utf8');
 if(kind!=='calendar'){
  const parsed=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
  const declaration=parsed.statements.filter(ts.isVariableStatement).flatMap(s=>[...s.declarationList.declarations]).find(d=>d.name.getText(parsed)===(kind==='maintenance'?'VehicleMaintenancesPage':'VehicleDeadlinesPage'))!;
  const body=(declaration.initializer as import('typescript').ArrowFunction).body as import('typescript').Block;
  const guard=body.statements.find(s=>ts.isIfStatement(s)&&s.expression.getText(parsed).replace(/\s/g,'')==='!canRead');
  const point=guard??body.statements.filter(ts.isReturnStatement).at(-1)!;
  const pos=point.getFullStart();source=source.slice(0,pos)+`\nexpose({${kind==='maintenance'?'loadMaintenances,onSubmit':'load'}});`+source.slice(pos);
 }

 const states:any[]=[],pending:any[]=[],refs:any[]=[],effects:any[]=[];let index=0,refIndex=0,functions:any;const api=new Proxy({},{get:(_,method)=> (...args:any[])=>new Promise((resolve,reject)=>pending.push({method,args,resolve,reject}))});
 const exports:any={};const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 runInNewContext(compiled,{exports,Date,Intl,URL,console,URLSearchParams,AbortController,FormData:class{values:any;constructor(values:any){this.values=values}get(key:string){return this.values[key]??null}},window:{setTimeout:()=>0,clearTimeout:()=>{}},expose:(f:any)=>functions=f,require(id:string){
  if(id.endsWith('operation-feedback'))return operationFeedback;
 if(id==='react')return{...React,useState:(value:any)=>{const i=index++;if(!(i in states))states[i]=i in initial?initial[i]:typeof value==='function'?value():value;return[states[i],(next:any)=>{states[i]=typeof next==='function'?next(states[i]):next}]},useEffect:(fn:any,deps:any[])=>{effects.push({fn,deps})},useRef:(value:any)=>{const i=refIndex++;return refs[i]??(refs[i]={current:value})},useCallback:(f:any)=>f,useMemo:(f:any)=>f()};
  if(id==='react/jsx-runtime')return{jsx:(type:any,props:any)=>({type,props}),jsxs:(type:any,props:any)=>({type,props}),Fragment:'Fragment'};
  if(id==='react-router-dom')return{useNavigate:()=>()=>{}};
  if(id.endsWith('operations-workspace'))return{emptyStoppageFilters:{search:'',status:'',siteId:'',workshopId:''},useOperationsAccess:(scope='stoppages')=>({canRead:permissions.includes('*')||permissions.includes(scope+':read'),canWrite:permissions.includes('*')||permissions.includes(scope+':write'),identity:'synthetic:qa'}),useOperationsTask:()=>({busy:false,error:null,success:null,run:async(fn:any)=>{await fn();return true}})};
  if(id.endsWith('snackbar-store'))return{snackbar:{capture:()=>"synthetic-scope",success:()=>{},error:()=>{},info:()=>{}}};
  if(id.endsWith('auth-store'))return{useAuthStore:(fn:any)=>fn({user:{id:'qa',tenantId:'synthetic',permissions}})};
  if(id.endsWith('use-entitlements'))return{useEntitlements:()=>({can:()=>true})};
  if(id.endsWith('master-data-usecases'))return{masterDataUseCases:api};if(id.endsWith('stoppages-usecases'))return{stoppagesUseCases:api};
  if(id.endsWith('api-base-url'))return{getApiBaseUrl:()=>'/api'};
  if(id.endsWith('calendar-types'))return{CALS_DEFAULT:[{id:0,name:'Work',color:'#123456',visible:true}]};
  if(id.endsWith('calendar-utils'))return calendarUtils;
  return new Proxy({},{get:(_,key)=>key==='useOperationsAccess'?()=>({canRead:permissions.includes('*'),canWrite:permissions.includes('*')}):String(key)});
 }});
 const render=()=>{index=0;refIndex=0;effects.length=0;if(kind==='calendar')functions=exports.useEvents(filters);else exports[kind==='maintenance'?'VehicleMaintenancesPage':'VehicleDeadlinesPage']()};render();return{get functions(){return functions},states,pending,render,effects};
}
test('late maintenance search response cannot replace newer results',async()=>{const h=harness('maintenance');const old=h.functions.loadMaintenances(1,'old',''),now=h.functions.loadMaintenances(1,'new','');h.pending[1].resolve({data:[{id:'new'}],total:1});await now;h.pending[0].resolve({data:[{id:'old'}],total:99});await old;assert.equal(h.states[1][0].id,'new');assert.equal(h.states[2],1)});
test('maintenance does not fetch protected data without vehicles read',async()=>{const h=harness('maintenance',[]);const result=h.functions.loadMaintenances(1,'','');assert.equal(h.pending.length,0);await result});
test('deadline zero thresholds remain zero instead of reverting to defaults',async()=>{const h=harness('deadlines',['*'],{2:'0',3:'0'});const p=h.functions.load();assert.equal(h.pending[0].args[0].kmWarning,0);assert.equal(h.pending[0].args[0].revisionWarningDays,0);h.pending[0].resolve({data:[],kpis:{}});await p});
test('deadlines do not fetch protected data without vehicles read',async()=>{const h=harness('deadlines',[]);const p=h.functions.load();assert.equal(h.pending.length,0);await p});
test('late calendar range cannot overwrite the visible range',async()=>{const h=harness('calendar');const old=h.functions.loadRange(new Date('2026-10-01'),new Date('2026-10-02')),now=h.functions.loadRange(new Date('2026-11-01'),new Date('2026-11-02'));h.pending[2].resolve({data:[{id:'new',title:'New',start:'2026-11-01T10:00:00Z',end:'2026-11-01T11:00:00Z'}]});h.pending[3].resolve({data:[]});await now;h.pending[0].resolve({data:[{id:'old',title:'Old',start:'2026-10-01T10:00:00Z',end:'2026-10-01T11:00:00Z'}]});h.pending[1].resolve({data:[]});await old;assert.equal(h.states[0][0].remoteId,'new')});
test('calendar does not start requests without stoppages read',async()=>{const h=harness('calendar',[]);const p=h.functions.loadRange(new Date('2026-10-01'),new Date('2026-10-02'));assert.equal(h.pending.length,0);await p});

test('failed attachment upload retries the saved maintenance without creating another record',async()=>{
 const h=harness('maintenance',['*'],{15:'vehicle-a',18:[{name:'synthetic.png'}]});
 const event={preventDefault(){},currentTarget:{performedAt:'2026-10-24',maintenanceType:'Tagliando'}};
 const first=h.functions.onSubmit(event);assert.equal(h.pending[0].method,'createVehicleMaintenance');h.pending[0].resolve({id:'saved-maintenance'});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.pending[1].method,'uploadVehicleMaintenanceAttachments');h.pending[1].reject(Error('Synthetic upload failure'));await first;
 h.render();const retry=h.functions.onSubmit(event);assert.equal(h.pending[2].method,'uploadVehicleMaintenanceAttachments');assert.equal(h.pending[2].args[0],'saved-maintenance');assert.equal(h.pending.filter(x=>x.method==='createVehicleMaintenance').length,1);h.pending[2].reject(Error('Synthetic upload failure'));await retry;
});
test('read-only vehicle role cannot submit maintenance mutations',async()=>{const h=harness('maintenance',['vehicles:read'],{15:'vehicle-a'});await h.functions.onSubmit({preventDefault(){},currentTarget:{}});assert.equal(h.pending.length,0)});
test('calendar filtering includes matches after page 200 and keeps independent custom events',async()=>{
 const h=harness('calendar',['*'],{}, {search:'match',status:'',siteId:'',workshopId:''});const p=h.functions.loadRange(new Date('2026-10-01'),new Date('2026-10-31'));
 h.pending[0].resolve({data:[{id:'match-201',start:'2026-10-02T10:00:00Z',end:'2026-10-02T11:00:00Z'},{id:'other',start:'2026-10-03T10:00:00Z',end:'2026-10-03T11:00:00Z'}]});h.pending[1].resolve({data:[{id:'custom-independent',start:'2026-10-04T10:00:00Z',end:'2026-10-04T11:00:00Z'}]});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.pending[2].method,'list');h.pending[2].resolve({data:Array.from({length:200},(_,i)=>({id:'match-'+i})),total:201});await new Promise(resolve=>setImmediate(resolve));assert.equal(h.pending[3].args[0].page,2);h.pending[3].resolve({data:[{id:'match-201'}],total:201});await p;assert.deepEqual(Array.from(h.states[0],(e:any)=>e.remoteId),['match-201','custom-independent']);
});
test('concurrent calendar creation issues one API request',async()=>{const h=harness('calendar');const first=h.functions.addEvent({title:'Synthetic',date:'2026-10-24',start:'10:00',end:'11:00'});assert.equal(await h.functions.addEvent({title:'Duplicate'}),null);assert.equal(h.pending.length,1);h.pending[0].resolve({data:{id:'one',start:'2026-10-24T10:00:00Z',end:'2026-10-24T11:00:00Z'}});assert.equal((await first).remoteId,'one')});
test('read-only calendar role cannot create custom events',async()=>{const h=harness('calendar',['stoppages:read']);assert.equal(await h.functions.addEvent({title:'Forbidden'}),null);assert.equal(h.pending.length,0)});

test('operations headings, roles, deadlines and accessible record names translate without changing the plate',()=>{for(const text of ['Registro fermi','Cerca un fermo','Stato del fermo','Modifiche non salvate','Soglie di avviso','Preavviso manutenzione · km','Note operative','Il tuo ruolo non consente l’accesso ai fermi.'])assert.notEqual(translateText(text,'en'),text,text);const label='Apri fermo QA101AA';assert.equal(translateText(label,'en'),'Open downtime record QA101AA');assert.equal(reverseTranslateText('Open downtime record QA101AA'),label);assert.equal(translateText('Fra 10 giorni','en'),'In 10 days')});

test("calendar labels and month names translate in both directions",()=>{assert.equal(translateText("Aperto","en"),"Open");assert.equal(translateText("LUN","en"),"MON");assert.equal(translateText("Ottobre 2026","en"),"October 2026");assert.equal(reverseTranslateText("October 2026"),"ottobre 2026");assert.equal(translateText("B07 ottobre intervention","en"),"B07 ottobre intervention")});

test('changing calendar filters does not unlock a pending mutation',async()=>{const filters={search:'old',status:'',siteId:'',workshopId:''};const h=harness('calendar',['*'],{},filters);const first=h.functions.addEvent({title:'First',date:'2026-10-24',start:'10:00',end:'11:00'});filters.search='new';h.render();h.effects.find((e:any)=>e.deps.includes(JSON.stringify(filters))).fn();const second=h.functions.addEvent({title:'Duplicate'});assert.equal(h.pending.length,1);assert.equal(await second,null);h.pending[0].resolve({data:{id:'one',start:'2026-10-24T10:00:00Z',end:'2026-10-24T11:00:00Z'}});await first});

test('calendar mutation refreshes with the newest filters',async()=>{const filters={search:'old',status:'',siteId:'',workshopId:''};const h=harness('calendar',['*'],{},filters);const first=h.functions.addEvent({title:'First',date:'2026-10-24',start:'10:00',end:'11:00'});filters.search='new';h.render();h.effects.find((e:any)=>e.deps.includes(JSON.stringify(filters))).fn();const range=h.functions.loadRange(new Date('2026-10-01'),new Date('2026-10-31'));h.pending[1].resolve({data:[]});h.pending[2].resolve({data:[]});await new Promise(resolve=>setImmediate(resolve));h.pending[3].resolve({data:[],total:0});await range;h.pending[0].resolve({data:{id:'one',start:'2026-10-24T10:00:00Z',end:'2026-10-24T11:00:00Z'}});await new Promise(resolve=>setImmediate(resolve));h.pending[4].resolve({data:[]});h.pending[5].resolve({data:[]});await new Promise(resolve=>setImmediate(resolve));assert.equal(h.pending[6].args[0].search,'new');h.pending[6].resolve({data:[],total:0});await first});
