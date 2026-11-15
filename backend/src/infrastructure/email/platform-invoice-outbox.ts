import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../database/prisma/client.js";
import { emailSender,SendEmailInput } from "./email-sender.js";
const LEASE_MS=15*60*1000;
// Resend retains a key for 24h; stop before expiry if the outcome is uncertain.
// https://resend.com/changelog/idempotency-keys
const RETRY_WINDOW_MS=23*60*60*1000;
const leaseAvailable=(now: Date) => ({ OR: [{ leaseExpiresAt: null },{ leaseExpiresAt: { lte: now } }] });
const text=(meta: Record<string,unknown>,key: string) => typeof meta[key]==="string"? String(meta[key]).trim():"";
class PermanentInvoiceEmailFailure extends Error {
}
type Sender={
  send: (input: SendEmailInput) => Promise<{
    provider: "resend";
    id: string|null;
  }>;
};
/** Owns only Platform invoice emails. Other queue types keep their production path. */
export class PlatformInvoiceOutboxProcessor {
  constructor(private readonly db: typeof prisma=prisma,private readonly sender: Sender=emailSender,private readonly sendTimeoutMs=30000) { }
  private async send(input: SendEmailInput) {
    let timer: ReturnType<typeof setTimeout>|undefined;
    try {
      return await Promise.race([this.sender.send(input),new Promise<never>((_resolve,reject) => {
        timer=setTimeout(() => reject(new Error("INVOICE_EMAIL_PROVIDER_TIMEOUT")),Math.min(Math.max(this.sendTimeoutMs,1),30000));
      })]);
    }
    finally {
      if(timer)
        clearTimeout(timer);
    }
  }
  async processPending(now=new Date(),options: {
    ids?: string[];
    take?: number;
  }={}) {
    const started=Date.now();
    const currentTime=() => new Date(now.getTime()+Math.max(0,Date.now()-started));
    const candidates=await this.db.emailQueue.findMany({ where: { type: "SAAS_INVOICE_EMAIL",status: "PENDING",nextAttemptAt: { lte: now },...leaseAvailable(now),...(options.ids?.length? { id: { in: options.ids } }:{}) },orderBy: { createdAt: "asc" },take: options.take??30 });
    let processed=0;
    for(const candidate of candidates) {
      const token=crypto.randomUUID(),claimedAt=currentTime();
      const owned={ id: candidate.id,type: "SAAS_INVOICE_EMAIL",status: "PENDING" as const,processingToken: token };
      const claim=await this.db.emailQueue.updateMany({ where: { id: candidate.id,type: "SAAS_INVOICE_EMAIL",status: "PENDING",nextAttemptAt: { lte: claimedAt },...leaseAvailable(claimedAt) },data: { processingToken: token,processingStartedAt: claimedAt,leaseExpiresAt: new Date(claimedAt.getTime()+LEASE_MS) } });
      if(claim.count!==1)
        continue;
      const item=await this.db.emailQueue.findFirst({ where: owned });
      if(!item)
        continue;
      processed++;
      let meta={ ...(item.meta as Record<string,unknown>??{}) };
      let target: {
        tenantId: string;
        invoiceId: string;
        deliveryId: string;
      }|undefined;
      let accepted: {
        provider: "resend";
        id: string;
      }|undefined;
      let acceptedAt: string|undefined;
      try {
        const tenantId=item.tenantId,invoiceId=text(meta,"invoiceId"),deliveryId=text(meta,"invoiceDeliveryId");
        if(!tenantId||text(meta,"tenantId")!==tenantId||!invoiceId||!deliveryId)
          throw new PermanentInvoiceEmailFailure("INVOICE_EMAIL_TARGET_INVALID");
        const invoice=await this.db.invoice.findFirst({ where: { id: invoiceId,tenantId,deletedAt: null },select: { id: true } });
        const delivery=await this.db.invoiceDelivery.findFirst({ where: { id: deliveryId,invoiceId,channel: "EMAIL" },select: { id: true,recipient: true,status: true,provider: true,providerMessageId: true } });
        if(!invoice||!delivery||delivery.recipient!==item.recipient)
          throw new PermanentInvoiceEmailFailure("INVOICE_EMAIL_TARGET_INVALID");
        target={ tenantId,invoiceId,deliveryId };
        // Receipt and provider must come from the same durable record. Partial
        // fields or contradictory receipts require reconciliation, not a send.
        const metaProvider=text(meta,"emailProvider"),metaReceipt=text(meta,"providerMessageId");
        const deliveryReceipt=delivery.status==="SENT"&&delivery.provider==="resend"? delivery.providerMessageId?.trim():"";
        if(((metaProvider||metaReceipt)&&(metaProvider!=="resend"||!metaReceipt))||
          (delivery.status==="SENT"&&!deliveryReceipt)||
          (metaReceipt&&deliveryReceipt&&metaReceipt!==deliveryReceipt)) {
          throw new PermanentInvoiceEmailFailure("INVOICE_EMAIL_RECONCILIATION_REQUIRED");
        }
        const receipt=metaReceipt||deliveryReceipt;
        if(receipt) {
          accepted={ provider: "resend",id: receipt };
          acceptedAt=text(meta,"providerAcceptedAt")||text(meta,"sentAt")||currentTime().toISOString();
        }
        else {
          // Rows created before this protocol may have an unknown provider
          // outcome. Do not assign them a new key and risk a second email.
          if(!/^[A-Za-z0-9._:-]{8,128}$/.test(text(meta,"invoiceEmailCommandKey")))
            throw new PermanentInvoiceEmailFailure("INVOICE_EMAIL_RECONCILIATION_REQUIRED");
          if(item.attempts>=item.maxAttempts)
            throw new PermanentInvoiceEmailFailure("INVOICE_EMAIL_ATTEMPTS_EXHAUSTED");
          const firstAttempt=text(meta,"platformInvoiceProviderStartedAt");
          const firstAt=firstAttempt? Date.parse(firstAttempt):NaN;
          if((!firstAttempt&&item.attempts>0)||(firstAttempt&&(!Number.isFinite(firstAt)||firstAt>currentTime().getTime()+60000||currentTime().getTime()-firstAt>=RETRY_WINDOW_MS)))
            throw new PermanentInvoiceEmailFailure("INVOICE_EMAIL_RECONCILIATION_REQUIRED");
          meta={ ...meta,platformInvoiceProviderStartedAt: firstAttempt||currentTime().toISOString() };
          const marked=await this.db.emailQueue.updateMany({ where: owned,data: { meta: meta as Prisma.InputJsonValue,leaseExpiresAt: new Date(currentTime().getTime()+LEASE_MS) } });
          if(marked.count!==1)
            continue;
          const raw=Array.isArray(meta.attachments)? meta.attachments:[];
          const attachments=raw.map(x => x as {
            filename?: string;
            contentBase64?: string;
            contentType?: string;
          }).filter(x => x.filename&&x.contentBase64).map(x => ({ filename: String(x.filename),content: Buffer.from(String(x.contentBase64),"base64"),...(x.contentType? { contentType: String(x.contentType) }:{}) }));
          const result=await this.send({ to: item.recipient,subject: item.subject,text: item.body,html: typeof meta.html==="string"? meta.html:undefined,fromName: typeof meta.fromName==="string"? meta.fromName:undefined,replyTo: typeof meta.replyTo==="string"? meta.replyTo:undefined,attachments,idempotencyKey: `fleetum-email-queue:${item.id}` });
          if(result.provider!=="resend"||!result.id?.trim())
            throw new PermanentInvoiceEmailFailure("INVOICE_EMAIL_RECEIPT_UNVERIFIED");
          accepted={ provider: result.provider,id: result.id.trim() };
          acceptedAt=currentTime().toISOString();
        }
        const receiptMeta={ ...meta,emailProvider: accepted.provider,providerMessageId: accepted.id,providerAcceptedAt: acceptedAt };
        const finalizedAt=currentTime();
        await this.db.$transaction(async (tx) => {
          const marked=await tx.emailQueue.updateMany({ where: owned,data: { status: "SENT",attempts: { increment: 1 },lastError: null,processingToken: null,processingStartedAt: null,leaseExpiresAt: null,meta: { ...receiptMeta,sentAt: acceptedAt } as Prisma.InputJsonValue } });
          if(marked.count!==1)
            return;
          const updated=await tx.invoiceDelivery.updateMany({ where: { id: deliveryId,invoiceId },data: { status: "SENT",provider: accepted!.provider,providerMessageId: accepted!.id,sentAt: finalizedAt,errorMessage: null } });
          if(updated.count!==1)
            throw Error("INVOICE_EMAIL_FINALIZATION_FAILED");
          const changed=await tx.invoice.updateMany({ where: { id: invoiceId,tenantId,deletedAt: null,status: { not: "PAID" } },data: { status: "SENT",sentAt: finalizedAt } });
          if(changed.count!==1&&!await tx.invoice.findFirst({ where: { id: invoiceId,tenantId,deletedAt: null,status: "PAID" },select: { id: true } }))
            throw Error("INVOICE_EMAIL_FINALIZATION_FAILED");
        });
      }
      catch(error) {
        const failureAt=currentTime(),attempt=item.attempts+1;
        const nextAttemptAt=new Date(failureAt.getTime()+Math.min(2**attempt,60)*60000);
        if(accepted) {
          // A committed SENT row no longer matches owned, including lost ACKs.
          // Persist a receipt when local finalization alone needs another try.
          await this.db.emailQueue.updateMany({ where: owned,data: { attempts: { increment: 1 },nextAttemptAt,lastError: "INVOICE_EMAIL_LOCAL_FINALIZATION_FAILED",processingToken: null,processingStartedAt: null,leaseExpiresAt: null,meta: { ...meta,emailProvider: accepted.provider,providerMessageId: accepted.id,providerAcceptedAt: acceptedAt } as Prisma.InputJsonValue } });
          continue;
        }
        const terminal=error instanceof PermanentInvoiceEmailFailure||attempt>=item.maxAttempts;
        const code=error instanceof PermanentInvoiceEmailFailure? error.message:"INVOICE_EMAIL_ATTEMPT_FAILED";
        try {
          await this.db.$transaction(async (tx) => {
            const changed=await tx.emailQueue.updateMany({ where: owned,data: { status: terminal? "FAILED":"PENDING",attempts: { increment: 1 },nextAttemptAt: terminal? item.nextAttemptAt:nextAttemptAt,lastError: code,processingToken: null,processingStartedAt: null,leaseExpiresAt: null,meta: meta as Prisma.InputJsonValue } });
            if(changed.count!==1||!target)
              return;
            await tx.invoiceDelivery.updateMany({ where: { id: target.deliveryId,invoiceId: target.invoiceId,status: { not: "SENT" } },data: { status: terminal? "FAILED":"PENDING",errorMessage: code } });
            if(terminal)
              await tx.invoice.updateMany({ where: { id: target.invoiceId,tenantId: target.tenantId,deletedAt: null,status: { notIn: ["SENT","PAID"] } },data: { status: "ERROR" } });
          });
        }
        catch {
          // Retain ownership if local persistence is unavailable. The finite
          // lease and durable first-attempt deadline govern a later retry.
        }
      }
    }
    return { processed };
  }
}
