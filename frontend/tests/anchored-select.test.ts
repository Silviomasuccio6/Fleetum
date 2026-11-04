import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
function harness(disabled=false){
 const slots:any[]=[];let cursor=0;const commits:string[]=[];
 const exports:any={};
 runInNewContext(ts.transpileModule(readFileSync(new URL('../src/presentation/components/ui/anchored-select.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{
  exports,Date,require(id:string){
   if(id==='react')return{useId:()=> 'sites',useEffect:()=>{},useRef:(initial:any)=>{const key=cursor++;return slots[key]??=( {current:initial} );},useState:(initial:any)=>{const key=cursor++;if(!(key in slots))slots[key]=initial;return[slots[key],(next:any)=>slots[key]=typeof next==='function'?next(slots[key]):next]}};
   if(id==='react/jsx-runtime')return{jsx:(type:any,props:any)=>({type,props}),jsxs:(type:any,props:any)=>({type,props})};
   if(id.endsWith('use-anchored-menu'))return{useAnchoredMenu:()=>({root:{current:null},position:{above:false,maxHeight:320}})};
   return{};
  }
 });
 function nodes(value:any):any[]{if(!value||typeof value!=='object')return[];if(Array.isArray(value))return value.flatMap(nodes);return[value,...nodes(value.props?.children)]}
 const render=()=>{cursor=0;return nodes(exports.AnchoredSelect({id:'site',value:'all',disabled,options:[{value:'all',label:'Tutte le sedi'},{value:'rome',label:'Roma'},{value:'milan',label:'Milano'}],onValueChange:(value:string)=>commits.push(value)}))};
 const trigger=()=>render().find(v=>v.type==='button');
 const key=(key:string)=>trigger().props.onKeyDown({key,preventDefault(){},stopPropagation(){}});
 return{render,trigger,key,commits};
}
test('arrows explore without a write, Escape cancels, Enter commits exactly once',()=>{
 const h=harness();h.key('ArrowDown');h.key('ArrowDown');assert.deepEqual(h.commits,[]);
 h.key('Escape');assert.equal(h.trigger().props['aria-expanded'],false);assert.deepEqual(h.commits,[]);
 h.key('Enter');h.key('ArrowDown');h.key('Enter');assert.deepEqual(h.commits,['rome']);
 assert.equal(h.trigger().props['aria-expanded'],false);
});
test('Home, End and Tab preserve explicit selection semantics',()=>{
 const h=harness();h.key('End');h.key('Tab');assert.deepEqual(h.commits,[]);
 h.key('Enter');h.key('End');h.key('Enter');assert.deepEqual(h.commits,['milan']);
 h.key('Enter');h.key('End');h.key('Home');h.key('Enter');assert.deepEqual(h.commits,['milan','all']);
});
test('typeahead finds a long-list destination and commits only on Enter',()=>{
 const h=harness();h.key('m');assert.deepEqual(h.commits,[]);h.key('Enter');assert.deepEqual(h.commits,['milan']);
});
test('a disabled selector never renders its options',()=>{
 const h=harness(true);assert.equal(h.trigger().props.disabled,true);
 assert.equal(h.render().some(v=>v.props?.role==='listbox'),false);
});
