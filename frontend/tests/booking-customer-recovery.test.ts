import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {runInNewContext} from 'node:vm';import ts from 'typescript';
// Executes the page's actual submit handler. Fake API persistence is distinct from the HTTP/DB gate.
const source=readFileSync(new URL('../src/presentation/pages/bookings/rental-bookings-page.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('booking.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function initializer(name:string){let result='';const walk=(node:ts.Node)=>{if(ts.isVariableDeclaration(node)&&node.name.getText(ast)===name)result=node.initializer!.getText(ast);ts.forEachChild(node,walk)};walk(ast);assert.ok(result,name);return ts.transpileModule('('+result+')',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;}
function harness({uploadFails=false,listFails=false}:{uploadFails?:boolean;listFails?:boolean}={}){
 let created=0,updated=0,uploads=0,closed=false,error:any=null;const defaultCustomerForm=runInNewContext(initializer('defaultCustomerForm'),{countryNameFromCode:()=> 'Italia'});let customerForm:any=defaultCustomerForm();customerForm={...customerForm,firstName:'Synthetic',lastName:'Recovery',drivingLicenseNumber:'QA-WORKFLOW'};
 const context:any={defaultCustomerForm,customerForm,saving:false,customerScanFiles:uploadFails?[{}]:[],customerSearch:'',loadCustomers:async()=>{if(listFails)throw Error('Elenco non disponibile')},
  rentalBookingsUseCases:{createCustomer:async()=>({id:'synthetic-'+(++created)}),updateCustomer:async()=>{updated++},uploadCustomerAttachments:async()=>{uploads++;if(uploadFails){uploadFails=false;throw Error('Upload non disponibile')}}},
  setSaving:(v:boolean)=>context.saving=v,setError:(v:any)=>error=v,setSuccess:()=>{},setCustomerForm:(next:any)=>{context.customerForm=typeof next==='function'?next(context.customerForm):next},setBookingForm:(next:any)=>{context.booking=next(context.booking??{})},setCustomerInput:(v:any)=>context.input=v,
  setCustomerModalOpen:(v:boolean)=>closed=!v,setCustomerScanFiles:(v:any)=>context.customerScanFiles=v,setCustomerScanInfo:()=>{},setRefreshKey:()=>{},
 };
 const submit=async()=>{await runInNewContext(initializer('onCustomerSubmit'),context)({preventDefault(){}})};
 return{context,submit,get created(){return created},get updated(){return updated},get uploads(){return uploads},get closed(){return closed},get error(){return error}};
}
test('a failed attachment after customer creation retries the same record and preserves the booking association',async()=>{
 const h=harness({uploadFails:true});await h.submit();assert.equal(h.created,1);assert.equal(h.context.customerForm.customerId,'synthetic-1');assert.equal(h.context.customerForm.mode,'edit');assert.equal(h.context.booking.customerId,'synthetic-1');assert.match(h.error,/salvat|creat/i);await h.submit();assert.equal(h.created,1);assert.equal(h.updated,1);assert.equal(h.uploads,2);assert.equal(h.closed,true);
});
test('a failed list refresh does not undo a saved customer or leave the form ready for a duplicate creation',async()=>{
 const h=harness({listFails:true});await h.submit();assert.equal(h.created,1);assert.equal(h.context.booking.customerId,'synthetic-1');assert.equal(h.closed,true);assert.match(h.error,/elenco/i);
});
test('normal inline creation selects the customer and closes the form',async()=>{
 const h=harness();await h.submit();assert.equal(h.created,1);assert.equal(h.context.booking.customerId,'synthetic-1');assert.equal(h.context.input,'Synthetic Recovery');assert.equal(h.closed,true);assert.equal(h.error,null);
});
function closeHarness(saving:boolean,dirty:boolean,accept:boolean){
 let callback='';const walk=(node:ts.Node)=>{if(ts.isCallExpression(node)&&node.expression.getText(ast)==='useDialogFocus'&&node.arguments[0]?.getText(ast)==='customerModalOpen')callback=node.arguments[2].getText(ast);ts.forEachChild(node,walk)};walk(ast);
 let closed=false,confirmations=0;const context:any={saving,customerFormDirty:dirty,setCustomerModalOpen:(open:boolean)=>closed=!open,setCustomerScanFiles:()=>{},setCustomerScanInfo:()=>{},setCustomerFormDirty:()=>{},window:{confirm:()=>{confirmations++;return accept}}};
 if(source.includes('const requestCloseCustomer ='))context.requestCloseCustomer=runInNewContext(initializer('requestCloseCustomer'),context);
 const invoke=()=>runInNewContext(ts.transpileModule('('+callback+')',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context)();
 return{invoke,get closed(){return closed},get confirmations(){return confirmations}};
}
test('Escape cannot dismiss a customer while the save is in progress',()=>{const h=closeHarness(true,true,true);h.invoke();assert.equal(h.closed,false);assert.equal(h.confirmations,0)});
test('Escape on a dirty customer asks before discarding and cancellation retains the form',()=>{const h=closeHarness(false,true,false);h.invoke();assert.equal(h.confirmations,1);assert.equal(h.closed,false);const accepted=closeHarness(false,true,true);accepted.invoke();assert.equal(accepted.closed,true)});
test('Escape closes a pristine customer without a discard prompt',()=>{const h=closeHarness(false,false,false);h.invoke();assert.equal(h.closed,true);assert.equal(h.confirmations,0)});
