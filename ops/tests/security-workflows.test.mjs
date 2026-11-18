import assert from 'node:assert/strict';
import test from 'node:test';
import {
 copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync
} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {delimiter, dirname, join} from 'node:path';
import {spawnSync} from 'node:child_process';
const yaml=createRequire(import.meta.url)('js-yaml');
const read=name=>readFileSync(new URL(`../../${name}`,import.meta.url),'utf8');
const ciText=read('.github/workflows/ci.yml'),historyText=read('.github/workflows/secret-history-scan.yml');
const ci=yaml.load(ciText),history=yaml.load(historyText);

test('security evidence changes preserve CI jobs, Semgrep scope and blocking result',()=>{
 assert.deepEqual(Object.keys(ci.jobs).sort(),['secret-scan','sast','verify','tenant-isolation','migration-compatibility','lighthouse','source-attestation'].sort());
 const sast=ci.jobs.sast;
 assert.equal(sast.name,'SAST (Semgrep)');
 assert.deepEqual(sast.permissions,{contents:'read','security-events':'write'});
 const scan=sast.steps.find(s=>s.id==='semgrep');
 for(const flag of ['--config p/owasp-top-ten','--config p/nodejs','--metrics=off','--error','--severity ERROR','--sarif'])assert.ok(scan.run.includes(flag));
 assert.equal(scan['continue-on-error'],undefined);
 assert.match(scan.run,/exit "\$scan_status"/);
 const evidence=sast.steps.find(s=>s.id==='semgrep-evidence');
 assert.equal(evidence.if,'always()');assert.match(evidence.run,/exit "\$validation_status"/);
 assert.match(evidence.run,/scan-evidence\.mjs semgrep/);
 assert.doesNotMatch(ciText,/Ensure SARIF exists|printf.*json\.schemastore|"results":\[\]/);
 const upload=sast.steps.find(s=>s.uses==='github/codeql-action/upload-sarif@v4');
 assert.match(upload.if,/always\(\).*semgrep-evidence\.outcome == 'success'/);
 assert.equal(upload.with.sarif_file,'semgrep.sarif');
});

test('history validation comes from the workflow revision, not an arbitrary historical source ref',()=>{
 const steps=history.jobs['gitleaks-history'].steps;
 const sources=steps.filter(s=>s.uses==='actions/checkout@v6'&&!s.with.path);
 assert.equal(sources.length,2);
 for(const s of sources){assert.equal(s.with['fetch-depth'],0);assert.equal(s.with['fetch-tags'],true);assert.equal(s.with['persist-credentials'],false);}
 assert.equal(sources[0].with.ref,'${{ inputs.ref }}');
 const controls=steps.find(s=>s.with?.path==='.scan-controls');
 assert.equal(controls.with.ref,'${{ github.workflow_sha }}');
 assert.equal(controls.with['persist-credentials'],false);
 assert.match(controls.with['sparse-checkout'],/\/ops\/security\/scan-evidence\.mjs/);
 const evidence=steps.find(s=>s.id==='evidence');
 assert.match(evidence.run,/node \.scan-controls\/ops\/security\/scan-evidence\.mjs/);
});

test('history clean, findings and execution errors take distinct paths without weakening triage policy',()=>{
 assert.deepEqual(Object.keys(history.on).sort(),['schedule','workflow_dispatch']);
 assert.equal(history.on.workflow_dispatch.inputs.fail_on_findings.default,'false');
 assert.deepEqual(history.permissions,{contents:'read'});
 const job=history.jobs['gitleaks-history'];assert.equal(job.environment,undefined);
 assert.doesNotMatch(historyText,/secrets\.|security-events:\s*write|pull_request_target|workflow_run/);
 const scan=job.steps.find(s=>s.id==='gitleaks');
 assert.match(scan.run,/--redact/);assert.match(scan.run,/--exit-code 10/);assert.match(scan.run,/--log-opts="--all"/);
 assert.match(scan.run,/rev-parse --is-shallow-repository/);assert.match(scan.run,/rev-list --all --count/);
 assert.match(scan.run,/0\|10\) exit 0/);assert.match(scan.run,/analysis incomplete.*exit 1/);
 const upload=job.steps.find(s=>s.uses==='actions/upload-artifact@v4');
 assert.equal(upload.if,"always() && steps.evidence.outcome == 'success'");
 assert.equal(upload.with.name,'gitleaks-history-summary');
 assert.equal(upload.with.path,'${{ runner.temp }}/gitleaks-history-summary.json');
 assert.equal(upload.with['if-no-files-found'],'error');
 const enforce=job.steps.find(s=>s.name==='Enforce manual failure on findings');
 assert.match(enforce.if,/inputs.fail_on_findings == 'true'/);assert.match(enforce.if,/exit_code == '10'/);
});

test('history publishes only the validated aggregate and removes its temporary SARIF', () => {
 const root = mkdtempSync(join(tmpdir(), 'fleetum-history-summary-'));
 try {
  const controls = join(root, '.scan-controls', 'ops', 'security');
  mkdirSync(controls, {recursive: true});
  copyFileSync(new URL('../security/scan-evidence.mjs', import.meta.url), join(controls, 'scan-evidence.mjs'));
  const reportDir = join(root, 'gitleaks-history');
  mkdirSync(reportDir);
  const report = join(reportDir, 'report.sarif');
  const summary = join(root, 'gitleaks-history-summary.json');
  const fixture = {
   version: '2.1.0',
   runs: [{
    tool: {driver: {name: 'gitleaks', rules: [{id: 'synthetic-rule'}]}},
    results: [{
     message: {text: 'synthetic detail'},
     partialFingerprints: {email: 'synthetic@example.invalid', commitMessage: 'synthetic commit'},
     locations: [{physicalLocation: {
      artifactLocation: {uri: 'synthetic-path'},
      region: {snippet: {text: 'REDACTED'}}
     }}]
    }]
   }]
  };
  const checkoutSha = 'a'.repeat(40);
  const evidence = history.jobs['gitleaks-history'].steps.find(step => step.id === 'evidence');
  const execute = () => spawnSync('bash', ['-e', '-c', evidence.run], {
   cwd: root,
   encoding: 'utf8',
   env: {
    ...process.env,
    PATH: [dirname(process.execPath), process.env.PATH].join(delimiter),
    RUNNER_TEMP: root,
    GITHUB_STEP_SUMMARY: join(root, 'step-summary.md'),
    SCAN_EXIT_CODE: '10',
    SCANNED_SHA: checkoutSha,
    SCANNED_COMMITS: '9'
   }
  });

  writeFileSync(report, JSON.stringify(fixture));
  const valid = execute();
  assert.equal(valid.status, 0, valid.stderr);
  assert.deepEqual(JSON.parse(readFileSync(summary, 'utf8')), {
   schemaVersion: 1,
   scanner: 'gitleaks',
   status: 'findings',
   findingsCount: 1,
   rulesCount: 1,
   warningCount: 0,
   checkoutSha,
   reachableCommits: 9
  });
  assert.equal(existsSync(report), false);

  rmSync(summary);
  writeFileSync(report, 'invalid synthetic report');
  assert.notEqual(execute().status, 0);
  assert.equal(existsSync(report), false);
  assert.equal(existsSync(summary), false);
 } finally {
  rmSync(root, {recursive: true, force: true});
 }
});

test('changed workflow shell blocks remain syntactically valid',()=>{
 for(const doc of [ci,history])for(const job of Object.values(doc.jobs))for(const step of job.steps??[]){
  if(!step.run||step.shell&& !step.shell.startsWith('bash'))continue;
  const script=step.run.replace(/\$\{\{[\s\S]*?\}\}/g,'synthetic-value');
  const r=spawnSync('bash',['-n'],{input:script,encoding:'utf8'});
  assert.equal(r.status,0,`${step.name}: ${r.stderr}`);
 }
});

test('reporting policy uses the repository private channel without invented contact or SLA',()=>{
 const policy=read('SECURITY.md');
 assert.match(policy,/https:\/\/github\.com\/Silviomasuccio6\/Fleetum\/security\/advisories\/new/);
 assert.match(policy,/synthetic data/);assert.match(policy,/Redact passwords, tokens/);
 assert.doesNotMatch(policy,/mailto:|within \d+|supported versions/i);
});
