import assert from "node:assert/strict";
import test from "node:test";
import { PlatformAdminService } from "../src/application/services/platform-admin-service.js";
import { PlatformLoginGuardService } from "../src/application/services/platform-login-guard-service.js";
import { createPlatformIpAllowlist } from "../src/interfaces/http/middlewares/platform-ip-allowlist.js";
import {
  PlatformAdminRepository,
  PlatformAuditEvent,
  PlatformLicense,
  PlatformTenantRow
} from "../src/domain/repositories/platform-admin-repository.js";

class FakePlatformRepository implements PlatformAdminRepository {
  public isActive = true;
  public license: PlatformLicense = {
    plan: "PRO",
    seats: 10,
    status: "ACTIVE",
    expiresAt: new Date("2030-01-01T00:00:00.000Z").toISOString(),
    updatedAt: new Date("2026-01-01T00:00:00.000Z").toISOString()
  };

  public audits: Array<{ action: string; details: Record<string, unknown> }> = [];
  public licensesWritten: PlatformLicense[] = [];

  async listTenants(): Promise<PlatformTenantRow[]> {
    return [];
  }

  async getTenantById(tenantId: string): Promise<{ id: string; name: string; isActive: boolean } | null> {
    return { id: tenantId, name: "Tenant Demo", isActive: this.isActive };
  }

  async setTenantActive(_tenantId: string, isActive: boolean): Promise<void> {
    this.isActive = isActive;
  }

  async getLatestLicense(): Promise<PlatformLicense | null> {
    return this.license;
  }

  async getLatestLicenseAtOrBefore(_tenantId: string, _at: Date): Promise<PlatformLicense | null> {
    return this.license;
  }

  async setLicense(_tenantId: string, _userId: string, details: PlatformLicense): Promise<void> {
    this.license = details;
    this.licensesWritten.push(details);
  }

  async listUsersGlobal(): Promise<Array<{ id: string; email: string; firstName: string; lastName: string; status: string; tenant: { id: string; name: string } }>> {
    return [];
  }

  async appendPlatformAudit(input: {
    tenantId: string;
    actorUserId: string;
    action: string;
    resource: string;
    resourceId?: string | null;
    details: Record<string, unknown>;
  }): Promise<void> {
    this.audits.push({ action: input.action, details: input.details });
  }

  async listRecentPlatformEvents(_limit: number): Promise<PlatformAuditEvent[]> {
    return [];
  }
}

test("platform ip allowlist always allows localhost", async () => {
  const alerts: Array<Record<string, unknown>> = [];
  const middleware = createPlatformIpAllowlist({
    notify: async (input: Record<string, unknown>) => {
      alerts.push(input);
    }
  } as any);

  const req = {
    ip: "::ffff:127.0.0.1",
    headers: {},
    method: "GET",
    originalUrl: "/platform-api/tenants",
    socket: { remoteAddress: "::ffff:127.0.0.1" }
  } as any;

  let nextErr: unknown = undefined;
  await middleware(req, {} as any, (err?: unknown) => {
    nextErr = err;
  });

  assert.equal(nextErr, undefined);
  assert.equal(alerts.length, 0);
});

test("platform ip allowlist blocks unauthorized ip and triggers alert", async () => {
  const alerts: Array<Record<string, unknown>> = [];
  const middleware = createPlatformIpAllowlist({
    notify: async (input: Record<string, unknown>) => {
      alerts.push(input);
    }
  } as any);

  const req = {
    ip: "8.8.8.8",
    headers: {},
    method: "GET",
    originalUrl: "/platform-api/tenants",
    socket: { remoteAddress: "8.8.8.8" }
  } as any;

  let nextErr: any = undefined;
  await middleware(req, {} as any, (err?: unknown) => {
    nextErr = err;
  });

  assert.equal(nextErr?.statusCode, 403);
  assert.equal(nextErr?.code, "PLATFORM_IP_FORBIDDEN");
  assert.equal(alerts.length, 1);
});

test("quick action renew updates license, writes audit and sends alert", async () => {
  const repo = new FakePlatformRepository();
  const sentAlerts: Array<Record<string, unknown>> = [];
  const service = new PlatformAdminService(
    repo,
    {
      notify: async (input: Record<string, unknown>) => {
        sentAlerts.push(input);
      }
    } as any,
    new PlatformLoginGuardService()
  );

  const result = await service.executeQuickAction({
    tenantId: "cktnant111111111111111111",
    actorUserId: "platform-admin",
    sourceIp: "127.0.0.1",
    action: "RENEW_30_DAYS"
  });

  assert.equal(result.updated, true);
  assert.equal(repo.licensesWritten.length, 1);
  assert.equal(repo.audits.length, 1);
  assert.equal(repo.audits[0]?.action, "PLATFORM_LICENSE_QUICK_ACTION");
  assert.equal(sentAlerts.length, 1);
});

test("quick action deactivate tenant updates state and writes audit", async () => {
  const repo = new FakePlatformRepository();
  const sentAlerts: Array<Record<string, unknown>> = [];
  const service = new PlatformAdminService(
    repo,
    {
      notify: async (input: Record<string, unknown>) => {
        sentAlerts.push(input);
      }
    } as any,
    new PlatformLoginGuardService()
  );

  const result = await service.executeQuickAction({
    tenantId: "cktnant222222222222222222",
    actorUserId: "platform-admin",
    sourceIp: "127.0.0.1",
    action: "DEACTIVATE_TENANT"
  });

  assert.equal(result.updated, true);
  assert.equal(repo.isActive, false);
  assert.equal(repo.license.status, "SUSPENDED");
  assert.equal(repo.audits.length, 2);
  assert.equal(repo.audits[0]?.action, "PLATFORM_TENANT_STATUS_CHANGED");
  assert.equal(repo.audits[1]?.action, "PLATFORM_LICENSE_QUICK_ACTION");
  assert.equal(sentAlerts.length, 2);
});

test("quick action trial sets TRIAL status with 14-day expiry", async () => {
  const repo = new FakePlatformRepository();
  const service = new PlatformAdminService(
    repo,
    { notify: async () => {} } as any,
    new PlatformLoginGuardService()
  );

  const result = await service.executeQuickAction({
    tenantId: "cktnant555555555555555555",
    actorUserId: "platform-admin",
    sourceIp: "127.0.0.1",
    action: "TRIAL_14_DAYS"
  });

  assert.equal(result.updated, true);
  assert.equal(repo.license.status, "TRIAL");
  assert.ok(repo.license.expiresAt);
  const expiryTs = new Date(repo.license.expiresAt!).getTime();
  assert.ok(expiryTs > Date.now());
  assert.ok(repo.audits.some((row) => row.action === "PLATFORM_LICENSE_QUICK_ACTION"));
});

test("updateLicense updates tenant plan and realigns standard monthly price", async () => {
  const repo = new FakePlatformRepository();
  repo.license = {
    plan: "ENTERPRISE",
    seats: 20,
    status: "SUSPENDED",
    expiresAt: "2030-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    priceMonthly: 399,
    billingCycle: "yearly"
  };
  const sentAlerts: Array<Record<string, unknown>> = [];
  const service = new PlatformAdminService(
    repo,
    {
      notify: async (input: Record<string, unknown>) => {
        sentAlerts.push(input);
      }
    } as any,
    new PlatformLoginGuardService()
  );

  const result = await service.updateLicense({
    tenantId: "cktnant333333333333333333",
    actorUserId: "platform-admin",
    sourceIp: "127.0.0.1",
    plan: "STARTER",
    seats: 20,
    status: "SUSPENDED",
    expiresAt: "2030-01-01T00:00:00.000Z",
    billingCycle: "yearly"
  });

  assert.equal(result.updated, true);
  assert.equal(repo.license.plan, "STARTER");
  assert.equal(repo.license.priceMonthly, 149);
  assert.equal(repo.license.billingCycle, "yearly");
  assert.equal(repo.audits.at(-1)?.action, "PLATFORM_LICENSE_UPDATED");
  assert.equal(sentAlerts.length, 1);
});

test("updateLicense persists plan transitions STARTER -> PRO -> ENTERPRISE -> STARTER", async () => {
  const repo = new FakePlatformRepository();
  repo.license = {
    plan: "STARTER",
    seats: 3,
    status: "ACTIVE",
    expiresAt: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    priceMonthly: 49,
    billingCycle: "monthly"
  };
  const service = new PlatformAdminService(
    repo,
    { notify: async () => {} } as any,
    new PlatformLoginGuardService()
  );

  const run = async (plan: "STARTER" | "PRO" | "ENTERPRISE") => {
    const result = await service.updateLicense({
      tenantId: "cktnant444444444444444444",
      actorUserId: "platform-admin",
      sourceIp: "127.0.0.1",
      plan,
      seats: repo.license.seats,
      status: repo.license.status,
      expiresAt: repo.license.expiresAt,
      billingCycle: repo.license.billingCycle
    });
    assert.equal(result.after.plan, plan);
    assert.equal(repo.license.plan, plan);
  };

  await run("PRO");
  await run("ENTERPRISE");
  await run("STARTER");
});
