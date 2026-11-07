import * as operationFeedback from "../src/application/stores/operation-feedback";
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as guards from '../src/presentation/pages/shared/generic-crud-guards';
import {validateReportPeriod,reportDelta} from '../src/presentation/pages/stats/stats-presentation';
import {translateText,reverseTranslateText} from '../src/presentation/i18n/fleetum-language';
function harness(kind:'stats'|'directory',permissions:string[]=[],features=true){
 const file=kind==='stats'?'stats/stats-page.tsx':'shared/generic-crud-page.tsx';
 let source=readFileSync(new URL('../src/presentation/pages/'+file,import.meta.url),'utf8');
 const parsed=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
 const declaration=parsed.statements.filter(ts.isVariableStatement).flatMap(s=>[...s.declarationList.declarations]).find(d=>d.name.getText(parsed)===(kind==='stats'?'StatsPage':'GenericCrudPage'))!;
 const body=(declaration.initializer as import('typescript').ArrowFunction).body as import('typescript').Block;
 const ret=body.statements.filter(ts.isReturnStatement).at(-1)!;const pos=ret.getFullStart();
 source=source.slice(0,pos)+`\nexpose({${kind==='stats'?'applyFilters,setDraftFilters,downloadXlsx,downloadVehicleProfitability,filters':'load,onSubmit,onDelete'}});`+source.slice(pos);
 const states:any[]=[],refs:any[]=[],loaders:any[]=[],pending:any[]=[];let index=0,refIndex=0,functions:any;
 const api=new Proxy({},{get:(_,method)=>(...args:any[])=>new Promise((resolve,reject)=>pending.push({method,args,resolve,reject}))});
 const exports:any={};
 runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Date,Intl,console,URL,URLSearchParams,Promise,expose:(f:any)=>functions=f,window:{setTimeout:()=>0,clearTimeout:()=>{}},document:{getElementById:()=>({focus(){}})},require(id:string){
 if(id.endsWith('operation-feedback'))return operationFeedback;
  if(id==='react')return{...React,useId:()=> 'synthetic-id',useState:(value:any)=>{const i=index++;if(!(i in states))states[i]=typeof value==='function'?value():value;return[states[i],(v:any)=>states[i]=typeof v==='function'?v(states[i]):v]},useEffect:()=>{},useRef:(v:any)=>{const i=refIndex++;return refs[i]??(refs[i]={current:v})},useCallback:(f:any)=>f,useMemo:(f:any)=>f()};
 if(id==='react/jsx-runtime')return{jsx:(type:any,props:any)=>({type,props}),jsxs:(type:any,props:any)=>({type,props}),Fragment:'Fragment'};
 if(id.endsWith('lib/utils'))return{cn:(...args:any[])=>args.join(' ')};
 if(id==='react-router-dom')return{useLocation:()=>({search:''})};
 if(id.endsWith('auth-store'))return{useAuthStore:(fn:any)=>fn({user:{id:'qa',tenantId:'synthetic',permissions}})};
 if(id.endsWith('use-entitlements'))return{useEntitlements:()=>({can:()=>features})};
 if(id.endsWith('use-async'))return{useAsync:(fn:any)=>{loaders.push(fn);return{data:null,loading:true,error:null}}};
 if(id.endsWith('generic-crud-guards'))return guards;
 if(id.endsWith('master-data-usecases'))return{masterDataUseCases:api};if(id.endsWith('stats-usecases'))return{statsUseCases:api};
 if(id.endsWith('stats-presentation'))return requireActualStats();
 if(id.endsWith('use-panel-motion'))return{usePanelMotion:()=>{}};
 return new Proxy({},{get:(_,key)=>key==='stoppageStatusLabel'?{}:key==='useAccessibleDialog'?()=>({dialogRef:{current:null},rememberOpener(){},onKeyDown(){}}):key==='usePanelMotion'?()=>{}:String(key)});
 }});
 function requireActualStats(){const module:any={exports:{}};runInNewContext(ts.transpileModule(readFileSync(new URL('../src/presentation/pages/stats/stats-presentation.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:module.exports,Date,Number,URL,document:{createElement:()=>({click(){},remove(){}}),body:{append(){}}},window:{setTimeout(){}}});return module.exports}
 const props={scope:'sites',title:'Sedi',fields:[{key:'name',label:'Nome'}],list:api.list,create:api.create,update:api.update,remove:api.remove};
 const render=()=>{index=0;refIndex=0;loaders.length=0;exports[kind==='stats'?'StatsPage':'GenericCrudPage'](props)};render();return{get functions(){return functions},pending,loaders,render};
}
test('directory does not request protected data without read permission',async()=>{const h=harness('directory');const p=h.functions.load(1,'');assert.equal(h.pending.length,0);await p});
test('statistics does not request protected data without stats read',()=>{const h=harness('stats');h.loaders.forEach(fn=>void fn());assert.equal(h.pending.length,0)});
test('invalid report period is rejected without changing the applied period',()=>{const h=harness('stats',['*']);const before=h.functions.filters;h.functions.setDraftFilters({...before,dateFrom:'',dateTo:'2026-10-24'});h.render();h.functions.applyFilters();h.render();assert.equal(h.functions.filters.dateFrom,before.dateFrom)});
test('inverted report period is rejected without changing the applied period',()=>{const h=harness('stats',['*']);const before=h.functions.filters;h.functions.setDraftFilters({...before,dateFrom:'2026-10-25',dateTo:'2026-10-01'});h.render();h.functions.applyFilters();h.render();assert.equal(h.functions.filters.dateFrom,before.dateFrom)});
test('read-only role cannot trigger report downloads',async()=>{const h=harness('stats',['stats:read']);const a=h.functions.downloadXlsx(),b=h.functions.downloadVehicleProfitability('pdf');assert.equal(h.pending.length,0);await a;await b});
test('export feature is required for profitability downloads',async()=>{const h=harness('stats',['*'],false);const p=h.functions.downloadVehicleProfitability('pdf');assert.equal(h.pending.length,0);await p});
test('concurrent report downloads issue one request and failures are handled',async()=>{const h=harness('stats',['*']);const first=h.functions.downloadXlsx();const second=h.functions.downloadXlsx();assert.equal(h.pending.length,1);h.pending[0].reject(Error('Synthetic unavailable'));await first;await second});

test('date validation rejects impossible dates and permits same-day periods',()=>{assert.deepEqual(validateReportPeriod('2026-10-24','2026-10-24'),{});assert.ok(validateReportPeriod('2026-02-30','2026-03-02').dateFrom);assert.ok(validateReportPeriod('2026-10-24','').dateTo)});
test('delta from zero is unavailable rather than an invented 100 percent',()=>{assert.equal(reportDelta(5,0),null);assert.equal(reportDelta(0,0),0);assert.equal(reportDelta(5,10),-50);assert.equal(reportDelta(NaN,10),null)});
test('read-only directory does not submit mutations',async()=>{const h=harness('directory',['sites:read']);await h.functions.onSubmit({preventDefault(){}});await h.functions.onDelete();assert.equal(h.pending.length,0)});
test('report selectors include reference data beyond the first 200 entries',async()=>{const h=harness('stats',['*']);const load=h.loaders[0]();assert.equal(h.pending.length,3);h.pending[0].resolve({data:Array.from({length:200},(_,i)=>({id:'site-'+i})),total:201});h.pending[1].resolve({data:[],total:0});h.pending[2].resolve({data:[],total:0});await new Promise(resolve=>setImmediate(resolve));assert.equal(h.pending[3].args[0].page,2);h.pending[3].resolve({data:[{id:'site-201'}],total:201});const result=await load;assert.equal(result.results[0].value.data.length,201)});
test('directory and report labels translate without rewriting record names',()=>{for(const value of ['Statistiche e report','Periodo e filtri','Cerca per nome o città','Qualità dei dati e investimento'])assert.notEqual(translateText(value,'en'),value);const value='Apri anagrafica Officina QA 1';assert.equal(translateText(value,'en'),'Open directory record Officina QA 1');assert.equal(reverseTranslateText('Open directory record Officina QA 1'),value);assert.equal(translateText('B08 oficina QA','en'),'B08 oficina QA')});

test('directory commands do not shadow existing customer labels',()=>{assert.equal(translateText('Apri anagrafica cliente Mario QA','en'),'Open customer Mario QA');assert.equal(reverseTranslateText('Open customer Mario QA'),'Apri anagrafica cliente Mario QA');assert.equal(translateText('20 di 231','en'),'20 of 231')});
