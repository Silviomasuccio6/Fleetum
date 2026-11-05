import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import ts from "typescript";
function client(){
 const calls:any[]=[],exports:any={};const source=readFileSync(new URL("../src/application/usecases/contract-rental-details-usecases.ts",import.meta.url),"utf8");
 runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:()=>({httpClient:{get:(...args:any[])=>calls.push(["get",...args]),patch:(...args:any[])=>calls.push(["patch",...args])}})});
 return{calls,...exports};
}
test("rental amounts use exact cents and distinguish zero from blank",()=>{
 const{parseContractCents:parse}=client();assert.equal(parse(""),null);assert.equal(parse("0"),0);assert.equal(parse("149,99"),14999);assert.equal(parse("0.01"),1);assert.equal(parse("9999999.99"),999999999);
 for(const value of ["-1","1,999","1e2","NaN","1 000","10000000",".50"])assert.throws(()=>parse(value));
});
test("rental conditions use scoped HTTP, encode identifiers and send the saved revision",()=>{
 const c=client();c.contractRentalDetailsUseCases.read("booking/id");c.contractRentalDetailsUseCases.candidates("booking/id","Anna & B");const terms={version:1,depositCents:0};c.contractRentalDetailsUseCases.save("booking/id",7,terms);
 assert.equal(c.calls[0][1],"/rental-bookings/booking%2Fid/contract/rental-details");assert.ok(c.calls[1][1].endsWith("?search=Anna%20%26%20B"));assert.equal(c.calls[2][0],"patch");assert.equal(c.calls[2][2].revision,7);assert.equal(c.calls[2][2].terms,terms);
});
