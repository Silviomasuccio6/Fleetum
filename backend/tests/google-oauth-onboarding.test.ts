import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { TenantProfileService } from "../src/application/services/tenant-profile-service.js";
import { SignupUseCase } from "../src/application/usecases/auth/signup-usecase.js";
import { prisma } from "../src/infrastructure/database/prisma/client.js";

const originalPrisma = {
  userFindFirst: prisma.user.findFirst,
  tenantCreate: prisma.tenant.create,
  tenantSubscriptionUpsert: prisma.tenantSubscription.upsert,
  auditLogCreate: prisma.auditLog.create,
  transaction: prisma.$transaction
};

afterEach(() => {
  (prisma.user as any).findFirst = originalPrisma.userFindFirst;
  (prisma.tenant as any).create = originalPrisma.tenantCreate;
  (prisma.tenantSubscription as any).upsert = originalPrisma.tenantSubscriptionUpsert;
  (prisma.auditLog as any).create = originalPrisma.auditLogCreate;
  (prisma as any).$transaction = originalPrisma.transaction;
});

test("Google signup creates a pending tenant without fabricated company profile data", async () => {
  const createdUsers: Array<Record<string, unknown>> = [];
  const defaultCalls: Array<Record<string, unknown>> = [];
  const auditLogs: Array<Record<string, unknown>> = [];
  let tenantCreatePayload: unknown = null;
  let subscriptionUpsertPayload: unknown = null;

  (prisma.user as any).findFirst = async () => null;
  (prisma.tenant as any).create = async (payload: unknown) => {
    tenantCreatePayload = payload;
    return { id: "tenant_social_1", name: "Account in configurazione" };
  };
  (prisma.tenantSubscription as any).upsert = async (payload: unknown) => {
    subscriptionUpsertPayload = payload;
    return {
      tenantId: "tenant_social_1",
      provider: "stripe",
      plan: "STARTER",
      billingCycle: "monthly",
      status: "PENDING",
      seats: 3,
      priceMonthly: 149,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      currentPeriodEnd: null,
      trialEndsAt: null,
      updatedAt: new Date("2026-06-30T00:00:00.000Z")
    };
  };
  (prisma.auditLog as any).create = async (payload: Record<string, unknown>) => {
    auditLogs.push(payload);
    return { id: "audit_social_signup" };
  };

  const userRepository = {
    create: async (input: Record<string, unknown>) => {
      createdUsers.push(input);
      return {
        id: "user_social_1",
        tenantId: input.tenantId,
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
        roles: ["ADMIN"],
        permissions: ["users:read", "users:write"],
        status: "ACTIVE"
      };
    }
  } as any;

  const tenantProfileService = {
    ensureDefaultsForTenant: async (input: Record<string, unknown>) => {
      defaultCalls.push(input);
      return undefined;
    }
  } as any;

  const useCase = new SignupUseCase(userRepository, tenantProfileService);
  const result = await useCase.executeSocial({
    email: "Mario.Rossi+Test@Example.com",
    provider: "google",
    firstName: "Mario",
    lastName: "Rossi",
    fullName: "Mario Rossi"
  });

  assert.equal(result.tenantId, "tenant_social_1");
  assert.deepEqual(tenantCreatePayload, { data: { name: "Account in configurazione" } });
  assert.equal(createdUsers[0].email, "mario.rossi+test@example.com");
  assert.equal(createdUsers[0].firstName, "Mario");
  assert.equal(createdUsers[0].lastName, "Rossi");
  assert.deepEqual(defaultCalls, [{ tenantId: "tenant_social_1", company: null }]);
  assert.equal((subscriptionUpsertPayload as any).create.status, "PENDING");
  assert.equal((subscriptionUpsertPayload as any).create.provider, "stripe");
  assert.equal((subscriptionUpsertPayload as any).create.plan, "STARTER");
  assert.equal((auditLogs[0].data as any).details.source, "signup_pending_billing");
});

test("Google signup rejects duplicate email without creating a second tenant", async () => {
  let tenantCreated = false;
  (prisma.user as any).findFirst = async () => ({ id: "existing_user", email: "admin@example.com" });
  (prisma.tenant as any).create = async () => {
    tenantCreated = true;
    return { id: "should_not_exist" };
  };

  const useCase = new SignupUseCase({} as any, {} as any);

  await assert.rejects(
    () =>
      useCase.executeSocial({
        email: "admin@example.com",
        provider: "google",
        firstName: "Mario",
        lastName: "Rossi"
      }),
    (error: any) => error?.code === "CONFLICT"
  );
  assert.equal(tenantCreated, false);
});

test("company onboarding updates tenant identity and creates the first site before billing", async () => {
  const calls: Record<string, any> = {};
  const tx = {
    tenantProfile: {
      upsert: async (payload: any) => ({ id: "profile_1", ...payload.create, ...payload.update })
    },
    tenantBranding: {
      upsert: async () => ({ id: "branding_1", logoFilePath: null })
    },
    tenant: {
      update: async (payload: any) => {
        calls.tenantUpdate = payload;
        return { id: payload.where.id };
      }
    },
    site: {
      findFirst: async () => null,
      create: async (payload: any) => {
        calls.siteCreate = payload;
        return { id: "site_1", ...payload.data };
      }
    },
    tenantLegalSettings: {
      upsert: async () => ({ id: "legal_1" })
    },
    auditLog: {
      create: async (payload: any) => {
        calls.auditLog = payload;
        return { id: "audit_1" };
      }
    }
  };
  (prisma as any).$transaction = async (callback: (transaction: typeof tx) => unknown) => callback(tx);

  const service = new TenantProfileService();
  await service.updateProfile("tenant_1", "user_1", {
    legalName: "Rossi Noleggi Srl",
    vatNumber: "07643520567",
    taxCode: "07643520567",
    pec: "rossi.noleggi@pec.invalid",
    sdiCode: "M5UXCR1",
    legalAddress: "Via Roma 1",
    city: "Roma",
    province: "RM",
    postalCode: "00118",
    country: "IT",
    email: "amministrazione@rossinoleggi.invalid",
    phone: "+3906123456",
    adminFirstName: "Mario",
    adminLastName: "Rossi",
    adminEmail: "mario.rossi@rossinoleggi.invalid"
  });

  assert.equal(calls.tenantUpdate.where.id, "tenant_1");
  assert.equal(calls.tenantUpdate.data.name, "Rossi Noleggi Srl");
  assert.equal(calls.tenantUpdate.data.vatNumber, "07643520567");
  assert.equal(calls.siteCreate.data.tenantId, "tenant_1");
  assert.equal(calls.siteCreate.data.name, "Rossi Noleggi Srl");
  assert.equal(calls.siteCreate.data.address, "Via Roma 1");
  assert.equal(calls.siteCreate.data.city, "Roma");
  assert.equal(calls.auditLog.data.action, "TENANT_PROFILE_UPDATED");
});
