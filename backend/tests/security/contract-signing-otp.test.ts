import {syntheticTerms} from "../helpers/contract-rental-terms.js";
import {env} from "../../src/shared/config/env.js";
import {assertSyntheticDatabase} from "../helpers/synthetic-database.js";
import {writeFile} from "node:fs/promises";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {before,after,test,describe} from "node:test";
import type http from "node:http";
import {createApp} from "../../src/app.js";
import {prisma} from "../../src/infrastructure/database/prisma/client.js";
import {emailSender,type SendEmailInput} from "../../src/infrastructure/email/email-sender.js";
import {EmailQueueService} from "../../src/infrastructure/email/email-queue-service.js";
import {signTenantAccessToken} from "../helpers/http-auth.js";
import {createSigningCrypto} from "../../src/application/services/contract-signing-crypto.js";
const originalSend=emailSender.send,mail:SendEmailInput[]=[],ids:Record<string,string>={},tokens:Record<string,string>={};
let server:http.Server,base="";const sha=(bytes:Buffer)=>crypto.createHash("sha256").update(bytes).digest("hex");
const api=(path:string,method="GET",body?:unknown,who="admin")=>fetch(base+path,{method,headers:{Authorization:`Bearer ${tokens[who]}`,"Content-Type":"application/json","X-Fleetum-Site":"all"},...(body===undefined?{}:{body:JSON.stringify(body)})});
const pub=(path:string,body:unknown,cookie="",origin=new URL(env.APP_URL).origin)=>fetch(base+"/contracts/signing/"+path,{method:"POST",headers:{"Content-Type":"application/json",Origin:origin,...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
const queue=new EmailQueueService();
const processIds=async(ids:string[])=>{await queue.processPending(new Date(),{ids});};
const newPractice=async()=>{
 const code="OTP-"+crypto.randomUUID().slice(0,8),pickupAt=new Date(Date.now()+7*86400000);
 const booking=await prisma.rentalBooking.create({data:{tenantId:ids.a,siteId:ids.site,pickupSiteId:ids.site,returnSiteId:ids.site,vehicleId:ids.vehicle,customerId:ids.customer,customerName:"Anna Test",customerEmail:"signer@example.invalid",code,pickupAt,returnAt:new Date(pickupAt.getTime()+86400000),pickupLocation:"Via sintetica 1, Roma",returnLocation:"Via sintetica 1, Roma",pickupKm:1000,expectedTotal:149,status:"CONFIRMED",contractStatus:"READY",cargosStatus:"PENDING"}});
 const contract=await prisma.bookingContract.create({data:{tenantId:ids.a,bookingId:booking.id,title:"Contratto sintetico — prova locale",content:"DOCUMENTO SINTETICO. Prova del processo di firma, senza impegni reali. Importo simulato: 149 EUR. Condizioni del noleggio fittizio.",status:"READY",rentalTerms:{...syntheticTerms,primaryDriverId:ids.customer},emailTo:"signer@example.invalid"}});
 return{booking,contract,path:`/rental-bookings/${booking.id}`};
};
const convertPractice=async(p:Awaited<ReturnType<typeof newPractice>>)=>{const review=await (await api(p.path+"/contract/conversion")).json() as any;const result=await api(p.path+"/contract/convert","POST",{reviewHash:review.reviewHash});assert.equal(result.status,201,await result.clone().text());};
const issue=async()=>{
 const practice=await newPractice(),key=crypto.randomUUID();const review=await (await api(practice.path+"/contract/conversion")).json() as any;const converted=await api(practice.path+"/contract/convert","POST",{reviewHash:review.reviewHash});assert.equal(converted.status,201,await converted.clone().text());const response=await fetch(base+practice.path+"/contract/signing",{method:"POST",headers:{Authorization:`Bearer ${tokens.admin}`,"Content-Type":"application/json","X-Fleetum-Site":"all","X-Idempotency-Key":key},body:JSON.stringify({recipient:"signer@example.invalid"})});
 assert.equal(response.status,202,await response.clone().text());const data=await response.json() as any;
 const row=await prisma.contractSigningRequest.findUniqueOrThrow({where:{id:data.id}});await processIds([row.inviteQueueId!]);
 const message=mail.at(-1)!;assert.equal(message.to,"signer@example.invalid");const raw=String(message.text).match(/https?:\/\/[^\s]+\/firma-contratto#token=([A-Za-z0-9_-]{43})/);assert.ok(raw,"Invitation must contain a fragment-only signing capability");
 const token=raw[1],pdf=await pub("document",{token});assert.equal(pdf.status,200,await pdf.clone().text());const bytes=Buffer.from(await pdf.arrayBuffer());assert.equal(sha(bytes),row.documentSha256);
 const cookie=pdf.headers.getSetCookie().map(value=>value.split(";")[0]).join("; ");assert.match(pdf.headers.getSetCookie().join(";"),/HttpOnly/);assert.match(pdf.headers.getSetCookie().join(";"),/SameSite=Strict/);
 return{...practice,key,row,token,cookie,bytes};
};
const challenge=async(practice:Awaited<ReturnType<typeof issue>>)=>{
 const response=await pub("otp",{token:practice.token,documentHash:practice.row.documentSha256},practice.cookie);assert.equal(response.status,202,await response.clone().text());
 const latest=await prisma.contractSigningRequest.findUniqueOrThrow({where:{id:practice.row.id}});await processIds([latest.otpQueueId!]);
 const code=String(mail.at(-1)!.text).match(/\n(\d{6})\n/);assert.ok(code,"Synthetic mailbox contains a six-digit code");return code[1];
};
const confirmation=(p:Awaited<ReturnType<typeof issue>>,code:string,confirmationId=crypto.randomUUID())=>({token:p.token,documentHash:p.row.documentSha256,code,confirmationId,consent:true,consentVersion:"email-otp-v1"});

const legacyOnly=process.env.FLEETUM_TEST_LEGACY_SIGNING==="1",fixtureMarker=legacyOnly?"legacy-otp":"otp";
describe(legacyOnly?"pre-upgrade contract invitations on synthetic PostgreSQL":"immutable contract and email OTP on synthetic PostgreSQL",{skip:process.env.RUN_CONTRACT_SIGNING_TESTS!=="1"},()=>{
 before(async()=>{
  assert.equal(process.env.NODE_ENV,"test");assert.equal(process.env.RUN_TENANT_ISOLATION_TESTS,"1");const db=new URL(process.env.DATABASE_URL!);assertSyntheticDatabase({user:"fleetum_e03_otp",database:"fleetum_e03_otp_test",uploadPrefix:"/private/tmp/fleetum-e03-otp-"});
  for(const which of ["a","b"]){ids[which]=(await prisma.tenant.create({data:{name:`Synthetic OTP ${which}`}})).id;await prisma.tenantSubscription.create({data:{tenantId:ids[which],provider:"test",plan:"ENTERPRISE",status:"ACTIVE",seats:10}});}
  const roles={admin:await prisma.role.upsert({where:{key:"ADMIN"},update:{},create:{key:"ADMIN",name:"Synthetic admin"}}),viewer:await prisma.role.upsert({where:{key:"VIEWER"},update:{},create:{key:"VIEWER",name:"Synthetic viewer"}})};
  for(const[who,tenant]of[["admin",ids.a],["viewer",ids.a],["foreign",ids.b]]){const role=who==="viewer"?roles.viewer:roles.admin;const user=await prisma.user.create({data:{tenantId:tenant,email:`${fixtureMarker}-${who}@example.invalid`,firstName:"Synthetic",lastName:who,status:"ACTIVE",passwordHash:"synthetic-only",roles:{create:{roleId:role.id}}}});ids[who]=user.id;const session=await prisma.refreshSession.create({data:{tenantId:tenant,userId:user.id,tokenHash:fixtureMarker+"-"+who,expiresAt:new Date(Date.now()+3600000)}});tokens[who]=signTenantAccessToken({tenantId:tenant,userId:user.id,sessionId:session.id,roles:[role.key]});}
  ids.site=(await prisma.site.create({data:{tenantId:ids.a,name:"Roma sintetica",city:"Roma",address:"Via sintetica 1"}})).id;
  ids.vehicle=(await prisma.vehicle.create({data:{tenantId:ids.a,siteId:ids.site,plate:legacyOnly?"OTP001AL":"OTP001AA",brand:"Fiat",model:"Panda",currentKm:1000}})).id;
  ids.customer=(await prisma.rentalCustomer.create({data:{tenantId:ids.a,firstName:"Anna",lastName:"Test",email:"signer@example.invalid",phone:"05555555",drivingLicenseNumber:"TESTLICENSE",drivingLicenseCategory:"B",drivingLicenseExpiresAt:new Date("2035-01-01"),documentExpiresAt:new Date("2035-01-01"),dateOfBirth:new Date("1990-01-01"),documentNumber:"TESTDOC",residenceAddress:"Via sintetica 2"}})).id;
  await prisma.tenantProfile.create({data:{tenantId:ids.a,legalName:"Noleggio sintetico",vatNumber:"00000000000",legalAddress:"Via sintetica 1",city:"Roma",postalCode:"00100",country:"IT",email:"noleggio@example.invalid"}});
  await prisma.tenantLegalSettings.create({data:{tenantId:ids.a,defaultContractTerms:"Condizioni aziendali sintetiche: chilometri e importi soltanto fittizi.",contractFooterText:"Solo collaudo locale, nessun effetto reale."}});
  emailSender.send=async input=>{assert.ok((Array.isArray(input.to)?input.to:[input.to]).every(value=>value.endsWith("@example.invalid")));mail.push(input);return{provider:"resend",id:`synthetic-mail-${mail.length}`};};
  server=createApp().listen(0,"127.0.0.1");await new Promise<void>(resolve=>server.once("listening",resolve));const address=server.address();assert.ok(address&&typeof address!=="string");base=`http://127.0.0.1:${address.port}/api`;
 });
 after(async()=>{emailSender.send=originalSend;if(server?.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));await prisma.$disconnect();});
 if(!legacyOnly){
 test("invitation capabilities are encrypted and the PDF download keeps the frozen bytes",async()=>{
  const p=await issue();const queued=await prisma.emailQueue.findUniqueOrThrow({where:{id:p.row.inviteQueueId!}});assert.ok(!JSON.stringify(queued).includes(p.token));assert.equal(queued.status,"SENT");
  const stored=await prisma.storedFileObject.findUniqueOrThrow({where:{id:p.row.storedFileObjectId}});assert.equal(stored.visibility,"private");assert.equal(stored.checksumSha256,p.row.documentSha256);
  const actual=await api(p.path+"/contract/pdf");assert.equal(actual.status,200);assert.equal(sha(Buffer.from(await actual.arrayBuffer())),p.row.documentSha256);
 });
 test("new invitations reject legacy drafts or missing agreed conditions without queuing email",async()=>{
  const p=await newPractice();await prisma.bookingContract.update({where:{id:p.contract.id},data:{rentalTerms:(await import("@prisma/client")).Prisma.DbNull}});
  const before=await prisma.emailQueue.count({where:{tenantId:ids.a}});
  const response=await fetch(base+p.path+"/contract/signing",{method:"POST",headers:{Authorization:`Bearer ${tokens.admin}`,"Content-Type":"application/json","X-Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({})});
  assert.equal(response.status,409,await response.clone().text());const review=await (await api(p.path+"/contract/conversion")).json() as any;assert.equal((await api(p.path+"/contract/convert","POST",{reviewHash:review.reviewHash})).status,422);assert.equal(await prisma.emailQueue.count({where:{tenantId:ids.a}}),before);assert.equal(await prisma.contractSigningRequest.count({where:{contractId:p.contract.id}}),0);
 });
 test("rental details save integer cents, distinguish zero and audit only the revision",async()=>{
  const p=await newPractice(),terms={...syntheticTerms,primaryDriverId:ids.customer,depositCents:0};
  const response=await api(p.path+"/contract/rental-details","PATCH",{revision:0,terms});assert.equal(response.status,200,await response.clone().text());const data=await response.json() as any;
  assert.equal(data.terms.depositCents,0);assert.equal(data.revision,1);assert.deepEqual(data.issues,[]);
  const event=await prisma.bookingContractEvent.findFirstOrThrow({where:{contractId:p.contract.id,type:"RENTAL_TERMS_UPDATED"}});assert.deepEqual(event.details,{revision:1});
 });
 test("foreign tenants and viewers cannot save; foreign or corporate driver IDs never enter the contract",async()=>{
  const p=await newPractice(),path=p.path+"/contract/rental-details",terms={...syntheticTerms,primaryDriverId:ids.customer};
  assert.equal((await api(path,"GET",undefined,"foreign")).status,404);assert.equal((await api(path,"PATCH",{revision:0,terms},"viewer")).status,403);
  const foreign=await prisma.rentalCustomer.create({data:{tenantId:ids.b,firstName:"Foreign secret identity",lastName:"Hidden"}});
  const company=await prisma.rentalCustomer.create({data:{tenantId:ids.a,customerType:"PERSONA_GIURIDICA",firstName:"Company",lastName:"Synthetic",companyName:"Synthetic SRL"}});
  for(const id of [foreign.id,company.id]){const response=await api(path,"PATCH",{revision:0,terms:{...terms,primaryDriverId:id}});assert.equal(response.status,422);assert.ok(!(await response.text()).includes(foreign.firstName));}
  const suggestions=await api(path+"/drivers?search=Foreign");assert.equal(suggestions.status,200);assert.deepEqual(await suggestions.json(),[]);
  assert.equal((await prisma.bookingContract.findUniqueOrThrow({where:{id:p.contract.id}})).rentalTermsRevision,0);
 });
 test("concurrent rental detail saves do not overwrite a newer revision",async()=>{
  const p=await newPractice(),terms={...syntheticTerms,primaryDriverId:ids.customer};const responses=await Promise.all([0,1].map(i=>api(p.path+"/contract/rental-details","PATCH",{revision:0,terms:{...terms,depositCents:10000+i}})));
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);assert.equal(await prisma.bookingContractEvent.count({where:{contractId:p.contract.id,type:"RENTAL_TERMS_UPDATED"}}),1);
 });
 test("rental details freeze during signature and cannot be edited after subscription",async()=>{
  const p=await issue(),terms={...syntheticTerms,primaryDriverId:ids.customer};
  assert.equal((await api(p.path+"/contract/rental-details","PATCH",{revision:0,terms})).status,409);
  const code=await challenge(p);assert.equal((await pub("confirm",confirmation(p,code),p.cookie)).status,200);
  assert.equal((await api(p.path+"/contract/rental-details","PATCH",{revision:0,terms})).status,409);assert.equal((await api(p.path+"/contract/rental-details")).status,200);
 });
 test("a company representative is not silently used as driver and CARGOS follows designated people",async()=>{
  const p=await newPractice(),company=await prisma.rentalCustomer.create({data:{tenantId:ids.a,customerType:"PERSONA_GIURIDICA",firstName:"Synthetic",lastName:"Company",companyName:"Synthetic SRL",legalRepFirstName:"Carla",legalRepLastName:"Firmataria",legalRepEmail:"company@example.invalid"}});
  await prisma.rentalBooking.update({where:{id:p.booking.id},data:{customerId:company.id,customerName:"Synthetic SRL"}});
  const response=await api(p.path+"/cargos");assert.equal(response.status,200,await response.clone().text());const data=await response.json() as any;
  assert.equal(data.fields.find((field:any)=>field.key==="CONDUCENTE_CONTRAENTE_NOME").value,"Anna");assert.equal(data.fields.find((field:any)=>field.key==="CONDUCENTE_CONTRAENTE_PATENTE_NUMERO").value,"TESTLICENSE");
  const second=await prisma.rentalCustomer.create({data:{tenantId:ids.a,firstName:"Bruno",lastName:"Aggiuntivo",drivingLicenseNumber:"SECOND-TEST-LICENCE"}});
  const save=await api(p.path+"/contract/rental-details","PATCH",{revision:0,terms:{...syntheticTerms,primaryDriverId:ids.customer,additionalDriverIds:[second.id]}});assert.equal(save.status,200);
  const next=await(await api(p.path+"/cargos")).json() as any;assert.equal(next.fields.find((field:any)=>field.key==="CONDUCENTE2_NOME").value,"Bruno");assert.equal(next.fields.find((field:any)=>field.key==="CONDUCENTE2_NOME").editable,false);assert.notEqual(next.sourceHash,data.sourceHash);
 });
 test("changes to a designated driver's identity invalidate the pending signing source",async()=>{
  const p=await issue();try{await prisma.rentalCustomer.update({where:{id:ids.customer},data:{drivingLicenseNumber:"CHANGED-TEST-LICENCE"}});const status=await(await api(p.path+"/contract/signing")).json() as any;assert.equal(status.request.sourceChanged,true);const rejected=await pub("otp",{token:p.token,documentHash:p.row.documentSha256},p.cookie);assert.equal(rejected.status,410);assert.equal((await rejected.json() as any).error,"CONTRACT_SIGNING_NOT_AVAILABLE");}finally{await prisma.rentalCustomer.update({where:{id:ids.customer},data:{drivingLicenseNumber:"TESTLICENSE"}});}
 });
 test("a removed driver permits revocation and does not make an already signed PDF disappear",async()=>{
  const pending=await issue();try{
   await prisma.rentalCustomer.update({where:{id:ids.customer},data:{deletedAt:new Date()}});
   const revoke=await api(pending.path+"/contract/signing/revoke","POST",{});assert.equal(revoke.status,200,await revoke.clone().text());
  }finally{await prisma.rentalCustomer.update({where:{id:ids.customer},data:{deletedAt:null}});}
  const signed=await issue(),code=await challenge(signed);assert.equal((await pub("confirm",confirmation(signed,code),signed.cookie)).status,200);
  try{await prisma.rentalCustomer.update({where:{id:ids.customer},data:{deletedAt:new Date()}});const pdf=await api(signed.path+"/contract/pdf");assert.equal(pdf.status,200,await pdf.clone().text());const final=await prisma.contractSigningRequest.findUniqueOrThrow({where:{id:signed.row.id}});assert.equal(sha(Buffer.from(await pdf.arrayBuffer())),final.signedDocumentSha256);assert.equal((await pub("evidence",{token:signed.token})).status,200);}
  finally{await prisma.rentalCustomer.update({where:{id:ids.customer},data:{deletedAt:null}});}
 });
 test("legacy content, regeneration and manual signature cannot overwrite an active signing version",async()=>{
  const p=await issue();for(const[path,method,body]of[["","PATCH",{contractStatus:"SIGNED"}],["/contract","PATCH",{content:"Replaced while awaiting signature"}],["/contract/generate","POST",{}],["/contract/mark-signed","POST",{}],["/contract","POST",{status:"SIGNED"}],["/transition","POST",{toStatus:"CONTRACT_SIGNED"}]] as const){const response=await api(p.path+path,method,body);assert.equal(response.status,409,`Frozen document must reject ${method} ${path}`);}
  assert.equal((await prisma.bookingContract.findUniqueOrThrow({where:{id:p.contract.id}})).content,p.contract.content);
 });
 test("foreign tenant, read-only staff, foreign origin and missing document proof cannot mutate signing",async()=>{
  const p=await issue();assert.equal((await api(p.path+"/contract/signing","GET",undefined,"foreign")).status,404);assert.equal((await api(p.path+"/contract/signing/revoke","POST",{},"viewer")).status,403);
  assert.equal((await pub("otp",{token:p.token,documentHash:p.row.documentSha256},"",(new URL(env.APP_URL).origin==="http://localhost:5173"?"http://127.0.0.1:5173":"http://localhost:5173"))).status,403);assert.equal((await pub("otp",{token:p.token,documentHash:p.row.documentSha256})).status,409);
 });
 test("wrong codes commit the attempt counter and another browser cannot consume a code",async()=>{
  const p=await issue(),code=await challenge(p),other=await pub("document",{token:p.token}),otherCookie=other.headers.getSetCookie().map(value=>value.split(";")[0]).join("; ");
  assert.equal((await pub("confirm",confirmation(p,code),otherCookie)).status,403);
  const wrong=code==="000000"?"111111":"000000";assert.equal((await pub("confirm",confirmation(p,wrong),p.cookie)).status,422);
  const row=await prisma.contractSigningRequest.findUniqueOrThrow({where:{id:p.row.id}});assert.equal(row.otpAttempts,1);assert.equal(row.totalAttempts,1);assert.equal(row.status,"PENDING");
 });
 test("concurrent confirmation records one signature and one copy; exact retry is idempotent and other replay is rejected",async()=>{
  const p=await issue(),code=await challenge(p),body=confirmation(p,code);
  const responses=await Promise.all([pub("confirm",body,p.cookie),pub("confirm",body,p.cookie)]);for(const response of responses)assert.equal(response.status,200,await response.clone().text());
  const row=await prisma.contractSigningRequest.findUniqueOrThrow({where:{id:p.row.id}});assert.equal(row.status,"SIGNED");assert.equal(row.otpHash,null);assert.equal(row.browserHash,null);assert.ok(row.evidenceMac);
  assert.equal(await prisma.bookingContractEvent.count({where:{tenantId:ids.a,contractId:p.contract.id,type:"SIGNED_EMAIL_OTP"}}),1);assert.equal(await prisma.emailQueue.count({where:{tenantId:ids.a,type:"CONTRACT_SIGNING_COPY",meta:{path:["requestId"],equals:p.row.id}}}),1);
  assert.equal((await pub("confirm",confirmation(p,code),p.cookie)).status,409);
  await processIds([row.copyQueueId!]);const copy=mail.at(-1)!;assert.equal(copy.attachments?.length,2);assert.equal(sha(copy.attachments![0].content),row.signedDocumentSha256);assert.equal(copy.attachments![1].content.subarray(0,5).toString(),"%PDF-");
  if(process.env.SIGNING_PDF_EVIDENCE_DIR){await writeFile(process.env.SIGNING_PDF_EVIDENCE_DIR+"/contract-original.pdf",copy.attachments![0].content);await writeFile(process.env.SIGNING_PDF_EVIDENCE_DIR+"/signature-receipt.pdf",copy.attachments![1].content);}
  await assert.rejects(prisma.contractSigningRequest.update({where:{id:row.id},data:{signerName:"Changed after signing"}}));
  const email=await fetch(base+p.path+"/contract/email",{method:"POST",headers:{Authorization:`Bearer ${tokens.admin}`,"Content-Type":"application/json","X-Fleetum-Site":"all","X-Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({to:"signer@example.invalid"})});assert.equal(email.status,201,await email.clone().text());
  assert.equal((await prisma.bookingContract.findUniqueOrThrow({where:{id:p.contract.id}})).status,"SIGNED","Legacy email finalization must preserve the signature");
  const send=emailSender.send;emailSender.send=async()=>{throw new Error("Synthetic transport failure");};
  try{const failed=await fetch(base+p.path+"/contract/email",{method:"POST",headers:{Authorization:`Bearer ${tokens.admin}`,"Content-Type":"application/json","X-Fleetum-Site":"all","X-Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({to:"signer@example.invalid"})});assert.equal(failed.status,201);const queued=await prisma.emailQueue.findFirstOrThrow({where:{tenantId:ids.a,type:"BOOKING_CONTRACT",status:"PENDING"},orderBy:{createdAt:"desc"}});for(let n=1;n<=5;n++)await queue.processPending(new Date(Date.now()+n*3600000),{ids:[queued.id]});assert.equal((await prisma.bookingContract.findUniqueOrThrow({where:{id:p.contract.id}})).status,"SIGNED","Terminal email failure must preserve the signature");}finally{emailSender.send=send;}
  const again=await pub("document",{token:p.token},p.cookie);assert.equal(sha(Buffer.from(await again.arrayBuffer())),row.documentSha256);
 });
 test("revocation makes the public link unusable and stops a queued invitation",async()=>{
  const practice=await newPractice();await convertPractice(practice);const response=await fetch(base+practice.path+"/contract/signing",{method:"POST",headers:{Authorization:`Bearer ${tokens.admin}`,"Content-Type":"application/json","X-Fleetum-Site":"all","X-Idempotency-Key":crypto.randomUUID()},body:"{}"});assert.equal(response.status,202);
  const data=await response.json() as any,row=await prisma.contractSigningRequest.findUniqueOrThrow({where:{id:data.id}}),crypt=createSigningCrypto(process.env.CONTRACT_SIGNING_KEY!);const queued=await prisma.emailQueue.findUniqueOrThrow({where:{id:row.inviteQueueId!}}),meta=queued.meta as any;const token=crypt.open(meta.payloadEncrypted,`${ids.a}/${row.id}/${queued.id}/INVITE/0`).token;
  assert.equal((await api(practice.path+"/contract/signing/revoke","POST",{})).status,200);const before=mail.length;await processIds([row.inviteQueueId!]);assert.equal(mail.length,before);assert.equal((await pub("resolve",{token})).status,410);
 });
 test("document and signed evidence fields are immutable at database level",async()=>{
  const p=await issue();await assert.rejects(prisma.contractSigningRequest.update({where:{id:p.row.id},data:{documentTitle:"tampered"}}));
  const original=await prisma.contractSigningRequest.findUniqueOrThrow({where:{id:p.row.id}});assert.equal(original.documentTitle,p.row.documentTitle);
 });
 test("concurrent invitation retry creates exactly one snapshot and one invitation",async()=>{
  const p=await newPractice(),key=crypto.randomUUID();await convertPractice(p);const send=()=>fetch(base+p.path+"/contract/signing",{method:"POST",headers:{Authorization:`Bearer ${tokens.admin}`,"Content-Type":"application/json","X-Fleetum-Site":"all","X-Idempotency-Key":key},body:"{}"});
  const responses=await Promise.all([send(),send()]);const data=[];for(const response of responses){assert.equal(response.status,202,await response.clone().text());data.push(await response.json() as any);}assert.equal(data[0].id,data[1].id);
  assert.equal(await prisma.contractSigningRequest.count({where:{tenantId:ids.a,contractId:p.contract.id}}),1);
  assert.equal(await prisma.storedFileObject.count({where:{tenantId:ids.a,resourceType:"ContractSigningDocument",resourceId:data[0].id}}),1);
 });
 test("cooldown, replacement, expiration and committed attempt limits protect the code",async()=>{
  const p=await issue(),first=await challenge(p);
  assert.equal((await pub("otp",{token:p.token,documentHash:p.row.documentSha256},p.cookie)).status,429);
  await prisma.contractSigningRequest.update({where:{id:p.row.id},data:{lastOtpAt:new Date(Date.now()-61000)}});
  const second=await challenge(p);
  if(first!==second)assert.equal((await pub("confirm",confirmation(p,first),p.cookie)).status,422);
  await prisma.contractSigningRequest.update({where:{id:p.row.id},data:{otpExpiresAt:new Date(Date.now()-1000)}});
  assert.equal((await pub("confirm",confirmation(p,second),p.cookie)).status,422);
  await prisma.contractSigningRequest.update({where:{id:p.row.id},data:{otpExpiresAt:new Date(Date.now()+600000),otpAttempts:0}});
  const wrong=second==="000000"?"111111":"000000";
  for(let n=0;n<5;n++)assert.equal((await pub("confirm",confirmation(p,wrong),p.cookie)).status,422);
  assert.equal((await pub("confirm",confirmation(p,second),p.cookie)).status,429);
  assert.equal((await prisma.contractSigningRequest.findUniqueOrThrow({where:{id:p.row.id}})).otpAttempts,5);
 });
 test("source changes and a suspended issuer invalidate an outstanding capability",async()=>{
  const p=await issue();await prisma.rentalCustomer.update({where:{id:ids.customer},data:{firstName:"Changed synthetic"}});
  try{assert.equal((await pub("resolve",{token:p.token})).status,410);}finally{await prisma.rentalCustomer.update({where:{id:ids.customer},data:{firstName:"Anna"}});}
  await prisma.user.update({where:{id:ids.admin},data:{status:"SUSPENDED"}});
  try{assert.equal((await pub("resolve",{token:p.token})).status,410);}finally{await prisma.user.update({where:{id:ids.admin},data:{status:"ACTIVE"}});}
 });
 test("a modified queued capability never reaches the email provider",async()=>{
  const p=await issue();await pub("otp",{token:p.token,documentHash:p.row.documentSha256},p.cookie);
  const row=await prisma.contractSigningRequest.findUniqueOrThrow({where:{id:p.row.id}}),item=await prisma.emailQueue.findUniqueOrThrow({where:{id:row.otpQueueId!}});
  await prisma.emailQueue.update({where:{id:item.id},data:{meta:{...(item.meta as any),payloadEncrypted:"tampered"}}});const before=mail.length;await processIds([item.id]);assert.equal(mail.length,before);
  const failed=await prisma.emailQueue.findUniqueOrThrow({where:{id:item.id}});assert.equal(failed.status,"FAILED");assert.equal((failed.meta as any).payloadEncrypted,undefined);
 });

 test("expired invitation is unusable and knowing an undelivered code cannot sign",async()=>{
  const p=await issue();const crypt=createSigningCrypto(process.env.CONTRACT_SIGNING_KEY!);
  assert.equal((await pub("otp",{token:p.token,documentHash:p.row.documentSha256},p.cookie)).status,202);
  const current=await prisma.contractSigningRequest.findUniqueOrThrow({where:{id:p.row.id}}),queued=await prisma.emailQueue.findUniqueOrThrow({where:{id:current.otpQueueId!}});
  const code=crypt.open((queued.meta as any).payloadEncrypted,`${ids.a}/${p.row.id}/${queued.id}/OTP/${current.otpGeneration}`).code as string;
  assert.equal((await pub("confirm",confirmation(p,code),p.cookie)).status,409);
  await api(p.path+"/contract/signing/revoke","POST",{});const token=crypt.token();
  await prisma.contractSigningRequest.create({data:{...p.row,id:crypto.randomUUID(),version:2,idempotencyKey:crypto.randomUUID(),tokenHash:crypt.hash(token),expiresAt:new Date(Date.now()-1000),inviteQueueId:null,siteAuthorization:p.row.siteAuthorization as any,evidence:undefined}});
  assert.equal((await pub("resolve",{token})).status,410);
 });

 test("manual conversion accepts an unpaid zero-price rental and is idempotent",async()=>{
  const p=await newPractice();await prisma.rentalBooking.update({where:{id:p.booking.id},data:{expectedTotal:0}});
  const preview=await api(p.path+"/contract/conversion");assert.equal(preview.status,200,await preview.clone().text());const review=await preview.json() as any;
  assert.equal(review.balance.agreedCents,0);assert.equal(review.balance.receivedCents,0);
  const convert=()=>api(p.path+"/contract/convert","POST",{reviewHash:review.reviewHash});
  const first=await convert();assert.equal(first.status,201,await first.clone().text());const second=await convert();assert.equal(second.status,200,await second.clone().text());
  assert.equal(await prisma.bookingContractEvent.count({where:{contractId:p.contract.id,type:"ISSUED_MANUALLY"}}),1);
  assert.equal(await prisma.rentalCollectionEntry.count({where:{bookingId:p.booking.id}}),0);
 });
 test("unsigned contracts cannot bypass document-bound signature through mark-signed",async()=>{
  const p=await newPractice();const result=await api(p.path+"/contract/mark-signed","POST",{});
  assert.equal(result.status,409,await result.clone().text());
  assert.notEqual((await prisma.bookingContract.findUniqueOrThrow({where:{id:p.contract.id}})).status,"SIGNED");
 });

 test("explicit discount keeps the 100/20/80/50/30 ledger and never creates a payment or automatic contract",async()=>{
  const p=await newPractice();const review=await (await api(p.path+"/contract/conversion")).json() as any;
  const input={listCents:10000,discountCents:2000,reason:"Sconto concordato sintetico",reviewHash:review.reviewHash};
  assert.equal((await api(p.path+"/contract/agreed-price","PUT",input,"viewer")).status,403);
  assert.equal((await api(p.path+"/contract/agreed-price","PUT",input,"foreign")).status,404);
  const agreement=await api(p.path+"/contract/agreed-price","PUT",input);assert.equal(agreement.status,200,await agreement.clone().text());
  const value=await agreement.json() as any;assert.equal(value.balance.agreedCents,8000);assert.equal(value.priceAgreement.actorUserId,ids.admin);
  assert.equal((await prisma.bookingContract.findUniqueOrThrow({where:{id:p.contract.id}})).issuedAt,null);
  assert.equal((await api(p.path+"/contract/convert","POST",{reviewHash:review.reviewHash})).status,409);
  const receipt=await fetch(base+"/rental-payments/bookings/"+p.booking.id+"/collections",{method:"POST",headers:{Authorization:`Bearer ${tokens.admin}`,"Content-Type":"application/json","X-Fleetum-Site":"all","Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({amountCents:5000,method:"CASH",occurredAt:new Date().toISOString(),reference:"QA receipt",reason:"Incasso sintetico"})});assert.equal(receipt.status,201,await receipt.clone().text());
  const updated=await (await api(p.path+"/contract/conversion")).json() as any;assert.equal(updated.balance.receivedCents,5000);assert.equal(updated.balance.outstandingCents,3000);
  const converted=await api(p.path+"/contract/convert","POST",{reviewHash:updated.reviewHash});assert.equal(converted.status,201,await converted.clone().text());
  assert.equal((await converted.json() as any).balance.outstandingCents,3000);assert.equal(await prisma.rentalCollectionEntry.count({where:{bookingId:p.booking.id}}),1);
  assert.equal((await api(p.path,"PATCH",{finalTotal:1})).status,409);
 });
 test("concurrent manual conversion emits exactly once without requiring any receipt",async()=>{
  const p=await newPractice(),review=await (await api(p.path+"/contract/conversion")).json() as any;
  const responses=await Promise.all([0,1].map(()=>api(p.path+"/contract/convert","POST",{reviewHash:review.reviewHash})));assert.deepEqual(responses.map(r=>r.status).sort(),[200,201]);
  assert.equal(await prisma.bookingContractEvent.count({where:{contractId:p.contract.id,type:"ISSUED_MANUALLY"}}),1);
  for(const[path,method,body]of[["/contract","PATCH",{status:"SIGNED"}],["/contract","POST",{status:"SIGNED"}],["/transition","POST",{toStatus:"CONTRACT_SIGNED"}],["","PATCH",{contractStatus:"SIGNED"}]] as const)assert.equal((await api(p.path+path,method,body)).status,409);
 });
 test("in-person signature requires consent, same-browser PDF proof, and conserves original and final PDF",async()=>{
  const p=await newPractice();await convertPractice(p);
  const endpoint=p.path+"/contract/signing/in-person",send=()=>fetch(base+endpoint,{method:"POST",headers:{Authorization:`Bearer ${tokens.admin}`,"Content-Type":"application/json","X-Fleetum-Site":"all","X-Idempotency-Key":p.contract.id},body:"{}"});
  const prepared=await send();assert.equal(prepared.status,202,await prepared.clone().text());const request=await prepared.json() as any;assert.equal(request.method,"IN_PERSON");
  assert.equal(await prisma.emailQueue.count({where:{tenantId:ids.a,meta:{path:["requestId"],equals:request.id}}}),0);
  const sharp=(await import("sharp")).default;
  const image=await sharp(Buffer.from('<svg width="800" height="200" xmlns="http://www.w3.org/2000/svg"><path d="M50 120 Q90 30 140 100 T240 110 T340 75 L430 110" fill="none" stroke="#182438" stroke-width="4"/></svg>')).png().toBuffer();
  const body={requestId:request.id,documentHash:request.documentSha256,confirmationId:crypto.randomUUID(),signatureDataUrl:"data:image/png;base64,"+image.toString("base64"),consent:true,consentVersion:"in-person-v1"};
  assert.equal((await api(endpoint+"/confirm","POST",body)).status,403);
  const doc=await api(endpoint+"/document","POST",{requestId:request.id});assert.equal(doc.status,200,await doc.clone().text());const original=Buffer.from(await doc.arrayBuffer());assert.equal(sha(original),request.documentSha256);
  const cookie=doc.headers.getSetCookie().map(v=>v.split(";")[0]).join("; ");
  const confirm=(value=body,who="admin")=>fetch(base+endpoint+"/confirm",{method:"POST",headers:{Authorization:`Bearer ${tokens[who]}`,"Content-Type":"application/json","X-Fleetum-Site":"all",Cookie:cookie},body:JSON.stringify(value)});
  assert.equal((await confirm({...body,consent:false} as any)).status,422);assert.equal((await confirm(body,"foreign")).status,404);assert.equal((await confirm(body,"viewer")).status,403);
  assert.equal((await confirm({...body,signatureDataUrl:"data:image/png;base64,not-valid"})).status,422);
  const signed=await Promise.all([confirm(),confirm()]);for(const result of signed)assert.equal(result.status,200,await result.clone().text());
  const row=await prisma.contractSigningRequest.findUniqueOrThrow({where:{id:request.id}});assert.equal(row.status,"SIGNED");assert.ok(row.signedStoredFileObjectId);assert.ok(row.signedDocumentSha256);assert.notEqual(row.signedDocumentSha256,row.documentSha256);
  assert.equal(await prisma.bookingContractEvent.count({where:{contractId:p.contract.id,type:"SIGNED_IN_PERSON"}}),1);
  const final=await api(p.path+"/contract/pdf"),bytes=Buffer.from(await final.arrayBuffer());assert.equal(sha(bytes),row.signedDocumentSha256);
  const {PDFDocument}=await import("pdf-lib");assert.equal((await PDFDocument.load(bytes)).getPageCount(),(await PDFDocument.load(original)).getPageCount()+2);
  if(process.env.BLOCK4_PDF_OUTPUT)await writeFile(process.env.BLOCK4_PDF_OUTPUT,bytes);
  assert.equal((await confirm({...body,confirmationId:crypto.randomUUID()})).status,409);
  assert.equal((await api(p.path+"/contract","PATCH",{content:"Cannot replace a signed document"})).status,409);
  const evidence=await api(p.path+"/contract/signing/evidence.pdf");assert.equal(evidence.status,200);
  const afterReceipt=await fetch(base+"/rental-payments/bookings/"+p.booking.id+"/collections",{method:"POST",headers:{Authorization:`Bearer ${tokens.admin}`,"Content-Type":"application/json","X-Fleetum-Site":"all","Idempotency-Key":crypto.randomUUID()},body:JSON.stringify({amountCents:1000,method:"CASH",occurredAt:new Date().toISOString(),reference:"Post-sign synthetic receipt",reason:"Pagamento successivo alla firma"})});assert.equal(afterReceipt.status,201,await afterReceipt.clone().text());
  const afterPayment=await api(p.path+"/contract/pdf");assert.equal(sha(Buffer.from(await afterPayment.arrayBuffer())),row.signedDocumentSha256);
  const revision=await api(p.path+"/contract/revision","POST",{expectedRevision:0});assert.equal(revision.status,200,await revision.clone().text());
  const historical=await api(p.path+"/contract/signing/versions/"+request.id+"/pdf");assert.equal(historical.status,200);assert.equal(sha(Buffer.from(await historical.arrayBuffer())),row.signedDocumentSha256);
  assert.equal((await api(p.path+"/contract","PATCH",{content:"DOCUMENTO SINTETICO: nuova revisione espressa e nuova firma necessaria."})).status,200);
  const termsAfterRevision=await (await api(p.path+"/contract/rental-details")).json() as any;assert.equal(termsAfterRevision.frozen,false);
  const saveRevision=await api(p.path+"/contract/rental-details","PATCH",{revision:termsAfterRevision.revision,terms:{...termsAfterRevision.terms,cancellation:"Nuove condizioni sintetiche per questa revisione"}});assert.equal(saveRevision.status,200,await saveRevision.clone().text());

  const updated=await (await api(p.path+"/contract/conversion")).json() as any;assert.equal(updated.issuedAt,null);assert.equal(updated.documentRevision,1);
  assert.equal((await api(p.path+"/contract/convert","POST",{reviewHash:updated.reviewHash})).status,201);
  const another=await fetch(base+endpoint,{method:"POST",headers:{Authorization:`Bearer ${tokens.admin}`,"Content-Type":"application/json","X-Fleetum-Site":"all","X-Idempotency-Key":crypto.randomUUID()},body:"{}"});assert.equal(another.status,202,await another.clone().text());assert.equal((await another.json() as any).version,2);
  assert.equal((await prisma.contractSigningRequest.findUniqueOrThrow({where:{id:request.id}})).status,"SIGNED");

 });

 test("a queued ordinary contract email cannot send an obsolete revision",async()=>{
  const p=await issue(),code=await challenge(p);assert.equal((await pub("confirm",confirmation(p,code),p.cookie)).status,200);
  const document=Buffer.from(await (await api(p.path+"/contract/pdf")).arrayBuffer()),subject="Copia sintetica prima della revisione",body="Documento sintetico per prova locale";
  const delivery=await prisma.bookingContractDelivery.create({data:{tenantId:ids.a,bookingId:p.booking.id,contractId:p.contract.id,channel:"EMAIL",recipient:"signer@example.invalid",subject,body,status:"PENDING"}});
  const item=await prisma.emailQueue.create({data:{tenantId:ids.a,type:"BOOKING_CONTRACT",recipient:"signer@example.invalid",subject,body,meta:{tenantId:ids.a,bookingId:p.booking.id,contractId:p.contract.id,contractRevision:0,contractDeliveryId:delivery.id,actorUserId:ids.admin,siteAuthorization:p.row.siteAuthorization as any,attachments:[{filename:"synthetic.pdf",contentType:"application/pdf",contentBase64:document.toString("base64")}]}}});
  assert.equal((await api(p.path+"/contract/revision","POST",{expectedRevision:0})).status,200);
  const before=mail.length;await processIds([item.id]);assert.equal(mail.length,before);
  const result=await prisma.emailQueue.findUniqueOrThrow({where:{id:item.id}});assert.equal(result.status,"FAILED");assert.match(result.lastError??"",/CONTRACT_REVISION_CHANGED/);
 });

 }else{
 test("pre-upgrade invitations retain their exact PDF and cannot bypass a changed agreed amount",async()=>{
  const seed=await issue(),p=await newPractice(),crypt=createSigningCrypto(process.env.CONTRACT_SIGNING_KEY!),token=crypt.token(),id=crypto.randomUUID(),key=crypto.randomUUID();
  const {loadSigningSource,signingHash,stableSigningJson}=await import("../../src/application/services/contract-signing-source.js");
  const {buildEnterpriseContractPdf}=await import("../../src/application/services/enterprise-contract-pdf-service.js");
  const {persistNewBuffer}=await import("../../src/infrastructure/storage/upload-persistence.js");
  const source=await loadSigningSource(ids.a,p.booking.id),bytes=await buildEnterpriseContractPdf({...source.input,booking:{...source.input.booking,finalTotal:null,priceAgreement:undefined}});
  await persistNewBuffer({tenantId:ids.a,category:"contract-signing",resourceType:"ContractSigningDocument",resourceId:id,originalName:"synthetic-legacy-contract.pdf",mimeType:"application/pdf",buffer:bytes,commit:async(tx,storageKey)=>{
   const stored=await tx.storedFileObject.findFirstOrThrow({where:{tenantId:ids.a,storageKey}});
   await tx.contractSigningRequest.create({data:{id,tenantId:ids.a,contractId:p.contract.id,version:1,idempotencyKey:key,requestHash:signingHash(stableSigningJson({tenantId:ids.a,bookingId:p.booking.id,userId:ids.admin,recipient:"signer@example.invalid"})),tokenHash:crypt.hash(token),documentTitle:p.contract.title,bookingCode:p.booking.code,documentSha256:sha(bytes),sourceHash:source.legacySourceHash,storedFileObjectId:stored.id,recipient:"signer@example.invalid",signerName:source.signerName,issuerName:source.issuerName,actorUserId:ids.admin,siteAuthorization:seed.row.siteAuthorization as any,expiresAt:new Date(Date.now()+86400000)}});
  }});
  const status=await (await api(p.path+"/contract/signing")).json() as any;assert.equal(status.request.sourceChanged,false);
  await prisma.rentalBooking.update({where:{id:p.booking.id},data:{finalTotal:0}});assert.equal((await pub("resolve",{token})).status,410);
  await prisma.rentalBooking.update({where:{id:p.booking.id},data:{finalTotal:null}});
  const doc=await pub("document",{token});assert.equal(doc.status,200,await doc.clone().text());assert.equal(sha(Buffer.from(await doc.arrayBuffer())),sha(bytes));
  const cookie=doc.headers.getSetCookie().map(value=>value.split(";")[0]).join("; "),row=await prisma.contractSigningRequest.findUniqueOrThrow({where:{id}}),legacy={...p,row,token,cookie,bytes,key};
  const code=await challenge(legacy);assert.equal((await pub("confirm",confirmation(legacy,code),cookie)).status,200);
  assert.equal((await prisma.bookingContract.findUniqueOrThrow({where:{id:p.contract.id}})).issuedAt,null,"Historical invitation is consumed, not silently reclassified as a new manual issuance");
 });

 }

});
