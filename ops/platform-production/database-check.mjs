import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, readdirSync, existsSync, rmSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, json, put, digest, extractRole, baseReport, tapCount, audit } from './ci.mjs';
import { BASES } from '../platform-release/production-candidate.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const CONTROL=path.resolve(HERE,'../..');
const CLUSTER='fleetum_platform_synthetic_20261115';
export function databaseConfig(file) {
  const info=lstatSync(file);assert.ok(info.isFile()&&!info.isSymbolicLink()&&info.size<=16384&&(info.mode&0o077)===0,'Private synthetic session file required');
  const c=json(file);
  assert.ok(c.syntheticOnly===true&&c.host==='127.0.0.1'&&c.user==='fleetum_qa'&&c.cluster===CLUSTER,'Synthetic loopback cluster required');
  assert.ok(Number.isSafeInteger(c.port)&&c.port>1024&&c.port<65536&&typeof c.password==='string'&&c.password.length>=12);
  return c;
}
function exported(ref,label,out) {
  const archive=path.join(out,label+'.tar.gz'),target=path.join(out,label);
  run('git',['archive','--format=tar.gz','--output='+archive,ref,'backend/prisma/schema.prisma','backend/prisma/migrations'],{cwd:CONTROL});
  run('python3',[path.join(HERE,'archives.py'),'extract',archive,target]);
  rmSync(archive);return path.join(target,'backend/prisma/schema.prisma');
}
export async function backend(sources,configFile,directory) {
  const out=path.resolve(directory);assert.ok(!existsSync(out)&&!out.startsWith(CONTROL+path.sep));mkdirSync(out);
  const c=databaseConfig(configFile),{root,proof}=extractRole(sources,'backend',out);
  const env={NODE_ENV:'test',PLATFORM_ADMIN_EMAIL:'platform-qa@example.test',UPLOAD_DIR:path.join(out,'synthetic-uploads')};
  run('npm',['ci','--workspace','backend'],{cwd:root,env,log:path.join(out,'install.log')});
  run('npm',['run','prisma:generate','-w','backend'],{cwd:root,env,log:path.join(out,'prisma.log')});
  run('npm',['run','lint','-w','backend'],{cwd:root,env,log:path.join(out,'lint.log')});
  run('npm',['run','build','-w','backend'],{cwd:root,env,log:path.join(out,'build.log')});
  // The existing storage unit contract uses relative keys prefixed by
  // UPLOAD_DIR. Keep that contract; only HTTP/database fixtures need an
  // absolute task-owned upload root.
  const unit=run('npm',['test','-w','backend'],{cwd:root,env:{...env,UPLOAD_DIR:'uploads'},log:path.join(out,'unit.log')});
  const unitTests=tapCount(unit,186),counts=audit(root,'backend',path.join(out,'audit.json'));
  const {PrismaClient}=createRequire(path.join(root,'package.json'))('@prisma/client');
  const uri=db=>`postgresql://${c.user}:${encodeURIComponent(c.password)}@127.0.0.1:${c.port}/${db}?schema=public`;
  const client=db=>new PrismaClient({datasourceUrl:uri(db)});
  const control=client('postgres');
  const marker=crypto.randomBytes(6).toString('hex'),patchDB='fleetum_platform_patch_'+marker,futureDB='fleetum_platform_forward_'+marker;
  const id=name=>{assert.match(name,/^fleetum_platform_(patch|forward)_[0-9a-f]{12}$/);return '"'+name+'"';};
  const databaseEnv=db=>({...env,DATABASE_URL:uri(db),ALLOW_SYNTHETIC_PLATFORM_DATABASE:'yes',RUN_TENANT_ISOLATION_TESTS:'1'});
  const command=(args,db,log)=>run(path.join(root,'node_modules/.bin/prisma'),args,{cwd:root,env:databaseEnv(db),redactions:[uri(db),c.password],log:path.join(out,log),timeout:180000});
  const migrate=(schema,db,log)=>command(['migrate','deploy','--schema',schema],db,log);
  const history=async db=>(await db.$queryRawUnsafe('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name')).map(x=>x.migration_name);
  const checked=async db=>{await db.$connect();assert.equal((await db.$queryRawUnsafe('SHOW cluster_name'))[0].cluster_name,CLUSTER);return db;};
  let current,createdPatch=false,createdFuture=false,trial;
  try {
    await checked(control);
    await control.$executeRawUnsafe('CREATE DATABASE '+id(patchDB));createdPatch=true;
    const baseline=exported(BASES.backend,'baseline',out);migrate(baseline,patchDB,'01-baseline-migrations.log');
    current=await checked(client(patchDB));const baselineNames=await history(current);assert.equal(baselineNames.length,42);
    await current.$executeRawUnsafe(`INSERT INTO "PlatformSecurityEvent" (id,action,details) VALUES ('source-ci-marker','SYNTHETIC_BEFORE_PATCH','{"marker":"keep"}'::jsonb)`);
    await current.$executeRawUnsafe(`INSERT INTO "EmailQueue" (id,type,recipient,subject,body,"updatedAt") VALUES ('source-ci-legacy','SAAS_INVOICE_EMAIL','legacy@example.test','Synthetic','Synthetic',CURRENT_TIMESTAMP)`);
    const before=await current.$queryRawUnsafe(`SELECT id,type,recipient,subject,body,status,attempts,"createdAt","updatedAt" FROM "EmailQueue" WHERE id='source-ci-legacy'`);
    await current.$disconnect();current=null;
    migrate(path.join(root,'backend/prisma/schema.prisma'),patchDB,'02-patch-migrations.log');
    current=await checked(client(patchDB));const patched=await history(current);assert.equal(patched.length,43);
    const after=await current.$queryRawUnsafe(`SELECT id,type,recipient,subject,body,status,attempts,"createdAt","updatedAt" FROM "EmailQueue" WHERE id='source-ci-legacy'`);
    assert.deepEqual(after,before);await current.$disconnect();current=null;
    const securityFiles=readdirSync(path.join(root,'backend/tests/security')).filter(f=>f.endsWith('.test.ts')).sort().map(f=>'backend/tests/security/'+f);
    assert.equal(securityFiles.length,2,'Unexpected source security inventory requires review');
    const tap=run(process.execPath,['--import','tsx','--test','--test-concurrency=1',...securityFiles],{cwd:root,env:databaseEnv(patchDB),redactions:[uri(patchDB),c.password],log:path.join(out,'03-security-tests.log'),timeout:300000});
    const databaseTests=tapCount(tap,13);
    await control.$executeRawUnsafe('CREATE DATABASE '+id(futureDB)+' WITH TEMPLATE '+id(patchDB));createdFuture=true;
    const future=exported(BASES.fallback,'future-main',out);migrate(future,futureDB,'04-forward-migrations.log');
    current=await checked(client(futureDB));const futureNames=await history(current);assert.equal(futureNames.length,48);
    assert.deepEqual(await current.$queryRawUnsafe(`SELECT details FROM "PlatformSecurityEvent" WHERE id='source-ci-marker'`),[{details:{marker:'keep'}}]);
    const migration='backend/prisma/migrations/20260921150000_final_release_blocker_atomicity/migration.sql';
    assert.deepEqual(readFileSync(path.join(root,migration)),readFileSync(path.join(out,'future-main',migration)));
    trial={databaseTests,migrationChain:{baseline:42,patched:43,future:48,preserved:true,canonical:true},postgresVersion:(await current.$queryRawUnsafe('SHOW server_version'))[0].server_version};
  } finally {
    if(current)await current.$disconnect();
    if(createdFuture)await control.$executeRawUnsafe('DROP DATABASE '+id(futureDB)+' WITH (FORCE)');
    if(createdPatch)await control.$executeRawUnsafe('DROP DATABASE '+id(patchDB)+' WITH (FORCE)');
    await control.$disconnect();
    rmSync(path.join(out,'synthetic-uploads'),{recursive:true,force:true});
  }
  const archive=path.join(out,'backend.compiled.tar.gz');run('python3',[path.join(HERE,'archives.py'),'pack',path.join(root,'backend/dist'),archive]);
  const report={...baseReport('backend',proof),unitTests,...trial,audit:counts,archiveSha256:digest(archive),syntheticOnly:true,temporaryDatabasesDropped:true};
  put(path.join(out,'backend.report.json'),report);return report;
}
