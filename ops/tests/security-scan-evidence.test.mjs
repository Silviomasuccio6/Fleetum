import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {assessScan} from '../security/scan-evidence.mjs';

const report=(name='Semgrep OSS',count=0,rules=1)=>({version:'2.1.0',runs:[{tool:{driver:{name,rules:Array.from({length:rules},(_,i)=>({id:'synthetic-'+i}))}},results:Array.from({length:count},()=>({ruleId:'synthetic-0',message:{text:'synthetic finding'}}))}]});
test('clean and findings require consistent scanner status and genuine SARIF',()=>{
 assert.equal(assessScan('semgrep',0,report()).status,'clean');
 assert.equal(assessScan('semgrep',1,report('Semgrep OSS',1)).status,'findings');
 assert.equal(assessScan('gitleaks',0,report('gitleaks',0,0)).status,'clean');
 assert.equal(assessScan('gitleaks',10,report('gitleaks',1)).status,'findings');
});
test('Gitleaks error one is never treated as findings: only the explicit finding exit ten is accepted',()=>{
 for(const code of [1,2,125,126,137])assert.equal(assessScan('gitleaks',code,report('gitleaks',1)).status,'error');
});
test('missing, malformed, empty, wrong-tool and fabricated zero-rule Semgrep evidence fail closed',()=>{
 for(const value of [null,{}, {version:'2.1.0',runs:[]},report('OtherTool'),report('Semgrep',0,0)])assert.equal(assessScan('semgrep',0,value).status,'error');
});
test('inconsistent counts, absent exit and invalid exit are not successful scans',()=>{
 for(const [code,value] of [[0,report('Semgrep OSS',1)],[1,report()],[10,report('gitleaks')],['',report()],['not-an-exit',report()]])assert.equal(assessScan(code===10?'gitleaks':'semgrep',code,value).status,'error');
});
test('explicit unsuccessful invocation or error notification prevents a clean result; warnings stay visible',()=>{
 let r=report();r.runs[0].invocations=[{executionSuccessful:false}];assert.equal(assessScan('semgrep',0,r).status,'error');
 r=report();r.runs[0].invocations=[{toolExecutionNotifications:[{level:'error'}]}];assert.equal(assessScan('semgrep',0,r).status,'error');
 r=report();r.runs[0].invocations=[{toolExecutionNotifications:[{level:'warning'}]}];const out=assessScan('semgrep',0,r);assert.equal(out.status,'clean');assert.equal(out.warningCount,1);
});
test('unredacted Gitleaks snippets are rejected before publication',()=>{
 const r=report('gitleaks',1);r.runs[0].results[0].locations=[{physicalLocation:{region:{snippet:{text:'synthetic-sensitive-marker'}}}}];
 assert.equal(assessScan('gitleaks',10,r).status,'error');
 r.runs[0].results[0].locations[0].physicalLocation.region.snippet.text='REDACTED';assert.equal(assessScan('gitleaks',10,r).status,'findings');
});
test('malformed nested evidence and configuration errors fail closed',()=>{
 for(const mutate of [r=>r.runs[0].invocations={},r=>r.runs[0].invocations=[null],r=>r.runs[0].invocations=[{toolConfigurationNotifications:[{level:'error'}]}],r=>r.runs[0].results=[null],r=>r.runs[0].results=[{locations:{}}]]){
  const r=report();mutate(r);assert.equal(assessScan('semgrep',0,r).status,'error');
 }
});
test('CLI emits only aggregate fields and no raw report contents, including invalid JSON',()=>{
 const d=mkdtempSync(path.join(tmpdir(),'fleetum-security-evidence-'));
 try{
  const p=path.join(d,'scan.sarif'),script=new URL('../security/scan-evidence.mjs',import.meta.url).pathname;
  const r=report('gitleaks',1);r.runs[0].results[0].message.text='DO_NOT_EMIT_SYNTHETIC_MARKER';writeFileSync(p,JSON.stringify(r));
  let x=spawnSync(process.execPath,[script,'gitleaks',p,'10'],{encoding:'utf8'});assert.equal(x.status,0);assert.equal(JSON.parse(x.stdout).status,'findings');assert.doesNotMatch(x.stdout+x.stderr,/DO_NOT_EMIT_SYNTHETIC_MARKER/);
  writeFileSync(p,'invalid DO_NOT_EMIT_SYNTHETIC_MARKER');x=spawnSync(process.execPath,[script,'gitleaks',p,'0'],{encoding:'utf8'});assert.notEqual(x.status,0);assert.doesNotMatch(x.stdout+x.stderr,/DO_NOT_EMIT_SYNTHETIC_MARKER/);
 }finally{rmSync(d,{recursive:true,force:true});}
});
