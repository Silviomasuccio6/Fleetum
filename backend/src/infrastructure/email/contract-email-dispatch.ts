import crypto from "node:crypto";
import type { EmailQueue } from "@prisma/client";
import { LicensePolicyService } from "../../application/services/license-policy-service.js";
import { snapshotFromRow } from "../../application/services/tenant-subscription-service.js";
import { prisma } from "../database/prisma/client.js";
import { logger } from "../logging/logger.js";
import type { emailSender } from "./email-sender.js";
import { ContractDispatchBlocked, contractSiteAuthorizationReason } from "./contract-site-authorization.js";
import { legacySiteCommandReason } from "./site-access-legacy.js";

type Receipt=Awaited<ReturnType<typeof emailSender.send>>;
type Outcome={receipt:Receipt}|{error:unknown};
export const dispatchContractEmail = async (
  item: Pick<EmailQueue,"id"|"tenantId"|"meta"|"recipient"|"subject"|"body">,
  processingToken: string, currentTime: ()=>Date, leaseMs: number, startDelivery: ()=>Promise<Receipt>
): Promise<Receipt | null> => {
  const meta=(item.meta??{}) as Record<string,unknown>;
  const legacyReason=legacySiteCommandReason("BOOKING_CONTRACT",meta);
  if(legacyReason)throw new ContractDispatchBlocked(legacyReason);
  const hadSubscription=Boolean(item.tenantId && await prisma.tenantSubscription.findUnique({where:{tenantId:item.tenantId},select:{tenantId:true}}));
  const delivery:{outcome?:Promise<Outcome>}={};
  try {
    await prisma.$transaction(async tx=>{
      if (!item.tenantId || meta.tenantId!==item.tenantId || typeof meta.bookingId!=="string" || typeof meta.contractId!=="string")
        throw new ContractDispatchBlocked("TARGET_INVALID");
      const tenantId=item.tenantId;
      // Align with account mutation ordering: User before Tenant. This bounds
      // suspension/assignment races through the start of the provider request.
      const authorization=meta.siteAuthorization as Record<string,unknown>|null;
      if (authorization && typeof authorization.userId==="string") await tx.$queryRaw`
        SELECT "id" FROM "User" WHERE "id"=${authorization.userId} AND "tenantId"=${tenantId} FOR SHARE`;
      const tenants=hadSubscription
        ? await tx.$queryRaw<Array<{isActive:boolean;deletedAt:Date|null}>>`SELECT "isActive","deletedAt" FROM "Tenant" WHERE "id"=${tenantId} FOR SHARE`
        : await tx.$queryRaw<Array<{isActive:boolean;deletedAt:Date|null}>>`SELECT "isActive","deletedAt" FROM "Tenant" WHERE "id"=${tenantId} FOR UPDATE`;
      if (!tenants[0]?.isActive || tenants[0].deletedAt) throw new ContractDispatchBlocked("TENANT_INACTIVE");
      const subscriptions=await tx.$queryRaw<Array<{tenantId:string}>>`SELECT "tenantId" FROM "TenantSubscription" WHERE "tenantId"=${tenantId} FOR SHARE`;
      if (hadSubscription && !subscriptions.length) throw new ContractDispatchBlocked("SUBSCRIPTION_CHANGED");
      await tx.$queryRaw`SELECT "id" FROM "RentalBooking" WHERE "id"=${meta.bookingId} AND "tenantId"=${tenantId} FOR SHARE`;
      await tx.$queryRaw`SELECT "id" FROM "BookingContract" WHERE "id"=${meta.contractId} AND "tenantId"=${tenantId} FOR SHARE`;
      if (typeof meta.contractDeliveryId==="string") await tx.$queryRaw`
        SELECT "id" FROM "BookingContractDelivery" WHERE "id"=${meta.contractDeliveryId} AND "tenantId"=${tenantId} FOR SHARE`;
      const reason=await contractSiteAuthorizationReason(tx,tenantId,meta.bookingId,meta.contractId,meta.actorUserId,meta.siteAuthorization);
      if (reason) throw new ContractDispatchBlocked(reason);
      const target=await tx.bookingContractDelivery.findFirst({where:{
        id:typeof meta.contractDeliveryId==="string"?meta.contractDeliveryId:"",tenantId,bookingId:meta.bookingId,contractId:meta.contractId,
        recipient:item.recipient,subject:item.subject,body:item.body
      },select:{id:true}});
      if (!target) throw new ContractDispatchBlocked("DELIVERY_CHANGED");
      const revisions=await tx.$queryRaw<Array<{documentRevision:number}>>`SELECT "documentRevision" FROM "BookingContract" WHERE "id"=${meta.contractId} AND "tenantId"=${tenantId}`;
      const currentRevision=revisions[0]?.documentRevision??0;
      if((meta.contractRevision??0)!==currentRevision)throw new ContractDispatchBlocked("CONTRACT_REVISION_CHANGED");
      const frozen=await tx.$queryRaw<Array<{documentSha256:string}>>`
        SELECT CASE WHEN "status"='SIGNED' THEN COALESCE("signedDocumentSha256","documentSha256") ELSE "documentSha256" END AS "documentSha256" FROM "ContractSigningRequest"
        WHERE "tenantId"=${tenantId} AND "contractId"=${meta.contractId}
        AND "contractRevision"=${currentRevision} AND ("status"='SIGNED' OR ("status"='PENDING' AND "expiresAt">NOW()))
        ORDER BY "version" DESC LIMIT 1`;
      if(typeof frozen[0]?.documentSha256==="string") {
        const attachments=Array.isArray(meta.attachments)?meta.attachments:[];
        const document=attachments[0] as {contentBase64?:unknown}|undefined;
        if(attachments.length!==1||typeof document?.contentBase64!=="string"||crypto.createHash("sha256").update(Buffer.from(document.contentBase64,"base64")).digest("hex")!==frozen[0].documentSha256)
          throw new ContractDispatchBlocked("CONTRACT_FROZEN_DOCUMENT_CHANGED");
      }
      const license=await new LicensePolicyService({getLatestByAction:(owner,resource,action)=>tx.auditLog.findFirst({where:{tenantId:owner,resource,action},orderBy:{createdAt:"desc"}})},
        async owner=>{const row=await tx.tenantSubscription.findUnique({where:{tenantId:owner}});return row?snapshotFromRow(row):null;}).getTenantLicense(tenantId);
      if (license.status!=="ACTIVE" && license.status!=="TRIAL") throw new ContractDispatchBlocked("LICENSE_UNAVAILABLE");
      const claim=await tx.emailQueue.updateMany({where:{id:item.id,status:"PENDING",processingToken,leaseExpiresAt:{gt:currentTime()}},data:{leaseExpiresAt:new Date(currentTime().getTime()+leaseMs)}});
      if (claim.count!==1) return;
      const finalReason=await contractSiteAuthorizationReason(tx,tenantId,meta.bookingId,meta.contractId,meta.actorUserId,meta.siteAuthorization);
      if (finalReason) throw new ContractDispatchBlocked(finalReason);
      // Observe the provider Promise immediately, without waiting on the
      // network while database locks are held. Keep durable receipt recovery.
      delivery.outcome=startDelivery().then(receipt=>({receipt}),error=>({error}));
    },{maxWait:5000,timeout:10000});
  }catch(error){
    if (!delivery.outcome) throw error;
    logger.warn({queueId:item.id},"Contract guard commit uncertain after provider initiation");
  }
  if (!delivery.outcome) return null;
  const outcome=await delivery.outcome;if("error" in outcome)throw outcome.error;return outcome.receipt;
};
