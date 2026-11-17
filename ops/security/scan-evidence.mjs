import {createHash} from 'node:crypto';
import {readFileSync,statSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// These statuses describe scanner execution, not a verdict on product security.
// Gitleaks is invoked with --exit-code 10: its ordinary exit 1 also means error.
export function assessScan(scanner,rawExit,report){
 const out={schemaVersion:1,scanner:['semgrep','gitleaks'].includes(scanner)?scanner:'unknown',status:'error',reportValid:false,exitCode:null,findingsCount:null,rulesCount:null,warningCount:0,reason:'invalid-evidence'};
 if(!['semgrep','gitleaks'].includes(scanner)||!/^\d{1,3}$/.test(String(rawExit??'')))return out;
 const exit=Number(rawExit);out.exitCode=exit;
 const findingExit=scanner==='gitleaks'?10:1;
 if(exit!==0&&exit!==findingExit)return {...out,reason:'scanner-execution-error'};
 if(report?.version!=='2.1.0'||!Array.isArray(report.runs)||report.runs.length===0)return out;
 let findings=0,rules=0;
 for(const run of report.runs){
  const driver=run?.tool?.driver;
  if(!driver||!Array.isArray(driver.rules)||!Array.isArray(run.results))return out;
  if(scanner==='semgrep'&&!['Semgrep','Semgrep OSS'].includes(driver.name))return out;
  if(scanner==='gitleaks'&&(typeof driver.name!=='string'||driver.name.toLowerCase()!=='gitleaks'))return out;
  if(scanner==='semgrep'&&driver.rules.length===0)return {...out,reason:'missing-scanner-rules'};
  if(run.invocations!==undefined&&!Array.isArray(run.invocations))return out;
  for(const invocation of run.invocations??[]){
   if(!invocation||typeof invocation!=='object')return out;
   if(invocation.executionSuccessful===false)return {...out,reason:'incomplete-analysis'};
   for(const field of ['toolExecutionNotifications','toolConfigurationNotifications']){
    if(invocation[field]!==undefined&&!Array.isArray(invocation[field]))return out;
    for(const n of invocation[field]??[]){
     if(!n||typeof n!=='object')return out;
     if(n.level==='error')return {...out,reason:'incomplete-analysis'};
     if(n.level==='warning')out.warningCount++;
    }
   }
  }
  for(const result of run.results){
   if(!result||typeof result!=='object'||result.locations!==undefined&&!Array.isArray(result.locations))return out;
   if(scanner!=='gitleaks')continue;
   for(const location of result.locations??[]){
   if(!location||typeof location!=='object')return out;
   const snippet=location.physicalLocation?.region?.snippet?.text;
   if(snippet!==undefined&&snippet!==null&&snippet!==''&&snippet!=='REDACTED')return {...out,reason:'unredacted-secret-evidence'};
   }
  }
  findings+=run.results.length;rules+=driver.rules.length;
 }
 if((exit===0&&findings!==0)||(exit===findingExit&&findings===0))return {...out,reason:'inconsistent-exit-and-report'};
 return {...out,status:findings?'findings':'clean',reportValid:true,findingsCount:findings,rulesCount:rules,reason:null};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 let out={schemaVersion:1,status:'error',reportValid:false,reason:'missing-or-invalid-report'};
 try{
  const [scanner,file,exit]=process.argv.slice(2);
  if(process.argv.length!==5||statSync(file).size>10*1024*1024)throw Error('Invalid bounded report');
  const bytes=readFileSync(file);out=assessScan(scanner,exit,JSON.parse(bytes.toString('utf8')));
  if(out.reportValid)out.reportSha256=createHash('sha256').update(bytes).digest('hex');
 }catch{ /* Raw parser errors, file paths and report contents are never printed. */ }
 console.log(JSON.stringify(out));
 if(!out.reportValid||out.status==='error')process.exitCode=1;
}
