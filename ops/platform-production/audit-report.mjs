import assert from 'node:assert/strict';
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const severities=['info','low','moderate','high','critical'];
export function validateAudit(report) {
  assert.ok(record(report)&&!Object.hasOwn(report,'error')&&report.auditReportVersion===2);
  assert.ok(record(report.vulnerabilities)&&record(report.metadata)&&record(report.metadata.vulnerabilities));
  const observed=Object.fromEntries(severities.map(s=>[s,0]));
  for(const [name,value] of Object.entries(report.vulnerabilities)) {
    assert.ok(name.trim()&&record(value)&&severities.includes(value.severity));observed[value.severity]++;
  }
  const counts=report.metadata.vulnerabilities;
  for(const key of [...severities,'total']) {
    assert.ok(Number.isSafeInteger(counts[key])&&counts[key]>=0);
    assert.equal(counts[key],key==='total'?Object.keys(report.vulnerabilities).length:observed[key]);
  }
  assert.equal(counts.high,0);assert.equal(counts.critical,0);return counts;
}
