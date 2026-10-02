import assert from "node:assert/strict";
import net from "node:net";
import { isDeepStrictEqual } from "node:util";
import type { AuditLogRepository, AuditLogRow } from "../../backend/src/domain/repositories/audit-log-repository.js";
import type { RentalPaymentService as ServiceType } from "../../backend/src/application/services/rental-payment-service.js";

// Standalone synthetic regression diagnostic, outside the application test suite.
// Run from repository root with: env -i PATH=/opt/homebrew/bin:/usr/bin:/bin NODE_ENV=test
// DOTENV_CONFIG_PATH=/dev/null node --import tsx ops/e2e/rental-financial-diagnostic.ts
// No real provider or database operation is permitted by these fixtures.
type PartialDeps = NonNullable<ConstructorParameters<typeof ServiceType>[2]>;
type EventInput = Parameters<ServiceType["handleStripeEvent"]>[0];
const clone = <T>(value: T): T => structuredClone(value);

let blockedNetworkAttempts = 0;
net.Socket.prototype.connect = function () {
  blockedNetworkAttempts += 1;
  throw new Error("NETWORK_FORBIDDEN_IN_READ_ONLY_REPRO");
} as typeof net.Socket.prototype.connect;
globalThis.fetch = async () => {
  blockedNetworkAttempts += 1;
  throw new Error("NETWORK_FORBIDDEN_IN_READ_ONLY_REPRO");
};

class FakeAudit implements AuditLogRepository {
  rows: Array<Parameters<AuditLogRepository["create"]>[0]> = [];
  async countByTenant(): Promise<number> { return this.rows.length; }
  async listByTenant(): Promise<AuditLogRow[]> { return []; }
  async listLatestByTenant(): Promise<AuditLogRow[]> { return []; }
  async getLatestByAction(): Promise<AuditLogRow | null> { return null; }
  async create(input: Parameters<AuditLogRepository["create"]>[0]): Promise<void> {
    this.appendAtomically(input);
  }
  appendAtomically(input: Parameters<AuditLogRepository["create"]>[0]): void {
    this.rows.push(clone(input));
  }
}

const unused = (name: string) => async () => {
  throw new Error(`UNEXPECTED_DEPENDENCY_IN_READ_ONLY_REPRO:${name}`);
};

// Override every default dependency, including unused ones, to prevent a Prisma fallback.
const allDependencyNames: Array<keyof PartialDeps> = [
  "findBookingForPayment", "findPaymentProfile", "createPaymentProfile",
  "createPendingPaymentMethod", "updatePaymentMethod", "findPaymentMethodById",
  "findPaymentMethodByStripeId", "findPaymentMethodBySetupIntentId", "listPaymentMethods",
  "listDepositsByBooking", "listExtraChargesByBooking", "findActiveDeposit", "createDeposit",
  "claimActiveDeposit", "updateDeposit", "findDepositById", "findDepositByStripePaymentIntentId",
  "createExtraCharge", "updateExtraCharge", "findExtraChargeById",
  "findExtraChargeByStripePaymentIntentId", "createRentalPaymentEvent", "updateRentalPaymentEvent",
  "compareAndUpdateExtraCharge", "compareAndUpdateDeposit", "findHistoricalPaymentMethodById"
];
const noDatabaseDefaults = Object.fromEntries(allDependencyNames.map((name) => [name, unused(name)])) as PartialDeps;
const fakeEmailQueue = new Proxy({}, {
  get(_target, key) { return unused(`emailQueue.${String(key)}`); }
});

const activePaymentMethod = {
  id: "rpm-repro", tenantId: "tenant-repro", paymentProfileId: "profile-repro",
  rentalCustomerId: "customer-repro", bookingId: "booking-repro",
  stripeCustomerId: "cus_repro", stripePaymentMethodId: "pm_repro",
  stripeSetupIntentId: "seti_repro", status: "ACTIVE", cardBrand: "visa",
  cardLast4: "4242", cardExpMonth: 12, cardExpYear: 2030,
  mandateAccepted: true, mandateAcceptedAt: new Date(0), termsVersion: "repro-v1", deletedAt: null
};

function makeFixture() {
  const extra: Record<string, unknown> = {
    id: "extra-repro", tenantId: "tenant-repro", bookingId: "booking-repro",
    rentalCustomerId: "customer-repro", vehicleId: "vehicle-repro", paymentMethodId: "rpm-repro",
    stripePaymentIntentId: "pi_extra_repro", type: "FINE", description: "In-memory diagnostic",
    amountCents: 1000, adminFeeCents: 200, totalAmountCents: 1200, currency: "EUR",
    status: "PAYMENT_PROCESSING", failureReason: null
  };
  const deposit: Record<string, unknown> = {
    id: "deposit-repro", tenantId: "tenant-repro", bookingId: "booking-repro",
    rentalCustomerId: "customer-repro", vehicleId: "vehicle-repro", paymentMethodId: "rpm-repro",
    stripePaymentIntentId: "pi_deposit_repro", amountCents: 50000, capturedAmountCents: 0,
    currency: "EUR", status: "AUTHORIZED", failureReason: null
  };
  const eventRows = new Map<string, { eventId: string; status: string; processedAt: Date | null }>();
  const transitions: Array<{ record: string; from: unknown; to: unknown }> = [];
  const audit = new FakeAudit();
  const partialDeps: PartialDeps = {
    ...noDatabaseDefaults,
    async findPaymentMethodById(tenantId, paymentMethodId) {
      assert.equal(tenantId, activePaymentMethod.tenantId);
      assert.equal(paymentMethodId, activePaymentMethod.id);
      return clone(activePaymentMethod) as never;
    },
    async findHistoricalPaymentMethodById(tenantId, paymentMethodId) {
      assert.equal(tenantId, activePaymentMethod.tenantId);
      assert.equal(paymentMethodId, activePaymentMethod.id);
      return clone(activePaymentMethod) as never;
    },
    async findExtraChargeById(tenantId, extraChargeId) {
      assert.equal(tenantId, extra.tenantId);
      assert.equal(extraChargeId, extra.id);
      return clone(extra) as never;
    },
    async findDepositById(tenantId, depositId) {
      assert.equal(tenantId, deposit.tenantId);
      assert.equal(depositId, deposit.id);
      return clone(deposit) as never;
    },
    async updateExtraCharge(tenantId, extraChargeId, data) {
      assert.equal(tenantId, extra.tenantId);
      assert.equal(extraChargeId, extra.id);
      transitions.push({ record: "extra", from: extra.status, to: data.status ?? extra.status });
      Object.assign(extra, data);
      return clone(extra) as never;
    },
    async updateDeposit(tenantId, depositId, data) {
      assert.equal(tenantId, deposit.tenantId);
      assert.equal(depositId, deposit.id);
      transitions.push({ record: "deposit", from: deposit.status, to: data.status ?? deposit.status });
      Object.assign(deposit, data);
      return clone(deposit) as never;
    },
    async compareAndUpdateExtraCharge(expected, data, auditInput) {
      if (!isDeepStrictEqual(expected, extra)) return null;
      if (auditInput) audit.appendAtomically(auditInput);
      transitions.push({ record: "extra", from: extra.status, to: data.status ?? extra.status });
      Object.assign(extra, data);
      return clone(extra) as never;
    },
    async compareAndUpdateDeposit(expected, data, auditInput) {
      if (!isDeepStrictEqual(expected, deposit)) return null;
      if (auditInput) audit.appendAtomically(auditInput);
      transitions.push({ record: "deposit", from: deposit.status, to: data.status ?? deposit.status });
      Object.assign(deposit, data);
      return clone(deposit) as never;
    },
    async createRentalPaymentEvent(event, tenantId) {
      assert.equal(tenantId, "tenant-repro");
      if (!eventRows.has(event.id)) eventRows.set(event.id, { eventId: event.id, status: "RECEIVED", processedAt: null });
      return clone(eventRows.get(event.id)!);
    },
    async updateRentalPaymentEvent(eventId, data) {
      assert.ok(eventRows.has(eventId));
      Object.assign(eventRows.get(eventId)!, data);
    }
  };
  return { extra, deposit, audit, partialDeps, transitions, eventRows };
}

const fakeStripe = (create: (...args: unknown[]) => Promise<unknown> = unused("stripe.paymentIntents.create")) => ({
  paymentIntents: {
    create,
    async retrieve(id: string) {
      assert.ok(id === "pi_extra_repro" || id === "pi_deposit_repro", "Only the synthetic linked intents may be retrieved");
      return intentFor(id === "pi_extra_repro" ? "extra" : "deposit");
    },
    capture: unused("stripe.paymentIntents.capture"), cancel: unused("stripe.paymentIntents.cancel")
  },
  customers: { create: unused("stripe.customers.create") },
  checkout: { sessions: { create: unused("stripe.checkout.sessions.create") } },
  setupIntents: { retrieve: unused("stripe.setupIntents.retrieve") },
  paymentMethods: { retrieve: unused("stripe.paymentMethods.retrieve") }
});

function intentFor(record: "extra" | "deposit") {
  return {
    id: record === "extra" ? "pi_extra_repro" : "pi_deposit_repro", object: "payment_intent",
    amount: record === "extra" ? 1200 : 50000, amount_received: record === "extra" ? 1200 : 50000,
    amount_capturable: 0, currency: "eur", customer: "cus_repro", payment_method: "pm_repro",
    status: "succeeded", last_payment_error: null,
    metadata: {
      domain: "rental_payments", tenantId: "tenant-repro", bookingId: "booking-repro",
      rentalCustomerId: "customer-repro", paymentMethodId: "rpm-repro",
      purpose: record === "extra" ? "rental_extra_charge" : "rental_deposit",
      ...(record === "extra" ? { rentalExtraChargeId: "extra-repro" } : { rentalDepositId: "deposit-repro" })
    }
  };
}

function eventFor(record: "extra" | "deposit", type: string, id: string, created: number): EventInput {
  return {
    id, type, created, object: "event", livemode: false, pending_webhooks: 1,
    data: { object: {
      ...intentFor(record),
      amount_received: type === "payment_intent.succeeded" ? (record === "extra" ? 1200 : 50000) : 0,
      status: type === "payment_intent.succeeded" ? "succeeded" : type === "payment_intent.canceled" ? "canceled" : "requires_payment_method",
      last_payment_error: type === "payment_intent.payment_failed" ? { code: "card_declined", message: "Synthetic failure" } : null,
      metadata: intentFor(record).metadata
    } }
  } as EventInput;
}

async function main() {
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.DOTENV_CONFIG_PATH, "/dev/null");
  process.env.DATABASE_URL = "postgresql://invalid:invalid@127.0.0.1:1/fleetum_diagnostic?schema=public";
  const { RentalPaymentService } = await import("../../backend/src/application/services/rental-payment-service.js");
  const { AppError } = await import("../../backend/src/shared/errors/app-error.js");
  const { env } = await import("../../backend/src/shared/config/env.js");
  // Same guard override as the existing unit tests; never supplied to a real SDK.
  (env as unknown as Record<string, unknown>).STRIPE_SECRET_KEY = "sk_test_in_memory_repro_only";
  const webhookObservations: Array<Record<string, unknown>> = [];

  // Distinct event IDs bypass duplicate-event protection. The older event is delivered second.
  for (const record of ["extra", "deposit"] as const) {
    for (const lateEvent of ["payment_intent.payment_failed", "payment_intent.canceled"] as const) {
      const fixture = makeFixture();
      const service = new RentalPaymentService(fixture.audit, fakeStripe() as never, fixture.partialDeps, fakeEmailQueue as never);
      const prefix = `${record}_${lateEvent.replaceAll(".", "_")}`;
      const success = eventFor(record, "payment_intent.succeeded", `evt_${prefix}_success`, 200);
      const late = eventFor(record, lateEvent, `evt_${prefix}_older`, 100);
      const successResult = await service.handleStripeEvent(success);
      const row = record === "extra" ? fixture.extra : fixture.deposit;
      const statusAfterSuccess = row.status;
      assert.equal(statusAfterSuccess, record === "extra" ? "PAID" : "CAPTURED");
      const lateResult = await service.handleStripeEvent(late);
      const duplicateResult = await service.handleStripeEvent(late);
      assert.equal(duplicateResult.duplicate, true);
      assert.equal(row.status, statusAfterSuccess);
      webhookObservations.push({
        record, deliveredEventTypes: [success.type, late.type], deliveredEventCreated: [success.created, late.created],
        distinctEventIds: success.id !== late.id, statusAfterSuccess, statusAfterOlderEvent: row.status,
        capturedAmountCents: record === "deposit" ? row.capturedAmountCents : undefined,
        bothEventsProcessed: successResult.received === true && lateResult.received === true,
        exactDuplicateIgnored: duplicateResult.duplicate === true,
        defectObserved: row.status !== statusAfterSuccess, transitions: fixture.transitions
      });
    }
  }

  const raceFixture = makeFixture();
  raceFixture.extra.status = "APPROVED";
  raceFixture.extra.stripePaymentIntentId = null;
  let announceProviderStarted!: () => void;
  let completeProvider!: (value: unknown) => void;
  const providerStarted = new Promise<void>((resolve) => { announceProviderStarted = resolve; });
  const providerResponse = new Promise<unknown>((resolve) => { completeProvider = resolve; });
  let stripeCreateCalls = 0;
  const raceStripe = fakeStripe(async () => {
    stripeCreateCalls += 1;
    announceProviderStarted();
    return providerResponse;
  });
  const raceService = new RentalPaymentService(raceFixture.audit, raceStripe as never, raceFixture.partialDeps, fakeEmailQueue as never);
  const chargePromise = raceService.chargeExtraCharge({ tenantId: "tenant-repro", extraChargeId: "extra-repro", userId: "user-repro" });
  await Promise.race([providerStarted, chargePromise.then(() => { throw new Error("PROVIDER_NOT_REACHED"); })]);
  const stateWhileProviderPending = raceFixture.extra.status;
  assert.equal(stateWhileProviderPending, "PAYMENT_PROCESSING");
  let cancellationStatusCode: number | null = null;
  let cancellationErrorCode: string | null = null;
  try {
    await raceService.cancelExtraCharge({ tenantId: "tenant-repro", extraChargeId: "extra-repro", userId: "user-repro" });
    assert.fail("A payment in flight must not return a successful cancellation");
  } catch (error) {
    assert.ok(error instanceof AppError && error.statusCode === 409);
    cancellationStatusCode = error.statusCode;
    cancellationErrorCode = error.code;
  } finally {
    completeProvider(intentFor("extra"));
  }
  const stateAfterCancellation = raceFixture.extra.status;
  assert.equal(stateAfterCancellation, "PAYMENT_PROCESSING");
  const chargeResult = await chargePromise;
  assert.equal(chargeResult.status, "PAID");
  assert.equal(stripeCreateCalls, 1);
  assert.equal(blockedNetworkAttempts, 0);
  console.log(JSON.stringify({
    diagnostic: "rental-financial-regression-check",
    sourceModule: "backend/src/application/services/rental-payment-service.ts",
    safety: { inMemoryDependenciesOnly: true, dotenvFileDisabled: true, blockedNetworkAttempts, appFilesModified: false },
    webhookObservations,
    cancellationRace: {
      stateWhileProviderPending, cancellationReturnedStatus: null, cancellationStatusCode, cancellationErrorCode, stateAfterCancellation,
      chargeReturnedStatus: chargeResult.status, finalStoredStatus: raceFixture.extra.status, stripeCreateCalls,
      defectObserved: cancellationStatusCode !== 409 || stateAfterCancellation !== "PAYMENT_PROCESSING" || raceFixture.extra.status !== "PAID",
      transitions: raceFixture.transitions, auditActions: raceFixture.audit.rows.map((row) => row.action)
    },
    interpretation: "These synthetic checks verify the repaired interleavings; they do not replace PostgreSQL concurrency or verified HTTP webhook gates.",
    limits: [
      "Synthetic events enter the service directly; HTTP routing, webhook signature validation and real Stripe event validity are not exercised.",
      "In-memory compare/audit/update checks a synthetic snapshot atomically; it does not test PostgreSQL isolation or transaction timing.",
      "One deterministic interleaving is reproduced; no claim is made about live data or production incidence.",
      "Import initializes the Prisma client module, but all repository calls are overridden and no connection or query is executed."
    ]
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ diagnosticError: error instanceof Error ? error.message : "unknown" }));
  process.exitCode = 1;
});
