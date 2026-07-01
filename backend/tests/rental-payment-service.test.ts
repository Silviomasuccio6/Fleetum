import assert from "node:assert/strict";
import test from "node:test";
import Stripe from "stripe";
import { RentalPaymentService } from "../src/application/services/rental-payment-service.js";
import { AuditLogRepository, AuditLogRow } from "../src/domain/repositories/audit-log-repository.js";
import { AppError } from "../src/shared/errors/app-error.js";
import { env } from "../src/shared/config/env.js";

class FakeAuditRepo implements AuditLogRepository {
  public rows: Array<Parameters<AuditLogRepository["create"]>[0]> = [];

  async countByTenant(_tenantId: string): Promise<number> { return 0; }
  async listByTenant(_tenantId: string, _input: { skip: number; take: number }): Promise<AuditLogRow[]> { return []; }
  async listLatestByTenant(_tenantId: string, _take: number): Promise<AuditLogRow[]> { return []; }
  async getLatestByAction(_tenantId: string, _resource: string, _action: string): Promise<AuditLogRow | null> { return null; }
  async create(input: Parameters<AuditLogRepository["create"]>[0]): Promise<void> { this.rows.push(input); }
}

const booking = {
  id: "booking-1",
  tenantId: "tenant-1",
  code: "BK-001",
  customerId: "customer-1",
  vehicleId: "vehicle-1",
  customerName: "Mario Rossi",
  customerEmail: "mario@example.test",
  customerPhone: "+3900000000",
  customer: {
    id: "customer-1",
    tenantId: "tenant-1",
    customerType: "PERSONA_FISICA",
    firstName: "Mario",
    lastName: "Rossi",
    email: "mario@example.test",
    phone: "+3900000000",
    companyName: null,
    deletedAt: null
  }
};

const activePaymentMethod = {
  id: "rpm-active",
  tenantId: "tenant-1",
  paymentProfileId: "profile-1",
  rentalCustomerId: "customer-1",
  bookingId: "booking-1",
  stripeCustomerId: "cus_rental",
  stripePaymentMethodId: "pm_active",
  stripeSetupIntentId: "seti_active",
  status: "ACTIVE",
  cardBrand: "visa",
  cardLast4: "4242",
  cardExpMonth: 12,
  cardExpYear: 2030,
  mandateAccepted: true,
  mandateAcceptedAt: new Date(),
  termsVersion: "rental-terms-v1",
  deletedAt: null
};

const fakeStripeBase = (overrides: Partial<Record<"paymentIntents" | "checkout" | "customers" | "setupIntents" | "paymentMethods", unknown>> = {}) => ({
  customers: {
    create: async () => ({ id: "cus_rental" })
  },
  checkout: {
    sessions: {
      create: async () => ({ id: "cs_setup", url: "https://checkout.stripe.test/setup", setup_intent: "seti_setup" })
    }
  },
  setupIntents: {
    retrieve: async () => ({ id: "seti_setup", payment_method: "pm_card", metadata: {} })
  },
  paymentMethods: {
    retrieve: async () => ({
      id: "pm_card",
      card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 },
      billing_details: { name: "Mario Rossi" }
    })
  },
  paymentIntents: {
    create: async () => ({ id: "pi_123", status: "requires_capture", amount_received: 0 }),
    capture: async () => ({ id: "pi_123", status: "succeeded" }),
    cancel: async () => ({ id: "pi_123", status: "canceled" })
  },
  ...overrides
}) as unknown as Stripe;

const setStripeTestEnv = () => {
  (env as unknown as Record<string, unknown>).STRIPE_SECRET_KEY = "sk_test_rental_payments";
};

test("rental setup session fails without mandate consent", async () => {
  setStripeTestEnv();
  const service = new RentalPaymentService(new FakeAuditRepo(), fakeStripeBase());

  await assert.rejects(
    () => service.createSetupSession({
      tenantId: "tenant-1",
      bookingId: "booking-1",
      userId: "user-1",
      mandateAccepted: false,
      termsVersion: "terms-v1"
    }),
    (error) => error instanceof AppError && error.code === "RENTAL_PAYMENT_MANDATE_REQUIRED"
  );
});

test("rental setup session creates a pending payment method scoped to tenant", async () => {
  setStripeTestEnv();
  const audit = new FakeAuditRepo();
  const pendingRows: unknown[] = [];
  const service = new RentalPaymentService(audit, fakeStripeBase(), {
    async findBookingForPayment() { return booking; },
    async findPaymentProfile() { return null; },
    async createPaymentProfile() {
      return { id: "profile-1", tenantId: "tenant-1", rentalCustomerId: "customer-1", stripeCustomerId: "cus_rental", status: "ACTIVE", deletedAt: null };
    },
    async createPendingPaymentMethod(input) {
      pendingRows.push(input);
      return { ...activePaymentMethod, ...input, id: "rpm-pending", status: "SETUP_PENDING", deletedAt: null } as never;
    },
    async updatePaymentMethod(_tenantId, _paymentMethodId, data) {
      return { ...activePaymentMethod, id: "rpm-pending", status: "SETUP_PENDING", stripeSetupIntentId: String(data.stripeSetupIntentId) } as never;
    }
  });

  const result = await service.createSetupSession({
    tenantId: "tenant-1",
    bookingId: "booking-1",
    userId: "user-1",
    mandateAccepted: true,
    termsVersion: "terms-v1",
    mandateIp: "127.0.0.1",
    mandateUserAgent: "test-agent"
  });

  assert.equal(result.checkoutUrl, "https://checkout.stripe.test/setup");
  assert.equal(pendingRows.length, 1);
  assert.match(JSON.stringify(pendingRows[0]), /tenant-1/);
  assert.equal(audit.rows.at(-1)?.action, "RENTAL_PAYMENT_SETUP_SESSION_CREATED");
});

test("deposit creation requires an active payment method with mandate", async () => {
  setStripeTestEnv();
  const service = new RentalPaymentService(new FakeAuditRepo(), fakeStripeBase(), {
    async findBookingForPayment() { return booking; },
    async findPaymentMethodById() { return { ...activePaymentMethod, status: "SETUP_PENDING", mandateAccepted: true } as never; },
    async findActiveDeposit() { return null; }
  });

  await assert.rejects(
    () => service.createDeposit({ tenantId: "tenant-1", bookingId: "booking-1", paymentMethodId: "rpm-pending", amountCents: 50_000, userId: "user-1" }),
    (error) => error instanceof AppError && error.code === "RENTAL_PAYMENT_METHOD_NOT_ACTIVE"
  );
});

test("extra charge cannot be charged twice or after paid status", async () => {
  setStripeTestEnv();
  const service = new RentalPaymentService(new FakeAuditRepo(), fakeStripeBase(), {
    async findExtraChargeById() {
      return {
        id: "extra-1",
        tenantId: "tenant-1",
        bookingId: "booking-1",
        rentalCustomerId: "customer-1",
        vehicleId: "vehicle-1",
        paymentMethodId: "rpm-active",
        stripePaymentIntentId: "pi_paid",
        type: "FINE",
        description: "Multa ZTL",
        amountCents: 1000,
        adminFeeCents: 200,
        totalAmountCents: 1200,
        currency: "EUR",
        status: "PAID",
        failureReason: null
      } as never;
    }
  });

  await assert.rejects(
    () => service.chargeExtraCharge({ tenantId: "tenant-1", extraChargeId: "extra-1", userId: "user-1" }),
    (error) => error instanceof AppError && error.code === "RENTAL_EXTRA_CHARGE_NOT_CHARGEABLE"
  );
});

test("authentication_required maps extra charge to REQUIRES_ACTION", async () => {
  setStripeTestEnv();
  let finalStatus: string | null = null;
  const stripe = fakeStripeBase({
    paymentIntents: {
      create: async () => {
        const error = new Error("Authentication required") as Error & { code?: string; decline_code?: string };
        error.code = "authentication_required";
        throw error;
      }
    }
  });
  const service = new RentalPaymentService(new FakeAuditRepo(), stripe, {
    async findExtraChargeById() {
      return {
        id: "extra-1",
        tenantId: "tenant-1",
        bookingId: "booking-1",
        rentalCustomerId: "customer-1",
        vehicleId: "vehicle-1",
        paymentMethodId: "rpm-active",
        stripePaymentIntentId: null,
        type: "FINE",
        description: "Multa ZTL",
        amountCents: 1000,
        adminFeeCents: 200,
        totalAmountCents: 1200,
        currency: "EUR",
        status: "APPROVED",
        failureReason: null
      } as never;
    },
    async findPaymentMethodById() { return activePaymentMethod as never; },
    async updateExtraCharge(_tenantId, _extraChargeId, data) {
      if (typeof data.status === "string") finalStatus = data.status;
      return {
        id: "extra-1",
        tenantId: "tenant-1",
        bookingId: "booking-1",
        rentalCustomerId: "customer-1",
        vehicleId: "vehicle-1",
        paymentMethodId: "rpm-active",
        stripePaymentIntentId: null,
        type: "FINE",
        description: "Multa ZTL",
        amountCents: 1000,
        adminFeeCents: 200,
        totalAmountCents: 1200,
        currency: "EUR",
        status: finalStatus ?? "APPROVED",
        failureReason: null
      } as never;
    }
  });

  const result = await service.chargeExtraCharge({ tenantId: "tenant-1", extraChargeId: "extra-1", userId: "user-1" });
  assert.equal(result.status, "REQUIRES_ACTION");
  assert.equal(finalStatus, "REQUIRES_ACTION");
});

test("partial deposit capture is final and stores captured timestamp", async () => {
  setStripeTestEnv();
  let updateData: Record<string, unknown> | null = null;
  const stripe = fakeStripeBase({
    paymentIntents: {
      capture: async () => ({ id: "pi_deposit", status: "succeeded" })
    }
  });
  const service = new RentalPaymentService(new FakeAuditRepo(), stripe, {
    async findDepositById() {
      return {
        id: "deposit-1",
        tenantId: "tenant-1",
        bookingId: "booking-1",
        rentalCustomerId: "customer-1",
        vehicleId: "vehicle-1",
        paymentMethodId: "rpm-active",
        stripePaymentIntentId: "pi_deposit",
        amountCents: 50_000,
        capturedAmountCents: 0,
        currency: "EUR",
        status: "AUTHORIZED",
        failureReason: null
      } as never;
    },
    async updateDeposit(_tenantId, _depositId, data) {
      const saved = data as Record<string, unknown>;
      updateData = saved;
      return {
        id: "deposit-1",
        tenantId: "tenant-1",
        bookingId: "booking-1",
        rentalCustomerId: "customer-1",
        vehicleId: "vehicle-1",
        paymentMethodId: "rpm-active",
        stripePaymentIntentId: "pi_deposit",
        amountCents: 50_000,
        capturedAmountCents: Number(saved.capturedAmountCents),
        currency: "EUR",
        status: String(saved.status),
        failureReason: null
      } as never;
    }
  });

  const result = await service.captureDeposit({
    tenantId: "tenant-1",
    depositId: "deposit-1",
    amountToCaptureCents: 20_000,
    userId: "user-1"
  });

  assert.equal(result.status, "PARTIALLY_CAPTURED");
  assert.equal(result.capturedAmountCents, 20_000);
  assert.ok(updateData?.capturedAt instanceof Date);
});

test("partially captured deposits cannot be captured again", async () => {
  setStripeTestEnv();
  const service = new RentalPaymentService(new FakeAuditRepo(), fakeStripeBase(), {
    async findDepositById() {
      return {
        id: "deposit-1",
        tenantId: "tenant-1",
        bookingId: "booking-1",
        rentalCustomerId: "customer-1",
        vehicleId: "vehicle-1",
        paymentMethodId: "rpm-active",
        stripePaymentIntentId: "pi_deposit",
        amountCents: 50_000,
        capturedAmountCents: 20_000,
        currency: "EUR",
        status: "PARTIALLY_CAPTURED",
        failureReason: null
      } as never;
    }
  });

  await assert.rejects(
    () => service.captureDeposit({ tenantId: "tenant-1", depositId: "deposit-1", userId: "user-1" }),
    (error) => error instanceof AppError && error.code === "RENTAL_DEPOSIT_NOT_CAPTURABLE"
  );
});

test("rental webhook duplicate is not processed twice", async () => {
  setStripeTestEnv();
  let processed = false;
  let updateCalls = 0;
  const service = new RentalPaymentService(new FakeAuditRepo(), fakeStripeBase(), {
    async createRentalPaymentEvent(event) {
      return { eventId: event.id, status: processed ? "PROCESSED" : "RECEIVED", processedAt: processed ? new Date() : null };
    },
    async updateRentalPaymentEvent() {
      updateCalls += 1;
      processed = true;
    }
  });

  const event = {
    id: "evt_rental_duplicate",
    type: "payment_method.attached",
    data: { object: { id: "pm_123", metadata: { domain: "rental_payments", tenantId: "tenant-1" } } }
  } as Stripe.Event;

  const first = await service.handleStripeEvent(event);
  const second = await service.handleStripeEvent(event);

  assert.equal(first.received, true);
  assert.equal(second.duplicate, true);
  assert.equal(updateCalls, 1);
});
