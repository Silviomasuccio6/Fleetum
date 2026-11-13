import assert from "node:assert/strict";
import net from "node:net";
import { after, before, test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import type Stripe from "stripe";
import type { RentalPaymentService as ServiceType } from "../src/application/services/rental-payment-service.js";
import type { AuditLogRepository, AuditLogRow } from "../src/domain/repositories/audit-log-repository.js";

// All records and provider replies are synthetic. Import the service only after
// dotenv and network guards are in place; every persistence dependency is fake.
type Deps = NonNullable<ConstructorParameters<typeof ServiceType>[2]>;
type Extra = NonNullable<Awaited<ReturnType<NonNullable<Deps["findExtraChargeById"]>>>>;
type Deposit = NonNullable<Awaited<ReturnType<NonNullable<Deps["findDepositById"]>>>>;
type PaymentMethod = NonNullable<Awaited<ReturnType<NonNullable<Deps["findPaymentMethodById"]>>>>;
const clone = <T>(value: T): T => structuredClone(value);
const forbidden = (name: string) => async (): Promise<never> => {
  throw new Error(`UNEXPECTED_PAYMENT_TEST_DEPENDENCY:${name}`);
};

const dependencyNames: Array<keyof Deps> = [
  "findBookingForPayment", "findPaymentProfile", "createPaymentProfile",
  "createPendingPaymentMethod", "updatePaymentMethod", "findPaymentMethodById",
  "findPaymentMethodByStripeId", "findPaymentMethodBySetupIntentId", "listPaymentMethods",
  "listDepositsByBooking", "listExtraChargesByBooking", "findActiveDeposit", "createDeposit",
  "claimActiveDeposit", "updateDeposit", "findDepositById", "findDepositByStripePaymentIntentId",
  "createExtraCharge", "updateExtraCharge", "findExtraChargeById",
  "findExtraChargeByStripePaymentIntentId", "createRentalPaymentEvent", "updateRentalPaymentEvent",
  "compareAndUpdateExtraCharge", "compareAndUpdateDeposit", "findHistoricalPaymentMethodById"
];

let RentalPaymentService: typeof ServiceType;
let AppError: typeof import("../src/shared/errors/app-error.js").AppError;
let blockedNetworkAttempts = 0;
const originalConnect = net.Socket.prototype.connect;
const originalFetch = globalThis.fetch;

before(async () => {
  assert.equal(process.env.NODE_ENV, "test", "Run only with the clean test environment");
  assert.equal(process.env.DOTENV_CONFIG_PATH, "/dev/null", "Real dotenv files must not be loaded");
  process.env.DATABASE_URL = "postgresql://invalid:invalid@127.0.0.1:1/fleetum_payment_memory_only?schema=public";
  net.Socket.prototype.connect = function () {
    blockedNetworkAttempts += 1;
    throw new Error("NETWORK_FORBIDDEN_IN_PAYMENT_UNIT_TEST");
  } as typeof net.Socket.prototype.connect;
  globalThis.fetch = async () => {
    blockedNetworkAttempts += 1;
    throw new Error("NETWORK_FORBIDDEN_IN_PAYMENT_UNIT_TEST");
  };
  ({ RentalPaymentService } = await import("../src/application/services/rental-payment-service.js"));
  ({ AppError } = await import("../src/shared/errors/app-error.js"));
  const { env } = await import("../src/shared/config/env.js");
  (env as unknown as Record<string, unknown>).STRIPE_SECRET_KEY = "sk_test_in_memory_payment_ordering_only";
});

after(() => {
  net.Socket.prototype.connect = originalConnect;
  globalThis.fetch = originalFetch;
  assert.equal(blockedNetworkAttempts, 0, "No provider or database connection may be attempted");
});

class FakeAudit implements AuditLogRepository {
  rows: Array<Parameters<AuditLogRepository["create"]>[0]> = [];
  failuresRemaining = 0;
  async countByTenant(): Promise<number> { return this.rows.length; }
  async listByTenant(): Promise<AuditLogRow[]> { return []; }
  async listLatestByTenant(): Promise<AuditLogRow[]> { return []; }
  async getLatestByAction(): Promise<AuditLogRow | null> { return null; }
  async create(input: Parameters<AuditLogRepository["create"]>[0]): Promise<void> {
    this.appendAtomically(input);
  }
  appendAtomically(input: Parameters<AuditLogRepository["create"]>[0]): void {
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new Error("Synthetic transactional audit failure");
    }
    this.rows.push(clone(input));
  }
}

const activePaymentMethod = {
  id: "rpm-ordering", tenantId: "tenant-ordering", paymentProfileId: "profile-ordering",
  rentalCustomerId: "customer-ordering", bookingId: "booking-ordering",
  stripeCustomerId: "cus_ordering", stripePaymentMethodId: "pm_ordering",
  stripeSetupIntentId: "seti_ordering", status: "ACTIVE", cardBrand: "visa",
  cardLast4: "4242", cardExpMonth: 12, cardExpYear: 2030, mandateAccepted: true,
  mandateAcceptedAt: new Date(0), termsVersion: "synthetic-ordering-v1", deletedAt: null
} as const;

type RecordKind = "extra" | "deposit";
function metadataFor(kind: RecordKind) {
  return {
    domain: "rental_payments", tenantId: "tenant-ordering", bookingId: "booking-ordering",
    rentalCustomerId: "customer-ordering", paymentMethodId: "rpm-ordering",
    purpose: kind === "extra" ? "rental_extra_charge" : "rental_deposit",
    ...(kind === "extra" ? { rentalExtraChargeId: "extra-ordering" } : { rentalDepositId: "deposit-ordering" })
  };
}

function intentFor(kind: RecordKind, status = "succeeded", amountReceived?: number) {
  return {
    id: kind === "extra" ? "pi_extra_ordering" : "pi_deposit_ordering", object: "payment_intent",
    amount: kind === "extra" ? 1200 : 50_000,
    amount_received: amountReceived ?? (kind === "extra" ? 1200 : 50_000),
    amount_capturable: status === "requires_capture" ? 50_000 : 0,
    currency: "eur", customer: "cus_ordering", payment_method: "pm_ordering",
    status, metadata: metadataFor(kind), last_payment_error: null
  };
}

function eventFor(kind: RecordKind, type: string, id: string, created = 100): Stripe.Event {
  const status = type === "payment_intent.succeeded" ? "succeeded"
    : type === "payment_intent.canceled" ? "canceled"
      : type === "payment_intent.amount_capturable_updated" ? "requires_capture" : "requires_payment_method";
  return {
    id, type, created, object: "event", livemode: false, pending_webhooks: 1,
    data: { object: {
      ...intentFor(kind, status, status === "succeeded" ? undefined : 0),
      last_payment_error: type === "payment_intent.payment_failed"
        ? { code: "card_declined", message: "Synthetic declined payment" } : null
    } }
  } as unknown as Stripe.Event;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function makeFixture() {
  const paymentMethod: PaymentMethod = clone(activePaymentMethod);
  const extra: Extra = {
    id: "extra-ordering", tenantId: "tenant-ordering", bookingId: "booking-ordering",
    rentalCustomerId: "customer-ordering", vehicleId: "vehicle-ordering", paymentMethodId: "rpm-ordering",
    stripePaymentIntentId: "pi_extra_ordering", type: "FINE", description: "Synthetic ordering regression",
    amountCents: 1000, adminFeeCents: 200, totalAmountCents: 1200, currency: "EUR",
    status: "PAYMENT_PROCESSING", failureReason: null
  };
  const deposit: Deposit = {
    id: "deposit-ordering", tenantId: "tenant-ordering", bookingId: "booking-ordering",
    rentalCustomerId: "customer-ordering", vehicleId: "vehicle-ordering", paymentMethodId: "rpm-ordering",
    stripePaymentIntentId: "pi_deposit_ordering", amountCents: 50_000, capturedAmountCents: 0,
    currency: "EUR", status: "AUTHORIZED", failureReason: null
  };
  const intents = { extra: intentFor("extra"), deposit: intentFor("deposit") };
  const charge = {
    id: "ch_extra_ordering", object: "charge", payment_intent: "pi_extra_ordering",
    amount: 1200, amount_refunded: 0, currency: "eur", customer: "cus_ordering",
    disputed: false, refunded: false, metadata: metadataFor("extra")
  };
  const dispute = {
    id: "dp_extra_ordering", object: "dispute", charge: charge.id, amount: 1200,
    currency: "eur", status: "needs_response", metadata: metadataFor("extra")
  };
  const audit = new FakeAudit();
  const writes: Array<{ kind: RecordKind; data: Record<string, unknown> }> = [];
  const events = new Map<string, { eventId: string; status: string; processedAt: Date | null }>();
  const retrievals: string[] = [];
  const creates: Array<{ params: unknown; idempotencyKey: unknown }> = [];
  const deps: Deps = {
    ...Object.fromEntries(dependencyNames.map((name) => [name, forbidden(name)])),
    async findPaymentMethodById(tenantId, paymentMethodId) {
      return tenantId === paymentMethod.tenantId && paymentMethodId === paymentMethod.id && !paymentMethod.deletedAt
        ? clone(paymentMethod) : null;
    },
    async findHistoricalPaymentMethodById(tenantId: string, paymentMethodId: string) {
      return tenantId === paymentMethod.tenantId && paymentMethodId === paymentMethod.id
        ? clone(paymentMethod) : null;
    },
    async findExtraChargeById(tenantId, extraChargeId) {
      return tenantId === extra.tenantId && extraChargeId === extra.id ? clone(extra) : null;
    },
    async findDepositById(tenantId, depositId) {
      return tenantId === deposit.tenantId && depositId === deposit.id ? clone(deposit) : null;
    },
    async findExtraChargeByStripePaymentIntentId(paymentIntentId) {
      return extra.stripePaymentIntentId === paymentIntentId ? clone(extra) : null;
    },
    async findDepositByStripePaymentIntentId(paymentIntentId) {
      return deposit.stripePaymentIntentId === paymentIntentId ? clone(deposit) : null;
    },
    async updateExtraCharge(tenantId, extraChargeId, data) {
      assert.equal(tenantId, extra.tenantId);
      assert.equal(extraChargeId, extra.id);
      writes.push({ kind: "extra", data: clone(data) as Record<string, unknown> });
      Object.assign(extra, data);
      return clone(extra);
    },
    async updateDeposit(tenantId, depositId, data) {
      assert.equal(tenantId, deposit.tenantId);
      assert.equal(depositId, deposit.id);
      writes.push({ kind: "deposit", data: clone(data) as Record<string, unknown> });
      Object.assign(deposit, data);
      return clone(deposit);
    },
    async compareAndUpdateExtraCharge(expected: Extra, data: Parameters<NonNullable<Deps["updateExtraCharge"]>>[2], auditInput?: Parameters<AuditLogRepository["create"]>[0]) {
      if (!isDeepStrictEqual(expected, extra)) return null;
      // Audit failure happens before any mutation, and compare/audit/write run
      // synchronously before yielding, modelling one committed transaction.
      if (auditInput) audit.appendAtomically(auditInput);
      writes.push({ kind: "extra", data: clone(data) as Record<string, unknown> });
      Object.assign(extra, data);
      return clone(extra);
    },
    async compareAndUpdateDeposit(expected: Deposit, data: Parameters<NonNullable<Deps["updateDeposit"]>>[2], auditInput?: Parameters<AuditLogRepository["create"]>[0]) {
      if (!isDeepStrictEqual(expected, deposit)) return null;
      if (auditInput) audit.appendAtomically(auditInput);
      writes.push({ kind: "deposit", data: clone(data) as Record<string, unknown> });
      Object.assign(deposit, data);
      return clone(deposit);
    },
    async createRentalPaymentEvent(event, _tenantId) {
      if (!events.has(event.id)) events.set(event.id, { eventId: event.id, status: "RECEIVED", processedAt: null });
      return clone(events.get(event.id)!);
    },
    async updateRentalPaymentEvent(eventId, data) {
      assert.ok(events.has(eventId));
      Object.assign(events.get(eventId)!, data);
    }
  } as Deps;
  const stripe = {
    paymentIntents: {
      async retrieve(id: string) {
        retrievals.push(id);
        const kind = id === intents.deposit.id ? "deposit" : "extra";
        return clone(intents[kind]);
      },
      async create(params: unknown, options?: { idempotencyKey?: string }) {
        creates.push({ params: clone(params), idempotencyKey: options?.idempotencyKey });
        return clone(intents.extra);
      },
      capture: forbidden("stripe.paymentIntents.capture"), cancel: forbidden("stripe.paymentIntents.cancel")
    },
    customers: { create: forbidden("stripe.customers.create") },
    checkout: { sessions: { create: forbidden("stripe.checkout.sessions.create") } },
    setupIntents: { retrieve: forbidden("stripe.setupIntents.retrieve") },
    paymentMethods: { retrieve: forbidden("stripe.paymentMethods.retrieve") },
    charges: { async retrieve(id: string) {
      assert.equal(id, charge.id);
      return clone(charge);
    } },
    disputes: { async retrieve(id: string) {
      assert.equal(id, dispute.id);
      return clone(dispute);
    } }
  };
  const email = new Proxy({}, { get(_target, key) { return forbidden(`emailQueue.${String(key)}`); } });
  const service = () => new RentalPaymentService(audit, stripe as unknown as Stripe, deps, email as never);
  return { extra, deposit, paymentMethod, intents, charge, dispute, audit, writes, events, retrievals, creates, deps, stripe, service };
}

for (const lateType of ["payment_intent.payment_failed", "payment_intent.canceled"] as const) {
  test(`INT-01: PAID extra remains paid after older ${lateType} with a distinct event ID`, async () => {
    const fixture = makeFixture();
    const service = fixture.service();
    await service.handleStripeEvent(eventFor("extra", "payment_intent.succeeded", "evt_extra_success", 200));
    assert.equal(fixture.extra.status, "PAID");
    const before = clone(fixture.extra);
    await service.handleStripeEvent(eventFor("extra", lateType, "evt_extra_old", 100));
    assert.deepEqual(fixture.extra, before);
    assert.equal(fixture.events.get("evt_extra_old")?.status, "PROCESSED");
    const duplicate = await service.handleStripeEvent(eventFor("extra", lateType, "evt_extra_old", 100));
    assert.equal(duplicate.duplicate, true);
  });
}

for (const capturedStatus of ["CAPTURED", "PARTIALLY_CAPTURED"] as const) {
  for (const lateType of ["payment_intent.payment_failed", "payment_intent.canceled", "payment_intent.amount_capturable_updated"] as const) {
    test(`INT-01: ${capturedStatus} deposit preserves money after older ${lateType}`, async () => {
      const fixture = makeFixture();
      fixture.deposit.status = capturedStatus;
      fixture.deposit.capturedAmountCents = capturedStatus === "CAPTURED" ? 50_000 : 20_000;
      fixture.intents.deposit.amount_received = fixture.deposit.capturedAmountCents;
      const before = clone(fixture.deposit);
      await fixture.service().handleStripeEvent(eventFor("deposit", lateType, `evt_${capturedStatus}_${lateType}`));
      assert.deepEqual(fixture.deposit, before);
    });
  }
}

test("INT-01: authoritative partial capture records PARTIALLY_CAPTURED rather than full capture", async () => {
  const fixture = makeFixture();
  fixture.intents.deposit.amount_received = 20_000;
  const event = eventFor("deposit", "payment_intent.succeeded", "evt_partial_capture", 200);
  (event.data.object as unknown as Record<string, unknown>).amount_received = 20_000;
  await fixture.service().handleStripeEvent(event);
  assert.equal(fixture.deposit.status, "PARTIALLY_CAPTURED");
  assert.equal(fixture.deposit.capturedAmountCents, 20_000);
});

for (const protectedStatus of ["REFUNDED", "DISPUTED"] as const) {
  for (const type of ["payment_intent.succeeded", "payment_intent.payment_failed", "payment_intent.canceled"] as const) {
    test(`INT-01: ${protectedStatus} is preserved after ${type}`, async () => {
      const fixture = makeFixture();
      fixture.extra.status = protectedStatus;
      const before = clone(fixture.extra);
      await fixture.service().handleStripeEvent(eventFor("extra", type, `evt_${protectedStatus}_${type}`));
      assert.deepEqual(fixture.extra, before);
    });
  }
}

test("INT-01: stale failed snapshot reconciles to the provider's current succeeded intent", async () => {
  const fixture = makeFixture();
  await fixture.service().handleStripeEvent(eventFor("extra", "payment_intent.payment_failed", "evt_stale_failed"));
  assert.equal(fixture.extra.status, "PAID");
  // Identity preflight and the fresh provider read tied to a database snapshot
  // can use separate retrieves; correctness does not require exactly one call.
  assert.ok(fixture.retrievals.length >= 1 && fixture.retrievals.length <= 6);
  assert.ok(fixture.retrievals.every((id) => id === "pi_extra_ordering"));
});

const mismatchCases: Array<{ name: string; mutate: (fixture: ReturnType<typeof makeFixture>, object: Record<string, unknown>) => void }> = [
  { name: "different bound PaymentIntent", mutate(fixture, object) {
    object.id = "pi_unbound";
    fixture.intents.extra.id = "pi_unbound";
  } },
  { name: "different tenant via Stripe-ID fallback", mutate(fixture, object) {
    const metadata = object.metadata as Record<string, string>;
    metadata.tenantId = "tenant-other";
    delete metadata.rentalExtraChargeId;
    (fixture.intents.extra.metadata as Record<string, string>).tenantId = "tenant-other";
    delete (fixture.intents.extra.metadata as Record<string, string>).rentalExtraChargeId;
  } },
  { name: "different booking", mutate(fixture, object) {
    (object.metadata as Record<string, string>).bookingId = "booking-other";
    fixture.intents.extra.metadata.bookingId = "booking-other";
  } },
  { name: "different rental customer", mutate(fixture, object) {
    (object.metadata as Record<string, string>).rentalCustomerId = "customer-other";
    fixture.intents.extra.metadata.rentalCustomerId = "customer-other";
  } },
  { name: "different amount", mutate(fixture, object) {
    object.amount = 9999;
    object.amount_received = 9999;
    fixture.intents.extra.amount = 9999;
    fixture.intents.extra.amount_received = 9999;
  } },
  { name: "different currency", mutate(fixture, object) {
    object.currency = "usd";
    fixture.intents.extra.currency = "usd";
  } },
  { name: "different Stripe customer", mutate(fixture, object) {
    object.customer = "cus_other";
    fixture.intents.extra.customer = "cus_other";
  } }
];

for (const mismatch of mismatchCases) {
  test(`INT-01: ${mismatch.name} is rejected without mutating the linked extra`, async () => {
    const fixture = makeFixture();
    const event = eventFor("extra", "payment_intent.succeeded", `evt_mismatch_${mismatch.name.replaceAll(" ", "_")}`);
    mismatch.mutate(fixture, event.data.object as unknown as Record<string, unknown>);
    const before = clone(fixture.extra);
    await assert.rejects(() => fixture.service().handleStripeEvent(event),
      (error) => error instanceof AppError && error.statusCode === 409);
    assert.deepEqual(fixture.extra, before);
    assert.equal(fixture.writes.length, 0);
  });
}

test("INT-01: unavailable authoritative retrieval leaves the event retryable and record untouched", async () => {
  const fixture = makeFixture();
  fixture.stripe.paymentIntents.retrieve = async () => { throw new Error("Synthetic provider unavailable"); };
  const before = clone(fixture.extra);
  await assert.rejects(() => fixture.service().handleStripeEvent(eventFor("extra", "payment_intent.succeeded", "evt_retryable")), /Synthetic provider unavailable/);
  assert.deepEqual(fixture.extra, before);
  assert.notEqual(fixture.events.get("evt_retryable")?.status, "PROCESSED");
});

test("INT-02: cancellation during PAYMENT_PROCESSING returns 409 and cannot promise cancellation", async () => {
  const fixture = makeFixture();
  fixture.extra.status = "APPROVED";
  fixture.extra.stripePaymentIntentId = null;
  const providerStarted = deferred<void>();
  const providerResponse = deferred<ReturnType<typeof intentFor>>();
  let createCalls = 0;
  fixture.stripe.paymentIntents.create = async () => {
    createCalls += 1;
    providerStarted.resolve();
    return providerResponse.promise;
  };
  const service = fixture.service();
  const charging = service.chargeExtraCharge({ tenantId: fixture.extra.tenantId, extraChargeId: fixture.extra.id, userId: "user-ordering" });
  await Promise.race([providerStarted.promise, charging.then(() => { throw new Error("Provider was not reached"); })]);
  try {
    assert.equal(fixture.extra.status, "PAYMENT_PROCESSING");
    await assert.rejects(() => service.cancelExtraCharge({ tenantId: fixture.extra.tenantId, extraChargeId: fixture.extra.id, userId: "user-ordering" }),
      (error) => error instanceof AppError && error.statusCode === 409);
    assert.equal(fixture.extra.status, "PAYMENT_PROCESSING");
    assert.equal(fixture.audit.rows.filter((row) => row.action === "RENTAL_EXTRA_CHARGE_CANCELED").length, 0);
  } finally {
    providerResponse.resolve(intentFor("extra"));
    await charging;
  }
  assert.equal(fixture.extra.status, "PAID");
  assert.equal(createCalls, 1);
});

test("INT-02: cancellation that wins before charge claim prevents any provider request", async () => {
  const fixture = makeFixture();
  fixture.extra.status = "APPROVED";
  fixture.extra.stripePaymentIntentId = null;
  const methodLookupStarted = deferred<void>();
  const allowMethodLookup = deferred<void>();
  fixture.deps.findPaymentMethodById = async () => {
    methodLookupStarted.resolve();
    await allowMethodLookup.promise;
    return clone(activePaymentMethod);
  };
  const service = fixture.service();
  const charging = service.chargeExtraCharge({ tenantId: fixture.extra.tenantId, extraChargeId: fixture.extra.id, userId: "user-ordering" });
  await Promise.race([methodLookupStarted.promise, charging.then(() => { throw new Error("Payment method was not reached"); })]);
  const canceled = await service.cancelExtraCharge({ tenantId: fixture.extra.tenantId, extraChargeId: fixture.extra.id, userId: "user-ordering" });
  assert.equal(canceled.status, "CANCELED");
  allowMethodLookup.resolve();
  await assert.rejects(() => charging, (error) => error instanceof AppError && error.statusCode === 409);
  assert.equal(fixture.extra.status, "CANCELED");
  assert.equal(fixture.creates.length, 0);
});

for (const errorType of ["StripeConnectionError", "StripeAPIError", "StripeRateLimitError"] as const) {
  test(`INT-02: indeterminate ${errorType} keeps PAYMENT_PROCESSING and does not declare failure`, async () => {
    const fixture = makeFixture();
    fixture.extra.status = "APPROVED";
    fixture.extra.stripePaymentIntentId = null;
    fixture.stripe.paymentIntents.create = async () => {
      const error = new Error("Synthetic indeterminate provider response") as Error & { type: string; code: string };
      error.type = errorType;
      error.code = errorType === "StripeConnectionError" ? "ETIMEDOUT" : "synthetic_error";
      throw error;
    };
    await assert.rejects(() => fixture.service().chargeExtraCharge({ tenantId: fixture.extra.tenantId, extraChargeId: fixture.extra.id, userId: "user-ordering" }), /Synthetic indeterminate provider response/);
    assert.equal(fixture.extra.status, "PAYMENT_PROCESSING");
    assert.equal(fixture.audit.rows.filter((row) => row.action === "RENTAL_EXTRA_CHARGE_FAILED").length, 0);
  });
}

test("INT-01: concurrent distinct events for one intent settle once and create one paid audit", async () => {
  const fixture = makeFixture();
  const retrieve = fixture.stripe.paymentIntents.retrieve;
  const bothReadsStarted = deferred<void>();
  let reads = 0;
  fixture.stripe.paymentIntents.retrieve = async (id: string) => {
    const intent = await retrieve(id);
    reads += 1;
    const readNumber = reads;
    if (readNumber === 2) bothReadsStarted.resolve();
    if (readNumber <= 2) await bothReadsStarted.promise;
    return intent;
  };
  const service = fixture.service();
  const results = await Promise.all([
    service.handleStripeEvent(eventFor("extra", "payment_intent.succeeded", "evt_concurrent_first", 200)),
    service.handleStripeEvent(eventFor("extra", "payment_intent.succeeded", "evt_concurrent_second", 201))
  ]);
  assert.equal(results.filter((result) => result.received).length, 2);
  assert.equal(fixture.extra.status, "PAID");
  assert.equal(fixture.writes.filter((write) => write.data.status === "PAID").length, 1);
  assert.equal(fixture.audit.rows.filter((row) => row.action === "RENTAL_EXTRA_CHARGE_PAID").length, 1);
  assert.equal(fixture.events.get("evt_concurrent_first")?.status, "PROCESSED");
  assert.equal(fixture.events.get("evt_concurrent_second")?.status, "PROCESSED");
});

test("INT-01: failed authoritative lookup can retry the same event ID and settle exactly once", async () => {
  const fixture = makeFixture();
  const retrieve = fixture.stripe.paymentIntents.retrieve;
  let firstRead = true;
  fixture.stripe.paymentIntents.retrieve = async (id: string) => {
    if (firstRead) {
      firstRead = false;
      throw new Error("Synthetic retryable authority failure");
    }
    return retrieve(id);
  };
  const service = fixture.service();
  const event = eventFor("extra", "payment_intent.succeeded", "evt_retry_same_id", 200);
  const before = clone(fixture.extra);
  await assert.rejects(() => service.handleStripeEvent(event), /Synthetic retryable authority failure/);
  assert.deepEqual(fixture.extra, before);
  assert.notEqual(fixture.events.get(event.id)?.status, "PROCESSED");
  const retried = await service.handleStripeEvent(event);
  assert.equal(retried.received, true);
  assert.equal(fixture.extra.status, "PAID");
  assert.equal((await service.handleStripeEvent(event)).duplicate, true);
  assert.equal(fixture.audit.rows.filter((row) => row.action === "RENTAL_EXTRA_CHARGE_PAID").length, 1);
});

test("INT-02: a webhook can bind and settle the claim before create returns without a second settlement", async () => {
  const fixture = makeFixture();
  fixture.extra.status = "APPROVED";
  fixture.extra.stripePaymentIntentId = null;
  const providerStarted = deferred<void>();
  const providerResponse = deferred<ReturnType<typeof intentFor>>();
  let createCalls = 0;
  fixture.stripe.paymentIntents.create = async () => {
    createCalls += 1;
    providerStarted.resolve();
    return providerResponse.promise;
  };
  const service = fixture.service();
  const charging = service.chargeExtraCharge({ tenantId: fixture.extra.tenantId, extraChargeId: fixture.extra.id, userId: "user-ordering" });
  await Promise.race([providerStarted.promise, charging.then(() => { throw new Error("Provider was not reached"); })]);
  try {
    assert.equal(fixture.extra.status, "PAYMENT_PROCESSING");
    assert.equal(fixture.extra.stripePaymentIntentId, null);
    await service.handleStripeEvent(eventFor("extra", "payment_intent.succeeded", "evt_webhook_before_response", 200));
    assert.equal(fixture.extra.stripePaymentIntentId, "pi_extra_ordering");
    assert.equal(fixture.extra.status, "PAID");
  } finally {
    providerResponse.resolve(intentFor("extra"));
    await charging;
  }
  assert.equal(fixture.extra.status, "PAID");
  assert.equal(createCalls, 1);
  assert.equal(fixture.audit.rows.filter((row) => row.action === "RENTAL_EXTRA_CHARGE_PAID").length, 1);
});

test("INT-02: a succeeded create response arriving after an authoritative refund preserves REFUNDED", async () => {
  const fixture = makeFixture();
  fixture.extra.status = "APPROVED";
  fixture.extra.stripePaymentIntentId = null;
  const providerStarted = deferred<void>();
  const providerResponse = deferred<ReturnType<typeof intentFor>>();
  fixture.stripe.paymentIntents.create = async () => {
    providerStarted.resolve();
    return providerResponse.promise;
  };
  const service = fixture.service();
  const charging = service.chargeExtraCharge({ tenantId: fixture.extra.tenantId, extraChargeId: fixture.extra.id, userId: "user-ordering" });
  await Promise.race([providerStarted.promise, charging.then(() => { throw new Error("Provider was not reached"); })]);
  try {
    await service.handleStripeEvent(eventFor("extra", "payment_intent.succeeded", "evt_paid_before_refund", 200));
    fixture.charge.amount_refunded = 1200;
    fixture.charge.refunded = true;
    const refundEvent = {
      id: "evt_refund_before_response", type: "charge.refunded", created: 201,
      data: { object: clone(fixture.charge) }
    } as unknown as Stripe.Event;
    await service.handleStripeEvent(refundEvent);
    assert.equal(fixture.extra.status, "REFUNDED");
  } finally {
    providerResponse.resolve(intentFor("extra"));
    await charging;
  }
  assert.equal(fixture.extra.status, "REFUNDED");
  assert.equal(fixture.audit.rows.filter((row) => row.action === "RENTAL_EXTRA_CHARGE_REFUNDED").length, 1);
  assert.equal(fixture.audit.rows.filter((row) => row.action === "RENTAL_EXTRA_CHARGE_PAID").length, 1);
});

test("INT-01: linked soft-deleted payment methods remain usable only for historical intent validation", async () => {
  const fixture = makeFixture();
  fixture.paymentMethod.deletedAt = new Date(1);
  fixture.paymentMethod.status = "REMOVED";
  assert.equal(await fixture.deps.findPaymentMethodById!(fixture.extra.tenantId, fixture.paymentMethod.id), null);
  await fixture.service().handleStripeEvent(eventFor("extra", "payment_intent.succeeded", "evt_historical_method"));
  assert.equal(fixture.extra.status, "PAID");
  assert.equal(fixture.creates.length, 0);
});

test("INT-02: retry of an existing intent reconciles it and never creates another provider payment", async () => {
  const fixture = makeFixture();
  const result = await fixture.service().chargeExtraCharge({ tenantId: fixture.extra.tenantId, extraChargeId: fixture.extra.id, userId: "user-ordering" });
  assert.equal(result.status, "PAID");
  assert.deepEqual(fixture.retrievals, ["pi_extra_ordering"]);
  assert.equal(fixture.creates.length, 0);
});

test("INT-01: authoritative dispute resolves its charge and stays DISPUTED after a later success", async () => {
  const fixture = makeFixture();
  fixture.extra.status = "PAID";
  fixture.charge.disputed = true;
  const disputeEvent = {
    id: "evt_dispute_authority", type: "charge.dispute.created", created: 200,
    data: { object: clone(fixture.dispute) }
  } as unknown as Stripe.Event;
  const service = fixture.service();
  await service.handleStripeEvent(disputeEvent);
  assert.equal(fixture.extra.status, "DISPUTED");
  await service.handleStripeEvent(eventFor("extra", "payment_intent.succeeded", "evt_success_after_dispute", 100));
  assert.equal(fixture.extra.status, "DISPUTED");
  assert.equal(fixture.audit.rows.filter((row) => row.action === "RENTAL_EXTRA_CHARGE_DISPUTED").length, 1);
});

test("INT-01: transactional audit failure rolls back PAID and a retry commits one settlement audit", async () => {
  const fixture = makeFixture();
  fixture.audit.failuresRemaining = 1;
  const before = clone(fixture.extra);
  const event = eventFor("extra", "payment_intent.succeeded", "evt_atomic_audit_retry", 200);
  const service = fixture.service();
  await assert.rejects(() => service.handleStripeEvent(event), /Synthetic transactional audit failure/);
  assert.deepEqual(fixture.extra, before);
  assert.equal(fixture.writes.filter((write) => write.data.status === "PAID").length, 0);
  assert.equal(fixture.audit.rows.filter((row) => row.action === "RENTAL_EXTRA_CHARGE_PAID").length, 0);
  assert.notEqual(fixture.events.get(event.id)?.status, "PROCESSED");

  assert.equal((await service.handleStripeEvent(event)).received, true);
  assert.equal(fixture.extra.status, "PAID");
  assert.equal(fixture.writes.filter((write) => write.data.status === "PAID").length, 1);
  assert.equal(fixture.audit.rows.filter((row) => row.action === "RENTAL_EXTRA_CHARGE_PAID").length, 1);
  assert.equal((await service.handleStripeEvent(event)).duplicate, true);
  assert.equal(fixture.audit.rows.filter((row) => row.action === "RENTAL_EXTRA_CHARGE_PAID").length, 1);
});

test("INT-01: settlement retrieves current provider state after a stale identity preflight", async () => {
  const fixture = makeFixture();
  fixture.intents.extra = intentFor("extra", "requires_payment_method", 0);
  const retrieve = fixture.stripe.paymentIntents.retrieve;
  const returnedProviderStatuses: string[] = [];
  fixture.stripe.paymentIntents.retrieve = async (id: string) => {
    const reply = await retrieve(id);
    returnedProviderStatuses.push(reply.status);
    if (returnedProviderStatuses.length === 1) {
      // The initial object proves identity only. Before settlement begins the
      // provider completes the payment; using the cached object would write FAILED.
      fixture.intents.extra = intentFor("extra", "succeeded", 1200);
    }
    return reply;
  };
  await fixture.service().handleStripeEvent(eventFor("extra", "payment_intent.payment_failed", "evt_stale_preflight_then_paid", 100));
  assert.equal(returnedProviderStatuses[0], "requires_payment_method");
  assert.ok(returnedProviderStatuses.slice(1).includes("succeeded"));
  assert.ok(fixture.retrievals.length >= 2 && fixture.retrievals.length <= 6);
  assert.ok(fixture.retrievals.every((id) => id === "pi_extra_ordering"));
  assert.equal(fixture.extra.status, "PAID");
  assert.equal(fixture.extra.failureReason, null);
  assert.equal(fixture.writes.filter((write) => write.data.status === "FAILED").length, 0);
  assert.equal(fixture.writes.filter((write) => write.data.status === "PAID").length, 1);
  assert.equal(fixture.audit.rows.filter((row) => row.action === "RENTAL_EXTRA_CHARGE_PAID").length, 1);
});

test("INT-01: a declined deposit intent stays bound and later settles to a partial capture", async () => {
  const fixture = makeFixture();
  fixture.deposit.status = "AUTHORIZING";
  fixture.deposit.stripePaymentIntentId = null;
  fixture.intents.deposit = intentFor("deposit", "requires_payment_method", 0);
  fixture.deps.findBookingForPayment = async (tenantId, bookingId) => {
    assert.equal(tenantId, fixture.deposit.tenantId);
    assert.equal(bookingId, fixture.deposit.bookingId);
    return {
      id: fixture.deposit.bookingId, tenantId: fixture.deposit.tenantId, code: "BK-SYNTHETIC-DECLINE",
      customerId: fixture.deposit.rentalCustomerId, vehicleId: "vehicle-ordering",
      customerName: "Synthetic customer", customerEmail: "synthetic@example.test", customerPhone: null,
      customer: {
        id: fixture.deposit.rentalCustomerId, tenantId: fixture.deposit.tenantId,
        customerType: "PERSONA_FISICA", firstName: "Synthetic", lastName: "Customer",
        email: "synthetic@example.test", phone: null, companyName: null, deletedAt: null
      }
    };
  };
  fixture.deps.claimActiveDeposit = async (input) => {
    assert.equal(input.tenantId, fixture.deposit.tenantId);
    assert.equal(input.bookingId, fixture.deposit.bookingId);
    assert.equal(input.paymentMethodId, fixture.deposit.paymentMethodId);
    assert.equal(input.amountCents, fixture.deposit.amountCents);
    assert.equal(input.status, "AUTHORIZING");
    return { deposit: clone(fixture.deposit), created: true };
  };
  let createCalls = 0;
  fixture.stripe.paymentIntents.create = async (_params, options) => {
    createCalls += 1;
    assert.equal(options?.idempotencyKey, "rental-deposit:tenant-ordering:deposit-ordering");
    const error = new Error("Synthetic deposit declined") as Error & {
      type: string; code: string; payment_intent: string;
    };
    error.type = "StripeCardError";
    error.code = "card_declined";
    error.payment_intent = "pi_deposit_ordering";
    throw error;
  };
  const service = fixture.service();
  const failed = await service.createDeposit({
    tenantId: fixture.deposit.tenantId, bookingId: fixture.deposit.bookingId,
    paymentMethodId: fixture.deposit.paymentMethodId, amountCents: 50_000, userId: "user-ordering"
  });
  assert.equal(failed.status, "FAILED");
  assert.equal(fixture.deposit.status, "FAILED");
  assert.equal(fixture.deposit.stripePaymentIntentId, "pi_deposit_ordering");
  assert.equal(fixture.deposit.capturedAmountCents, 0);

  fixture.intents.deposit = intentFor("deposit", "succeeded", 20_000);
  const success = eventFor("deposit", "payment_intent.succeeded", "evt_deposit_partial_after_decline", 200);
  (success.data.object as unknown as Record<string, unknown>).amount_received = 20_000;
  assert.equal((await service.handleStripeEvent(success)).received, true);
  assert.equal(fixture.deposit.status, "PARTIALLY_CAPTURED");
  assert.equal(fixture.deposit.stripePaymentIntentId, "pi_deposit_ordering");
  assert.equal(fixture.deposit.capturedAmountCents, 20_000);
  assert.equal(fixture.deposit.failureReason, null);
  assert.equal(createCalls, 1);
});

test("INT-01: an unknown provider status is rejected without altering money or marking an event processed", async () => {
  const fixture = makeFixture();
  fixture.intents.extra.status = "unexpected_future_status";
  const before = clone(fixture.extra);
  const event = eventFor("extra", "payment_intent.succeeded", "evt_unknown_provider_status", 200);
  await assert.rejects(() => fixture.service().handleStripeEvent(event),
    (error) => error instanceof AppError && error.statusCode === 409 && error.code === "RENTAL_PAYMENT_BINDING_MISMATCH");
  assert.deepEqual(fixture.extra, before);
  assert.equal(fixture.writes.length, 0);
  assert.equal(fixture.audit.rows.length, 0);
  assert.notEqual(fixture.events.get(event.id)?.status, "PROCESSED");
});

test("INT-02: an unclassified provider error stays uncertain and cannot be locally canceled", async () => {
  const fixture = makeFixture();
  fixture.extra.status = "APPROVED";
  fixture.extra.stripePaymentIntentId = null;
  const unknownError = new Error("Synthetic unknown provider error without classification");
  fixture.stripe.paymentIntents.create = async () => { throw unknownError; };
  const service = fixture.service();
  await assert.rejects(() => service.chargeExtraCharge({
    tenantId: fixture.extra.tenantId, extraChargeId: fixture.extra.id, userId: "user-ordering"
  }), (error) => error === unknownError);
  assert.equal(fixture.extra.status, "PAYMENT_PROCESSING");
  assert.equal(fixture.extra.stripePaymentIntentId, null);
  assert.equal(fixture.writes.filter((write) => write.data.status === "FAILED").length, 0);
  assert.equal(fixture.audit.rows.filter((row) => row.action === "RENTAL_EXTRA_CHARGE_FAILED").length, 0);
  await assert.rejects(() => service.cancelExtraCharge({
    tenantId: fixture.extra.tenantId, extraChargeId: fixture.extra.id, userId: "user-ordering"
  }), (error) => error instanceof AppError && error.statusCode === 409);
  assert.equal(fixture.extra.status, "PAYMENT_PROCESSING");
  assert.equal(fixture.audit.rows.filter((row) => row.action === "RENTAL_EXTRA_CHARGE_CANCELED").length, 0);
});

test("INT-02: an indeterminate error carrying a known intent reconciles PAID instead of declaring failure", async () => {
  const fixture = makeFixture();
  fixture.extra.status = "APPROVED";
  fixture.extra.stripePaymentIntentId = null;
  let createCalls = 0;
  fixture.stripe.paymentIntents.create = async () => {
    createCalls += 1;
    const error = new Error("Synthetic connection error with an existing intent") as Error & {
      type: string; code: string; payment_intent: string;
    };
    error.type = "StripeConnectionError";
    error.code = "ETIMEDOUT";
    error.payment_intent = "pi_extra_ordering";
    throw error;
  };
  const result = await fixture.service().chargeExtraCharge({
    tenantId: fixture.extra.tenantId, extraChargeId: fixture.extra.id, userId: "user-ordering"
  });
  assert.equal(result.status, "PAID");
  assert.equal(fixture.extra.status, "PAID");
  assert.equal(fixture.extra.stripePaymentIntentId, "pi_extra_ordering");
  assert.ok(fixture.retrievals.length >= 1 && fixture.retrievals.length <= 6);
  assert.ok(fixture.retrievals.every((id) => id === "pi_extra_ordering"));
  assert.equal(fixture.writes.filter((write) => write.data.status === "FAILED").length, 0);
  assert.equal(fixture.audit.rows.filter((row) => row.action === "RENTAL_EXTRA_CHARGE_FAILED").length, 0);
  assert.equal(fixture.audit.rows.filter((row) => row.action === "RENTAL_EXTRA_CHARGE_PAID").length, 1);
  assert.equal(createCalls, 1);
});
