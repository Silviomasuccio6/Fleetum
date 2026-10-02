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

const paymentIntentForRequest = (
  params: Stripe.PaymentIntentCreateParams,
  response: Partial<Stripe.PaymentIntent>
): Stripe.PaymentIntent => ({
  id: "pi_123",
  object: "payment_intent",
  amount: params.amount,
  amount_received: 0,
  currency: params.currency,
  customer: params.customer,
  payment_method: params.payment_method,
  metadata: params.metadata ?? {},
  status: "requires_capture",
  ...response
}) as Stripe.PaymentIntent;

// Keep provider state separate from repository snapshots: retrieve returns the
// current PaymentIntent, including the identity and money fields used to bind it.
const fakeStripeBase = (overrides: Partial<Record<"paymentIntents" | "checkout" | "customers" | "setupIntents" | "paymentMethods", unknown>> = {}) => {
  const intents = new Map<string, Stripe.PaymentIntent>();
  const intentOverrides = overrides.paymentIntents as Partial<Stripe["paymentIntents"]> | undefined;
  return {
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
    ...overrides,
    paymentIntents: {
      create: async (params: Stripe.PaymentIntentCreateParams, options?: Stripe.RequestOptions) => {
        const response = intentOverrides?.create
          ? await intentOverrides.create(params, options)
          : { id: "pi_123", status: "requires_capture", amount_received: 0 } as const;
        const intent = paymentIntentForRequest(params, response);
        intents.set(intent.id, structuredClone(intent));
        return structuredClone(intent);
      },
      retrieve: async (id: string) => {
        if (intentOverrides?.retrieve) return intentOverrides.retrieve(id);
        const intent = intents.get(id);
        assert.ok(intent, `Synthetic PaymentIntent ${id} must exist before retrieval`);
        return structuredClone(intent);
      },
      capture: intentOverrides?.capture ?? (async (id: string, params: Stripe.PaymentIntentCaptureParams) => {
        const intent = intents.get(id);
        assert.ok(intent);
        const captured = { ...intent, status: "succeeded", amount_received: params.amount_to_capture ?? intent.amount } as Stripe.PaymentIntent;
        intents.set(id, captured);
        return structuredClone(captured);
      }),
      cancel: intentOverrides?.cancel ?? (async (id: string) => {
        const intent = intents.get(id);
        assert.ok(intent);
        const canceled = { ...intent, status: "canceled" } as Stripe.PaymentIntent;
        intents.set(id, canceled);
        return structuredClone(canceled);
      })
    }
  } as unknown as Stripe;
};

// Serialize compare/update and audit as one fake transaction. An audit failure
// leaves the row unchanged; copied read snapshots reject later stale writes.
const paymentRowLocks = new WeakMap<object, Promise<void>>();
const compareAndUpdatePayment = (
  current: Record<string, unknown>, expected: object, data: object,
  auditRepository: AuditLogRepository,
  audit?: Parameters<AuditLogRepository["create"]>[0]
) => {
  const prior = paymentRowLocks.get(current) ?? Promise.resolve();
  const transaction = prior.then(async () => {
    const snapshot = expected as Record<string, unknown>;
    for (const field of ["id", "tenantId", "bookingId", "rentalCustomerId", "paymentMethodId", "stripePaymentIntentId", "status", "amountCents", "capturedAmountCents", "adminFeeCents", "totalAmountCents", "currency", "updatedAt"]) {
      if (current[field] instanceof Date && snapshot[field] instanceof Date) {
        if ((current[field] as Date).getTime() !== (snapshot[field] as Date).getTime()) return null;
      } else if (current[field] !== snapshot[field]) return null;
    }
    if (audit) await auditRepository.create(audit);
    Object.assign(current, data);
    return { ...current } as never;
  });
  paymentRowLocks.set(current, transaction.then(() => undefined, () => undefined));
  return transaction;
};

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

test("concurrent deposit requests reuse one atomic claim and one Stripe attempt key", async () => {
  setStripeTestEnv();
  const deposit = {
    id: "deposit-shared",
    createdAt: new Date(),
    tenantId: "tenant-1",
    bookingId: "booking-1",
    rentalCustomerId: "customer-1",
    vehicleId: "vehicle-1",
    paymentMethodId: "rpm-active",
    stripePaymentIntentId: null,
    amountCents: 50_000,
    capturedAmountCents: 0,
    currency: "EUR",
    status: "AUTHORIZING",
    failureReason: null
  };
  let claimed = false;
  const stripeAttemptKeys: string[] = [];
  const stripe = fakeStripeBase({
    paymentIntents: {
      create: async (_params: unknown, options?: { idempotencyKey?: string }) => {
        stripeAttemptKeys.push(String(options?.idempotencyKey));
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { id: "pi_shared", status: "requires_capture", amount_received: 0 };
      }
    }
  });
  const auditRepository = new FakeAuditRepo();
  const service = new RentalPaymentService(auditRepository, stripe, {
    async findBookingForPayment() { return booking; },
    async findPaymentMethodById() { return activePaymentMethod as never; },
    async claimActiveDeposit() {
      const created = !claimed;
      claimed = true;
      return { deposit: { ...deposit } as never, created };
    },
    async findDepositById(tenantId, depositId) {
      return tenantId === deposit.tenantId && depositId === deposit.id ? { ...deposit } as never : null;
    },
    async findHistoricalPaymentMethodById(tenantId, paymentMethodId) {
      return tenantId === activePaymentMethod.tenantId && paymentMethodId === activePaymentMethod.id ? { ...activePaymentMethod } as never : null;
    },
    async compareAndUpdateDeposit(expected, data, audit) {
      return compareAndUpdatePayment(deposit, expected, data, auditRepository, audit);
    },
    async updateDeposit(_tenantId, _depositId, data) {
      Object.assign(deposit, data);
      return { ...deposit } as never;
    }
  });

  const [first, second] = await Promise.all([
    service.createDeposit({ tenantId: "tenant-1", bookingId: "booking-1", paymentMethodId: "rpm-active", amountCents: 50_000, userId: "user-1" }),
    service.createDeposit({ tenantId: "tenant-1", bookingId: "booking-1", paymentMethodId: "rpm-active", amountCents: 50_000, userId: "user-1" })
  ]);

  assert.equal(first.id, "deposit-shared");
  assert.equal(second.id, "deposit-shared");
  assert.equal(new Set(stripeAttemptKeys).size, 1);
  assert.equal(stripeAttemptKeys[0], "rental-deposit:tenant-1:deposit-shared");
});

test("an active deposit with a different request payload returns 409 without another Stripe call", async () => {
  setStripeTestEnv();
  let stripeCalls = 0;
  const stripe = fakeStripeBase({
    paymentIntents: {
      create: async () => {
        stripeCalls += 1;
        return { id: "pi_unexpected", status: "requires_capture", amount_received: 0 };
      }
    }
  });
  const auditRepository = new FakeAuditRepo();
  const service = new RentalPaymentService(auditRepository, stripe, {
    async findBookingForPayment() { return booking; },
    async findPaymentMethodById() { return activePaymentMethod as never; },
    async claimActiveDeposit() {
      return {
        created: false,
        deposit: {
          id: "deposit-existing",
          tenantId: "tenant-1",
          bookingId: "booking-1",
          rentalCustomerId: "customer-1",
          vehicleId: "vehicle-1",
          paymentMethodId: "rpm-active",
          stripePaymentIntentId: "pi_existing",
          amountCents: 60_000,
          capturedAmountCents: 0,
          currency: "EUR",
          status: "AUTHORIZED",
          failureReason: null
        } as never
      };
    }
  });

  await assert.rejects(
    () => service.createDeposit({ tenantId: "tenant-1", bookingId: "booking-1", paymentMethodId: "rpm-active", amountCents: 50_000, userId: "user-1" }),
    (error) => error instanceof AppError && error.statusCode === 409 && error.code === "RENTAL_DEPOSIT_ALREADY_ACTIVE"
  );
  assert.equal(stripeCalls, 0);
});

test("an indeterminate Stripe error keeps the claim retryable with the same attempt key", async () => {
  setStripeTestEnv();
  const deposit = {
    id: "deposit-retry",
    createdAt: new Date(),
    tenantId: "tenant-1",
    bookingId: "booking-1",
    rentalCustomerId: "customer-1",
    vehicleId: "vehicle-1",
    paymentMethodId: "rpm-active",
    stripePaymentIntentId: null,
    amountCents: 50_000,
    capturedAmountCents: 0,
    currency: "EUR",
    status: "AUTHORIZING",
    failureReason: null
  };
  let callCount = 0;
  const stripeAttemptKeys: string[] = [];
  const statusUpdates: string[] = [];
  const stripe = fakeStripeBase({
    paymentIntents: {
      create: async (_params: unknown, options?: { idempotencyKey?: string }) => {
        callCount += 1;
        stripeAttemptKeys.push(String(options?.idempotencyKey));
        if (callCount === 1) {
          const timeout = new Error("Connection timed out") as Error & { type?: string; code?: string };
          timeout.type = "StripeConnectionError";
          timeout.code = "ETIMEDOUT";
          throw timeout;
        }
        return { id: "pi_retry", status: "requires_capture", amount_received: 0 };
      }
    }
  });
  const auditRepository = new FakeAuditRepo();
  const service = new RentalPaymentService(auditRepository, stripe, {
    async findBookingForPayment() { return booking; },
    async findPaymentMethodById() { return activePaymentMethod as never; },
    async claimActiveDeposit() { return { deposit: { ...deposit } as never, created: callCount === 0 }; },
    async findDepositById(tenantId, depositId) {
      return tenantId === deposit.tenantId && depositId === deposit.id ? { ...deposit } as never : null;
    },
    async findHistoricalPaymentMethodById(tenantId, paymentMethodId) {
      return tenantId === activePaymentMethod.tenantId && paymentMethodId === activePaymentMethod.id ? { ...activePaymentMethod } as never : null;
    },
    async compareAndUpdateDeposit(expected, data, audit) {
      const updated = await compareAndUpdatePayment(deposit, expected, data, auditRepository, audit);
      if (updated && typeof data.status === "string") statusUpdates.push(data.status);
      return updated;
    },
    async updateDeposit(_tenantId, _depositId, data) {
      if (typeof data.status === "string") statusUpdates.push(data.status);
      Object.assign(deposit, data);
      return { ...deposit } as never;
    }
  });

  const request = { tenantId: "tenant-1", bookingId: "booking-1", paymentMethodId: "rpm-active", amountCents: 50_000, userId: "user-1" };
  await assert.rejects(() => service.createDeposit(request), /Connection timed out/);
  assert.equal(deposit.status, "AUTHORIZING");
  assert.ok(!statusUpdates.includes("FAILED"));

  const retried = await service.createDeposit(request);
  assert.equal(retried.status, "AUTHORIZED");
  assert.deepEqual(stripeAttemptKeys, [
    "rental-deposit:tenant-1:deposit-retry",
    "rental-deposit:tenant-1:deposit-retry"
  ]);
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
  const extraCharge = {
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
  };
  const stripe = fakeStripeBase({
    paymentIntents: {
      create: async () => {
        const error = new Error("Authentication required") as Error & { code?: string; decline_code?: string };
        error.code = "authentication_required";
        throw error;
      }
    }
  });
  const auditRepository = new FakeAuditRepo();
  const service = new RentalPaymentService(auditRepository, stripe, {
    async findExtraChargeById(tenantId, extraChargeId) {
      return tenantId === extraCharge.tenantId && extraChargeId === extraCharge.id ? { ...extraCharge } as never : null;
    },
    async findPaymentMethodById() { return activePaymentMethod as never; },
    async compareAndUpdateExtraCharge(expected, data, audit) {
      const updated = await compareAndUpdatePayment(extraCharge, expected, data, auditRepository, audit);
      if (updated && typeof data.status === "string") finalStatus = data.status;
      return updated;
    },
    async updateExtraCharge(_tenantId, _extraChargeId, data) {
      if (typeof data.status === "string") finalStatus = data.status;
      Object.assign(extraCharge, data);
      return { ...extraCharge } as never;
    }
  });

  const result = await service.chargeExtraCharge({ tenantId: "tenant-1", extraChargeId: "extra-1", userId: "user-1" });
  assert.equal(result.status, "REQUIRES_ACTION");
  assert.equal(finalStatus, "REQUIRES_ACTION");
});

test("partial deposit capture is final and stores captured timestamp", async () => {
  setStripeTestEnv();
  let updateData: Record<string, unknown> | null = null;
  const deposit = {
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
  };
  let currentIntent = paymentIntentForRequest({
    amount: 50_000, currency: "eur", customer: "cus_rental", payment_method: "pm_active",
    metadata: { domain: "rental_payments", purpose: "rental_deposit", tenantId: "tenant-1",
      bookingId: "booking-1", rentalCustomerId: "customer-1", rentalDepositId: "deposit-1", paymentMethodId: "rpm-active" }
  }, { id: "pi_deposit", status: "requires_capture", amount_received: 0 });
  const stripe = fakeStripeBase({
    paymentIntents: {
      retrieve: async (id: string) => {
        assert.equal(id, currentIntent.id);
        return structuredClone(currentIntent);
      },
      capture: async (id: string, params: Stripe.PaymentIntentCaptureParams) => {
        assert.equal(id, currentIntent.id);
        currentIntent = { ...currentIntent, status: "succeeded", amount_received: params.amount_to_capture ?? currentIntent.amount };
        return structuredClone(currentIntent);
      }
    }
  });
  const auditRepository = new FakeAuditRepo();
  const service = new RentalPaymentService(auditRepository, stripe, {
    async findDepositById(tenantId, depositId) {
      return tenantId === deposit.tenantId && depositId === deposit.id ? { ...deposit } as never : null;
    },
    async findHistoricalPaymentMethodById(tenantId, paymentMethodId) {
      return tenantId === activePaymentMethod.tenantId && paymentMethodId === activePaymentMethod.id ? { ...activePaymentMethod } as never : null;
    },
    async compareAndUpdateDeposit(expected, data, audit) {
      const updated = await compareAndUpdatePayment(deposit, expected, data, auditRepository, audit);
      if (updated) updateData = data as Record<string, unknown>;
      return updated;
    },
    async updateDeposit(_tenantId, _depositId, data) {
      updateData = data as Record<string, unknown>;
      Object.assign(deposit, data);
      return { ...deposit } as never;
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
