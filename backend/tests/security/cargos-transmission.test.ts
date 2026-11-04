import assert from "node:assert/strict";
import crypto from "node:crypto";
import { before,after,test,describe } from "node:test";
import type http from "node:http";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/infrastructure/database/prisma/client.js";
import { signTenantAccessToken } from "../helpers/http-auth.js";
let tokenGate:Promise<void>|undefined,tokenEntered:(()=>void)|undefined;
const originalFetch=globalThis.fetch;let server:http.Server,base="";const ids:Record<string,string>={},tokens:Record<string,string>={};
let mode:"accepted"|"rejected"|"unknown"|"blocked"|"check-invalid"="accepted",sendCalls=0,checkCalls=0,release:(()=>void)|undefined,entered:(()=>void)|undefined;
const request=(path:string,method="GET",body?:unknown,who="admin")=>originalFetch(base+path,{method,headers:{Authorization:`Bearer ${tokens[who]}`,"Content-Type":"application/json","X-Fleetum-Site":"all"},...(body===undefined?{}:{body:JSON.stringify(body)})});
const api=(suffix:string,method="GET",body?:unknown,who="admin")=>request(`/rental-bookings/${ids.booking}${suffix}`,method,body,who);
describe("CARGOS synthetic HTTP and tenant boundaries",()=>{
before(async()=>{
 assert.equal(process.env.NODE_ENV,"test");const url=new URL(process.env.DATABASE_URL!);assert.equal(url.hostname,"127.0.0.1");assert.equal(process.env.RUN_TENANT_ISOLATION_TESTS,"1");
 const e03=url.pathname==="/fleetum_e03_test"&&url.username==="fleetum_e03";
 const ci=url.pathname==="/fleetum_ci"&&url.username==="fleetum";
 assert.ok(e03||ci,"Only a named temporary test database is allowed");
 assert.match(process.env.UPLOAD_DIR??"",/^(?:\/private)?\/(?:tmp|var\/folders\/[^/]+\/[^/]+\/T)\/fleetum-(?:e03-|ci-uploads\.|verify-uploads-)/);
 for(const which of ["a","b"]){ids[which]=(await prisma.tenant.create({data:{name:`Synthetic E03 ${which}`}})).id;await prisma.tenantSubscription.create({data:{tenantId:ids[which],provider:"test",plan:"ENTERPRISE",status:"ACTIVE",seats:10}});}
 const admin=await prisma.role.upsert({where:{key:"ADMIN"},update:{},create:{key:"ADMIN",name:"Synthetic admin"}});const viewer=await prisma.role.upsert({where:{key:"VIEWER"},update:{},create:{key:"VIEWER",name:"Synthetic viewer"}});
 for(const[who,tenant,role]of[["admin",ids.a,admin.id],["foreign",ids.b,admin.id],["viewer",ids.a,viewer.id]]){
  const user=await prisma.user.create({data:{tenantId:tenant,email:`e03-${who}@example.invalid`,firstName:"Synthetic",lastName:who,status:"ACTIVE",passwordHash:"not-a-real-password",roles:{create:{roleId:role}}}});ids[who]=user.id;
  const session=await prisma.refreshSession.create({data:{tenantId:tenant,userId:user.id,tokenHash:`e03-${who}`,expiresAt:new Date(Date.now()+3600000)}});tokens[who]=signTenantAccessToken({tenantId:tenant,userId:user.id,sessionId:session.id,roles:who==="viewer"?["VIEWER"]:["ADMIN"],permissions:who==="viewer"?[]:undefined});
 }
 ids.site=(await prisma.site.create({data:{tenantId:ids.a,name:"Sede sintetica",address:"Via sintetica 1",city:"Roma"}})).id;
 const customer=await prisma.rentalCustomer.create({data:{tenantId:ids.a,firstName:"Anna",lastName:"Test",dateOfBirth:new Date("1990-01-01"),documentNumber:"TESTDOC",drivingLicenseNumber:"TESTPATENTE",phone:"05555555"}});
 const vehicle=await prisma.vehicle.create({data:{tenantId:ids.a,siteId:ids.site,plate:"QA001AA",brand:"Fiat",model:"Panda"}});
 ids.booking=(await prisma.rentalBooking.create({data:{tenantId:ids.a,siteId:ids.site,pickupSiteId:ids.site,returnSiteId:ids.site,vehicleId:vehicle.id,customerId:customer.id,customerName:"Anna Test",code:"E03-001",pickupAt:new Date("2026-11-01T10:00:00Z"),returnAt:new Date("2026-11-03T10:00:00Z"),pickupLocation:"Via sintetica 1",returnLocation:"Via sintetica 1",status:"CONFIRMED"}})).id;
 ids.contract=(await prisma.bookingContract.create({data:{tenantId:ids.a,bookingId:ids.booking,title:"Contratto sintetico",content:"Condizioni sintetiche per test isolato",signedAt:new Date("2026-10-29T10:00:00Z"),status:"SIGNED"}})).id;
 globalThis.fetch=async(input,init)=>{
  const target=String(input);assert.ok(target.startsWith("https://cargos.poliziadistato.it/CARGOS_API/api/"),"No real external network allowed");
  if(target.endsWith("Token")){tokenEntered?.();if(tokenGate)await tokenGate;return new Response(JSON.stringify({token_type:"Bearer",access_token:"synthetic-token",expires_date:"2099-01-01T00:00:00Z"}));}
  if(target.endsWith("Check")){checkCalls++;return new Response(JSON.stringify(mode==="check-invalid"?[{esito:false,errore:{error_code:45,error_description:"sensitive-validation-details"}}]:[{esito:true}]));}
  assert.ok(target.endsWith("Send"));sendCalls++;
  const rows=JSON.parse(String(init?.body));assert.equal(rows.length,1);assert.equal(rows[0].length,1505);
  if(mode==="blocked"){entered?.();await new Promise<void>(resolve=>{release=resolve;});}
  const contractId=rows[0].slice(0,50).trim();
  return new Response(JSON.stringify(mode==="unknown"?{}:mode==="rejected"?[{esito:false,errore:{error_code:123,error_description:"must-not-leak"}}]:[{esito:true,transactionid:contractId===ids.contract?"SYNTHETIC-CARGOS-001":"SYNTHETIC-"+contractId}]));
 };
 server=createApp().listen(0,"127.0.0.1");await new Promise<void>(resolve=>server.once("listening",resolve));const address=server.address();assert.ok(address&&typeof address!=="string");base=`http://127.0.0.1:${address.port}/api`;
});
after(async()=>{
 release?.();globalThis.fetch=originalFetch;if(server?.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));
 const tenants=[ids.a,ids.b].filter(Boolean);const where={tenantId:{in:tenants}};
 if(tenants.length){
  await prisma.contractCargosReceipt.deleteMany({where});await prisma.contractCargosTransmission.deleteMany({where});await prisma.tenantCargosConnection.deleteMany({where});
  await prisma.bookingContractEvent.deleteMany({where});await prisma.bookingContractDelivery.deleteMany({where});await prisma.bookingContract.deleteMany({where});
  await prisma.rentalBookingNote.deleteMany({where});await prisma.rentalBookingPricingSnapshot.deleteMany({where});await prisma.rentalBookingCreateRequest.deleteMany({where});await prisma.rentalBooking.deleteMany({where});
  await prisma.contractTemplate.deleteMany({where});await prisma.rentalCustomer.deleteMany({where});await prisma.vehicle.deleteMany({where});
  await prisma.refreshSession.deleteMany({where});const users=await prisma.user.findMany({where,select:{id:true}});
  await prisma.userRole.deleteMany({where:{userId:{in:users.map(u=>u.id)}}});await prisma.user.deleteMany({where});
  await prisma.site.deleteMany({where});await prisma.tenantSubscription.deleteMany({where});await prisma.tenant.deleteMany({where:{id:{in:tenants}}});
 }
 await prisma.$disconnect();
});
test("CARGOS missing configuration stays unsent; foreign tenant and viewer are rejected",async()=>{
 const response=await api("/cargos");assert.equal(response.status,200,await response.clone().text());const data=await response.json() as any;assert.equal(data.configured,false);assert.equal(data.canSend,false);
 const attempt=await api("/cargos/transmit","POST",{sourceHash:data.sourceHash});assert.equal(attempt.status,409);assert.equal(sendCalls,0);
 assert.equal((await api("/cargos","GET",undefined,"foreign")).status,404);assert.equal((await api("/cargos/transmit","POST",{sourceHash:data.sourceHash},"viewer")).status,403);
 assert.equal((await api("/cargos","POST",{status:"SENT",transmissionId:"FAKE"})).status,410);assert.notEqual((await prisma.rentalBooking.findUniqueOrThrow({where:{id:ids.booking}})).cargosStatus,"SENT");
});
test("CARGOS configuration is tenant-bound and read never returns credentials",async()=>{
 const response=await request("/rental-bookings/cargos/configuration","PATCH",{enabled:true,credentials:{username:"synthetic-user",password:"synthetic-secret",apiKey:"012345678901234567890123456789010123456789012345"},agencies:{[ids.site]:{id:"SYNTHETIC",name:"Agenzia Test",placeCode:"100000001",address:"Via sintetica 1",phone:"05555555"}}});assert.equal(response.status,200,await response.clone().text());
 const body=await (await request("/rental-bookings/cargos/configuration")).text();assert.ok(!body.includes("synthetic-secret"));assert.ok(!body.includes("apiKey"));const stored=await prisma.tenantCargosConnection.findUniqueOrThrow({where:{tenantId:ids.a}});assert.ok(!stored.credentialsEncrypted.includes("synthetic-secret"));
 const before=await (await api("/cargos")).json() as any;const record=Object.fromEntries(before.fields.filter((f:any)=>f.editable).map((f:any)=>[f.key,!f.required?"":f.key.endsWith("_TIPO_COD")?"1":f.kind==="code"?"100000001":f.kind==="digit"?"1":""]));
 const draft=await api("/cargos/draft","PATCH",{record});assert.equal(draft.status,200,await draft.clone().text());assert.equal((await draft.json() as any).canSend,true);
});
test("CARGOS rejects shortened credential tags before any provider request",async()=>{
 const stored=await prisma.tenantCargosConnection.findUniqueOrThrow({where:{tenantId:ids.a}});
 const[iv,tag,data]=stored.credentialsEncrypted.split(".");assert.equal(Buffer.from(tag,"base64url").length,16);
 const before=checkCalls,previousTokenHook=tokenEntered;let tokenCalls=0;tokenEntered=()=>{tokenCalls++;};
 try{
  await prisma.tenantCargosConnection.update({where:{tenantId:ids.a},data:{credentialsEncrypted:[iv,Buffer.from(tag,"base64url").subarray(0,4).toString("base64url"),data].join(".")}});
  const status=await (await api("/cargos")).json() as any;
  const response=await api("/cargos/check","POST",{sourceHash:status.sourceHash});
  assert.ok(response.status>=400,"Shortened authentication tags must fail closed");
  assert.equal(checkCalls,before);assert.equal(tokenCalls,0);
 }finally{
  tokenEntered=previousTokenHook;
  await prisma.tenantCargosConnection.update({where:{tenantId:ids.a},data:{credentialsEncrypted:stored.credentialsEncrypted}});
 }
});
test("CARGOS double click creates exactly one accepted transmission and protects the claimed draft",async()=>{
 const data=await (await api("/cargos")).json() as any;mode="blocked";const seen=new Promise<void>(resolve=>{entered=resolve;});const first=api("/cargos/transmit","POST",{sourceHash:data.sourceHash});await seen;
 assert.equal((await api("/cargos/transmit","POST",{sourceHash:data.sourceHash})).status,409);
 assert.equal((await api("/cargos/draft","PATCH",{record:{CONTRATTO_TIPOP:"2"}})).status,409);
 release?.();const done=await first;assert.equal(done.status,200,await done.clone().text());assert.equal((await done.json() as any).status,"ACCEPTED");assert.equal(sendCalls,1);
 const evidence=await prisma.contractCargosTransmission.findUniqueOrThrow({where:{contractId:ids.contract}}) as any;
 assert.equal(evidence.requestedByUserId,ids.admin);assert.ok(evidence.recordEncrypted);assert.ok(!evidence.recordEncrypted.includes("QA001AA"));
 const replay=await api("/cargos/transmit","POST",{sourceHash:data.sourceHash});assert.equal(replay.status,200);assert.equal((await replay.json() as any).duplicate,true);assert.equal(sendCalls,1);
 assert.equal((await prisma.rentalBooking.findUniqueOrThrow({where:{id:ids.booking}})).cargosTransmissionId,"SYNTHETIC-CARGOS-001");
});
test("an unchanged accepted source permits the guarded handover transition",async()=>{
 await prisma.rentalBooking.update({where:{id:ids.booking},data:{status:"CONTRACT_SIGNED",contractStatus:"SIGNED",contractSignedAt:new Date("2026-10-29T10:00:00Z")}});
 const response=await api("/transition","POST",{toStatus:"READY_FOR_HANDOVER"});assert.equal(response.status,200,await response.clone().text());
 assert.equal((await response.json() as any).status,"READY_FOR_HANDOVER");
});
test("CARGOS evidence becomes stale when contract content changes",async()=>{
 await prisma.bookingContract.update({where:{id:ids.contract},data:{content:"Changed after submission"}});const data=await (await api("/cargos")).json() as any;assert.equal(data.sourceChanged,true);assert.equal(data.canSend,false);
 await prisma.rentalBooking.update({where:{id:ids.booking},data:{status:"CONTRACT_SIGNED",contractStatus:"SIGNED",contractSignedAt:new Date("2026-10-29T10:00:00Z")}});
 const response=await api("/transition","POST",{toStatus:"READY_FOR_HANDOVER"});assert.equal(response.status,409);assert.equal(sendCalls,1);
});

test("a changed accepted source cannot be silently reported as accepted again",async()=>{
 const data=await (await api("/cargos")).json() as any;
 const response=await api("/cargos/transmit","POST",{sourceHash:data.sourceHash});
 assert.equal(response.status,409);assert.equal(sendCalls,1);
});

const newPractice=async()=>{
 const original=await prisma.rentalBooking.findUniqueOrThrow({where:{id:ids.booking}});
 const booking=await prisma.rentalBooking.create({data:{tenantId:ids.a,siteId:ids.site,pickupSiteId:ids.site,returnSiteId:ids.site,vehicleId:original.vehicleId,customerId:original.customerId,customerName:"Anna Test",code:"E03-"+crypto.randomUUID(),pickupAt:original.pickupAt,returnAt:original.returnAt,pickupLocation:original.pickupLocation,returnLocation:original.returnLocation,status:"CONFIRMED"}});
 const contract=await prisma.bookingContract.create({data:{tenantId:ids.a,bookingId:booking.id,title:"Contratto sintetico",content:"Synthetic terms",signedAt:new Date("2026-10-29T10:00:00Z"),status:"SIGNED"}});
 const recordDraft=(await prisma.contractCargosTransmission.findUniqueOrThrow({where:{contractId:ids.contract}})).recordDraft!;
 await prisma.contractCargosTransmission.create({data:{tenantId:ids.a,contractId:contract.id,recordDraft}});
 const data=await (await request(`/rental-bookings/${booking.id}/cargos`)).json() as any;
 return{booking,contract,data,send:()=>request(`/rental-bookings/${booking.id}/cargos/transmit`,"POST",{sourceHash:data.sourceHash})};
};
test("canceled practices cannot initiate a new transmission",async()=>{
 const practice=await newPractice();await prisma.rentalBooking.update({where:{id:practice.booking.id},data:{status:"CANCELED"}});
 const before=sendCalls;const response=await practice.send();assert.equal(response.status,409);assert.equal(sendCalls,before);
 const data=await (await request(`/rental-bookings/${practice.booking.id}/cargos`)).json() as any;assert.equal(data.canSend,false);
});
test("remote rejection remains unsent and permits an explicit corrected retry",async()=>{
 const practice=await newPractice();mode="rejected";const first=await practice.send();assert.equal(first.status,200);assert.equal((await first.json() as any).status,"REJECTED");
 const stored=await prisma.rentalBooking.findUniqueOrThrow({where:{id:practice.booking.id}});assert.equal(stored.cargosStatus,"ERROR");assert.equal(stored.cargosTransmissionId,null);
 mode="accepted";const retry=await practice.send();assert.equal(retry.status,200);assert.equal((await retry.json() as any).status,"ACCEPTED");
});
test("an uncertain Send outcome blocks blind retry and has no false acceptance",async()=>{
 const practice=await newPractice();mode="unknown";const before=sendCalls;const response=await practice.send();assert.equal(response.status,200);assert.equal((await response.json() as any).status,"UNKNOWN");
 assert.equal((await practice.send()).status,409);assert.equal(sendCalls,before+1);
 const stored=await prisma.rentalBooking.findUniqueOrThrow({where:{id:practice.booking.id}});assert.equal(stored.cargosStatus,"ERROR");assert.equal(stored.cargosTransmissionId,null);
});
test("suspending the operator during token acquisition prevents the actual Send",async()=>{
 const practice=await newPractice();mode="accepted";const before=sendCalls;let allow:()=>void=()=>{};
 tokenGate=new Promise<void>(resolve=>{allow=resolve;});const seen=new Promise<void>(resolve=>{tokenEntered=resolve;});
 const pending=practice.send();await seen;
 try{await prisma.user.update({where:{id:ids.admin},data:{status:"SUSPENDED"}});allow();const response=await pending;assert.equal(response.status,200);assert.equal((await response.json() as any).status,"UNAVAILABLE");assert.equal(sendCalls,before);}
 finally{allow();tokenGate=undefined;tokenEntered=undefined;await prisma.user.update({where:{id:ids.admin},data:{status:"ACTIVE"}});}
});

test("replacing CARGOS credentials during token acquisition blocks the old connection",async()=>{
 const practice=await newPractice();mode="accepted";const before=sendCalls;let allow:()=>void=()=>{};
 const old=await prisma.tenantCargosConnection.findUniqueOrThrow({where:{tenantId:ids.a}});
 tokenGate=new Promise<void>(resolve=>{allow=resolve;});const seen=new Promise<void>(resolve=>{tokenEntered=resolve;});
 const pending=practice.send();await seen;
 try{await prisma.tenantCargosConnection.update({where:{tenantId:ids.a},data:{credentialsEncrypted:"synthetic-replacement"}});allow();const response=await pending;assert.equal(response.status,200);assert.equal((await response.json() as any).status,"UNAVAILABLE");assert.equal(sendCalls,before);}
 finally{allow();tokenGate=undefined;tokenEntered=undefined;await prisma.tenantCargosConnection.update({where:{tenantId:ids.a},data:{credentialsEncrypted:old.credentialsEncrypted}});}
});

const receiptBytes=async()=>{const{PDFDocument}=await import("pdf-lib");const pdf=await PDFDocument.create();pdf.addPage().drawText("SYNTHETIC CARGOS RECEIPT - NOT AN OFFICIAL DOCUMENT");return Buffer.from(await pdf.save());};
const uploadReceipt=async(practice:Awaited<ReturnType<typeof newPractice>>,options:{kind?:string;transactionId?:string;sourceHash?:string;bytes?:Buffer;key?:string;who?:string}={})=>{
 const bytes=options.bytes??await receiptBytes(),form=new FormData();
 for(const[key,value]of Object.entries({sourceHash:options.sourceHash??practice.data.sourceHash,transactionId:options.transactionId??"PORTAL-"+practice.contract.id,protocol:"SYNTHETIC-RECEIPT-001",receiptDate:"2026-10-30",kind:options.kind??"CONFIRM_PORTAL",verifiedOnPortal:"true"}))form.set(key,value);
 form.set("file",new Blob([bytes],{type:"application/pdf"}),"synthetic-receipt.pdf");
 return originalFetch(base+`/rental-bookings/${practice.booking.id}/cargos/receipts`,{method:"POST",headers:{Authorization:`Bearer ${tokens[options.who??"admin"]}`,"X-Fleetum-Site":"all","X-Idempotency-Key":options.key??crypto.randomUUID()},body:form});
};
test("explicit Check records validation and never creates a sent booking or Send call",async()=>{
 const p=await newPractice();mode="accepted";const before=sendCalls,checks=checkCalls;
 const response=await request(`/rental-bookings/${p.booking.id}/cargos/check`,"POST",{sourceHash:p.data.sourceHash});assert.equal(response.status,200,await response.clone().text());const result=await response.json() as any;
 assert.equal(result.validation.status,"VALID");assert.equal(result.validation.current,true);assert.equal(result.status,"DRAFT");assert.equal(sendCalls,before);assert.equal(checkCalls,checks+1);assert.ok(result.history.some((event:any)=>event.type==="CARGOS_CHECKED"));
});
test("a rejected precheck prevents Send and history retains a subsequent explicit attempt",async()=>{
 const p=await newPractice(),before=sendCalls;mode="check-invalid";const first=await p.send();assert.equal(first.status,200);assert.equal((await first.json() as any).status,"REJECTED");assert.equal(sendCalls,before);
 mode="accepted";const second=await p.send();assert.equal(second.status,200,await second.clone().text());assert.equal((await second.json() as any).status,"ACCEPTED");assert.equal(sendCalls,before+1);
 const data=await(await request(`/rental-bookings/${p.booking.id}/cargos`)).json() as any;assert.equal(data.history.filter((event:any)=>event.type==="CARGOS_STARTED").length,2);assert.equal(data.history.filter((event:any)=>event.type==="CARGOS_OUTCOME").length,2);assert.ok(!JSON.stringify(data.history).includes("sensitive-validation-details"));
});
test("an uncertain transmission stays blocked and cannot be resolved by Check or a second Send",async()=>{
 const p=await newPractice();mode="unknown";assert.equal((await(await p.send()).json() as any).status,"UNKNOWN");const before=sendCalls;
 assert.equal((await p.send()).status,409);assert.equal((await request(`/rental-bookings/${p.booking.id}/cargos/check`,"POST",{sourceHash:p.data.sourceHash})).status,409);assert.equal(sendCalls,before);
});
test("manual portal confirmation requires the matching evidence and preserves one receipt on concurrent retry",async()=>{
 const p=await newPractice();mode="unknown";await p.send();const before=sendCalls,bytes=await receiptBytes(),key=crypto.randomUUID();
 const responses=await Promise.all([uploadReceipt(p,{bytes,key}),uploadReceipt(p,{bytes,key})]);for(const response of responses)assert.equal(response.status,201,await response.clone().text());
 const data=await(await request(`/rental-bookings/${p.booking.id}/cargos`)).json() as any;assert.equal(data.status,"MANUAL_CONFIRMED");assert.equal(data.receipts.length,1);assert.equal(sendCalls,before);assert.equal(data.history.filter((event:any)=>event.type==="CARGOS_PORTAL_CONFIRMED").length,1);
 const row=await prisma.contractCargosReceipt.findFirstOrThrow({where:{transmission:{contractId:p.contract.id}}});await assert.rejects(prisma.contractCargosReceipt.update({where:{id:row.id},data:{protocol:"REWRITTEN"}}));
 const file=await prisma.storedFileObject.findUniqueOrThrow({where:{id:row.storedFileObjectId}});assert.equal(file.visibility,"private");assert.equal(file.checksumSha256,row.sha256);
 await prisma.rentalBooking.update({where:{id:p.booking.id},data:{status:"CONTRACT_SIGNED",contractStatus:"SIGNED",contractSignedAt:new Date()}});
 const handover=await request(`/rental-bookings/${p.booking.id}/transition`,"POST",{toStatus:"READY_FOR_HANDOVER"});assert.equal(handover.status,200,await handover.clone().text());
 await prisma.storedFileObject.update({where:{id:file.id},data:{deletedAt:new Date()}});await prisma.rentalBooking.update({where:{id:p.booking.id},data:{status:"CONTRACT_SIGNED"}});assert.equal((await request(`/rental-bookings/${p.booking.id}/transition`,"POST",{toStatus:"READY_FOR_HANDOVER"})).status,409);
 await prisma.storedFileObject.update({where:{id:file.id},data:{deletedAt:null}});
});
test("receipt archives do not invent API acceptance or expose batch PDFs to viewers and foreign tenants",async()=>{
 const p=await newPractice();mode="accepted";const sent=await(await p.send()).json() as any;const bytes=await receiptBytes();
 assert.equal((await uploadReceipt(p,{kind:"ARCHIVE",transactionId:sent.transactionId,who:"viewer",bytes})).status,403);
 assert.equal((await uploadReceipt(p,{kind:"ARCHIVE",transactionId:sent.transactionId,who:"foreign",bytes})).status,404);
 assert.equal((await uploadReceipt(p,{kind:"ARCHIVE",transactionId:"WRONG",bytes})).status,409);
 const saved=await uploadReceipt(p,{kind:"ARCHIVE",transactionId:sent.transactionId,bytes});assert.equal(saved.status,201,await saved.clone().text());const data=await saved.json() as any;assert.equal(data.status,"ACCEPTED");const receipt=data.receipts[0];
 const path=`/rental-bookings/${p.booking.id}/cargos/receipts/${receipt.id}/pdf`,download=await request(path);assert.equal(download.status,200);assert.equal(crypto.createHash("sha256").update(Buffer.from(await download.arrayBuffer())).digest("hex"),receipt.sha256);
 assert.equal((await request(path,"GET",undefined,"viewer")).status,403);assert.equal((await request(path,"GET",undefined,"foreign")).status,404);
 assert.equal((await request(`/rental-bookings/${ids.booking}/cargos/receipts/${receipt.id}/pdf`)).status,404);assert.ok(!JSON.stringify(data.receipts).includes("storageKey"));
});
test("invalid PDFs, mismatched source, in-flight claims and changed documents cannot unlock an uncertain attempt",async()=>{
 const p=await newPractice();mode="unknown";await p.send();
 assert.equal((await uploadReceipt(p,{bytes:Buffer.from("%PDF-broken")})).status,422);assert.equal((await uploadReceipt(p,{sourceHash:"0".repeat(64)})).status,409);
 const row=await prisma.contractCargosTransmission.findUniqueOrThrow({where:{contractId:p.contract.id}});assert.equal(await prisma.contractCargosReceipt.count({where:{transmissionId:row.id}}),0);
 await prisma.contractCargosTransmission.update({where:{id:row.id},data:{status:"SENDING",startedAt:new Date()}});assert.equal((await uploadReceipt(p)).status,409);
 await prisma.contractCargosTransmission.update({where:{id:row.id},data:{status:"UNKNOWN"}});await prisma.bookingContract.update({where:{id:p.contract.id},data:{content:"Changed after uncertain send"}});assert.equal((await uploadReceipt(p)).status,409);
 assert.equal((await prisma.contractCargosTransmission.findUniqueOrThrow({where:{id:row.id}})).status,"UNKNOWN");
});
test("an old interrupted claim can be confirmed only with an explicit portal receipt, without resending",async()=>{
 const p=await newPractice();mode="unknown";await p.send();const before=sendCalls;
 await prisma.contractCargosTransmission.update({where:{contractId:p.contract.id},data:{status:"SENDING",startedAt:new Date(Date.now()-10*60000)}});
 const response=await uploadReceipt(p);assert.equal(response.status,201,await response.clone().text());assert.equal((await response.json() as any).status,"MANUAL_CONFIRMED");assert.equal(sendCalls,before);
});

test("history pagination stays scoped to the visible booking and rejects unrelated cursors",async()=>{
 const p=await newPractice(),other=await newPractice();
 await prisma.bookingContractEvent.createMany({data:Array.from({length:45},(_,n)=>({tenantId:ids.a,bookingId:p.booking.id,contractId:p.contract.id,actorUserId:ids.admin,type:"CARGOS_TEST",message:"Synthetic history "+n,createdAt:new Date("2026-10-30T10:00:00Z")}))});
 const first=await(await request(`/rental-bookings/${p.booking.id}/cargos/history`)).json() as any;
 assert.equal(first.events.length,40);assert.ok(first.cursor);
 const last=await(await request(`/rental-bookings/${p.booking.id}/cargos/history?cursor=${first.cursor}`)).json() as any;
 assert.equal(last.events.length,5);assert.equal(last.cursor,null);assert.equal(new Set([...first.events,...last.events].map((v:any)=>v.id)).size,45);
 assert.equal((await request(`/rental-bookings/${other.booking.id}/cargos/history?cursor=${first.cursor}`)).status,404);
 assert.equal((await request(`/rental-bookings/${p.booking.id}/cargos/history`,"GET",undefined,"foreign")).status,404);
});
test("batch receipts remain private in a selected-site view and references cannot be reused",async()=>{
 const p=await newPractice();mode="unknown";await p.send();assert.equal((await uploadReceipt(p)).status,201);
 const data=await(await request(`/rental-bookings/${p.booking.id}/cargos`)).json() as any;
 const scoped=await originalFetch(base+`/rental-bookings/${p.booking.id}/cargos`,{headers:{Authorization:`Bearer ${tokens.admin}`,"X-Fleetum-Site":ids.site}});assert.equal(scoped.status,200);assert.equal((await scoped.json() as any).canManageReceipts,false);
 const file=await originalFetch(base+`/rental-bookings/${p.booking.id}/cargos/receipts/${data.receipts[0].id}/pdf`,{headers:{Authorization:`Bearer ${tokens.admin}`,"X-Fleetum-Site":ids.site}});assert.equal(file.status,403);
 const other=await newPractice();mode="unknown";await other.send();const duplicate=await uploadReceipt(other,{transactionId:"PORTAL-"+p.contract.id});assert.equal(duplicate.status,409);assert.equal((await prisma.contractCargosTransmission.findUniqueOrThrow({where:{contractId:other.contract.id}})).status,"UNKNOWN");
});
test("corporate mapping and fresh in-flight claims cannot be treated as safe to reconcile",async()=>{
 const p=await newPractice();mode="unknown";await p.send();
 await prisma.contractCargosTransmission.update({where:{contractId:p.contract.id},data:{status:"SENDING",startedAt:new Date(Date.now()-2*60000)}});
 const fresh=await(await request(`/rental-bookings/${p.booking.id}/cargos`)).json() as any;assert.equal(fresh.status,"UNKNOWN");assert.equal(fresh.canReconcile,false);
 await prisma.rentalCustomer.update({where:{id:p.booking.customerId!},data:{customerType:"PERSONA_GIURIDICA"}});
 try{const data=await(await request(`/rental-bookings/${p.booking.id}/cargos`)).json() as any;assert.equal(data.canSend,false);assert.equal(data.canReconcile,false);assert.match(data.message,/mappatura/i);assert.equal((await p.send()).status,422);}
 finally{await prisma.rentalCustomer.update({where:{id:p.booking.customerId!},data:{customerType:"PERSONA_FISICA"}});}
});
test("per-practice validation limits reject repeated calls while leaving another practice independent",async()=>{
 const p=await newPractice();mode="accepted";const body={sourceHash:p.data.sourceHash};
 for(let i=0;i<10;i++)assert.equal((await request(`/rental-bookings/${p.booking.id}/cargos/check`,"POST",body)).status,200);
 assert.equal((await request(`/rental-bookings/${p.booking.id}/cargos/check`,"POST",body)).status,429);
 const other=await newPractice();assert.equal((await request(`/rental-bookings/${other.booking.id}/cargos/check`,"POST",{sourceHash:other.data.sourceHash})).status,200);
});

test("accepted synthetic CARGOS evidence supports handover, rental and return with persisted kilometres",async()=>{
 const p=await newPractice();
 await prisma.rentalBooking.update({where:{id:p.booking.id},data:{status:"CONTRACT_SIGNED",contractStatus:"SIGNED",contractSignedAt:new Date("2026-10-29T10:00:00Z"),pickupKm:0,returnKm:null}});
 mode="accepted";
 const state=await(await request(`/rental-bookings/${p.booking.id}/cargos`)).json() as any;
 const sent=await request(`/rental-bookings/${p.booking.id}/cargos/transmit`,"POST",{sourceHash:state.sourceHash});assert.equal(sent.status,200,await sent.clone().text());
 for(const toStatus of ["READY_FOR_HANDOVER","IN_RENT"]){const response=await request(`/rental-bookings/${p.booking.id}/transition`,"POST",{toStatus});assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json() as any).status,toStatus);}
 const missing=await request(`/rental-bookings/${p.booking.id}/transition`,"POST",{toStatus:"CLOSED"});assert.equal(missing.status,400);assert.equal((await missing.json() as any).error,"BOOKING_RETURN_KM_REQUIRED");
 const update=await request(`/rental-bookings/${p.booking.id}`,"PATCH",{returnKm:25,finalTotal:0});assert.equal(update.status,200,await update.clone().text());
 const closed=await request(`/rental-bookings/${p.booking.id}/transition`,"POST",{toStatus:"CLOSED"});assert.equal(closed.status,200,await closed.clone().text());
 const read=await request(`/rental-bookings/${p.booking.id}`),result=await read.json() as any;assert.equal(read.status,200);assert.equal(result.status,"CLOSED");assert.equal(result.pickupKm,0);assert.equal(result.returnKm,25);assert.equal(result.finalTotal,0);
});

});
