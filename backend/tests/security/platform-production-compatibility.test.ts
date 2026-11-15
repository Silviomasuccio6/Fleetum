import assert from "node:assert/strict";
import {after,before,test} from "node:test";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import {prisma} from "../../src/infrastructure/database/prisma/client.js";
import {env} from "../../src/shared/config/env.js";
import {PlatformSessionService} from "../../src/application/services/platform-session-service.js";
import {requirePlatformAuth} from "../../src/interfaces/http/middlewares/platform-auth.js";
import {InvoiceService} from "../../src/application/services/invoice-service.js";
import {EmailQueueService} from "../../src/infrastructure/email/email-queue-service.js";
import {PlatformInvoiceOutboxProcessor} from "../../src/infrastructure/email/platform-invoice-outbox.js";

const url=new URL(env.DATABASE_URL);
assert.equal(process.env.ALLOW_SYNTHETIC_PLATFORM_DATABASE,"yes");
assert.equal(url.hostname,"127.0.0.1");
assert.match(url.pathname,/^\/fleetum_platform_patch_[a-f0-9]+$/);
before(async()=>{const rows=await prisma.$queryRawUnsafe<Array<{cluster_name:string}>>("SHOW cluster_name");assert.equal(rows[0].cluster_name,"fleetum_platform_synthetic_20261115");});
after(async()=>{await prisma.$disconnect();});
const token=()=>jwt.sign({userId:"platform-admin",tenantId:"platform",roles:["PLATFORM_ADMIN"],permissions:["platform:manage"],platformAdmin:true,tokenType:"platform",jti:crypto.randomUUID()},env.PLATFORM_JWT_SECRET,{expiresIn:"5m"});
const authorize=async(bearer:string)=>{let failure:any;await requirePlatformAuth({headers:{authorization:`Bearer ${bearer}`}} as any,{} as any,(e:any)=>{failure=e;});return failure;};
async function fixture(){
 const suffix=crypto.randomUUID();
 const tenant=await prisma.tenant.create({data:{id:"platform-qa-"+suffix,name:"Synthetic Platform QA"}});
 const invoice=await prisma.invoice.create({data:{tenantId:tenant.id,invoiceNumber:"QA-"+suffix,status:"GENERATED",issueDate:new Date(),dueDate:new Date(),periodStart:new Date(),periodEnd:new Date(),currency:"EUR",subtotal:100,taxRate:22,taxAmount:22,total:122,billingName:"Synthetic Company",billingEmail:"billing@example.test"}});
 const queue=new EmailQueueService();queue.processPending=async()=>({processed:0});
 const service=new InvoiceService(queue);(service as any).renderPdf=async()=>Buffer.from("synthetic-pdf");
 const input={invoiceId:invoice.id,actorUserId:"platform-admin",sourceIp:"127.0.0.1",idempotencyKey:"qa-"+suffix};
 return {tenant,invoice,service,input};
}
test("native PostgreSQL logout is idempotent and rejects bearer replay",async()=>{
 const service=new PlatformSessionService(),bearer=token();assert.equal(await authorize(bearer),undefined);
 await Promise.all([service.logout(bearer),service.logout(bearer)]);
 assert.equal(await service.isRevoked(bearer),true);assert.equal((await authorize(bearer))?.code,"PLATFORM_SESSION_REVOKED");assert.equal(await authorize(token()),undefined);
 const hash=crypto.createHash("sha256").update(bearer).digest("hex");
 assert.equal(await prisma.platformSecurityEvent.count({where:{action:"PLATFORM_SESSION_REVOKED",details:{path:["tokenHash"],equals:hash}}}),1);
});
test("a failed durable logout transaction does not falsely record revocation",async()=>{
 const bearer=token();
 await prisma.$executeRawUnsafe(`CREATE FUNCTION qa_reject_logout() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='PLATFORM_SESSION_REVOKED' THEN RAISE EXCEPTION 'synthetic revocation failure'; END IF; RETURN NEW; END $$`);
 await prisma.$executeRawUnsafe(`CREATE TRIGGER qa_reject_logout BEFORE INSERT ON "PlatformSecurityEvent" FOR EACH ROW EXECUTE FUNCTION qa_reject_logout()`);
 try{await assert.rejects(()=>new PlatformSessionService().logout(bearer));assert.equal(await new PlatformSessionService().isRevoked(bearer),false);}finally{await prisma.$executeRawUnsafe(`DROP TRIGGER qa_reject_logout ON "PlatformSecurityEvent"`);await prisma.$executeRawUnsafe(`DROP FUNCTION qa_reject_logout()`);}
});
test("concurrent invoice commands create one delivery and one queue row",async()=>{
 const f=await fixture();const result=await Promise.all([f.service.sendEmail(f.input),f.service.sendEmail(f.input)]);
 assert.deepEqual(result.map(x=>x.replayed).sort(),[false,true]);assert.equal(result[0].emailDelivery.status,"PENDING");
 assert.equal(await prisma.invoiceEmailRequest.count({where:{tenantId:f.tenant.id}}),1);assert.equal(await prisma.invoiceDelivery.count({where:{invoiceId:f.invoice.id}}),1);assert.equal(await prisma.emailQueue.count({where:{tenantId:f.tenant.id,type:"SAAS_INVOICE_EMAIL"}}),1);
});
test("a reused key with a different invoice payload has no new side effects",async()=>{
 const f=await fixture();await f.service.sendEmail(f.input);await prisma.invoice.update({where:{id:f.invoice.id},data:{billingEmail:"changed@example.test"}});
 await assert.rejects(()=>f.service.sendEmail(f.input),(e:any)=>e.code==="IDEMPOTENCY_KEY_REUSED");assert.equal(await prisma.emailQueue.count({where:{tenantId:f.tenant.id}}),1);
});
test("invoice outbox enqueue rolls back delivery and queue if ledger insertion fails",async()=>{
 const f=await fixture();f.input.idempotencyKey="synthetic-rollback-command";
 await prisma.$executeRawUnsafe(`CREATE FUNCTION qa_reject_invoice_command() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."idempotencyKey"='synthetic-rollback-command' THEN RAISE EXCEPTION 'synthetic ledger failure'; END IF; RETURN NEW; END $$`);
 await prisma.$executeRawUnsafe(`CREATE TRIGGER qa_reject_invoice_command BEFORE INSERT ON "InvoiceEmailRequest" FOR EACH ROW EXECUTE FUNCTION qa_reject_invoice_command()`);
 try{await assert.rejects(()=>f.service.sendEmail(f.input));assert.equal(await prisma.invoiceDelivery.count({where:{invoiceId:f.invoice.id}}),0);assert.equal(await prisma.emailQueue.count({where:{tenantId:f.tenant.id}}),0);}finally{await prisma.$executeRawUnsafe(`DROP TRIGGER qa_reject_invoice_command ON "InvoiceEmailRequest"`);await prisma.$executeRawUnsafe(`DROP FUNCTION qa_reject_invoice_command()`);}
});
test("native PostgreSQL consumers finalize a single invoice delivery",async()=>{
 const f=await fixture();await f.service.sendEmail(f.input);const queued=await prisma.emailQueue.findFirstOrThrow({where:{tenantId:f.tenant.id}});let calls=0;
 const worker=new PlatformInvoiceOutboxProcessor(prisma,{send:async()=>{calls++;return {provider:"resend",id:"synthetic-receipt-"+f.invoice.id};}});
 await Promise.all([worker.processPending(new Date(),{ids:[queued.id]}),worker.processPending(new Date(),{ids:[queued.id]})]);
 assert.equal(calls,1);assert.equal((await prisma.emailQueue.findUniqueOrThrow({where:{id:queued.id}})).status,"SENT");assert.equal((await prisma.invoice.findUniqueOrThrow({where:{id:f.invoice.id}})).status,"SENT");
});
test("a local finalization failure preserves the receipt and avoids another provider call",async()=>{
 const f=await fixture();await f.service.sendEmail(f.input);const queued=await prisma.emailQueue.findFirstOrThrow({where:{tenantId:f.tenant.id}});let calls=0;
 const worker=new PlatformInvoiceOutboxProcessor(prisma,{send:async()=>{calls++;return {provider:"resend",id:"synthetic-persisted-receipt"};}});
 await prisma.$executeRawUnsafe(`CREATE FUNCTION qa_reject_delivery_finalization() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='SENT' THEN RAISE EXCEPTION 'synthetic finalization failure'; END IF; RETURN NEW; END $$`);
 await prisma.$executeRawUnsafe(`CREATE TRIGGER qa_reject_delivery_finalization BEFORE UPDATE ON "InvoiceDelivery" FOR EACH ROW EXECUTE FUNCTION qa_reject_delivery_finalization()`);
 const now=new Date();
 try{await worker.processPending(now,{ids:[queued.id]});const row=await prisma.emailQueue.findUniqueOrThrow({where:{id:queued.id}});assert.equal(row.status,"PENDING");assert.equal((row.meta as any).providerMessageId,"synthetic-persisted-receipt");}finally{await prisma.$executeRawUnsafe(`DROP TRIGGER qa_reject_delivery_finalization ON "InvoiceDelivery"`);await prisma.$executeRawUnsafe(`DROP FUNCTION qa_reject_delivery_finalization()`);}
 await worker.processPending(new Date(now.getTime()+180000),{ids:[queued.id]});assert.equal(calls,1);assert.equal((await prisma.emailQueue.findUniqueOrThrow({where:{id:queued.id}})).status,"SENT");
});
