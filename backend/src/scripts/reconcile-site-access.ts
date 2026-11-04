import fs from "node:fs/promises";
import { SiteAccessReconciliationService } from "../application/services/site-access-reconciliation-service.js";
import { prisma } from "../infrastructure/database/prisma/client.js";

// An explicit tenant and active ADMIN are mandatory even for an inventory.
// Output files are private and reserved before a mutation; existing files are never overwritten.
const main=async()=>{
  const args=process.argv.slice(2),allowed=new Set(["--tenant","--actor","--selection","--apply","--output"]),values=new Map<string,string>();
  for(let i=0;i<args.length;i+=2){const key=args[i],value=args[i+1];if(!allowed.has(key)||!value||value.startsWith("--")||values.has(key))throw new Error("Argomenti non validi");values.set(key,value);}
  const tenant=values.get("--tenant"),actor=values.get("--actor");if(!tenant||!actor||values.has("--selection")&&values.has("--apply"))throw new Error("Tenant, amministratore e operazione espliciti obbligatori");
  const output=values.get("--output"),file=output?await fs.open(output,"wx",0o600):undefined;
  let confirmed=false;
  try{
    const service=new SiteAccessReconciliationService();
    const read=async(path:string)=>{const stat=await fs.stat(path);if(stat.size>131072)throw new Error("Manifest troppo grande");return JSON.parse(await fs.readFile(path,"utf8"));};
    const result=values.has("--apply")?await service.apply(tenant,actor,await read(values.get("--apply")!)):await service.plan(tenant,actor,values.has("--selection")?await read(values.get("--selection")!):undefined);
    if(file){await file.writeFile(JSON.stringify(result,null,2)+"\n");await file.sync();confirmed=true;process.stdout.write('{"written":true}\n');}
    else process.stdout.write(JSON.stringify(result,null,2)+"\n");
  }finally{
    await file?.close();
    if(output&&!confirmed)await fs.unlink(output).catch(()=>{});
  }
};
main().catch(error=>{process.stderr.write(JSON.stringify({error:typeof error?.code==="string"?error.code:"SITE_RECONCILIATION_FAILED",message:"Operazione non confermata. Verifica l’esito prima di riprovare e genera un piano aggiornato."})+"\n");process.exitCode=1;}).finally(()=>prisma.$disconnect());
