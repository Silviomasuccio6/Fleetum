import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
test('production observer, archive and inert-image controls pass synthetic Python fixtures',()=>{
 const result=spawnSync('python3',['-m','unittest','discover','-s','ops/platform-production','-p','test_*.py'],{encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},timeout:60000,maxBuffer:8*1024*1024});
 assert.equal(result.status,0,(result.stdout??'')+(result.stderr??''));
});
