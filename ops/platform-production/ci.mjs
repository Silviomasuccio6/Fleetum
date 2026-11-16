import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync, lstatSync, rmSync, openSync, readSync, closeSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { verifyCandidate } from '../platform-release/production-candidate.mjs';
import { candidateProof, ROLES, SHA, HASH, positiveId, PLATFORM_API } from './policy.mjs';
import { validateAudit } from './audit-report.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const REPO=path.resolve(HERE,'../..');
export const MANIFEST='ops/platform-release/production-candidates/20261115/candidate.json';
export function digest(file) {
  const fd=openSync(file,'r'),buffer=Buffer.alloc(1024*1024),h=createHash('sha256');
  try {let n;while((n=readSync(fd,buffer,0,buffer.length,null))>0)h.update(buffer.subarray(0,n));return h.digest('hex');}
  finally {closeSync(fd);}
}
export const json=file=>JSON.parse(readFileSync(file,'utf8'));
export const put=(file,value)=>writeFileSync(file,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});
const runtime=()=>({node:process.versions.node,platform:process.platform,arch:process.arch});
const git=(...args)=>execFileSync('git',['-C',REPO,...args],{encoding:'utf8',maxBuffer:32*1024*1024}).trim();
const safeEnv=(extra={})=>({PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR??'/tmp',
  CI:'1',DOTENV_CONFIG_PATH:'/dev/null',CHECKPOINT_DISABLE:'1',PRISMA_HIDE_UPDATE_MESSAGE:'1',...extra});
export function assertCIBuilder(env=process.env,platform=process.platform,arch=process.arch) {
  assert.ok(env.GITHUB_ACTIONS==='true'&&platform==='linux'&&arch==='x64','Docker checks require the isolated GitHub Linux AMD64 runner');
}

export function run(command,args,{cwd=REPO,env={},log,redactions=[],timeout=900000}={}) {
  if(command==='docker'){assertCIBuilder();args=['--host','unix:///var/run/docker.sock',...args];}
  const result=spawnSync(command,args,{cwd,env:safeEnv(env),encoding:'utf8',timeout,maxBuffer:32*1024*1024});
  let output=(result.stdout??'')+(result.stderr??'');
  for(const secret of redactions)if(secret)output=output.split(secret).join('[REDACTED]');
  output=output.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[SYNTHETIC_TOKEN_REDACTED]');
  if(log)writeFileSync(log,output,{mode:0o600});
  assert.ok(!result.error&&!result.signal&&result.status===0,`Candidate check failed; inspect ${log??command}`);
  return output;
}
export function tapCount(text,minimum) {
  const count=name=>Number([...text.matchAll(new RegExp(`^# ${name} (\\d+)\\s*$`,'gm'))].at(-1)?.[1]);
  const tests=count('tests');
  assert.ok(Number.isSafeInteger(tests)&&tests>=minimum&&count('pass')===tests&&count('fail')===0&&count('skipped')===0&&count('cancelled')===0,'Incomplete or failed TAP report');
  return tests;
}
function fresh(directory) {
  const target=path.resolve(directory);
  assert.ok(target!==REPO&&!target.startsWith(REPO+path.sep)&&!REPO.startsWith(target+path.sep),'Output must be separate from controls');
  assert.ok(!existsSync(target),'New output directory required');mkdirSync(target);return target;
}
function context() {
  const controlSha=git('rev-parse','HEAD'),runId=process.env.GITHUB_RUN_ID??'1';
  assert.ok(SHA.test(controlSha)&&positiveId(runId));
  assert.equal(process.env.CI_CONTROL_SHA??controlSha,controlSha,'Workflow checkout differs from source');
  assert.equal(process.env.GITHUB_REPOSITORY??'Silviomasuccio6/Fleetum','Silviomasuccio6/Fleetum');
  return {repository:'Silviomasuccio6/Fleetum',controlSha,runId:String(runId)};
}
function files(directory,prefix='') {
  return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
    const relative=prefix+entry.name,p=path.join(directory,entry.name);
    assert.ok(!entry.isSymbolicLink(),'Exported source link rejected');
    return entry.isDirectory()?files(p,relative+'/'):[relative];
  });
}
function assertExport(root,tree) {
  const raw=execFileSync('git',['-C',REPO,'ls-tree','-rz',tree],{maxBuffer:32*1024*1024}).toString();
  const expected=new Map(raw.split('\0').filter(Boolean).map(line=>{
    const m=/^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/.exec(line);assert.ok(m,'Source link/submodule rejected');return [m[3],{mode:m[1],sha:m[2]}];
  }));
  assert.deepEqual(files(root).sort(),[...expected.keys()].sort(),'Git archive omitted or added source files');
  for(const [relative,item] of expected) {
    const p=path.join(root,relative),bytes=readFileSync(p);
    assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),item.sha,'Exported blob differs from Git');
    assert.equal(Boolean(statSync(p).mode&0o111),item.mode==='100755');
  }
}
export function prepareSources(directory) {
  assert.equal(git('status','--porcelain'),'','Commit controls before claiming source identity');
  const c=context(),out=fresh(directory),manifest=path.join(REPO,MANIFEST);
  const checked=verifyCandidate(REPO,manifest),descriptor=json(manifest),sources={};
  for(const role of ROLES) {
    const raw=path.join(out,role+'.git.tar.gz'),root=path.join(out,role+'-source');
    run('git',['archive','--format=tar.gz','--output='+raw,descriptor.sources[role].treeSha]);
    run('python3',[path.join(HERE,'archives.py'),'extract',raw,root]);
    assertExport(root,descriptor.sources[role].treeSha);
    const name=role+'.source.tar.gz';run('python3',[path.join(HERE,'archives.py'),'pack',root,path.join(out,name)]);
    sources[role]={...checked.sources[role],archiveName:name,archiveSha256:digest(path.join(out,name))};
    rmSync(raw);rmSync(root,{recursive:true});
  }
  const proof={schemaVersion:1,kind:'platform-production-source-export',...c,manifestSha256:digest(manifest),sources};
  put(path.join(out,'sources.json'),proof);return proof;
}
export function readSources(directory) {
  const proof=json(path.join(directory,'sources.json')),c=context(),descriptor=json(path.join(REPO,MANIFEST));
  assert.equal(proof.kind,'platform-production-source-export');assert.equal(proof.controlSha,c.controlSha);assert.equal(proof.runId,c.runId);
  assert.equal(proof.manifestSha256,digest(path.join(REPO,MANIFEST)));
  for(const role of ROLES) {
    const s=proof.sources?.[role];assert.equal(s?.sourceSha,descriptor.sources[role].sourceSha);assert.equal(s.treeSha,descriptor.sources[role].treeSha);
    assert.equal(s.archiveName,role+'.source.tar.gz');assert.ok(HASH.test(s.archiveSha256));
  }
  return proof;
}
export function extractRole(sources,role,work) {
  assert.ok(ROLES.includes(role));const proof=readSources(sources),s=proof.sources[role],archive=path.join(sources,s.archiveName);
  assert.ok(lstatSync(archive).isFile()&&!lstatSync(archive).isSymbolicLink()&&statSync(archive).size<=128*1024*1024);
  assert.equal(digest(archive),s.archiveSha256,'Source artifact checksum mismatch');
  const root=path.join(work,'source');run('python3',[path.join(HERE,'archives.py'),'extract',archive,root]);
  assertExport(root,s.treeSha);return {root,proof};
}
export function baseReport(role,source) {
  return {schemaVersion:1,role,...context(),manifestSha256:source.manifestSha256,
    sourceSha:source.sources[role==='image'?'backend':role].sourceSha,
    treeSha:source.sources[role==='image'?'backend':role].treeSha,runtime:runtime(),passed:true};
}
export function audit(root,role,log) {
  // npm exits nonzero even for moderate findings. Validate the report, not a
  // fallback empty object or the exit status alone.
  const result=spawnSync('npm',['audit','--workspace',role==='backend'?'backend':'frontend','--omit=dev','--json'],{cwd:root,env:safeEnv(),encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024});
  writeFileSync(log,result.stdout??'',{mode:0o600});
  assert.ok(!result.error&&!result.signal&&[0,1].includes(result.status));
  return validateAudit(JSON.parse(result.stdout));
}
export function frontend(sources,role,directory) {
  assert.ok(['satin','fallback'].includes(role));const out=fresh(directory),{root,proof}=extractRole(sources,role,out);
  run('npm',['ci','--workspace','frontend'],{cwd:root,log:path.join(out,'install.log')});
  const tap=run('npm',['test','-w','frontend'],{cwd:root,env:{NODE_ENV:'test'},log:path.join(out,'tests.log')});
  const tests=tapCount(tap,role==='satin'?129:118);
  run('npm',['run','build','-w','frontend'],{cwd:root,env:{NODE_ENV:'production',VITE_PLATFORM_API_BASE_URL:PLATFORM_API},log:path.join(out,'build.log')});
  const counts=audit(root,role,path.join(out,'audit.json')),archive=path.join(out,role+'.compiled.tar.gz');
  run('python3',[path.join(HERE,'archives.py'),'pack',path.join(root,'frontend/dist'),archive]);
  const report={...baseReport(role,proof),tests,audit:counts,platformApi:PLATFORM_API,archiveSha256:digest(archive)};
  put(path.join(out,role+'.report.json'),report);return report;
}
export function image(sources,directory) {
  assertCIBuilder();
  const out=fresh(directory),{root,proof}=extractRole(sources,'backend',out),tag='fleetum-platform-ci:'+context().runId;
  run('docker',['buildx','build','--platform','linux/amd64','--load','--tag',tag,
    '--label','it.fleetum.platform.source='+proof.sources.backend.sourceSha,
    '--label','it.fleetum.platform.tree='+proof.sources.backend.treeSha,
    '--file',path.join(root,'backend/Dockerfile.prod'),root],{log:path.join(out,'image-build.log'),timeout:1800000});
  const info=JSON.parse(run('docker',['image','inspect','--format','{"id":{{json .Id}},"os":{{json .Os}},"arch":{{json .Architecture}},"source":{{json (index .Config.Labels "it.fleetum.platform.source")}},"tree":{{json (index .Config.Labels "it.fleetum.platform.tree")}}}',tag]));
  assert.equal(info.os,'linux');assert.equal(info.arch,'amd64');assert.equal(info.source,proof.sources.backend.sourceSha);assert.equal(info.tree,proof.sources.backend.treeSha);
  run('docker',['run','--rm','--network','none','--entrypoint','node',tag,'-e',
    'const a=require("node:assert/strict");a.equal(process.arch,"x64");a.equal(process.versions.node,"22.23.1");a.equal(process.getuid(),1000);a.equal(process.getgid(),1000);require.resolve("resend");require.resolve("@prisma/client");require("node:fs").accessSync("dist/interfaces/http/middlewares/platform-auth.js");'],{log:path.join(out,'image-smoke.log')});
  const archive=path.join(out,'backend.image.tar');run('docker',['save','--output',archive,tag],{timeout:180000});
  run('docker',['pull','aquasec/trivy:latest'],{log:path.join(out,'scanner-pull.log'),timeout:300000});
  const scannerRefs=JSON.parse(run('docker',['image','inspect','--format','{{json .RepoDigests}}','aquasec/trivy:latest']));
  const scanners=scannerRefs.filter(x=>/^(?:docker\.io\/)?aquasec\/trivy@sha256:[0-9a-f]{64}$/.test(x));assert.equal(scanners.length,1);
  const scan=JSON.parse(run('docker',['run','--rm','-v',out+':/artifact:ro',scanners[0],
    'image','--input','/artifact/backend.image.tar','--scanners','vuln','--format','json','--severity','HIGH,CRITICAL','--exit-code','1'],
    {log:path.join(out,'image-vulnerabilities.log'),timeout:900000}));
  assert.equal(scan.SchemaVersion,2);assert.ok(Array.isArray(scan.Results));
  const findings=scan.Results.flatMap(x=>x.Vulnerabilities??[]);
  assert.ok(findings.every(x=>!['HIGH','CRITICAL'].includes(x.Severity)),'Image vulnerability scan did not pass');
  const report={...baseReport('image',proof),platform:'linux/amd64',imageId:info.id,smokePassed:true,runtimeUser:{uid:1000,gid:1000},
    dockerfileSha256:digest(path.join(root,'backend/Dockerfile.prod')),archiveSha256:digest(archive),
    scanner:{image:scanners[0],high:0,critical:0}};
  put(path.join(out,'image.report.json'),report);return report;
}
export function security(sources,directory) {
  assertCIBuilder();
  const out=fresh(directory),proof=readSources(sources),tools={};
  for(const [name,tag] of Object.entries({gitleaks:'ghcr.io/gitleaks/gitleaks:latest',semgrep:'semgrep/semgrep:latest'})) {
    run('docker',['pull',tag],{log:path.join(out,name+'-pull.log'),timeout:300000});
    const refs=JSON.parse(run('docker',['image','inspect','--format','{{json .RepoDigests}}',tag]));
    const prefix=tag.split(':')[0]+'@sha256:',prefixes=name==='semgrep'?[prefix,'docker.io/'+prefix]:[prefix];
    const exact=refs.filter(x=>prefixes.some(p=>x.startsWith(p)&&HASH.test(x.slice(p.length))));
    assert.equal(exact.length,1,'Exactly one scanner digest required');tools[name]=exact[0];
  }
  for(const role of ROLES) {
    const work=path.join(out,role);mkdirSync(work);const {root}=extractRole(sources,role,work);
    run('docker',['run','--rm','--network','none','-v',root+':/repo:ro',tools.gitleaks,
      'detect','--source','/repo','--no-git','--redact'],{log:path.join(out,role+'-secrets.log')});
    const target=role==='backend'?'backend/src':'frontend/src';
    run('docker',['run','--rm','-v',root+':/src:ro','-w','/src',tools.semgrep,
      'semgrep','scan','--config','p/owasp-top-ten','--config','p/nodejs','--metrics=off','--error','--severity','ERROR',target],
      {log:path.join(out,role+'-sast.log')});
    rmSync(work,{recursive:true});
  }
  const report={schemaVersion:1,role:'security',...context(),manifestSha256:proof.manifestSha256,
    sources:Object.fromEntries(ROLES.map(role=>[role,proof.sources[role].sourceSha])),tools,passed:true};
  put(path.join(out,'security.report.json'),report);return report;
}
export function attest(sources,reportsDir,outfile) {
  const source=readSources(sources),reports={};for(const role of [...ROLES,'image','security'])reports[role]=json(path.join(reportsDir,role+'.report.json'));
  const proof=candidateProof({source,reports,needs:JSON.parse(process.env.CANDIDATE_JOB_RESULTS??'null'),context:{...context(),event:process.env.GITHUB_EVENT_NAME,branch:process.env.GITHUB_REF_NAME}});
  put(outfile,proof);return proof;
}

async function main() {
  try {
    const {values,positionals}=parseArgs({allowPositionals:true,options:{out:{type:'string'},sources:{type:'string'},role:{type:'string'},reports:{type:'string'},database:{type:'string'}}});
    const mode=positionals[0];assert.ok(values.out,'Output required');let result;
    if(mode==='sources')result=prepareSources(values.out);
    else if(mode==='frontend')result=frontend(values.sources,values.role,values.out);
    else if(mode==='image')result=image(values.sources,values.out);
    else if(mode==='security')result=security(values.sources,values.out);
    else if(mode==='backend'){const {backend}=await import('./database-check.mjs');result=await backend(values.sources,values.database,values.out);}
    else if(mode==='attest')result=attest(values.sources,values.reports,values.out);
    else throw Error('Unsupported candidate CI mode');
    console.log(JSON.stringify({completed:true,mode,controlSha:result.controlSha,readyForDeployment:false}));
  } catch {console.error('Candidate CI step failed. Inspect the sanitized task logs.');process.exitCode=1;}
}
// Finish ESM evaluation before loading the backend adapter, which shares the
// pure helpers above. A top-level awaited import here deadlocks that cycle.
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
