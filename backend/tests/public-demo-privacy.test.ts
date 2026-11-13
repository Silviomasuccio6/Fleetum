import assert from "node:assert/strict";
import test from "node:test";
import { buildConsentedDemoAnalyticsEvent } from "../src/application/services/public-demo-analytics-service.js";
import { prisma } from "../src/infrastructure/database/prisma/client.js";
import { emailQueueCronService, handlePublicDemoRequest } from "../src/interfaces/http/routes/index.js";
import { publicDemoRequestSchema } from "../src/interfaces/http/validators/public-validators.js";

const baseRequest = {
  companyName: "Autonoleggio Demo",
  fullName: "Mario Rossi",
  email: "mario.rossi@example.com",
  source: "fleetum.it",
  referrer: "https://example.test",
  visitorId: "visitor-12345678",
  sessionId: "session-12345678"
};

test("demo remains operational without creating an analytics event when consent is absent", () => {
  const input = publicDemoRequestSchema.parse(baseRequest);
  const event = buildConsentedDemoAnalyticsEvent({
    input,
    leadId: "lead_1",
    ip: "203.0.113.9",
    userAgent: "Synthetic Browser"
  });

  assert.equal(input.consentAnalytics, false);
  assert.equal(event, null);
});

test("demo analytics event is built only from explicit consent and carries its policy version", () => {
  const input = publicDemoRequestSchema.parse({ ...baseRequest, consentAnalytics: true });
  const event = buildConsentedDemoAnalyticsEvent({
    input,
    leadId: "lead_1",
    ip: "203.0.113.9",
    userAgent: "Synthetic Browser"
  });

  assert.ok(event);
  assert.equal(event.consentAnalytics, true);
  assert.equal(event.eventType, "DEMO_FORM_SUBMIT");
  assert.equal((event.metadata as Record<string, unknown>).leadId, "lead_1");
  assert.equal((event.metadata as Record<string, unknown>).consentVersion, "cookie-preferences-v1");
  assert.notEqual(event.ipHash, "203.0.113.9");
  assert.notEqual(event.userAgentHash, "Synthetic Browser");
});

test("demo accepts an email that is already leased and still pending", async () => {
  const originalTransaction = prisma.$transaction;
  const originalLeadUpdate = prisma.demoLead.update;
  const originalQueueFindUnique = prisma.emailQueue.findUnique;
  const originalEnqueue = emailQueueCronService.enqueue;
  const originalProcessPending = emailQueueCronService.processPending;
  let persistedDeliveryStatus: string | undefined;

  const transactionClient = {
    $queryRaw: async () => [{ locked: "1" }],
    demoLead: {
      findUnique: async () => null,
      create: async () => ({ id: "lead_pending", createdAt: new Date("2030-01-01T00:00:00.000Z") }),
      update: async (input: any) => ({ id: input.where.id, ...input.data })
    },
    websiteEvent: { create: async () => ({ id: "event_pending" }) }
  };
  (prisma as any).$transaction = async (callback: (tx: typeof transactionClient) => unknown) => callback(transactionClient);
  (prisma.demoLead as any).update = async (input: any) => {
    persistedDeliveryStatus = input.data.emailDeliveryStatus;
    return { id: input.where.id, ...input.data };
  };
  (prisma.emailQueue as any).findUnique = async () => ({ status: "PENDING", lastError: null, meta: null });
  (emailQueueCronService as any).enqueue = async () => ({ id: "queue_pending" });
  (emailQueueCronService as any).processPending = async () => ({ processed: 0 });

  const response = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    setHeader() {
      return undefined;
    }
  };

  try {
    await handlePublicDemoRequest({
      body: baseRequest,
      ip: "203.0.113.10",
      headers: { "user-agent": "Synthetic Browser", "x-idempotency-key": "demo-request-pending" }
    } as any, response as any);

    assert.equal(response.statusCode, 202);
    assert.equal((response.body as any).delivery.status, "PENDING");
    assert.equal((response.body as any).delivery.queueEmailId, "queue_pending");
    assert.equal(persistedDeliveryStatus, "PENDING");
  } finally {
    (prisma as any).$transaction = originalTransaction;
    (prisma.demoLead as any).update = originalLeadUpdate;
    (prisma.emailQueue as any).findUnique = originalQueueFindUnique;
    (emailQueueCronService as any).enqueue = originalEnqueue;
    (emailQueueCronService as any).processPending = originalProcessPending;
  }
});
