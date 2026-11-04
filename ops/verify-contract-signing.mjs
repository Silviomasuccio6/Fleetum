import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm,stat} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(Number(process.versions.node.split('.')[0])!==22)throw Error('Use Node 22.23.1');
const evidence=process.argv[2]?path.resolve(process.argv[2]):null;
if(!evidence)throw Error('Provide a new evidence directory');
await mkdir(evidence);
const scratch=await mkdtemp('/private/tmp/fleetum-e03-otp-pg-');const container='fleetum_e03_otp_'+randomBytes(5).toString('hex');const password=randomBytes(20).toString('hex');
const macSocket=path.join(os.homedir(),'.docker/run/docker.sock');
const dockerSocket=await stat(macSocket).then(v=>v.isSocket()?macSocket:'/var/run/docker.sock').catch(()=>'/var/run/docker.sock');
await mkdir(scratch+'/docker');await mkdir(scratch+'/uploads');
const env={PATH:process.env.PATH,HOME:os.homedir(),DOCKER_HOST:'unix://'+dockerSocket,DOCKER_CONFIG:scratch+'/docker',NODE_ENV:'test',RUN_TENANT_ISOLATION_TESTS:'1',RUN_CONTRACT_SIGNING_TESTS:'1',DOTENV_CONFIG_PATH:'/dev/null',UPLOAD_DIR:scratch+'/uploads',JWT_SECRET:randomBytes(48).toString('hex'),CARGOS_DATA_ENCRYPTION_KEY:randomBytes(32).toString('hex'),CONTRACT_SIGNING_KEY:randomBytes(32).toString('hex'),APP_URL:'http://127.0.0.1:5191',CORS_ORIGIN:'http://127.0.0.1:5191',STORAGE_PROVIDER:'local',SIGNING_PDF_EVIDENCE_DIR:evidence};
const children=new Set();
async function run(command,args,name){const child=spawn(command,args,{cwd:root,env,stdio:['ignore','pipe','pipe']});children.add(child);let output='';for(const stream of [child.stdout,child.stderr])stream.on('data',c=>output+=c);const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve)});children.delete(child);await writeFile(evidence+'/'+name,output.split(password).join('<temporary-db-password>'));if(code!==0)throw Error(name+' exit '+code);return output;}
let removed=false;const deadline=setTimeout(()=>{for(const c of children)c.kill('SIGTERM');},180000);
try{
 await run('docker',['run','--rm','-d','--name',container,'--label','fleetum-purpose=e03-otp-20261029','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_USER=fleetum_e03_otp','-e','POSTGRES_PASSWORD='+password,'-e','POSTGRES_DB=fleetum_e03_otp_test','-p','127.0.0.1::5432','postgres:16-alpine'],'db-start.log');
 let ready=false;for(let i=0;i<100;i++){try{await run('docker',['exec',container,'pg_isready','-U','fleetum_e03_otp','-d','fleetum_e03_otp_test'],'db-ready.log');ready=true;break}catch{await new Promise(r=>setTimeout(r,200))}}if(!ready)throw Error('Temporary database not ready');
 const port=(await run('docker',['port',container,'5432/tcp'],'db-port.log')).trim().split(':').at(-1);if(!/^\d+$/.test(port))throw Error('Invalid local port');env.DATABASE_URL='postgresql://fleetum_e03_otp:'+password+'@127.0.0.1:'+port+'/fleetum_e03_otp_test?schema=public';
 await run(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy','--schema','backend/prisma/schema.prisma'],'db-migrations.log');
 await run(process.execPath,['--import','tsx','--test','--test-concurrency=1','--test-timeout=40000','backend/tests/security/contract-signing-otp.test.ts'],'signing-http-db.log');
 console.log('Signing synthetic HTTP/PostgreSQL tests passed.');
}finally{clearTimeout(deadline);for(const c of children)c.kill('SIGTERM');try{await run('docker',['rm','-f',container],'db-cleanup.log');removed=true}catch{}await rm(scratch,{recursive:true,force:true});await writeFile(evidence+'/database-cleanup.json',JSON.stringify({container,containerRemoved:removed,scratchRemoved:true,syntheticOnly:true},null,2));console.log('Temporary runtime removed='+removed);}
