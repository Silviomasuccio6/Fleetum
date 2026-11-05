import {assertSyntheticDatabase} from "../helpers/synthetic-database.js";
import assert from "node:assert/strict";
import { before, after, describe, it } from "node:test";
import type http from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs/promises";
import sharp from "sharp";
import { PDFParse } from "pdf-parse";
import { createApp } from "../../src/app.js";
import { InvoiceService } from "../../src/application/services/invoice-service.js";
import { readInvoiceCompanyLogo } from "../../src/application/services/invoice-logo-service.js";
import { prisma } from "../../src/infrastructure/database/prisma/client.js";
import { storageProvider } from "../../src/infrastructure/storage/storage-provider.js";
import { signTenantAccessToken } from "../helpers/http-auth.js";

const run = `subscription-${Date.now()}`, ids: Record<string,string> = {}, tokens: Record<string,string> = {}, tenants: string[] = [];
let server: http.Server | undefined, base = "", archive: Buffer, logo: Buffer;
const service = new InvoiceService();
const generate = () => service.generateForTenant({ tenantId: ids.a, actorUserId: ids.admin, sourceIp: "192.0.2.10" });
const read = (who = "admin", id = ids.invoice, site = "all") => fetch(`${base}/billing/invoices/${id}/pdf`, { headers: { Authorization: `Bearer ${tokens[who]}`, "X-Fleetum-Site": site } });
const extract = async (buffer: Uint8Array) => { const reader = new PDFParse({ data: buffer.slice() }); try { return (await reader.getText()).text; } finally { await reader.destroy(); } };

describe("subscription copies through authenticated HTTP on disposable PostgreSQL", () => {
  before(async () => {
    assertSyntheticDatabase({user:"fleetum_e01",database:"fleetum_e01_test",port:"61521",uploadPrefix:"/private/tmp/fleetum-e01-invoice-"});
    assert.equal(process.env.NODE_ENV, "test"); const url = new URL(process.env.DATABASE_URL!);


    const permission = await prisma.permission.upsert({ where:{key:"billing:read"}, update:{}, create:{key:"billing:read",description:"Synthetic billing read"} });
    for (const key of ["ADMIN","MANAGER","OPERATOR","VIEWER"]) {
      const role = await prisma.role.upsert({where:{key},update:{},create:{key,name:key}}); ids[key]=role.id;
      if (["MANAGER","OPERATOR"].includes(key)) await prisma.rolePermission.upsert({where:{roleId_permissionId:{roleId:role.id,permissionId:permission.id}},update:{},create:{roleId:role.id,permissionId:permission.id}});
    }
    for (const key of ["a","b"]) {
      ids[key] = (await prisma.tenant.create({data:{name:`Synthetic ${run}-${key}`}})).id; tenants.push(ids[key]);
      await prisma.tenantSubscription.create({data:{tenantId:ids[key],provider:"test",plan:"ENTERPRISE",status:"ACTIVE",seats:20}});
      await prisma.tenantProfile.create({data:{tenantId:ids[key],legalName:key==="a" ? "Autonoleggio Sintetico Storico Srl" : "FOREIGN_BILLING_IDENTITY",legalAddress:"Via sintetica 1",email:`billing-${key}@example.invalid`,vatNumber:"00000000000"}});
      ids[key+"Site"]=(await prisma.site.create({data:{tenantId:ids[key],name:"Synthetic Roma",city:"Synthetic",address:"Synthetic"}})).id;
    }
    for (const [who,role,tenant] of [["admin","ADMIN",ids.a],["manager","MANAGER",ids.a],["operator","OPERATOR",ids.a],["nopermission","VIEWER",ids.a],["foreign","ADMIN",ids.b]]) {
      ids[who]=(await prisma.user.create({data:{tenantId:tenant,email:`${run}-${who}@example.invalid`,firstName:"Synthetic",lastName:who,passwordHash:"not-a-login-hash",assignedSiteId:ids[tenant===ids.a ? "aSite":"bSite"],roles:{create:{roleId:ids[role]}}}})).id;
      const session=await prisma.refreshSession.create({data:{tenantId:tenant,userId:ids[who],tokenHash:`${run}-${who}`,expiresAt:new Date(Date.now()+3600000)}});
      tokens[who]=signTenantAccessToken({tenantId:tenant,userId:ids[who],sessionId:session.id}); ids[who+"Session"]=session.id;
    }
    logo=await sharp({create:{width:160,height:40,channels:4,background:"#21375d"}}).png().toBuffer(); ids.logoKey=`tenants/${ids.a}/branding/synthetic.png`;
    await storageProvider.write(ids.logoKey,logo);
    await prisma.storedFileObject.create({data:{tenantId:ids.a,provider:storageProvider.name,storageKey:ids.logoKey,resourceType:"TenantBranding",resourceId:ids.a,sizeBytes:logo.length,mimeType:"image/png"}});
    await prisma.tenantBranding.create({data:{tenantId:ids.a,logoFilePath:ids.logoKey}});
    const generated=await generate(); ids.invoice=generated.data.id;
    server=createApp().listen(0,"127.0.0.1"); await new Promise<void>(resolve=>server!.once("listening",resolve));base=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  });
  after(async () => {
    if(server?.listening) await new Promise<void>((resolve,reject)=>server!.close(e=>e?reject(e):resolve()));
    if(tenants.length) {
      const where={tenantId:{in:tenants}};
      await prisma.invoiceDelivery.deleteMany({where:{invoice:where}});await prisma.invoiceItem.deleteMany({where:{invoice:where}});await prisma.invoice.deleteMany({where});
      await prisma.emailQueue.deleteMany({where});await prisma.auditLog.deleteMany({where});await prisma.refreshSession.deleteMany({where});await prisma.userRole.deleteMany({where:{user:where}});await prisma.user.deleteMany({where});
      await prisma.site.deleteMany({where});await prisma.tenantBranding.deleteMany({where});await prisma.tenantProfile.deleteMany({where});await prisma.storedFileObject.deleteMany({where});await prisma.tenantSubscription.deleteMany({where});await prisma.tenant.deleteMany({where:{id:{in:tenants}}});
    }
    await prisma.$disconnect(); if(process.env.UPLOAD_DIR?.startsWith("/private/tmp/fleetum-e01-invoice-"))await fs.rm(process.env.UPLOAD_DIR,{recursive:true,force:true});
  });
  it("returns a private archived copy containing saved billing fields and amounts",async()=>{
    const response=await read();assert.equal(response.status,200,await response.clone().text());assert.equal(response.headers.get("cache-control"),"private, no-store");assert.equal(response.headers.get("x-content-type-options"),"nosniff");
    archive=Buffer.from(await response.arrayBuffer()); const text=await extract(archive);
    for(const expected of ["COPIA DI CORTESIA","Autonoleggio Sintetico Storico Srl","Abbonamento Fleetum","181,78","32,78"])assert.ok(text.includes(expected),expected);
    assert.ok(!text.includes("FOREIGN_BILLING_IDENTITY")); const row=await prisma.invoice.findUniqueOrThrow({where:{id:ids.invoice}});assert.ok(row.pdfFilePath?.startsWith(`tenants/${ids.a}/invoices/`));ids.archiveKey=row.pdfFilePath!;
    assert.equal(await prisma.storedFileObject.count({where:{tenantId:ids.a,resourceType:"Invoice",resourceId:ids.invoice}}),1);
  });
  it("preserves identical PDF bytes after address, logo, company name and status change",async()=>{
    await prisma.tenantProfile.update({where:{tenantId:ids.a},data:{legalName:"Current identity must not replace history",legalAddress:"New synthetic address"}});
    await prisma.tenant.update({where:{id:ids.a},data:{name:"Current company"}});await storageProvider.write(ids.logoKey,Buffer.from("corrupt current logo"));await prisma.invoice.update({where:{id:ids.invoice},data:{status:"PAID"}});
    const old=process.env.FLEETUM_BILLING_LEGAL_NAME;process.env.FLEETUM_BILLING_LEGAL_NAME="Changed issuer";
    try {assert.deepEqual(Buffer.from(await (await read()).arrayBuffer()),archive);assert.deepEqual(await service.pdfBufferForPlatform(ids.invoice),archive);}finally{if(old===undefined)delete process.env.FLEETUM_BILLING_LEGAL_NAME;else process.env.FLEETUM_BILLING_LEGAL_NAME=old;}
  });
  it("keeps foreign tenants, missing permission, operator and selected-site billing out",async()=>{
    assert.equal((await read("foreign")).status,404);assert.equal((await read("nopermission")).status,403);assert.equal((await read("operator")).status,403);
    assert.equal((await read("manager",ids.invoice,ids.aSite)).status,403);assert.equal((await read("manager")).status,200);
    assert.equal((await fetch(`${base}/billing/invoices/${ids.invoice}/pdf`)).status,401);
  });
  it("checks session revocation before exposing the stored PDF",async()=>{
    await prisma.refreshSession.update({where:{id:ids.managerSession},data:{revokedAt:new Date()}});assert.equal((await read("manager")).status,401);
  });
  it("rejects forged archive keys and metadata before reading any object",async()=>{
    const original=storageProvider.read, reads:string[]=[];storageProvider.read=async key=>{reads.push(key);return original.call(storageProvider,key);};
    try {
      await prisma.invoice.update({where:{id:ids.invoice},data:{pdfFilePath:`tenants/${ids.b}/invoices/foreign.pdf`}});assert.equal((await read()).status,503);assert.deepEqual(reads,[]);
      await prisma.invoice.update({where:{id:ids.invoice},data:{pdfFilePath:ids.archiveKey}});await prisma.storedFileObject.updateMany({where:{storageKey:ids.archiveKey},data:{resourceId:"foreign-invoice"}});assert.equal((await read()).status,503);assert.deepEqual(reads,[]);
    }finally{storageProvider.read=original;await prisma.storedFileObject.updateMany({where:{storageKey:ids.archiveKey},data:{resourceId:ids.invoice}});}
  });
  it("detects changed archive bytes and never silently regenerates a finalized copy",async()=>{
    await storageProvider.write(ids.archiveKey,Buffer.from("%PDF-tampered"));assert.equal((await read()).status,503);await storageProvider.write(ids.archiveKey,archive);assert.equal((await read()).status,200);
  });
  it("never loads a cross-tenant, unregistered or tombstoned company logo",async()=>{
    const original=storageProvider.read,reads:string[]=[];storageProvider.read=async key=>{reads.push(key);return original.call(storageProvider,key);};
    try {
      for(const key of [`tenants/${ids.b}/branding/foreign.png`,`tenants/${ids.a}/branding/missing.png`]){await prisma.tenantBranding.update({where:{tenantId:ids.a},data:{logoFilePath:key}});assert.equal(await readInvoiceCompanyLogo(ids.a),null);}
      await prisma.tenantBranding.update({where:{tenantId:ids.a},data:{logoFilePath:ids.logoKey}});await prisma.storedFileObject.updateMany({where:{storageKey:ids.logoKey},data:{deletedAt:new Date()}});assert.equal(await readInvoiceCompanyLogo(ids.a),null);assert.deepEqual(reads,[]);
    }finally{storageProvider.read=original;await prisma.storedFileObject.updateMany({where:{storageKey:ids.logoKey},data:{deletedAt:null}});await storageProvider.write(ids.logoKey,logo);}
  });
  it("commits invoice, PDF link and private metadata together; a failed domain write removes the staged object",async()=>{
    const beforeInvoices=await prisma.invoice.count(), beforeObjects=await prisma.storedFileObject.count(), original=prisma.$transaction, written:string[]=[], originalWrite=storageProvider.writeNew;
    storageProvider.writeNew=async(...args)=>{written.push(args[0]);return originalWrite.apply(storageProvider,args);};
    (prisma as any).$transaction=(callback:any,options:any)=>original.call(prisma,(tx:any)=>callback(new Proxy(tx,{get(target,key){return key === "auditLog" ? {create:async()=>{throw new Error("Synthetic rollback after domain write");}} : Reflect.get(target,key);}})),options);
    try{await assert.rejects(()=>generate(),/Synthetic rollback/);}finally{(prisma as any).$transaction=original;storageProvider.writeNew=originalWrite;}
    assert.equal(await prisma.invoice.count(),beforeInvoices);assert.equal(await prisma.storedFileObject.count(),beforeObjects);assert.equal(written.length,1);assert.equal(await storageProvider.exists(written[0]),false);
  });
  it("recovers a lost commit acknowledgement without duplicating invoices or deleting their PDF",async()=>{
    const original=prisma.$transaction,before=await prisma.invoice.count();
    (prisma as any).$transaction=async(callback:any,options:any)=>{await original.call(prisma,callback,options);throw new Error("Synthetic acknowledgement loss after real COMMIT");};
    let result;try{result=await generate();}finally{(prisma as any).$transaction=original;}
    assert.equal(await prisma.invoice.count(),before+1);assert.ok((await service.pdfBufferForPlatform(result.data.id)).length>1000);
  });
  it("does not queue mail, create another invoice or change financial rows when downloading",async()=>{
    const before=await prisma.invoice.count();await read();await read();assert.equal(await prisma.invoice.count(),before);assert.equal(await prisma.emailQueue.count({where:{tenantId:ids.a}}),0);
  });
});
