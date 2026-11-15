import assert from "node:assert/strict";
import {afterEach,test} from "node:test";
import vm from "node:vm";
import {readFileSync} from "node:fs";
import ts from "typescript";
import {platformAdminUseCases} from "../src/application/usecases/platform/platform-admin-usecases";
import {platformAuthStorage} from "../src/infrastructure/platform/platform-auth-storage";
const originalFetch=globalThis.fetch;
afterEach(()=>{globalThis.fetch=originalFetch;platformAuthStorage.clear();});
const invoice={id:"invoice-synthetic",invoiceNumber:"QA-SYNTHETIC",status:"GENERATED"};
function callback(reply:(id:string,key:string)=>Promise<any>){
 const path=new URL('../src/presentation/pages/platform/platform-admin-page.tsx',import.meta.url),source=ts.createSourceFile(path.pathname,readFileSync(path,'utf8'),ts.ScriptTarget.ES2022,true,ts.ScriptKind.TSX);
 let node:ts.Expression|undefined;const visit=(n:ts.Node)=>{if(ts.isVariableDeclaration(n)&&n.name.getText(source)==='sendInvoice')node=n.initializer;ts.forEachChild(n,visit);};visit(source);assert.ok(node);
 const keys=new Map<string,string>(),events:string[]=[],calls:string[]=[],locks=new Set<string>();let count=0;
 const run=vm.runInNewContext(ts.transpileModule(`const run=${node.getText(source)};run`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
  platformAdminUseCases:{sendInvoiceEmail:async(id:string,key:string)=>{calls.push(key);return reply(id,key);}},
  invoiceEmailRequestKeys:{current:keys},operationLocks:{current:locks},invoiceSendLocks:{current:locks},
  setPendingOperations:()=>{},setInvoiceLoading:()=>{},setOperationError:()=>{},setInvoices:()=>{},
  snackbar:{success:()=>events.push('success'),info:()=>events.push('info'),error:()=>events.push('error')},
  handlePlatformAuthError:()=>false,load:async()=>{},crypto:{randomUUID:()=>`synthetic-command-${++count}`}
 });
 return {run:()=>run(invoice),keys,events,calls};
}
test('pending invoice delivery keeps one command key across explicit refresh attempts',async()=>{
 const h=callback(async()=>({data:invoice,emailDelivery:{id:'delivery-synthetic',status:'PENDING'}}));await h.run();await h.run();
 assert.equal(h.keys.size,1);assert.equal(h.calls[0],h.calls[1]);assert.deepEqual(h.events,['info','info']);
});
test('only a sent delivery clears the key and announces an email as sent',async()=>{
 let sent=false;const h=callback(async()=>({data:invoice,emailDelivery:{id:'delivery-synthetic',status:sent?'SENT':'PENDING'}}));await h.run();sent=true;await h.run();
 assert.equal(h.keys.size,0);assert.equal(h.calls[0],h.calls[1]);assert.deepEqual(h.events,['info','success']);
});
test('a failed request retains its original command key without success feedback',async()=>{
 const h=callback(async()=>{throw Error('synthetic unavailable');});await h.run();await h.run();assert.equal(h.keys.size,1);assert.equal(h.calls[0],h.calls[1]);assert.deepEqual(h.events,['error','error']);
});
test('the actual callback blocks simultaneous clicks before React state updates',async()=>{
 let resolve!:(x:any)=>void;const h=callback(async()=>new Promise(r=>{resolve=r;}));const first=h.run();await h.run();assert.equal(h.calls.length,1);resolve({data:invoice,emailDelivery:{id:'delivery-synthetic',status:'SENT'}});await first;
});
test('an old backend success body cannot be mistaken for confirmed delivery',async()=>{
 platformAuthStorage.set('synthetic-platform-bearer');globalThis.fetch=async()=>new Response(JSON.stringify({data:invoice}),{status:200,headers:{'Content-Type':'application/json'}});
 await assert.rejects(()=>platformAdminUseCases.sendInvoiceEmail(invoice.id,'synthetic-command'));assert.equal(platformAuthStorage.get(),'synthetic-platform-bearer');
});
