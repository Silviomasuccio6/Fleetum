import crypto from 'node:crypto';
import {Prisma} from '@prisma/client';
import {prisma} from '../../infrastructure/database/prisma/client.js';
import {siteAccessForTenant} from '../../infrastructure/auth/site-access-context.js';
import {visibleBookingWhere} from '../../infrastructure/repositories/resource-site-scope.js';
import {createAuditLog} from '../../infrastructure/repositories/prisma-audit-log-repository.js';
import {env} from '../../shared/config/env.js';
import {ExactMoneyReader} from '../../infrastructure/database/exact-money-reader.js';
import {AppError} from '../../shared/errors/app-error.js';
import {collectionBalance,validateCollectionTarget} from '../../domain/payments/rental-collection-policy.js';
export type CollectionQuery={page:number;pageSize:number;search?:string;bookingId?:string;customerId?:string;siteId?:string;from?:string;to?:string;state?:string;method?:string};
export type CollectionCommand={amountCents?:number;method?:'CASH'|'BANK_TRANSFER'|'EXTERNAL_POS';occurredAt:string;reference:string;reason:string;requestKey:string};
const missing=()=>new AppError('Pratica di pagamento non trovata',404,'RENTAL_PAYMENT_NOT_FOUND');
const conflict=(message:string)=>new AppError(message,409,'RENTAL_COLLECTION_CONFLICT');
const safeInteger=(value:unknown):number=>{const n=Number(value);if(!Number.isSafeInteger(n))throw conflict('Importo non rappresentabile in centesimi esatti.');return n;};
// Parameters are always bound. SQL identifiers are fixed here, never supplied by a request.
function workspaceQuery(tenantId:string,q:CollectionQuery){
 const scope=siteAccessForTenant(tenantId),conditions:Prisma.Sql[]=[Prisma.sql`b."tenantId"=${tenantId}`,
  Prisma.sql`v."tenantId"=${tenantId}`,Prisma.sql`(b."customerId" IS NULL OR c."tenantId"=${tenantId})`,
  Prisma.sql`(b."deletedAt" IS NULL OR EXISTS(SELECT 1 FROM "RentalCollectionEntry" h WHERE h."tenantId"=${tenantId} AND h."bookingId"=b.id))`];
 const site=(ids:string[])=>ids.length?Prisma.sql`(b."siteId" IN (${Prisma.join(ids)}) OR b."pickupSiteId" IN (${Prisma.join(ids)}) OR b."returnSiteId" IN (${Prisma.join(ids)}))`:Prisma.sql`FALSE`;
 if(scope&&!scope.allSites)conditions.push(site(scope.siteIds));
 if(q.siteId)conditions.push(site([q.siteId]));
 if(q.bookingId)conditions.push(Prisma.sql`b.id=${q.bookingId}`);
 if(q.customerId)conditions.push(Prisma.sql`b."customerId"=${q.customerId}`);
 if(q.search){const pattern='%'+q.search.replace(/[\\%_]/g,'\\$&')+'%';conditions.push(Prisma.sql`(b.code ILIKE ${pattern} OR b."customerName" ILIKE ${pattern} OR v.plate ILIKE ${pattern})`);}
 if(q.from)conditions.push(Prisma.sql`b."returnAt">=${new Date(q.from+'T00:00:00Z')}`);
 if(q.to)conditions.push(Prisma.sql`b."pickupAt"<${new Date(new Date(q.to+'T00:00:00Z').getTime()+86400000)}`);
 if(q.method)conditions.push(Prisma.sql`EXISTS(SELECT 1 FROM "RentalCollectionEntry" m WHERE m."tenantId"=${tenantId} AND m."bookingId"=b.id AND m.kind='RECEIPT' AND m.method::text=${q.method})`);
 const final=env.EXACT_MONEY_READ_MODE==='exact'?Prisma.sql`COALESCE(b."finalTotalExact",round(b."finalTotal"::numeric,2))`:Prisma.sql`round(b."finalTotal"::numeric,2)`;
 const expected=env.EXACT_MONEY_READ_MODE==='exact'?Prisma.sql`COALESCE(b."expectedTotalExact",round(b."expectedTotal"::numeric,2))`:Prisma.sql`round(b."expectedTotal"::numeric,2)`;
 return Prisma.sql`WITH scoped AS (
  SELECT b.id,b."tenantId",b.code,b."customerId",b."customerName",b."pickupAt",b."returnAt",b."siteId",b."deletedAt",b."vehicleId",
   v.plate,v.brand,v.model,s.name AS "siteName",COALESCE(${final},${expected})*100 AS agreed
  FROM "RentalBooking" b JOIN "Vehicle" v ON v.id=b."vehicleId" LEFT JOIN "RentalCustomer" c ON c.id=b."customerId"
  LEFT JOIN "Site" s ON s.id=b."siteId" AND s."tenantId"=b."tenantId" WHERE ${Prisma.join(conditions,' AND ')}
 ), totals AS (
  SELECT e."bookingId",SUM(CASE WHEN e.kind='RECEIPT' THEN e."amountCents" WHEN e.kind='REFUND' THEN -e."amountCents"
   WHEN p.kind='RECEIPT' THEN -e."amountCents" ELSE e."amountCents" END)::numeric AS received
  FROM "RentalCollectionEntry" e JOIN scoped b ON b.id=e."bookingId" AND b."tenantId"=e."tenantId"
  LEFT JOIN "RentalCollectionEntry" p ON p.id=e."sourceId" AND p."tenantId"=e."tenantId" AND p."bookingId"=e."bookingId" GROUP BY e."bookingId"
 ), balances AS (
  SELECT b.*,COALESCE(t.received,0) AS received,
   CASE WHEN b.agreed IS NULL THEN NULL ELSE GREATEST(0,b.agreed-COALESCE(t.received,0)) END AS due,
   CASE WHEN b.agreed IS NULL THEN 0 ELSE GREATEST(0,COALESCE(t.received,0)-b.agreed) END AS credit,
   COALESCE((SELECT SUM(d."amountCents"-d."capturedAmountCents") FROM "RentalDeposit" d
    JOIN "RentalCustomerPaymentMethod" m ON m.id=d."paymentMethodId" AND m."tenantId"=b."tenantId" AND m."rentalCustomerId"=b."customerId"
    JOIN "RentalCustomerPaymentProfile" p ON p.id=m."paymentProfileId" AND p."tenantId"=b."tenantId" AND p."rentalCustomerId"=b."customerId"
    WHERE d."tenantId"=b."tenantId" AND d."bookingId"=b.id AND d."rentalCustomerId"=b."customerId"
     AND (d."vehicleId" IS NULL OR d."vehicleId"=b."vehicleId") AND d."deletedAt" IS NULL AND d.status='AUTHORIZED' AND (d."captureBefore" IS NULL OR d."captureBefore">CURRENT_TIMESTAMP)),0) AS guarantee
  FROM scoped b LEFT JOIN totals t ON t."bookingId"=b.id
 ), states AS (
  SELECT *,CASE WHEN agreed IS NULL THEN 'UNKNOWN' WHEN received>agreed THEN 'CREDIT' WHEN agreed=0 THEN 'FREE'
   WHEN received=agreed THEN 'PAID' WHEN received>0 THEN 'PARTIAL' ELSE 'DUE' END AS state FROM balances
 ), filtered AS(SELECT * FROM states ${q.state?Prisma.sql`WHERE state=${q.state}`:Prisma.empty})`;
}
const projection=Prisma.sql`id,code,"customerId","customerName","pickupAt","returnAt","siteId","siteName","deletedAt",plate,brand,model,
 agreed::text AS "agreedCents",received::text AS "receivedCents",due::text AS "outstandingCents",credit::text AS "creditCents",guarantee::text AS "authorizedGuaranteeCents",state`;
function rowDto(row:any){return{...row,archived:!!row.deletedAt,agreedCents:row.agreedCents===null?null:safeInteger(row.agreedCents),receivedCents:safeInteger(row.receivedCents),outstandingCents:row.outstandingCents===null?null:safeInteger(row.outstandingCents),creditCents:safeInteger(row.creditCents),authorizedGuaranteeCents:safeInteger(row.authorizedGuaranteeCents)};}
export class RentalCollectionService{
 async list(tenantId:string,q:CollectionQuery){
  return prisma.$transaction(async tx=>{
   const query=workspaceQuery(tenantId,q);
   const rows=await tx.$queryRaw<any[]>(Prisma.sql`${query} SELECT ${projection} FROM filtered ORDER BY "pickupAt" DESC,id OFFSET ${(q.page-1)*q.pageSize} LIMIT ${q.pageSize}`);
   const [stats]=await tx.$queryRaw<any[]>(Prisma.sql`${query} SELECT count(*)::text AS count,count(*) FILTER(WHERE agreed IS NULL)::text AS unknown,
    COALESCE(SUM(agreed),0)::text AS agreed,COALESCE(SUM(received),0)::text AS received,COALESCE(SUM(due),0)::text AS due,
    COALESCE(SUM(credit),0)::text AS credit,COALESCE(SUM(guarantee),0)::text AS guarantee FROM filtered`);
   return{data:rows.map(rowDto),total:safeInteger(stats.count),page:q.page,pageSize:q.pageSize,summary:{agreedCents:safeInteger(stats.agreed),receivedCents:safeInteger(stats.received),outstandingCents:safeInteger(stats.due),creditCents:safeInteger(stats.credit),authorizedGuaranteeCents:safeInteger(stats.guarantee),unknownTotalCount:safeInteger(stats.unknown)}};
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
 }
 async detail(tenantId:string,bookingId:string){
  return prisma.$transaction(async tx=>{
   const rows=await tx.$queryRaw<any[]>(Prisma.sql`${workspaceQuery(tenantId,{bookingId,page:1,pageSize:1})} SELECT ${projection} FROM filtered`);
   if(!rows[0])throw missing();
   const entries=await tx.rentalCollectionEntry.findMany({where:{tenantId,bookingId},orderBy:[{createdAt:'asc'},{id:'asc'}],select:{id:true,kind:true,method:true,amountCents:true,currency:true,occurredAt:true,reference:true,reason:true,sourceId:true,createdAt:true,createdBy:{select:{id:true,firstName:true,lastName:true}}}});
   // The legacy pricing snapshot is descriptive; it never overrides the booking's agreed amount.
   const savedPricing=await tx.rentalBookingPricingSnapshot.findFirst({where:{tenantId,bookingId,deletedAt:null},select:{id:true,priceListName:true,pricePackageName:true,baseRateAmount:true,baseRateUnit:true,discountPercent:true,createdAt:true}});
   const reader=new ExactMoneyReader().withQuery(<T>(sql:string,...values:unknown[])=>tx.$queryRawUnsafe<T>(sql,...values));
   const [hydrated]=await reader.hydrate('RentalBookingPricingSnapshot',savedPricing?[savedPricing]:[],{tenantId});
   const pricing=hydrated?{id:hydrated.id,priceListName:hydrated.priceListName,pricePackageName:hydrated.pricePackageName,
    unitRateAmount:hydrated.baseRateAmount===null?null:String(hydrated.baseRateAmount),unit:hydrated.baseRateUnit,discountPercent:hydrated.discountPercent,
    recordedAt:hydrated.createdAt,discountProvenance:{status:'NOT_RECORDED',actor:null,reason:null}}:null;
   const booking=rowDto(rows[0]);collectionBalance(booking.agreedCents,entries);
   return{booking,entries,pricing,onlineCollection:{enabled:false,reason:'MERCHANT_CONFIGURATION_REQUIRED' as const}};
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
 }
 async record(tenantId:string,bookingId:string,userId:string,kind:'RECEIPT'|'REFUND'|'REVERSAL',input:CollectionCommand,sourceId:string|null=null){
  return prisma.$transaction(async tx=>{
   // Same booking lock serializes different request keys, refunds and reversals.
   await tx.$queryRaw`SELECT id FROM "RentalBooking" WHERE id=${bookingId} AND "tenantId"=${tenantId} FOR UPDATE`;
   const booking=await tx.rentalBooking.findFirst({where:{...visibleBookingWhere(tenantId),id:bookingId,deletedAt:null},select:{id:true}});
   const author=await tx.user.findFirst({where:{tenantId,id:userId,status:'ACTIVE',deletedAt:null},select:{id:true}});
   if(!booking||!author)throw missing();
   const normalized={kind,sourceId,amountCents:input.amountCents??null,method:input.method??null,occurredAt:new Date(input.occurredAt).toISOString(),reference:input.reference,reason:input.reason};
   const requestHash=crypto.createHash('sha256').update(JSON.stringify({bookingId,userId,...normalized})).digest('hex');
   const prior=await tx.rentalCollectionEntry.findUnique({where:{tenantId_requestKey:{tenantId,requestKey:input.requestKey}}});
   if(prior){if(prior.requestHash!==requestHash)throw conflict('Chiave già usata per un movimento diverso. Aggiorna il registro prima di riprovare.');return{id:prior.id,replayed:true};}
   const occurredAt=new Date(input.occurredAt);
   if(!Number.isFinite(occurredAt.getTime())||occurredAt.getTime()>Date.now()+300000)throw new AppError('La data del movimento non può essere futura.',400,'VALIDATION_ERROR');
   const entries=await tx.rentalCollectionEntry.findMany({where:{tenantId,bookingId}}),source=entries.find(x=>x.id===sourceId);
   if(kind!=='RECEIPT'&&!source)throw missing();
   const amountCents=kind==='REVERSAL'?source!.amountCents:input.amountCents!,method=kind==='RECEIPT'?input.method!:source!.method;
   if(!Number.isSafeInteger(amountCents)||amountCents<=0||amountCents>100000000||!method)throw new AppError('Importo o metodo non valido',400,'VALIDATION_ERROR');
   if(source&&occurredAt<source.occurredAt)throw conflict('La rettifica non può precedere il movimento originale.');
   validateCollectionTarget(kind,sourceId,amountCents,entries);
   const entry=await tx.rentalCollectionEntry.create({data:{tenantId,bookingId,createdByUserId:userId,kind,method,amountCents,currency:'EUR',occurredAt,reference:input.reference,reason:input.reason,sourceId,requestKey:input.requestKey,requestHash}});
   await createAuditLog(tx,{tenantId,userId,action:'RENTAL_COLLECTION_'+kind,resource:'rental-collection',resourceId:entry.id,details:{bookingId,kind,method,amountCents,sourceId}});
   return{id:entry.id,replayed:false};
  },{timeout:15000}).catch(error=>{if((error as {code?:string}).code==='P2002')throw conflict('Chiave o storno già registrati. Aggiorna il registro prima di riprovare.');throw error;});
 }
}
