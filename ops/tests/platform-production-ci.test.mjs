import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { tapCount } from '../platform-production/ci.mjs';
import { databaseConfig } from '../platform-production/database-check.mjs';
import { validateAudit } from '../platform-production/audit-report.mjs';

test('TAP must contain actual non-skipped passing tests, not just exit zero',()=>{
 assert.equal(tapCount('# tests 13\n# pass 13\n# fail 0\n# skipped 0\n# cancelled 0\n',13),13);
 for(const data of ['', '# tests 0\n# pass 0\n# fail 0\n# skipped 0\n# cancelled 0\n','# tests 13\n# pass 12\n# fail 0\n# skipped 1\n# cancelled 0\n'])assert.throws(()=>tapCount(data,13));
});
const audit=()=>({auditReportVersion:2,vulnerabilities:{},metadata:{vulnerabilities:{info:0,low:0,moderate:0,high:0,critical:0,total:0}}});
test('a valid empty audit is distinct from a tool error or malformed counts',()=>{
 assert.equal(validateAudit(audit()).total,0);
 for(const change of [r=>r.error={},r=>delete r.auditReportVersion,r=>r.vulnerabilities.x={severity:'critical'},r=>r.metadata.vulnerabilities.high=-1,r=>r.metadata.vulnerabilities.total=1]){
  const r=audit();change(r);assert.throws(()=>validateAudit(r));
 }
});
test('even consistent audit counts fail on a critical finding',()=>{
 const r=audit();r.vulnerabilities.x={severity:'critical'};r.metadata.vulnerabilities.critical=1;r.metadata.vulnerabilities.total=1;assert.throws(()=>validateAudit(r));
});
test('database inputs cannot select a real host, arbitrary role or non-private credential file',t=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'fleetum-source-ci-test-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const file=path.join(root,'session.json');
 const valid={syntheticOnly:true,host:'127.0.0.1',user:'fleetum_qa',cluster:'fleetum_platform_synthetic_20261115',port:60001,password:'synthetic-test-only-password'};
 writeFileSync(file,JSON.stringify(valid),{mode:0o600});assert.equal(databaseConfig(file).host,'127.0.0.1');
 for(const change of [r=>r.host='203.0.113.1',r=>r.user='postgres',r=>r.syntheticOnly=false,r=>r.cluster='production']){
  const r={...valid};change(r);writeFileSync(file,JSON.stringify(r));assert.throws(()=>databaseConfig(file));
 }
 const link=path.join(root,'link.json');symlinkSync(file,link);assert.throws(()=>databaseConfig(link));
});
