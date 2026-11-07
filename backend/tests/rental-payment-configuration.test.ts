import assert from "node:assert/strict";
import test from "node:test";
import type Stripe from "stripe";
import { RentalPaymentService } from "../src/application/services/rental-payment-service.js";
import type { AuditLogRepository } from "../src/domain/repositories/audit-log-repository.js";
import { env } from "../src/shared/config/env.js";
import { AppError } from "../src/shared/errors/app-error.js";

const booking = {
  id: "synthetic-booking", tenantId: "synthetic-tenant", code: "QA-CONFIG",
  customerId: "synthetic-customer", vehicleId: "synthetic-vehicle", customerName: "Synthetic customer",
  customer: { id: "synthetic-customer", tenantId: "synthetic-tenant", deletedAt: null }
};
const service = (client: Stripe | null = null, visible = true) => new RentalPaymentService(
  { create: async () => { throw new Error("Configuration inspection must not write an audit event"); } } as unknown as AuditLogRepository,
  client,
  {
    findBookingForPayment: async () => visible ? booking as never : null,
    findDepositById: async () => ({ id: "synthetic-deposit", tenantId: booking.tenantId, bookingId: booking.id }) as never,
    findExtraChargeById: async () => ({ id: "synthetic-extra", tenantId: booking.tenantId, bookingId: booking.id }) as never,
    listPaymentMethods: async () => [], listDepositsByBooking: async () => [], listExtraChargesByBooking: async () => []
  }
);
const withConfiguration = async (environment: typeof env.FLEETUM_ENVIRONMENT, key: string | undefined, run: () => Promise<void>) => {
  const original = { environment: env.FLEETUM_ENVIRONMENT, key: env.STRIPE_SECRET_KEY };
  env.FLEETUM_ENVIRONMENT = environment;
  env.STRIPE_SECRET_KEY = key;
  try { await run(); } finally { env.FLEETUM_ENVIRONMENT = original.environment; env.STRIPE_SECRET_KEY = original.key; }
};

test("payment summary distinguishes intentionally disabled staging from missing configuration without mutating data", async () => {
  await withConfiguration("staging", undefined, async () => {
    const summary = await service().getBookingPaymentSummary(booking.tenantId, booking.id);
    assert.deepEqual((summary as any).capabilities.stripe, {
      status: "disabled_for_environment", operationsEnabled: false, verification: "not_performed"
    });
    assert.deepEqual(summary.deposits, []);
  });
});

test("missing Stripe is a service-unavailable condition, never a pretend setup session", async () => {
  await withConfiguration("production", undefined, async () => {
    const payments = service();
    assert.deepEqual((await payments.getBookingPaymentSummary(booking.tenantId, booking.id) as any).capabilities.stripe, {
      status: "not_configured", operationsEnabled: false, verification: "not_performed"
    });
    await assert.rejects(payments.createSetupSession({ tenantId: booking.tenantId, bookingId: booking.id, userId: "synthetic-user", mandateAccepted: true, termsVersion: "synthetic-v1" }),
      (error: unknown) => error instanceof AppError && error.statusCode === 503 && error.code === "RENTAL_STRIPE_NOT_CONFIGURED");
  });
});

test("configuration presence does not claim merchant verification or leak a credential", async () => {
  const sentinel = "sk_test_synthetic_configuration_never_sent";
  await withConfiguration("production", sentinel, async () => {
    const summary = await service({} as Stripe).getBookingPaymentSummary(booking.tenantId, booking.id);
    assert.deepEqual((summary as any).capabilities.stripe, {
      status: "configuration_present", operationsEnabled: true, verification: "not_performed"
    });
    assert.ok(!JSON.stringify(summary).includes(sentinel));
  });
});

test("disabled environments reject every Stripe operation before any provider call even with an injected client", async () => {
  await withConfiguration("staging", "sk_test_synthetic_never_sent", async () => {
    let calls = 0;
    const client = new Proxy({}, { get() { calls++; throw new Error("Provider must not be called"); } }) as Stripe;
    const payments = service(client);
    const requests = [
      () => payments.createSetupSession({ tenantId: booking.tenantId, bookingId: booking.id, userId: "synthetic-user", mandateAccepted: true, termsVersion: "synthetic-v1" }),
      () => payments.createDeposit({ tenantId: booking.tenantId, bookingId: booking.id, userId: "synthetic-user", paymentMethodId: "synthetic-method", amountCents: 100 }),
      () => payments.captureDeposit({ tenantId: booking.tenantId, depositId: "synthetic-deposit", userId: "synthetic-user" }),
      () => payments.releaseDeposit({ tenantId: booking.tenantId, depositId: "synthetic-deposit", userId: "synthetic-user" }),
      () => payments.chargeExtraCharge({ tenantId: booking.tenantId, extraChargeId: "synthetic-extra", userId: "synthetic-user" })
    ];
    for (const request of requests) await assert.rejects(request(), (error: unknown) => error instanceof AppError && error.statusCode === 503 && error.code === "RENTAL_STRIPE_DISABLED");
    assert.equal(calls, 0);
  });
});

test("configuration data is not returned for a booking outside the authorized scope", async () => {
  await withConfiguration("production", undefined, async () => {
    await assert.rejects(service(null, false).getBookingPaymentSummary("synthetic-other-tenant", booking.id),
      (error: unknown) => error instanceof AppError && error.statusCode === 404);
  });
});
