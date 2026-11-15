import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
test('Platform packaging, image publication and frontend transaction boundaries pass synthetic Python checks',()=>{
 const result=spawnSync('python3',['-m','unittest','discover','-s','ops/platform-release','-p','test_*.py','-v'],{encoding:'utf8',timeout:30000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
 assert.equal(result.status,0,result.stdout+result.stderr);
 assert.match(result.stderr,/Ran \d+ tests/);assert.doesNotMatch(result.stderr,/skipped=/);
});
