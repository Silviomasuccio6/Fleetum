import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import ts from "typescript";
function adapter(){const exports:any={},calls:any[]=[];const source=readFileSync(new URL("../src/application/usecases/contract-cargos-usecases.ts",import.meta.url),"utf8");runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,FormData,require:()=>({httpClient:{get:(...args:any[])=>calls.push(["GET",...args]),post:(...args:any[])=>calls.push(["POST",...args]),patch:(...args:any[])=>calls.push(["PATCH",...args])}})});return{...exports,calls};}
const input={sourceHash:"a".repeat(64),transactionId:"PORTAL-SYNTHETIC-1",protocol:"TEST-001",receiptDate:"2026-10-30",kind:"CONFIRM_PORTAL",verifiedOnPortal:true};
test("receipt form preserves the original PDF, verification declaration and explicit portal method",()=>{
 const a=adapter(),file=new File(["%PDF-synthetic"],"synthetic.pdf",{type:"application/pdf"}),form=a.buildCargosReceiptForm(input,file);
 assert.equal(form.get("file"),file);assert.equal(form.get("verifiedOnPortal"),"true");assert.equal(form.get("kind"),"CONFIRM_PORTAL");assert.equal(form.get("sourceHash"),input.sourceHash);
 assert.throws(()=>a.buildCargosReceiptForm({...input,verifiedOnPortal:false},file));assert.throws(()=>a.buildCargosReceiptForm({...input,receiptDate:"2026-02-31"},file));assert.throws(()=>a.buildCargosReceiptForm(input,new File(["not PDF"],"x.html",{type:"text/html"})));
});
test("Check and receipt APIs use scoped HTTP, encoded identifiers and explicit idempotency",()=>{
 const a=adapter(),file=new File(["%PDF-synthetic"],"synthetic.pdf",{type:"application/pdf"}),form=a.buildCargosReceiptForm(input,file);
 a.contractCargosUseCases.check("booking/id",input.sourceHash);a.contractCargosUseCases.history("booking/id","cursor/id");a.contractCargosUseCases.receipt("booking/id",form,"test-key");
 assert.equal(a.calls[0][1],"/rental-bookings/booking%2Fid/cargos/check");assert.ok(a.calls[1][1].endsWith("cursor=cursor%2Fid"));assert.equal(a.calls[2][2],form);assert.equal(a.calls[2][3].headers["X-Idempotency-Key"],"test-key");
});
