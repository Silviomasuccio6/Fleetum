import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import cron from "node-cron";
import { startPrivacyRetentionCron } from "../src/infrastructure/cron/privacy-retention-cron.js";
import { prisma } from "../src/infrastructure/database/prisma/client.js";
import { env } from "../src/shared/config/env.js";
import { logger } from "../src/infrastructure/logging/logger.js";
import { metrics } from "../src/infrastructure/observability/metrics.js";

const original = {
  schedule: cron.schedule, findMany: prisma.tenant.findMany, findFirst: prisma.tenant.findFirst,
  enabled: env.PRIVACY_RETENTION_CRON_ENABLED, global: env.PRIVACY_RETENTION_GLOBAL_ENABLED,
  info: logger.info, error: logger.error, observe: metrics.observeRetentionRun
};
afterEach(() => {
  cron.schedule = original.schedule;
  prisma.tenant.findMany = original.findMany;
  prisma.tenant.findFirst = original.findFirst;
  env.PRIVACY_RETENTION_CRON_ENABLED = original.enabled;
  env.PRIVACY_RETENTION_GLOBAL_ENABLED = original.global;
  logger.info = original.info; logger.error = original.error;
  metrics.observeRetentionRun = original.observe;
});

const zero = () => ({ deleted: { passwordResetTokens: 0, invitationTokens: 0,
  refreshSessions: 0, deletedCustomerAttachments: 0, deletedStoredFileObjects: 0 } });
const harness = (ids: string[], service: object) => {
  const events: unknown[] = [];
  let callback!: () => Promise<void>;
  (cron as any).schedule = (_expression: string, fn: typeof callback) => { callback = fn; return {}; };
  env.PRIVACY_RETENTION_CRON_ENABLED = true;
  env.PRIVACY_RETENTION_GLOBAL_ENABLED = false;
  (prisma.tenant as any).findFirst = async () => ids.length ? { id: ids.at(-1) } : null;
  (prisma.tenant as any).findMany = async (input: any) => {
    assert.deepEqual(input.select, { id: true });
    assert.equal(input.where.isActive, true);
    assert.equal(input.where.deletedAt, null);
    const gt = input.where.id?.gt;
    const lte = input.where.id?.lte;
    return ids.filter(id => (!gt || id > gt) && (!lte || id <= lte))
      .slice(0, input.take).map(id => ({ id }));
  };
  (logger as any).info = (data: unknown) => events.push(data);
  (logger as any).error = (data: unknown) => events.push(data);
  (metrics as any).observeRetentionRun = (data: unknown) => events.push(data);
  startPrivacyRetentionCron(service as any);
  return { run: () => callback(), events };
};

test("retention reaches every tenant beyond the first 500 exactly once", async () => {
  const ids = Array.from({ length: 1001 }, (_, i) => `tenant_${String(i).padStart(4, "0")}`);
  const visited: string[] = [];
  const h = harness(ids, { runRetention: async ({ tenantId }: any) => { visited.push(tenantId); return zero(); } });
  await h.run();
  assert.deepEqual(visited, ids);
});

test("a tenant failure leaves subsequent pages eligible and keeps private errors out of cron logs", async () => {
  const ids = Array.from({ length: 501 }, (_, i) => `tenant_${String(i).padStart(4, "0")}`);
  const visited: string[] = [];
  const h = harness(ids, { runRetention: async ({ tenantId }: any) => {
    visited.push(tenantId);
    if (tenantId === ids[0]) throw new Error("secret-reset-token@example.test");
    return zero();
  } });
  await h.run();
  assert.deepEqual(visited, ids);
  assert.equal(JSON.stringify(h.events).includes("secret-reset-token"), false);
  assert.ok(h.events.some((e: any) => e.tenantsFailed === 1 && e.tenantsProcessed === 500));
});

test("overlapping ticks do not run the same cleanup twice and the guard releases after completion", async () => {
  let release!: () => void;
  let started!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { started = resolve; });
  let calls = 0;
  const h = harness(["tenant_1"], { runRetention: async () => {
    calls++; started(); await barrier; return zero();
  } });
  const first = h.run(); await entered;
  const second = h.run();
  await new Promise(resolve => setImmediate(resolve));
  const overlappingCalls = calls;
  release(); await Promise.all([first, second]);
  assert.equal(overlappingCalls, 1);
  await h.run(); assert.equal(calls, 2);
});

test("a global cleanup failure does not suppress tenant cleanup and inactive cron does nothing", async () => {
  let calls = 0;
  const h = harness(["tenant_1"], {
    runGlobalRetention: async () => { throw new Error("private-global-payload"); },
    runRetention: async () => { calls++; return zero(); }
  });
  env.PRIVACY_RETENTION_GLOBAL_ENABLED = true;
  await h.run(); assert.equal(calls, 1);
  assert.equal(JSON.stringify(h.events).includes("private-global-payload"), false);
  env.PRIVACY_RETENTION_CRON_ENABLED = false;
  await h.run(); assert.equal(calls, 1);
});

test("enumeration failure releases the overlap guard so a later tick can recover", async () => {
  let calls = 0;
  const h = harness(["tenant_1"], { runRetention: async () => { calls++; return zero(); } });
  const findMany = prisma.tenant.findMany;
  (prisma.tenant as any).findMany = async () => { throw new Error("private-query-payload"); };
  await h.run(); assert.equal(calls, 0);
  prisma.tenant.findMany = findMany;
  await h.run(); assert.equal(calls, 1);
  assert.equal(JSON.stringify(h.events).includes("private-query-payload"), false);
});
