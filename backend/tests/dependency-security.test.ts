import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import test from "node:test";
import { z } from "zod";
const require=createRequire(import.meta.url),qs=require("qs");
for(const [name,schema,input]of[
 ["array",z.array(z.string()).max(8),Array(256).fill(1)],
 ["set",z.set(z.string()).max(8),new Set(Array.from({length:256},(_,i)=>i))]
]as const)test(`oversized ${name} stops before collecting per-element failures`,()=>{
 const result=schema.safeParse(input);assert.equal(result.success,false);if(result.success)throw new Error("Expected cap");
 assert.equal(result.error.issues.length,1);assert.equal(result.error.issues[0].code,"too_big");
});
for(const mode of["plain","valid","trailing","charset"])test(`HTTP parser survives ${mode} request and remains responsive`,()=>{
 const child=spawnSync(process.execPath,[new URL("./helpers/compressed-request-probe.mjs",import.meta.url).pathname,mode],{encoding:"utf8",timeout:6000,maxBuffer:128*1024});
 assert.equal(child.error,undefined);assert.equal(child.signal,null);assert.equal(child.status,0,child.stderr);
 const result=JSON.parse(child.stdout);assert.equal(result.status,mode==="charset"?415:200);
 if(mode!=="charset")assert.equal(JSON.parse(result.body).synthetic,"fleetum-dependency-probe");
});
test("query serialization handles hostile comma array entries without uncaught coercion errors",()=>{
 for(const encodeValuesOnly of[false,true])for(const entry of[{toString:"synthetic"},Object.create(null)])
  assert.doesNotThrow(()=>qs.stringify({synthetic:[entry]},{arrayFormat:"comma",encodeValuesOnly}));
 assert.equal(qs.stringify({synthetic:["roma","milano"]},{arrayFormat:"comma"}),"synthetic=roma%2Cmilano");
});

for(const mode of ["valid","abort","async-abort"])test(`upload parser keeps ${mode} streams within error handling`,()=>{
 const child=spawnSync(process.execPath,[new URL("./helpers/upload-abort-probe.mjs",import.meta.url).pathname,mode],{encoding:"utf8",timeout:5000,maxBuffer:128*1024});
 assert.equal(child.error,undefined);assert.equal(child.signal,null);assert.equal(child.status,0,child.stderr);assert.equal(JSON.parse(child.stdout).handled,true);
});
