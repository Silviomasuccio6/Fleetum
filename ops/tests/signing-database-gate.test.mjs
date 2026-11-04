import assert from "node:assert/strict";
import {readFileSync,mkdtempSync,readFileSync as read,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import test from "node:test";
const workflow=readFileSync(new URL("../../.github/workflows/ci.yml",import.meta.url),"utf8");
const local=readFileSync(new URL("../verify-database.sh",import.meta.url),"utf8");
test("the existing tenant isolation job prepares disposable keys and enables the signing database suite",()=>{
 const job=workflow.slice(workflow.indexOf("  tenant-isolation:"),workflow.indexOf("  migration-compatibility:"));
 assert.match(job,/RUN_TENANT_ISOLATION_TESTS: "1"/);assert.match(job,/DOTENV_CONFIG_PATH: \/dev\/null/);
 assert.ok(job.indexOf("Prepare ephemeral signing and CARGOS test keys")<job.indexOf("Run black-box tenant isolation tests"));
 const command=job.match(/node -e '([^\n]+)'/)[1],folder=mkdtempSync(path.join(tmpdir(),"fleetum-test-keys-")),file=path.join(folder,"ephemeral-env");
 try{const result=spawnSync(process.execPath,["-e",command],{env:{GITHUB_ENV:file},encoding:"utf8"});assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.replace(/::add-mask::[a-f0-9]{64}\n/g,""),"");const entries=Object.fromEntries(read(file,"utf8").trim().split("\n").map(row=>row.split("=")));assert.equal(entries.RUN_CONTRACT_SIGNING_TESTS,"1");for(const key of ["CONTRACT_SIGNING_KEY","CARGOS_DATA_ENCRYPTION_KEY"])assert.match(entries[key],/^[a-f0-9]{64}$/);assert.notEqual(entries.CONTRACT_SIGNING_KEY,entries.CARGOS_DATA_ENCRYPTION_KEY);for(const key of [entries.CONTRACT_SIGNING_KEY,entries.CARGOS_DATA_ENCRYPTION_KEY])assert.ok(result.stdout.includes("::add-mask::"+key));}finally{rmSync(folder,{recursive:true,force:true});}
});
test("local database verification runs the signing cases on the loopback temporary database",()=>{
 assert.match(local,/export RUN_CONTRACT_SIGNING_TESTS=1/);assert.match(local,/-p 127\.0\.0\.1::5432/);assert.match(local,/export DOTENV_CONFIG_PATH=\/dev\/null/);assert.match(local,/trap cleanup EXIT/);assert.match(local,/test:tenant-isolation/);assert.doesNotMatch(local,/fleetum_verify_local/);
});

test("a macOS-style temporary directory ending in slash remains inside the test runner namespace",()=>{
 const assignments=local.match(/VERIFY_UPLOAD_PARENT=[^\n]+\nUPLOAD_DIR=[^\n]+/)[0];
 const result=spawnSync("/bin/bash",["-c",assignments+'\nprintf \'%s\' "$UPLOAD_DIR"'],{env:{TMPDIR:"/tmp/"},encoding:"utf8"});
 assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/^\/tmp\/fleetum-verify-uploads-\d+$/);
});
