import assert from "node:assert/strict";
import test from "node:test";
import { LicensePolicyService } from "../src/application/services/license-policy-service.js";
import { AuditLogRepository, AuditLogRow } from "../src/domain/repositories/audit-log-repository.js";

class FakeAuditRepo implements AuditLogRepository {
  public latest: AuditLogRow | null = null;

  async countByTenant(_tenantId: string): Promise<number> {
    return 0;
  }

  async listByTenant(_tenantId: string, _input: { skip: number; take: number }): Promise<AuditLogRow[]> {
    return [];
  }

  async listLatestByTenant(_tenantId: string, _take: number): Promise<AuditLogRow[]> {
    return [];
  }

  async getLatestByAction(_tenantId: string, _resource: string, _action: string): Promise<AuditLogRow | null> {
    return this.latest;
  }

  async create(_input: {
    tenantId: string;
    userId?: string | null;
    action: string;
    resource: string;
    resourceId?: string | null;
    details?: unknown;
  }): Promise<void> {}
}

test("license policy reads plan from nested details.after payload", async () => {
  const repo = new FakeAuditRepo();
  repo.latest = {
    id: "audit-1",
    tenantId: "tenant-1",
    userId: "platform-admin",
    action: "PLATFORM_LICENSE_UPDATED",
    resource: "tenant",
    resourceId: "tenant-1",
    details: {
      actor: "platform-admin",
      before: { plan: "STARTER" },
      after: {
        plan: "PRO",
        seats: 5,
        status: "ACTIVE",
        expiresAt: null,
        priceMonthly: 149,
        billingCycle: "monthly"
      }
    },
    createdAt: new Date()
  };

  const service = new LicensePolicyService(repo, async () => null);
  const entitlements = await service.getTenantEntitlements("tenant-1");

  assert.equal(entitlements.plan, "PRO");
  assert.equal(entitlements.license.plan, "PRO");
  assert.equal(entitlements.priceMonthly, 149);
});

test("license policy defaults to pending when no subscription or audit license exists", async () => {
  const repo = new FakeAuditRepo();
  const service = new LicensePolicyService(repo, async () => null);

  const license = await service.getTenantLicense("tenant-without-license");

  assert.equal(license.plan, "STARTER");
  assert.equal(license.status, "PENDING");
  assert.equal(license.expiresAt, null);
});

test("license policy reads plan from raw payload for backward compatibility", async () => {
  const repo = new FakeAuditRepo();
  repo.latest = {
    id: "audit-2",
    tenantId: "tenant-2",
    userId: "platform-admin",
    action: "PLATFORM_LICENSE_UPDATED",
    resource: "tenant",
    resourceId: "tenant-2",
    details: {
      plan: "ENTERPRISE",
      seats: 10,
      status: "ACTIVE",
      expiresAt: null,
      priceMonthly: 399,
      billingCycle: "yearly"
    },
    createdAt: new Date()
  };

  const service = new LicensePolicyService(repo, async () => null);
  const license = await service.getTenantLicense("tenant-2");

  assert.equal(license.plan, "ENTERPRISE");
  assert.equal(license.billingCycle, "yearly");
});

test("license policy prefers persisted tenant subscription over audit fallback", async () => {
  const repo = new FakeAuditRepo();
  repo.latest = {
    id: "audit-3",
    tenantId: "tenant-3",
    userId: "platform-admin",
    action: "PLATFORM_LICENSE_UPDATED",
    resource: "tenant",
    resourceId: "tenant-3",
    details: {
      plan: "STARTER",
      seats: 3,
      status: "ACTIVE",
      expiresAt: null,
      priceMonthly: 129,
      billingCycle: "monthly"
    },
    createdAt: new Date()
  };

  const service = new LicensePolicyService(repo, async () => ({
    plan: "PRO",
    seats: 7,
    status: "PAST_DUE",
    expiresAt: null,
    updatedAt: new Date().toISOString(),
    priceMonthly: 199,
    billingCycle: "yearly",
    provider: "stripe",
    stripeCustomerId: "cus_demo",
    stripeSubscriptionId: "sub_demo"
  }));

  const license = await service.getTenantLicense("tenant-3");

  assert.equal(license.plan, "PRO");
  assert.equal(license.seats, 7);
  assert.equal(license.provider, "stripe");
  assert.equal(license.status, "PAST_DUE");
  assert.equal(license.priceMonthly, 199);
  assert.equal(license.billingCycle, "yearly");
});
