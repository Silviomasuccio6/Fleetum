import assert from "node:assert/strict";
export type DedicatedDatabase={user:string;database:string;port?:string;uploadPrefix?:string};
/** Accept only the named loopback laboratories or the isolated repository CI database. */
export function assertSyntheticDatabase(legacy?:DedicatedDatabase,variables:NodeJS.ProcessEnv=process.env){
 assert.equal(variables.NODE_ENV,"test","Persistent tests require NODE_ENV=test");
 assert.equal(variables.RUN_TENANT_ISOLATION_TESTS,"1","Persistent tests require explicit opt-in");
 assert.equal(variables.DOTENV_CONFIG_PATH,"/dev/null","Real environment files are forbidden in persistent tests");
 const target=new URL(variables.DATABASE_URL??"postgresql://invalid/invalid");
 assert.equal(target.protocol,"postgresql:");assert.equal(target.hostname,"127.0.0.1","Only a loopback PostgreSQL is permitted");
 assert.match(target.port,/^[1-9]\d{0,4}$/);assert.ok(Number(target.port)<=65535);
 const upload=variables.UPLOAD_DIR??"";
 assert.match(upload,/^(?:\/private)?\/(?:tmp|var\/folders\/[^/]+\/[^/]+\/T)\/fleetum-[A-Za-z0-9_.-]+(?:\/uploads)?$/,"Uploads must stay in a disposable Fleetum directory");
 const ci=target.username==="fleetum"&&target.pathname==="/fleetum_ci";
 if(ci){assert.match(upload,/^(?:\/private)?\/(?:tmp|var\/folders\/[^/]+\/[^/]+\/T)\/fleetum-(?:ci-uploads\.[A-Za-z0-9]+|verify-uploads-[A-Za-z0-9_-]+)(?:\/uploads)?$/,"CI uploads must belong to the temporary runner");}
 else{
  assert.ok(legacy,"This suite requires the named temporary CI database");
  assert.equal(target.username,legacy.user);assert.equal(target.pathname,"/"+legacy.database);
  if(legacy.port)assert.equal(target.port,legacy.port);
  if(legacy.uploadPrefix)assert.ok(upload.startsWith(legacy.uploadPrefix),"Dedicated uploads must stay in their temporary laboratory");
 }
 assert.equal(target.searchParams.get("host"),null,"Connection host overrides are forbidden");
 return{ci,uploadDir:upload};
}
