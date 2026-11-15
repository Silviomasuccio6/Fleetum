import assert from "node:assert/strict";
import test from "node:test";
import { PlatformInvoiceOutboxProcessor } from "../src/infrastructure/email/platform-invoice-outbox.js";
const now=new Date("2030-01-15T12:00:00Z");
const clone=<T>(v: T): T => structuredClone(v);
const matches=(row: any,where: any): boolean => Object.entries(where||{}).every(([key,value]: any) => {
  if(key==="OR")
    return value.some((condition: any) => matches(row,condition));
  if(value&&typeof value==="object"&&!(value instanceof Date)) {
    if("lte" in value)
      return row[key]!=null&&new Date(row[key])<=value.lte;
    if("in" in value)
      return value.in.includes(row[key]);
    if("notIn" in value)
      return !value.notIn.includes(row[key]);
    if("not" in value)
      return row[key]!==value.not;
  }
  return row[key]===value;
});
const apply=(row: any,data: any) => {
  for(const [key,value] of Object.entries(data) as any)
    row[key]=value&&typeof value==="object"&&"increment" in value? row[key]+value.increment:clone(value);
};
function fixture() {
  const state: any={ row: { id: "queue-synthetic",tenantId: "tenant-a",type: "SAAS_INVOICE_EMAIL",recipient: "billing@example.test",subject: "Synthetic",body: "Synthetic invoice",meta: { tenantId: "tenant-a",invoiceId: "invoice-a",invoiceDeliveryId: "delivery-a" },status: "PENDING",attempts: 0,maxAttempts: 5,nextAttemptAt: now,createdAt: now,processingToken: null,processingStartedAt: null,leaseExpiresAt: null },invoice: { id: "invoice-a",tenantId: "tenant-a",deletedAt: null,status: "GENERATED",sentAt: null },delivery: { id: "delivery-a",invoiceId: "invoice-a",channel: "EMAIL",recipient: "billing@example.test",status: "PENDING",provider: null,providerMessageId: null },calls: [],failFinalization: false,loseCommitAck: false };
  const mutate=(row: any,input: any) => {
    if(!matches(row,input.where))
      return { count: 0 }; apply(row,input.data); return { count: 1 };
  };
  const db: any={
    emailQueue: { findMany: async ({ where }: any) => matches(state.row,where)? [clone(state.row)]:[],findFirst: async ({ where }: any) => matches(state.row,where)? clone(state.row):null,updateMany: async (i: any) => mutate(state.row,i) },
    invoice: {
      findFirst: async ({ where }: any) => matches(state.invoice,where)? clone(state.invoice):null,updateMany: async (i: any) => {
        if(state.failFinalization) {
          state.failFinalization=false;
          throw Error("synthetic finalization failure");
        } return mutate(state.invoice,i);
      }
    },
    invoiceDelivery: { findFirst: async ({ where }: any) => matches(state.delivery,where)? clone(state.delivery):null,updateMany: async (i: any) => mutate(state.delivery,i) },
    $executeRaw: async () => 0,
    $transaction: async (fn: any) => {
      const snapshot=clone({ row: state.row,invoice: state.invoice,delivery: state.delivery }); let result; try {
        result=await fn(db);
      }
        catch(e) {
          Object.assign(state,snapshot);
          throw e;
        } if(state.loseCommitAck) {
          state.loseCommitAck=false;
          throw Error("synthetic lost commit acknowledgement");
        } return result;
    }
  };
  state.row.meta.invoiceEmailCommandKey="invoice-command-synthetic";
  const sender={ send: async (input: any) => { state.calls.push(input); return { provider: "resend" as const,id: "receipt-synthetic" }; } };
  return { state,db,sender,processor: new PlatformInvoiceOutboxProcessor(db,sender) };
}
test("two consumers claim one invoice queue row and record a single delivery",async () => {
  const { state,processor }=fixture();
  await Promise.all([processor.processPending(now),processor.processPending(now)]);
  assert.equal(state.calls.length,1);
  assert.equal(state.row.status,"SENT");
  assert.equal(state.delivery.status,"SENT");
  assert.equal(state.invoice.status,"SENT");
  assert.equal(state.row.processingToken,null);
  assert.equal(state.calls[0].idempotencyKey,"fleetum-email-queue:queue-synthetic");
});
test("foreign invoice metadata is rejected before calling the provider",async () => {
  const { state,processor }=fixture();
  state.invoice.tenantId="tenant-b";
  await processor.processPending(now);
  assert.equal(state.calls.length,0);
  assert.equal(state.row.status,"FAILED");
  assert.equal(state.invoice.status,"GENERATED");
});
test("a delivery for another invoice cannot authorize the message",async () => {
  const { state,processor }=fixture();
  state.delivery.invoiceId="invoice-b";
  await processor.processPending(now);
  assert.equal(state.calls.length,0);
  assert.equal(state.row.status,"FAILED");
});
test("a changed snapshot recipient cannot be substituted into a queued invoice",async () => {
  const { state,processor }=fixture();
  state.row.recipient="other@example.test";
  await processor.processPending(now);
  assert.equal(state.calls.length,0);
});
test("a provider receipt survives local finalization failure and avoids another send",async () => {
  const { state,processor }=fixture();
  state.failFinalization=true;
  await processor.processPending(now);
  assert.equal(state.row.status,"PENDING");
  assert.equal(state.row.meta.providerMessageId,"receipt-synthetic");
  assert.equal(state.delivery.status,"PENDING");
  await processor.processPending(new Date(now.getTime()+180000));
  assert.equal(state.calls.length,1);
  assert.equal(state.row.status,"SENT");
  assert.equal(state.delivery.status,"SENT");
});
test("a lost commit acknowledgement cannot revert a committed SENT row",async () => {
  const { state,processor }=fixture();
  state.loseCommitAck=true;
  await processor.processPending(now);
  assert.equal(state.row.status,"SENT");
  assert.equal(state.invoice.status,"SENT");
  assert.equal(state.delivery.status,"SENT");
  assert.equal(state.calls.length,1);
});
test("an empty provider receipt is not advertised as a successful invoice email",async () => {
  const { state,db }=fixture();
  const processor=new PlatformInvoiceOutboxProcessor(db,{ send: async () => ({ provider: "resend",id: null }) } as any);
  await processor.processPending(now);
  assert.equal(state.row.status,"FAILED");
  assert.notEqual(state.invoice.status,"SENT");
});
test("an old uncertain attempt cannot be resent beyond the provider key lifetime",async () => {
  const { state,processor }=fixture();
  state.row.attempts=1;
  state.row.meta.platformInvoiceProviderStartedAt=new Date(now.getTime()-24*3600000).toISOString();
  await processor.processPending(now);
  assert.equal(state.calls.length,0);
  assert.equal(state.row.status,"FAILED");
});
test("legacy retry without an attempt timestamp is preserved for reconciliation",async () => {
  const { state,processor }=fixture();
  state.row.attempts=1;
  await processor.processPending(now);
  assert.equal(state.calls.length,0);
  assert.equal(state.row.status,"FAILED");
});
test("legacy pending rows are not given a fresh provider key during an upgrade",async () => {
  const { state,processor }=fixture();
  delete state.row.meta.invoiceEmailCommandKey;
  await processor.processPending(now);
  assert.equal(state.calls.length,0);
  assert.equal(state.row.status,"FAILED");
  assert.equal(state.row.lastError,"INVOICE_EMAIL_RECONCILIATION_REQUIRED");
});
test("a verified legacy provider receipt can finish locally without sending again",async () => {
  const { state,processor }=fixture();
  delete state.row.meta.invoiceEmailCommandKey;
  state.row.meta.emailProvider="resend";
  state.row.meta.providerMessageId="legacy-receipt";
  await processor.processPending(now);
  assert.equal(state.calls.length,0);
  assert.equal(state.row.status,"SENT");
});
test("a definite transient failure retries with the same provider key",async () => {
  const { state,db }=fixture();
  let count=0;
  const keys: string[]=[];
  const processor=new PlatformInvoiceOutboxProcessor(db,{
    send: async (input: any) => {
      keys.push(input.idempotencyKey); if(count++===0)
        throw Error("synthetic transport failure"); return { provider: "resend",id: "receipt-synthetic" };
    }
  } as any);
  await processor.processPending(now);
  await processor.processPending(new Date(now.getTime()+180000));
  assert.equal(state.row.status,"SENT");
  assert.equal(keys.length,2);
  assert.equal(keys[0],keys[1]);
});
test("invoice sending cannot downgrade an already paid invoice",async () => {
  const { state,processor }=fixture();
  state.invoice.status="PAID";
  await processor.processPending(now);
  assert.equal(state.invoice.status,"PAID");
  assert.equal(state.delivery.status,"SENT");
});
test("a failed resend cannot downgrade an invoice already sent",async () => {
  const { state,db }=fixture();
  state.invoice.status="SENT";
  state.row.maxAttempts=1;
  const processor=new PlatformInvoiceOutboxProcessor(db,{ send: async () => { throw Error("synthetic rejection"); } } as any);
  await processor.processPending(now);
  assert.equal(state.invoice.status,"SENT");
  assert.equal(state.row.status,"FAILED");
});
test("the dedicated consumer leaves all tenant queue types to the existing worker",async () => {
  const { state,processor }=fixture();
  state.row.type="BOOKING_CONTRACT";
  await processor.processPending(now);
  assert.equal(state.calls.length,0);
  assert.equal(state.row.processingToken,null);
});
test("provider acceptance with a lost reply reuses the original physical delivery",async () => {
  const { state,db }=fixture();
  let attempts=0,physical=0;
  const receipts=new Map<string,string>();
  const worker=new PlatformInvoiceOutboxProcessor(db,{
    send: async (input: any) => {
      let id=receipts.get(input.idempotencyKey); if(!id) {
        id="receipt-"+(++physical);
        receipts.set(input.idempotencyKey,id);
      } if(attempts++===0)
        throw Error("synthetic lost provider reply"); return { provider: "resend",id };
    }
  } as any);
  await worker.processPending(now);
  await worker.processPending(new Date(now.getTime()+180000));
  assert.equal(physical,1);
  assert.equal(attempts,2);
  assert.equal(state.row.status,"SENT");
});
test("a hanging provider call releases the request with a bounded retryable outcome",async () => {
  const { state,db }=fixture();
  const worker=new PlatformInvoiceOutboxProcessor(db,{ send: async () => new Promise(() => { }) } as any,5);
  await worker.processPending(now);
  assert.equal(state.row.status,"PENDING");
  assert.equal(state.row.processingToken,null);
  assert.equal(state.row.attempts,1);
});
test("an exhausted queue cannot obtain another provider attempt",async () => {
  const { state,processor }=fixture();
  state.row.attempts=5;
  state.row.meta.platformInvoiceProviderStartedAt=now.toISOString();
  await processor.processPending(now);
  assert.equal(state.calls.length,0);
  assert.equal(state.row.status,"FAILED");
});
test("receipt fields from different providers cannot be combined into false delivery",async () => {
  const { state,processor }=fixture();
  state.row.meta.emailProvider="other-provider";
  state.row.meta.providerMessageId="unverified-receipt";
  state.delivery.provider="resend";
  await processor.processPending(now);
  assert.equal(state.calls.length,0);
  assert.equal(state.row.status,"FAILED");
  assert.equal(state.delivery.status,"FAILED");
});
test("conflicting durable receipts require reconciliation without overwriting the sent delivery",async () => {
  const { state,processor }=fixture();
  state.row.meta.emailProvider="resend";
  state.row.meta.providerMessageId="receipt-one";
  state.delivery.status="SENT";
  state.delivery.provider="resend";
  state.delivery.providerMessageId="receipt-two";
  await processor.processPending(now);
  assert.equal(state.calls.length,0);
  assert.equal(state.row.status,"FAILED");
  assert.equal(state.delivery.providerMessageId,"receipt-two");
  assert.equal(state.delivery.status,"SENT");
});
test("a verified sent delivery can repair a pending queue without another provider call",async () => {
  const { state,processor }=fixture();
  delete state.row.meta.invoiceEmailCommandKey;
  state.delivery.status="SENT";
  state.delivery.provider="resend";
  state.delivery.providerMessageId="receipt-original";
  await processor.processPending(now);
  assert.equal(state.calls.length,0);
  assert.equal(state.row.status,"SENT");
  assert.equal(state.row.meta.providerMessageId,"receipt-original");
});
