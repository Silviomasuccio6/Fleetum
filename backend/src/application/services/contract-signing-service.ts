import {logger} from "../../infrastructure/logging/logger.js";
import crypto from "node:crypto";
import type {ContractSigningRequest,EmailQueue,Prisma} from "@prisma/client";
import {prisma} from "../../infrastructure/database/prisma/client.js";
import {env} from "../../shared/config/env.js";
import {AppError} from "../../shared/errors/app-error.js";
import {persistNewBuffer} from "../../infrastructure/storage/upload-persistence.js";
import {storageProvider} from "../../infrastructure/storage/storage-provider.js";
import {siteAccessForTenant} from "../../infrastructure/auth/site-access-context.js";
import {captureContractSiteAuthorization,contractSiteAuthorizationReason,ContractDispatchBlocked} from "../../infrastructure/email/contract-site-authorization.js";
import {LicensePolicyService} from "./license-policy-service.js";
import {snapshotFromRow} from "./tenant-subscription-service.js";
import {createSigningCrypto,SIGNING_CONSENT,SIGNING_CONSENT_VERSION} from "./contract-signing-crypto.js";
import {loadSigningSource,lockSigningBusinessSource,assertSigningReady,stableSigningJson,signingHash} from "./contract-signing-source.js";
import {buildEnterpriseContractPdf} from "./enterprise-contract-pdf-service.js";
import {buildSigningEvidencePdf} from "./contract-signing-evidence-pdf.js";
import type {SendEmailInput} from "../../infrastructure/email/email-sender.js";

type Db=Prisma.TransactionClient;
type Purpose="INVITE"|"OTP"|"COPY";
type Receipt={provider:"resend";id:string};
const unavailable=()=>new AppError("Richiesta di firma non disponibile o scaduta",410,"CONTRACT_SIGNING_NOT_AVAILABLE");
const envelopeContext=(row:ContractSigningRequest,queueId:string,purpose:Purpose,generation:number)=>`${row.tenantId}/${row.id}/${queueId}/${purpose}/${generation}`;
const queueType=(purpose:Purpose)=>`CONTRACT_SIGNING_${purpose}`;
const maskEmail=(value:string)=>{const [local,domain]=value.split("@");return `${local.slice(0,1)}***@${domain}`;};
class SigningReplay extends Error {constructor(readonly requestId:string){super("SIGNING_REPLAY");}}
export const signingConfigured=()=>/^[a-f0-9]{64}$/i.test(env.CONTRACT_SIGNING_KEY);

export class ContractSigningService {
 private crypt(){return createSigningCrypto(env.CONTRACT_SIGNING_KEY);}
 private async authority(tx:Db,tenantId:string,bookingId:string,actorUserId:string,scope:unknown,write=false){
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${actorUserId} AND "tenantId"=${tenantId} FOR SHARE`;
  const tenant=await tx.$queryRaw<Array<{isActive:boolean;deletedAt:Date|null}>>`SELECT "isActive","deletedAt" FROM "Tenant" WHERE "id"=${tenantId} FOR SHARE`;
  if(!tenant[0]?.isActive||tenant[0].deletedAt)throw unavailable();
  await tx.$queryRaw`SELECT "tenantId" FROM "TenantSubscription" WHERE "tenantId"=${tenantId} FOR SHARE`;
  const license=await new LicensePolicyService({getLatestByAction:(owner,resource,action)=>tx.auditLog.findFirst({where:{tenantId:owner,resource,action},orderBy:{createdAt:"desc"}})},async owner=>{const row=await tx.tenantSubscription.findUnique({where:{tenantId:owner}});return row?snapshotFromRow(row):null;}).getTenantLicense(tenantId);
  if(!["ACTIVE","TRIAL"].includes(license.status))throw unavailable();
  await lockSigningBusinessSource(tx,tenantId,bookingId,write);
  const source=await loadSigningSource(tenantId,bookingId,tx);
  const reason=await contractSiteAuthorizationReason(tx,tenantId,bookingId,source.contract.id,actorUserId,scope);
  if(reason)throw unavailable();
  return source;
 }
 private async summary(tx:Db,row:ContractSigningRequest){
  const ids=[row.inviteQueueId,row.otpQueueId,row.copyQueueId].filter((id):id is string=>Boolean(id));
  const queues=ids.length?await tx.emailQueue.findMany({where:{tenantId:row.tenantId,id:{in:ids}},select:{id:true,status:true}}):[];
  const state=(id:string|null)=>queues.find(q=>q.id===id)?.status??null;
  return{id:row.id,version:row.version,status:row.status==="PENDING"&&row.expiresAt.getTime()<=Date.now()?"EXPIRED":row.status,documentTitle:row.documentTitle,documentSha256:row.documentSha256,bookingCode:row.bookingCode,issuerName:row.issuerName,signerName:row.signerName,maskedEmail:maskEmail(row.recipient),expiresAt:row.expiresAt.toISOString(),signedAt:row.signedAt?.toISOString()??null,inviteDelivery:state(row.inviteQueueId),otpDelivery:state(row.otpQueueId),copyDelivery:state(row.copyQueueId),otpExpiresAt:row.otpExpiresAt?.toISOString()??null,resendAfter:row.lastOtpAt?new Date(row.lastOtpAt.getTime()+60000).toISOString():null,codeSendsRemaining:Math.max(0,5-row.otpSendCount),attemptsRemaining:Math.max(0,Math.min(5-row.otpAttempts,10-row.totalAttempts)),consent:SIGNING_CONSENT,consentVersion:SIGNING_CONSENT_VERSION};
 }
 async status(tenantId:string,bookingId:string){
  const source=await loadSigningSource(tenantId,bookingId);
  const row=await prisma.contractSigningRequest.findFirst({where:{tenantId,contractId:source.contract.id},orderBy:{version:"desc"}});
  return{configured:signingConfigured(),recipient:source.recipient,request:row?{...await this.summary(prisma,row),sourceChanged:row.status==="PENDING"&&row.sourceHash!==source.sourceHash}:null};
 }
 private async enqueue(tx:Db,row:ContractSigningRequest,purpose:Purpose,generation:number,payload:Record<string,unknown>){
  const id=crypto.randomUUID();const encrypted=this.crypt().seal(payload,envelopeContext(row,id,purpose,generation));
  const subject=purpose==="OTP"?`Codice per firmare il contratto ${row.bookingCode}`:purpose==="COPY"?`Copia del contratto ${row.bookingCode} e registrazione firma`:`Firma del contratto ${row.bookingCode}`;
  await tx.emailQueue.create({data:{id,tenantId:row.tenantId,type:queueType(purpose),deduplicationKey:`contract-signing:${row.id}:${purpose}:${generation}`,recipient:row.recipient,subject,body:"Messaggio riservato di firma. Contenuto disponibile soltanto al servizio di invio autorizzato.",meta:{tenantId:row.tenantId,requestId:row.id,purpose,generation,payloadEncrypted:encrypted},maxAttempts:3}});
  return id;
 }
 async issue(tenantId:string,bookingId:string,userId:string,input:{recipient?:string;idempotencyKey:string}){
  const crypt=this.crypt(),scope=captureContractSiteAuthorization(siteAccessForTenant(tenantId),userId);
  const source=await loadSigningSource(tenantId,bookingId);
  const recipient=(input.recipient??source.recipient).trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)||recipient.length>254)throw new AppError("Inserisci un’email valida per il firmatario",422,"CONTRACT_SIGNER_EMAIL_REQUIRED");
  const requestHash=signingHash(stableSigningJson({tenantId,bookingId,userId,recipient}));
  const previous=await prisma.contractSigningRequest.findUnique({where:{tenantId_idempotencyKey:{tenantId,idempotencyKey:input.idempotencyKey}}});
  if(previous){if(previous.requestHash!==requestHash||previous.contractId!==source.contract.id)throw new AppError("Richiesta già utilizzata con dati differenti",409,"IDEMPOTENCY_CONFLICT");return{...await this.summary(prisma,previous),duplicate:true};}
  assertSigningReady(source);
  const bytes=await buildEnterpriseContractPdf(source.input);
  if(bytes.length>3*1024*1024)throw new AppError("Il documento è troppo grande per la firma online",413,"CONTRACT_SIGNING_DOCUMENT_TOO_LARGE");
  const id=crypto.randomUUID(),token=crypt.token(),documentSha256=signingHash(bytes),expiresAt=new Date(Date.now()+48*3600000);
  try{
   const persisted=await persistNewBuffer({tenantId,category:"contract-signing",resourceType:"ContractSigningDocument",resourceId:id,originalName:`Contratto_${source.booking.code.replace(/[^a-zA-Z0-9_-]/g,"_")}.pdf`,mimeType:"application/pdf",buffer:bytes,commit:async(tx,key)=>{
    const current=await this.authority(tx,tenantId,bookingId,userId,scope,true);
    const replay=await tx.contractSigningRequest.findUnique({where:{tenantId_idempotencyKey:{tenantId,idempotencyKey:input.idempotencyKey}}});
    if(replay){if(replay.requestHash!==requestHash)throw new AppError("Richiesta già utilizzata con dati differenti",409,"IDEMPOTENCY_CONFLICT");throw new SigningReplay(replay.id);}
    assertSigningReady(current);
    if(current.sourceHash!==source.sourceHash)throw new AppError("I dati sono cambiati. Rileggi il contratto prima dell’invio",409,"CONTRACT_DOCUMENT_CHANGED");
    const active=await tx.contractSigningRequest.findFirst({where:{tenantId,contractId:current.contract.id,OR:[{status:"SIGNED"},{status:"PENDING",expiresAt:{gt:new Date()}}]}});
    if(active)throw new AppError("Esiste già una firma o un invito attivo. Verifica la pratica",409,"CONTRACT_SIGNATURE_EXISTS");
    await tx.contractSigningRequest.updateMany({where:{tenantId,contractId:current.contract.id,status:"PENDING",expiresAt:{lte:new Date()}},data:{status:"EXPIRED",otpHash:null,browserHash:null}});
    const last=await tx.contractSigningRequest.aggregate({where:{tenantId,contractId:current.contract.id},_max:{version:true}});
    const stored=await tx.storedFileObject.findFirstOrThrow({where:{tenantId,storageKey:key,resourceType:"ContractSigningDocument",resourceId:id,visibility:"private",deletedAt:null}});
    const row=await tx.contractSigningRequest.create({data:{id,tenantId,contractId:current.contract.id,version:(last._max.version??0)+1,idempotencyKey:input.idempotencyKey,requestHash,tokenHash:crypt.hash(token),documentTitle:current.contract.title,bookingCode:current.booking.code,documentSha256,sourceHash:current.sourceHash,storedFileObjectId:stored.id,recipient,signerName:current.signerName,issuerName:current.issuerName,actorUserId:userId,siteAuthorization:scope as unknown as Prisma.InputJsonValue,expiresAt}});
    const inviteQueueId=await this.enqueue(tx,row,"INVITE",0,{token});
    await tx.contractSigningRequest.update({where:{id},data:{inviteQueueId}});
    // Previously shared mutable links must not expose a newly frozen version.
    const shares=await tx.bookingContractDelivery.findMany({where:{tenantId,contractId:current.contract.id,channel:"WHATSAPP"}});
    for(const share of shares){const details=share.details&&typeof share.details==="object"&&!Array.isArray(share.details)?share.details:{};await tx.bookingContractDelivery.update({where:{id:share.id},data:{details:{...details,revokedAt:new Date().toISOString()}}});}
    await tx.bookingContractEvent.create({data:{tenantId,bookingId,contractId:current.contract.id,actorUserId:userId,type:"SIGNING_INVITED",message:"Documento congelato e invito alla firma email predisposto",details:{requestId:id,version:row.version,documentSha256}}});
    return id;
   }});
   const row=await prisma.contractSigningRequest.findUniqueOrThrow({where:{id:persisted.result!}});return{...await this.summary(prisma,row),duplicate:false};
  }catch(error){
   if(error instanceof SigningReplay){const row=await prisma.contractSigningRequest.findFirstOrThrow({where:{id:error.requestId,tenantId,requestHash}});return{...await this.summary(prisma,row),duplicate:true};}
   if(error&&typeof error==="object"&&"code" in error&&["P2034","P2002"].includes(String(error.code))){
    const replay=await prisma.contractSigningRequest.findUnique({where:{tenantId_idempotencyKey:{tenantId,idempotencyKey:input.idempotencyKey}}});
    if(replay?.requestHash===requestHash)return{...await this.summary(prisma,replay),duplicate:true};
    throw new AppError("La pratica è cambiata durante l’invio. Rileggi lo stato prima di riprovare",409,"CONTRACT_SIGNING_CHANGED");
   }
   throw error;
  }
 }
 private async lookup(token:string){
  const crypt=this.crypt();if(!crypt.validToken(token))throw unavailable();
  const row=await prisma.contractSigningRequest.findUnique({where:{tokenHash:crypt.hash(token)}});
  if(!row)throw unavailable();return row;
 }
 private async publicTransaction<T>(token:string,fn:(tx:Db,row:ContractSigningRequest,source:Awaited<ReturnType<typeof loadSigningSource>>,now:Date)=>Promise<T>){
  const found=await this.lookup(token);const contract=await prisma.bookingContract.findFirst({where:{id:found.contractId,tenantId:found.tenantId},select:{bookingId:true}});if(!contract)throw unavailable();
  return prisma.$transaction(async tx=>{
   const source=await this.authority(tx,found.tenantId,contract.bookingId,found.actorUserId,found.siteAuthorization,true);
   await tx.$queryRaw`SELECT "id" FROM "ContractSigningRequest" WHERE "id"=${found.id} AND "tenantId"=${found.tenantId} FOR UPDATE`;
   const row=await tx.contractSigningRequest.findUniqueOrThrow({where:{id:found.id}}),now=new Date();
   if(!["PENDING","SIGNED"].includes(row.status)||row.expiresAt<=now||["CANCELED","NO_SHOW"].includes(source.booking.status))throw unavailable();
   if(row.status==="PENDING"&&(row.sourceHash!==source.sourceHash||source.booking.status!=="CONFIRMED"))throw unavailable();
   return fn(tx,row,source,now);
  });
 }
 async resolve(token:string){return this.publicTransaction(token,(tx,row)=>this.summary(tx,row));}
 async readPdf(row:ContractSigningRequest){
  const stored=await prisma.storedFileObject.findFirst({where:{id:row.storedFileObjectId,tenantId:row.tenantId,resourceType:"ContractSigningDocument",resourceId:row.id,visibility:"private",deletedAt:null}});
  if(!stored||stored.sizeBytes>3*1024*1024||stored.checksumSha256!==row.documentSha256)throw new AppError("Documento non disponibile",503,"CONTRACT_DOCUMENT_UNAVAILABLE");
  const bytes=await storageProvider.read(stored.storageKey).catch(()=>{throw new AppError("Documento non disponibile",503,"CONTRACT_DOCUMENT_UNAVAILABLE");});if(bytes.length!==stored.sizeBytes||signingHash(bytes)!==row.documentSha256)throw new AppError("Verifica del documento non riuscita",503,"CONTRACT_DOCUMENT_INTEGRITY");
  return bytes;
 }
 async document(token:string,existingProof:string){
  const row=await this.publicTransaction(token,async(_tx,current)=>current),bytes=await this.readPdf(row);
  await this.publicTransaction(token,async(_tx,current)=>{if(current.id!==row.id)throw unavailable();});
  const crypt=this.crypt(),proof=crypt.readProof(existingProof,row.id,row.documentSha256,Date.now())?existingProof:crypt.documentProof(row.id,row.documentSha256,Date.now());
  return{bytes,proof,requestId:row.id,filename:`Contratto_${row.bookingCode.replace(/[^a-zA-Z0-9_-]/g,"_")}.pdf`};
 }
 async requestOtp(token:string,documentHash:string,proofValue:string){
  return this.publicTransaction(token,async(tx,row,_source,now)=>{
   const crypt=this.crypt(),proof=crypt.readProof(proofValue,row.id,row.documentSha256,now.getTime());
   if(row.status!=="PENDING"||documentHash!==row.documentSha256||!proof)throw new AppError("Apri il documento prima di richiedere il codice",409,"CONTRACT_DOCUMENT_VIEW_REQUIRED");
   if(row.otpSendCount>=5||row.totalAttempts>=10)throw new AppError("Limite dei codici raggiunto. Contatta il noleggiatore",429,"CONTRACT_OTP_LIMIT");
   if(row.lastOtpAt&&now.getTime()-row.lastOtpAt.getTime()<60000)throw new AppError("Attendi un minuto prima di richiedere un altro codice",429,"CONTRACT_OTP_COOLDOWN");
   const generation=row.otpGeneration+1,code=crypt.code(),browserHash=crypt.hash(proof.nonce);
   const updated=await tx.contractSigningRequest.update({where:{id:row.id},data:{otpGeneration:generation,otpSendCount:{increment:1},otpAttempts:0,otpHash:crypt.otpDigest({requestId:row.id,generation,documentHash:row.documentSha256,browserHash,code}),browserHash,otpExpiresAt:new Date(now.getTime()+10*60000),lastOtpAt:now,documentRequestedAt:new Date(proof.at)}});
   const otpQueueId=await this.enqueue(tx,updated,"OTP",generation,{code});
   const latest=await tx.contractSigningRequest.update({where:{id:row.id},data:{otpQueueId}});return this.summary(tx,latest);
  });
 }
 async confirm(token:string,input:{documentHash:string;code:string;confirmationId:string;consentVersion:string},proofValue:string,audit:{ip:string;userAgent:string}){
  const outcome=await this.publicTransaction(token,async(tx,row,source,now)=>{
   const crypt=this.crypt(),proof=crypt.readProof(proofValue,row.id,row.documentSha256,now.getTime());
   if(!proof||input.documentHash!==row.documentSha256||input.consentVersion!==SIGNING_CONSENT_VERSION)return{error:"DOCUMENT_OR_BROWSER" as const};
   const browserHash=crypt.hash(proof.nonce),digest=crypt.otpDigest({requestId:row.id,generation:row.otpGeneration,documentHash:row.documentSha256,browserHash,code:input.code});
   if(row.status==="SIGNED"){
    if(row.confirmationId===input.confirmationId&&row.signedBrowserHash===browserHash&&crypt.equal(digest,row.consumedOtpHash??""))return{value:{...await this.summary(tx,row),duplicate:true}};
    return{error:"ALREADY_SIGNED" as const};
   }
   if(row.browserHash!==browserHash)return{error:"DOCUMENT_OR_BROWSER" as const};
   if(row.otpAttempts>=5||row.totalAttempts>=10)return{error:"LIMIT" as const};
   if(!row.otpExpiresAt||row.otpExpiresAt<=now||!row.otpHash)return{error:"INVALID_CODE" as const};
   const delivery=await tx.emailQueue.findFirst({where:{id:row.otpQueueId??"",tenantId:row.tenantId,type:queueType("OTP"),status:"SENT"},select:{meta:true}});
   const meta=(delivery?.meta??{}) as Record<string,unknown>;
   if(!delivery||meta.requestId!==row.id||meta.generation!==row.otpGeneration||meta.emailProvider!=="resend"||typeof meta.providerMessageId!=="string"||!meta.providerMessageId.trim())return{error:"NOT_SENT" as const};
   if(!crypt.equal(digest,row.otpHash)){
    await tx.contractSigningRequest.update({where:{id:row.id},data:{otpAttempts:{increment:1},totalAttempts:{increment:1}}});
    return{error:"INVALID_CODE" as const};
   }
   const evidence={version:1,method:"EMAIL_OTP",requestId:row.id,tenantId:row.tenantId,contractId:row.contractId,documentVersion:row.version,documentTitle:row.documentTitle,documentSha256:row.documentSha256,signerName:row.signerName,signerEmail:row.recipient,issuerName:row.issuerName,signedAt:now.toISOString(),documentRequestedAt:row.documentRequestedAt?.toISOString()??null,otpRequestedAt:row.lastOtpAt?.toISOString()??null,otpGeneration:row.otpGeneration,otpQueueId:row.otpQueueId,otpProviderMessageId:meta.providerMessageId,consentVersion:SIGNING_CONSENT_VERSION,consent:SIGNING_CONSENT,confirmationId:input.confirmationId,browserHash,ipHash:crypt.auditHash(audit.ip),userAgentHash:crypt.auditHash(audit.userAgent)};
   const copyQueueId=await this.enqueue(tx,row,"COPY",row.otpGeneration,{documentSha256:row.documentSha256});
   const signed=await tx.contractSigningRequest.update({where:{id:row.id},data:{status:"SIGNED",signedAt:now,confirmationId:input.confirmationId,consumedOtpHash:row.otpHash,signedBrowserHash:browserHash,otpHash:null,browserHash:null,consentVersion:SIGNING_CONSENT_VERSION,evidence,evidenceMac:crypt.evidenceMac(stableSigningJson(evidence)),copyQueueId}});
   await tx.bookingContract.update({where:{id:row.contractId},data:{status:"SIGNED",signedAt:now,errorMessage:null}});
   await tx.rentalBooking.update({where:{id:source.booking.id},data:{contractStatus:"SIGNED",contractSignedAt:now,status:"CONTRACT_SIGNED"}});
   await tx.bookingContractEvent.create({data:{tenantId:row.tenantId,bookingId:source.booking.id,contractId:row.contractId,type:"SIGNED_EMAIL_OTP",message:"Firma tramite codice email registrata sul documento conservato",details:{requestId:row.id,documentSha256:row.documentSha256,version:row.version,signedAt:now.toISOString()}}});
   return{value:{...await this.summary(tx,signed),duplicate:false}};
  });
  if("error" in outcome){
   if(outcome.error==="ALREADY_SIGNED")throw new AppError("Questo documento è già stato sottoscritto",409,"CONTRACT_ALREADY_SIGNED");
   if(outcome.error==="LIMIT")throw new AppError("Troppi tentativi. Contatta il noleggiatore",429,"CONTRACT_OTP_LIMIT");
   if(outcome.error==="NOT_SENT")throw new AppError("Attendi la conferma dell’invio del codice",409,"CONTRACT_OTP_NOT_SENT");
   if(outcome.error==="DOCUMENT_OR_BROWSER")throw new AppError("Riapri il documento e richiedi il codice da questo browser",403,"CONTRACT_OTP_BROWSER_MISMATCH");
   throw new AppError("Codice non valido o scaduto",422,"CONTRACT_OTP_INVALID");
  }
  return outcome.value;
 }
 async revoke(tenantId:string,bookingId:string,userId:string){
  const scope=captureContractSiteAuthorization(siteAccessForTenant(tenantId),userId);
  await prisma.$transaction(async tx=>{
   const source=await this.authority(tx,tenantId,bookingId,userId,scope,true);
   await tx.contractSigningRequest.updateMany({where:{tenantId,contractId:source.contract.id,status:"PENDING"},data:{status:"REVOKED",otpHash:null,browserHash:null}});
   await tx.bookingContractEvent.create({data:{tenantId,bookingId,contractId:source.contract.id,actorUserId:userId,type:"SIGNING_REVOKED",message:"Invito alla firma revocato"}});
  });return this.status(tenantId,bookingId);
 }
 async frozen(tenantId:string,bookingId:string){
  const source=await loadSigningSource(tenantId,bookingId);
  const row=await prisma.contractSigningRequest.findFirst({where:{tenantId,contractId:source.contract.id,OR:[{status:"SIGNED"},{status:"PENDING",expiresAt:{gt:new Date()}}]},orderBy:{version:"desc"}});
  return row?{row,bytes:await this.readPdf(row)}:null;
 }
 async publicEvidence(token:string){
  const row=await this.publicTransaction(token,async(_tx,current)=>{if(current.status!=="SIGNED")throw unavailable();return current;});
  return this.evidencePdf(row);
 }
 async evidencePdf(row:ContractSigningRequest){
  if(row.status!=="SIGNED"||!row.evidence||!this.crypt().equal(this.crypt().evidenceMac(stableSigningJson(row.evidence)),row.evidenceMac??""))throw new AppError("Registrazione della firma non disponibile",503,"CONTRACT_SIGNING_EVIDENCE_UNAVAILABLE");
  return buildSigningEvidencePdf(row);
 }
 async dispatchEmail(item:Pick<EmailQueue,"id"|"tenantId"|"meta"|"recipient"|"subject"|"body"|"type">,processingToken:string,currentTime:()=>Date,leaseMs:number,start:(message:Partial<SendEmailInput>)=>Promise<Receipt>,storedReceipt:Receipt|null){
  const meta=(item.meta??{}) as Record<string,unknown>,purpose=meta.purpose as Purpose;
  if(item.type!==queueType(purpose)||!item.tenantId||meta.tenantId!==item.tenantId||typeof meta.requestId!=="string"||!["INVITE","OTP","COPY"].includes(purpose)||!Number.isInteger(meta.generation)||typeof meta.payloadEncrypted!=="string")throw new ContractDispatchBlocked("SIGNING_TARGET_INVALID");
  const found=await prisma.contractSigningRequest.findFirst({where:{id:meta.requestId,tenantId:item.tenantId},include:{contract:{select:{bookingId:true}}}});if(!found)throw new ContractDispatchBlocked("SIGNING_TARGET_MISSING");
  let payload:Record<string,unknown>;try{payload=this.crypt().open(meta.payloadEncrypted,envelopeContext(found,item.id,purpose,meta.generation as number));}catch{throw new ContractDispatchBlocked("SIGNING_ENVELOPE_INVALID");}
  let attachments:SendEmailInput["attachments"]=[];
  if(purpose==="COPY")attachments=[{filename:`Contratto_${found.bookingCode.replace(/[^a-zA-Z0-9_-]/g,"_")}.pdf`,content:await this.readPdf(found),contentType:"application/pdf"},{filename:"Registrazione_firma_email.pdf",content:await this.evidencePdf(found),contentType:"application/pdf"}];
  const delivery:{outcome?:Promise<{receipt:Receipt}|{error:unknown}>}={};
  try {await prisma.$transaction(async tx=>{
   const source=await this.authority(tx,found.tenantId,found.contract.bookingId,found.actorUserId,found.siteAuthorization);
   await tx.$queryRaw`SELECT "id" FROM "ContractSigningRequest" WHERE "id"=${found.id} AND "tenantId"=${found.tenantId} FOR UPDATE`;
   const row=await tx.contractSigningRequest.findUniqueOrThrow({where:{id:found.id}}),now=currentTime();
   if(item.recipient!==row.recipient)throw new ContractDispatchBlocked("SIGNING_RECIPIENT_CHANGED");
   const expectedSubject=purpose==="OTP"?`Codice per firmare il contratto ${row.bookingCode}`:purpose==="COPY"?`Copia del contratto ${row.bookingCode} e registrazione firma`:`Firma del contratto ${row.bookingCode}`;
   if(item.subject!==expectedSubject)throw new ContractDispatchBlocked("SIGNING_MESSAGE_CHANGED");
   let text:string;
   if(purpose==="COPY"){
    if(row.status!=="SIGNED"||row.copyQueueId!==item.id||meta.generation!==row.otpGeneration||payload.documentSha256!==row.documentSha256)throw new ContractDispatchBlocked("SIGNING_COPY_CHANGED");
    text=`Gentile ${row.signerName},\n\nla firma tramite codice email del contratto ${row.bookingCode} è stata registrata. In allegato trovi il documento esatto e la registrazione della firma.\n\n${row.issuerName}`;
   }else{
    if(row.status!=="PENDING"||row.expiresAt<=now||row.sourceHash!==source.sourceHash||source.booking.status!=="CONFIRMED")throw new ContractDispatchBlocked("SIGNING_REQUEST_INACTIVE");
    if(purpose==="INVITE"){
     if(row.inviteQueueId!==item.id||meta.generation!==0||typeof payload.token!=="string"||this.crypt().hash(payload.token)!==row.tokenHash)throw new ContractDispatchBlocked("SIGNING_INVITE_CHANGED");
     const link=new URL("/firma-contratto",env.APP_URL);link.hash="token="+payload.token;
     text=`Gentile ${row.signerName},\n\n${row.issuerName} ti invita a leggere e sottoscrivere il contratto ${row.bookingCode}.\n\n${link.toString()}\n\nApri il documento e richiedi il codice email. Il collegamento scade il ${row.expiresAt.toLocaleString("it-IT",{timeZone:"Europe/Rome"})}.\nNon condividere questo collegamento.`;
    }else{
     if(row.otpQueueId!==item.id||row.otpGeneration!==meta.generation||!row.otpExpiresAt||row.otpExpiresAt<=now||!row.browserHash||typeof payload.code!=="string"||!/^\d{6}$/.test(payload.code)||!this.crypt().equal(this.crypt().otpDigest({requestId:row.id,generation:row.otpGeneration,documentHash:row.documentSha256,browserHash:row.browserHash,code:payload.code}),row.otpHash??""))throw new ContractDispatchBlocked("SIGNING_OTP_EXPIRED_OR_REPLACED");
     text=`Il codice per sottoscrivere il contratto ${row.bookingCode}, versione ${row.version}, è:\n\n${payload.code}\n\nScade dopo 10 minuti dalla richiesta ed è utilizzabile dal browser che lo ha richiesto. Non condividerlo.\n\n${row.issuerName}`;
    }
   }
   const claim=await tx.emailQueue.updateMany({where:{id:item.id,tenantId:row.tenantId,status:"PENDING",processingToken,leaseExpiresAt:{gt:now}},data:{leaseExpiresAt:new Date(now.getTime()+leaseMs)}});if(claim.count!==1)return;
   if(storedReceipt){delivery.outcome=Promise.resolve({receipt:storedReceipt});return;}
   // Observe the outcome immediately; retain locks through provider initiation only.
   delivery.outcome=start({text,html:undefined,attachments,fromName:row.issuerName,replyTo:undefined}).then(receipt=>{if(!receipt.id?.trim())return{error:new Error("Riscontro del servizio email non disponibile")};return{receipt};},()=>({error:new Error("Invio email firma non confermato")}));
  },{maxWait:5000,timeout:10000});}catch(error){
   if(!delivery.outcome)throw error;
   logger.warn({queueId:item.id},"Signing guard commit uncertain after provider initiation");
  }
  if(!delivery.outcome)return null;const result=await delivery.outcome;if("error" in result)throw result.error;return result.receipt;
 }
}
export const contractSigningService=new ContractSigningService();
