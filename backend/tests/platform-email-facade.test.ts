import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../src/infrastructure/database/prisma/client.js";
import { EmailQueueService } from "../src/infrastructure/email/email-queue-service.js";
import { emailSender } from "../src/infrastructure/email/email-sender.js";
test("Platform invoice enqueue uses the caller transaction without a second root write",async () => {
  let calls=0;
  const transaction={ emailQueue: { create: async ({ data }: any) => { calls++; return { id: "synthetic-queue",...data }; } } };
  const result=await new EmailQueueService().enqueue({ tenantId: "tenant-synthetic",type: "SAAS_INVOICE_EMAIL",recipient: "billing@example.test",subject: "Synthetic",body: "Synthetic" },transaction as any);
  assert.equal(calls,1);
  assert.equal(result.id,"synthetic-queue");
});
test("the existing worker retains the password-email path and excludes Platform invoice rows",async () => {
  const find=prisma.emailQueue.findMany,update=prisma.emailQueue.update,send=emailSender.send;
  const queries: any[]=[],sent: any[]=[];
  let updates=0;
  (prisma.emailQueue as any).findMany=async (input: any) => { queries.push(input.where); return input.where.type==="SAAS_INVOICE_EMAIL"? []:[{ id: "synthetic-reset",type: "PASSWORD_RESET",recipient: "reset@example.test",subject: "Synthetic",body: "Synthetic",meta: {},attempts: 0,maxAttempts: 5,nextAttemptAt: new Date() }]; };
  (prisma.emailQueue as any).update=async () => { updates++; return {}; };
  emailSender.send=async (input: any) => { sent.push(input); return { provider: "resend",id: "synthetic-receipt" }; };
  try {
    const result=await new EmailQueueService().processPending();
    assert.equal(result.processed,1);
    assert.equal(sent.length,1);
    assert.equal(sent[0].idempotencyKey,undefined);
    assert.equal(updates,1);
    assert.deepEqual(queries[1].type,{ not: "SAAS_INVOICE_EMAIL" });
  }
  finally {
    (prisma.emailQueue as any).findMany=find;
    (prisma.emailQueue as any).update=update;
    emailSender.send=send;
  }
});
