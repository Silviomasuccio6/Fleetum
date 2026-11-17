import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,existsSync,mkdtempSync,rmSync,statSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import test from 'node:test';
import {createRequire} from 'node:module';
import {executeInstallation,readInstallation} from '../platform-production/install.mjs';
const yaml=createRequire(import.meta.url)('js-yaml');
const text=readFileSync(new URL('../../.github/workflows/install-platform-production.yml',import.meta.url),'utf8');
const w=yaml.load(text);
test('production installer is separately manual, main-only and holds the existing global production lock',()=>{
 assert.deepEqual(Object.keys(w.on),['workflow_dispatch']);assert.equal(w.concurrency.group,'fleetum-production');assert.equal(w.concurrency['cancel-in-progress'],false);
 assert.equal(w.jobs.install.environment,'production');assert.deepEqual(w.jobs.install.permissions,{contents:'read',actions:'read'});
 assert.match(w.jobs.install.if,/refs\/heads\/main/);assert.match(w.jobs.install.if,/RELEASE_PLATFORM_PRODUCTION/);
 assert.doesNotMatch(text,/packages:\s*write|npm (ci|run)|pull_request_target|workflow_run/);
 const steps=w.jobs.install.steps,verify=steps.findIndex(s=>s.name?.startsWith('Verify exact')),execute=steps.findIndex(s=>s.name?.startsWith('Execute one'));
 assert.ok(verify>=0&&execute>verify);assert.doesNotMatch(JSON.stringify(steps[verify]),/SSH_KEY|KNOWN_HOSTS/);
 assert.equal(steps[0].with.ref,'${{ github.workflow_sha }}');assert.equal(steps[0].with['persist-credentials'],false);
 assert.match(steps[execute].with.script,/revalidateInstallation/);
});
test('all installer scripts parse and only the outcome is retained publicly',()=>{
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 for(const step of w.jobs.install.steps){
  if(step.run)assert.equal(spawnSync('bash',['-n'],{input:step.run,encoding:'utf8'}).status,0);
  if(step.with?.script)assert.doesNotThrow(()=>new AsyncFunction('github','context','core',step.with.script));
  if(step.with?.script)assert.match(step.with.script,/catch\s*\{\s*core\.setFailed/);
  if(step.uses==='actions/upload-artifact@v4')assert.equal(step.with.path,'${{ runner.temp }}/platform-production-installed.json');
 }
 assert.doesNotMatch(text,/vars\.FLEETUM_PLATFORM_PRODUCTION_(?:INSTALL|PROFILE|BACKUP|PREFLIGHT)_JSON/);
});
test('missing production evidence is refused without invoking a transport',()=>{
 assert.throws(()=>readInstallation({},'a'.repeat(40),'a'.repeat(40)));
 assert.throws(()=>executeInstallation({confirm:'STAGING',runId:'12'},{}));
});
test('SSH transfer pins host trust, forwards no GitHub token and removes its temporary key',t=>{
 const root=mkdtempSync(path.join(tmpdir(),'fleetum-install-test-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const request={confirm:'RELEASE_PLATFORM_PRODUCTION',runId:'12',approval:{controlSha:'a'.repeat(40)}};
 let keyFile;
 const result=executeInstallation(request,{RUNNER_TEMP:root,PATH:process.env.PATH,HOME:process.env.HOME,GH_TOKEN:'synthetic-token-must-not-forward',
  FLEETUM_PLATFORM_PRODUCTION_HOST:'synthetic.example.invalid',FLEETUM_PLATFORM_PRODUCTION_USER:'ubuntu',FLEETUM_PLATFORM_PRODUCTION_SSH_KEY:'synthetic-key-only',FLEETUM_PLATFORM_PRODUCTION_KNOWN_HOSTS:'synthetic-host-only'},(command,args,options)=>{
   assert.equal(command,'ssh');assert.ok(args.includes('StrictHostKeyChecking=yes'));keyFile=args[args.indexOf('-i')+1];assert.equal(statSync(keyFile).mode&0o077,0);
   assert.deepEqual(Object.keys(options.env).sort(),['HOME','PATH']);assert.equal(spawnSync('bash',['-n'],{input:args.at(-1),encoding:'utf8'}).status,0);
   const payload=JSON.parse(options.input);assert.deepEqual(Object.keys(payload.files).sort(),['host_install.py','host_preflight.py','image_identity.py']);
   assert.equal(payload.request.confirm,'RELEASE_PLATFORM_PRODUCTION');assert.ok(!options.input.includes('synthetic-token-must-not-forward'));
   return {status:0,stdout:JSON.stringify({completed:true,controlSha:'a'.repeat(40),runId:'12'})};
  });
 assert.equal(result.completed,true);assert.equal(existsSync(keyFile),false);
});
