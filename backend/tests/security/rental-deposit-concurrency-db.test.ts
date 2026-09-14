import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import Stripe from "stripe";
import { RentalPaymentService } from "../../src/application/services/rental-payment-service.js";
import { AuditLogRepository, AuditLogRow } from "../../src/domain/repositories/audit-log-repository.js";
import { prisma } from "../../src/infrastructure/database/prisma/client.js";
import { env } from "../../src/shared/config/env.js";

class NoopAuditRepository implements AuditLogRepository {
  async countByTenant(_tenantId: string): Promise<number> { return 0; }
  async listByTenant(_tenantId: string, _input: { skip: number; take: number }): Promise<AuditLogRow[]> { return []; }
  async listLatestByTenant(_tenantId: string, _take: number): Promise<AuditLogRow[]> { return []; }
  async getLatestByAction(_tenantId: string, _resource: string, _action: string): Promise<AuditLogRow | null> { return null; }
  async create(): Promise<void> {}
}

const runId = `deposit-race-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let tenantId = "";
let userId = "";
let bookingId = "";
let paymentMethodId = "";

const cleanup = async () => {
  if (!tenantId) return;
  await prisma.rentalPaymentEvent.deleteMany({ where: { tenantId } });
  await prisma.rentalDeposit.deleteMany({ where: { tenantId } });
  await prisma.rentalCustomerPaymentMethod.deleteMany({ where: { tenantId } });
  await prisma.rentalCustomerPaymentProfile.deleteMany({ where: { tenantId } });
  await prisma.rentalBooking.deleteMany({ where: { tenantId } });
  await prisma.rentalCustomer.deleteMany({ where: { tenantId } });
  await prisma.user.deleteMany({ where: { tenantId } });
  await prisma.vehicle.deleteMany({ where: { tenantId } });
  await prisma.site.deleteMany({ where: { tenantId } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
};

describe("rental deposit PostgreSQL concurrency", () => {
  before(async () => {
    await prisma.$connect();
    (env as unknown as Record<string, unknown>).STRIPE_SECRET_KEY = "sk_test_synthetic_deposit_race";

    const tenant = await prisma.tenant.create({
      data: { name: `Deposit Race ${runId}`, vatNumber: `IT${Date.now().toString().slice(-11)}` }
    });
    tenantId = tenant.id;
    const user = await prisma.user.create({
      data: {
        tenantId,
        email: `${runId}@example.test`,
        passwordHash: "synthetic-test-only",
        firstName: "Deposit",
        lastName: "Race",
        isEmailVerified: true
      }
    });
    userId = user.id;
    const site = await prisma.site.create({
      data: { tenantId, name: `Site ${runId}`, address: "Via Test 1", city: "Roma" }
    });
    const vehicle = await prisma.vehicle.create({
      data: {
        tenantId,
        siteId: site.id,
        plate: `DR${runId.slice(-8)}`.replace(/[^A-Za-z0-9]/g, "").slice(0, 12).toUpperCase(),
        brand: "Synthetic",
        model: "Deposit Race",
        year: 2025,
        isActive: true
      }
    });
    const customer = await prisma.rentalCustomer.create({
      data: {
        tenantId,
        firstName: "Cliente",
        lastName: "Sintetico",
        drivingLicenseNumber: `DL-${runId}`
      }
    });
    const booking = await prisma.rentalBooking.create({
      data: {
        tenantId,
        vehicleId: vehicle.id,
        customerId: customer.id,
        createdByUserId: userId,
        code: `DEPOSIT-${runId}`,
        status: "CONFIRMED",
        customerName: "Cliente Sintetico",
        pickupAt: new Date("2027-05-10T08:00:00.000Z"),
        returnAt: new Date("2027-05-12T08:00:00.000Z")
      }
    });
    bookingId = booking.id;
    const profile = await prisma.rentalCustomerPaymentProfile.create({
      data: {
        tenantId,
        rentalCustomerId: customer.id,
        stripeCustomerId: `cus_${runId}`,
        status: "ACTIVE"
      }
    });
    const paymentMethod = await prisma.rentalCustomerPaymentMethod.create({
      data: {
        tenantId,
        paymentProfileId: profile.id,
        rentalCustomerId: customer.id,
        bookingId,
        stripeCustomerId: profile.stripeCustomerId,
        stripePaymentMethodId: `pm_${runId}`,
        status: "ACTIVE",
        mandateAccepted: true,
        mandateAcceptedAt: new Date(),
        termsVersion: "synthetic-v1",
        createdByUserId: userId
      }
    });
    paymentMethodId = paymentMethod.id;
  });

  after(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("creates one database claim and one logical Stripe authorization under concurrent requests", async () => {
    const stripeCallKeys: string[] = [];
    const logicalAuthorizations = new Map<string, Promise<Stripe.PaymentIntent>>();
    const stripeClient = {
      paymentIntents: {
        create: async (_params: unknown, options?: { idempotencyKey?: string }) => {
          const key = String(options?.idempotencyKey ?? "");
          stripeCallKeys.push(key);
          let authorization = logicalAuthorizations.get(key);
          if (!authorization) {
            authorization = new Promise<Stripe.PaymentIntent>((resolve) => {
              setTimeout(() => resolve({
                id: `pi_${runId}`,
                status: "requires_capture",
                amount_received: 0
              } as Stripe.PaymentIntent), 20);
            });
            logicalAuthorizations.set(key, authorization);
          }
          return authorization;
        }
      }
    } as unknown as Stripe;
    const service = new RentalPaymentService(new NoopAuditRepository(), stripeClient);
    const request = { tenantId, bookingId, paymentMethodId, amountCents: 50_000, userId };

    const results = await Promise.all(
      Array.from({ length: 8 }, () => service.createDeposit(request))
    );

    assert.equal(new Set(results.map((deposit) => deposit.id)).size, 1);
    assert.equal(logicalAuthorizations.size, 1);
    assert.equal(new Set(stripeCallKeys).size, 1);
    assert.equal(results.every((deposit) => deposit.status === "AUTHORIZED"), true);

    const activeRows = await prisma.rentalDeposit.findMany({
      where: {
        tenantId,
        bookingId,
        deletedAt: null,
        status: { in: ["AUTHORIZING", "AUTHORIZED"] }
      }
    });
    assert.equal(activeRows.length, 1);
    assert.equal(activeRows[0]?.stripePaymentIntentId, `pi_${runId}`);
  });
});
