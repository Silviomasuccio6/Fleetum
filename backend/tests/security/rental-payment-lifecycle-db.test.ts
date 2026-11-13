import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type Stripe from "stripe";
import type { RentalDepositStatus, RentalExtraChargeStatus } from "@prisma/client";
import { RentalPaymentService } from "../../src/application/services/rental-payment-service.js";
import type { AuditLogRepository, AuditLogRow } from "../../src/domain/repositories/audit-log-repository.js";
import { prisma } from "../../src/infrastructure/database/prisma/client.js";
import { AppError } from "../../src/shared/errors/app-error.js";
import { env } from "../../src/shared/config/env.js";

// This suite is opt-in and must run only in the PostgreSQL instance created by
// verify:database. The guard runs before the first database connection or write.
const assertSyntheticDatabase = () => {
  assert.equal(process.env.RUN_TENANT_ISOLATION_TESTS, "1", "temporary database runner opt-in is required");
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.DOTENV_CONFIG_PATH, "/dev/null", "real env files must not be loaded");
  const url = new URL(process.env.DATABASE_URL ?? "invalid://missing");
  assert.ok(url.protocol === "postgresql:" || url.protocol === "postgres:");
  assert.ok(url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]");
  assert.ok(url.pathname === "/fleetum_ci" || url.pathname === "/fleetum_rehearsal", "only the temporary synthetic database is allowed");
};

class NoopAuditRepository implements AuditLogRepository {
  async countByTenant(_tenantId: string): Promise<number> { return 0; }
  async listByTenant(_tenantId: string, _input: { skip: number; take: number }): Promise<AuditLogRow[]> { return []; }
  async listLatestByTenant(_tenantId: string, _take: number): Promise<AuditLogRow[]> { return []; }
  async getLatestByAction(_tenantId: string, _resource: string, _action: string): Promise<AuditLogRow | null> { return null; }
  async create(): Promise<void> {}
}

const runId = `payment-lifecycle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const tenantIds: string[] = [];
let sequence = 0;
const originalStripeKey = env.STRIPE_SECRET_KEY;
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const settled = <T>(promise: Promise<T>) => promise.then(
  (value) => ({ ok: true as const, value }),
  (error: unknown) => ({ ok: false as const, error })
);
const assertConflict = (result: Awaited<ReturnType<typeof settled>>) => {
  assert.equal(result.ok, false, "the conflicting command must be rejected");
  if (!result.ok) {
    assert.ok(result.error instanceof AppError);
    assert.equal(result.error.statusCode, 409);
  }
};
const timeoutError = () => Object.assign(new Error("Synthetic provider connection timeout"), {
  type: "StripeConnectionError", code: "ETIMEDOUT"
});

const fixture = async (suffix: string) => {
  const marker = `${runId}-${suffix}-${sequence++}`;
  const tenant = await prisma.tenant.create({ data: { name: `Synthetic ${marker}` } });
  tenantIds.push(tenant.id);
  const user = await prisma.user.create({ data: {
    tenantId: tenant.id, email: `${marker}@example.test`, passwordHash: "synthetic-unused-hash",
    firstName: "Synthetic", lastName: "Lifecycle", isEmailVerified: true
  } });
  const site = await prisma.site.create({ data: { tenantId: tenant.id, name: marker, address: "Synthetic", city: "Synthetic" } });
  const vehicle = await prisma.vehicle.create({ data: {
    tenantId: tenant.id, siteId: site.id, plate: `SYN-${marker}`, brand: "Synthetic", model: "Lifecycle", year: 2025, isActive: true
  } });
  const customer = await prisma.rentalCustomer.create({ data: {
    tenantId: tenant.id, firstName: "Synthetic", lastName: "Customer", email: `${marker}-customer@example.test`
  } });
  const booking = await prisma.rentalBooking.create({ data: {
    tenantId: tenant.id, vehicleId: vehicle.id, customerId: customer.id, createdByUserId: user.id,
    code: marker, customerName: "Synthetic Customer", status: "CONFIRMED",
    pickupAt: new Date("2030-01-01T00:00:00Z"), returnAt: new Date("2030-01-02T00:00:00Z")
  } });
  const profile = await prisma.rentalCustomerPaymentProfile.create({ data: {
    tenantId: tenant.id, rentalCustomerId: customer.id, stripeCustomerId: `cus_${marker}`, status: "ACTIVE"
  } });
  const method = await prisma.rentalCustomerPaymentMethod.create({ data: {
    tenantId: tenant.id, paymentProfileId: profile.id, rentalCustomerId: customer.id, bookingId: booking.id,
    stripeCustomerId: profile.stripeCustomerId, stripePaymentMethodId: `pm_${marker}`, status: "ACTIVE",
    mandateAccepted: true, mandateAcceptedAt: new Date(), termsVersion: "synthetic-v1", createdByUserId: user.id
  } });
  const extra = await prisma.rentalExtraCharge.create({ data: {
    tenantId: tenant.id, bookingId: booking.id, rentalCustomerId: customer.id, vehicleId: vehicle.id,
    paymentMethodId: method.id, createdByUserId: user.id, approvedByUserId: user.id,
    type: "DAMAGE", description: "Synthetic lifecycle charge", amountCents: 1200, adminFeeCents: 100,
    totalAmountCents: 1300, currency: "EUR", status: "APPROVED"
  } });
  return { tenant, user, site, vehicle, customer, booking, profile, method, extra, marker };
};
type Fixture = Awaited<ReturnType<typeof fixture>>;
const input = (f: Fixture) => ({ tenantId: f.tenant.id, extraChargeId: f.extra.id, userId: f.user.id });
const readExtra = (f: Fixture) => prisma.rentalExtraCharge.findUniqueOrThrow({ where: { id: f.extra.id } });
const createDeposit = (f: Fixture, status: RentalDepositStatus, capturedAmountCents = 0) => prisma.rentalDeposit.create({ data: {
  tenantId: f.tenant.id, bookingId: f.booking.id, rentalCustomerId: f.customer.id, vehicleId: f.vehicle.id,
  paymentMethodId: f.method.id, stripePaymentIntentId: `pi_deposit_${f.marker}`,
  amountCents: 50_000, capturedAmountCents, currency: "EUR", status, createdByUserId: f.user.id, approvedByUserId: f.user.id
} });
const extraIntent = (f: Fixture, status: Stripe.PaymentIntent.Status = "succeeded", id = `pi_extra_${f.marker}`): Stripe.PaymentIntent => ({
  id, object: "payment_intent", status, customer: f.profile.stripeCustomerId, payment_method: f.method.stripePaymentMethodId,
  amount: f.extra.totalAmountCents, amount_received: status === "succeeded" ? f.extra.totalAmountCents : 0,
  amount_capturable: 0, currency: "eur", capture_method: "automatic", latest_charge: `ch_${f.marker}`,
  metadata: { domain: "rental_payments", purpose: "rental_extra_charge", tenantId: f.tenant.id,
    bookingId: f.booking.id, rentalCustomerId: f.customer.id, rentalExtraChargeId: f.extra.id, paymentMethodId: f.method.id, chargeType: f.extra.type }
} as unknown as Stripe.PaymentIntent);
const depositIntent = (
  f: Fixture, depositId: string, status: Stripe.PaymentIntent.Status, capturedAmountCents = 0
): Stripe.PaymentIntent => ({
  id: `pi_deposit_${f.marker}`, object: "payment_intent", status,
  customer: f.profile.stripeCustomerId, payment_method: f.method.stripePaymentMethodId,
  amount: 50_000, amount_received: capturedAmountCents, amount_capturable: status === "requires_capture" ? 50_000 : 0,
  currency: "eur", capture_method: "manual", latest_charge: `ch_deposit_${f.marker}`,
  metadata: { domain: "rental_payments", purpose: "rental_deposit", tenantId: f.tenant.id,
    bookingId: f.booking.id, rentalCustomerId: f.customer.id, rentalDepositId: depositId, paymentMethodId: f.method.id }
} as unknown as Stripe.PaymentIntent);
const provider = (initial: Stripe.PaymentIntent) => {
  const current = new Map([[initial.id, initial]]);
  const createCalls: Array<{ params: Stripe.PaymentIntentCreateParams; key: string | undefined }> = [];
  const retrieveCalls: string[] = [];
  let onCreate: (params: Stripe.PaymentIntentCreateParams, options?: Stripe.RequestOptions) => Promise<Stripe.PaymentIntent> = async () => initial;
  const stripe = { paymentIntents: {
    create: async (params: Stripe.PaymentIntentCreateParams, options?: Stripe.RequestOptions) => {
      createCalls.push({ params, key: options?.idempotencyKey });
      return onCreate(params, options);
    },
    retrieve: async (id: string) => {
      retrieveCalls.push(id);
      const result = current.get(id);
      assert.ok(result, "only an explicitly synthetic current PaymentIntent can be retrieved");
      return result;
    }
  } } as unknown as Stripe;
  return { stripe, current, createCalls, retrieveCalls, setCreate: (callback: typeof onCreate) => { onCreate = callback; } };
};
const service = (p: ReturnType<typeof provider>) => new RentalPaymentService(new NoopAuditRepository(), p.stripe);
const event = (type: string, intent: Stripe.PaymentIntent): Stripe.Event => ({
  id: `evt_${runId}_${sequence++}`, object: "event", type, created: 1_900_000_000,
  data: { object: intent }, livemode: false
} as unknown as Stripe.Event);
const acceptOrControlledRejection = async (work: () => Promise<unknown>) => {
  try { await work(); } catch (error) {
    assert.ok(error instanceof AppError, "a rejected synthetic event must produce a controlled application error");
    assert.ok(error.statusCode >= 400 && error.statusCode < 500);
  }
};
const businessSnapshot = () => Promise.all([
  prisma.rentalExtraCharge.findMany({ where: { tenantId: { in: tenantIds } }, orderBy: { id: "asc" } }),
  prisma.rentalDeposit.findMany({ where: { tenantId: { in: tenantIds } }, orderBy: { id: "asc" } }),
  prisma.rentalCustomerPaymentMethod.findMany({ where: { tenantId: { in: tenantIds } }, orderBy: { id: "asc" } })
]).then((rows) => JSON.stringify(rows));

describe("rental payment lifecycle PostgreSQL concurrency and reconciliation", { concurrency: false }, () => {
  before(async () => {
    assertSyntheticDatabase();
    (env as unknown as Record<string, unknown>).STRIPE_SECRET_KEY = "sk_test_synthetic_payment_lifecycle";
    await prisma.$connect();
  });
  after(async () => {
    (env as unknown as Record<string, unknown>).STRIPE_SECRET_KEY = originalStripeKey;
    if (tenantIds.length) {
      const where = { tenantId: { in: tenantIds } };
      await prisma.rentalPaymentEvent.deleteMany({ where });
      await prisma.rentalExtraCharge.deleteMany({ where });
      await prisma.rentalDeposit.deleteMany({ where });
      await prisma.rentalCustomerPaymentMethod.deleteMany({ where });
      await prisma.rentalCustomerPaymentProfile.deleteMany({ where });
      await prisma.rentalBooking.deleteMany({ where });
      await prisma.rentalCustomer.deleteMany({ where });
      await prisma.auditLog.deleteMany({ where });
      await prisma.user.deleteMany({ where });
      await prisma.vehicle.deleteMany({ where });
      await prisma.site.deleteMany({ where });
      await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    }
    await prisma.$disconnect();
  });

  it("allows one real database charge claim when two callers read APPROVED", async () => {
    const f = await fixture("charge-race");
    const p = provider(extraIntent(f));
    const s = service(p);
    const delegate = prisma.rentalExtraCharge;
    const originalFind = delegate.findFirst.bind(delegate);
    const ready = deferred<void>();
    let readers = 0;
    delegate.findFirst = (async (args: Parameters<typeof originalFind>[0]) => {
      const row = await originalFind(args);
      if (row?.id === f.extra.id && readers < 2) {
        readers += 1;
        if (readers === 2) ready.resolve();
        await ready.promise;
      }
      return row;
    }) as typeof delegate.findFirst;
    try {
      const results = await Promise.all([settled(s.chargeExtraCharge(input(f))), settled(s.chargeExtraCharge(input(f)))]);
      assert.equal(readers, 2, "the race must start from two actual reads of the original row");
      assert.equal(p.createCalls.length, 1, "only the database claim winner may call the provider");
      assert.equal(results.filter((result) => result.ok).length, 1);
      assertConflict(results.find((result) => !result.ok)!);
      const saved = await readExtra(f);
      assert.equal(saved.status, "PAID");
      assert.equal(saved.stripePaymentIntentId, extraIntent(f).id);
    } finally { ready.resolve(); delegate.findFirst = originalFind as typeof delegate.findFirst; }
  });

  it("rejects cancellation while the claimed provider charge is pending", async () => {
    const f = await fixture("pending-cancel");
    const intent = extraIntent(f);
    const p = provider(intent);
    const started = deferred<void>();
    const response = deferred<Stripe.PaymentIntent>();
    p.setCreate(async () => { started.resolve(); return response.promise; });
    const s = service(p);
    const charging = settled(s.chargeExtraCharge(input(f)));
    await started.promise;
    let cancellation: Awaited<ReturnType<typeof settled>>;
    let pendingStatus: string;
    try {
      cancellation = await settled(s.cancelExtraCharge(input(f)));
      pendingStatus = (await readExtra(f)).status;
    } finally { response.resolve(intent); await charging; }
    assertConflict(cancellation!);
    assert.equal(pendingStatus!, "PAYMENT_PROCESSING", "pending provider outcome must never be reported as canceled");
    assert.equal((await readExtra(f)).status, "PAID");
    assert.equal(p.createCalls.length, 1);
  });

  it("does not start a provider charge after cancellation wins over a stale charge read", async () => {
    const f = await fixture("cancel-first");
    const p = provider(extraIntent(f));
    const s = service(p);
    const delegate = prisma.rentalExtraCharge;
    const originalFind = delegate.findFirst.bind(delegate);
    const readStarted = deferred<void>();
    const continueRead = deferred<void>();
    let paused = false;
    delegate.findFirst = (async (args: Parameters<typeof originalFind>[0]) => {
      const row = await originalFind(args);
      if (!paused && row?.id === f.extra.id) {
        paused = true;
        readStarted.resolve();
        await continueRead.promise;
      }
      return row;
    }) as typeof delegate.findFirst;
    const charging = settled(s.chargeExtraCharge(input(f)));
    try {
      await readStarted.promise;
      assert.equal((await s.cancelExtraCharge(input(f))).status, "CANCELED");
      continueRead.resolve();
      assertConflict(await charging);
      assert.equal(p.createCalls.length, 0);
      assert.equal((await readExtra(f)).status, "CANCELED");
    } finally { continueRead.resolve(); await charging; delegate.findFirst = originalFind as typeof delegate.findFirst; }
  });

  it("keeps an unknown provider outcome pending and forbids recreating it even after 24 hours", async () => {
    const f = await fixture("uncertain");
    const p = provider(extraIntent(f));
    p.setCreate(async () => { throw timeoutError(); });
    const s = service(p);
    await settled(s.chargeExtraCharge(input(f)));
    let saved = await readExtra(f);
    assert.equal(saved.status, "PAYMENT_PROCESSING");
    assert.equal(saved.stripePaymentIntentId, null);
    assert.equal(p.createCalls.length, 1);
    await prisma.rentalExtraCharge.update({ where: { id: f.extra.id }, data: { updatedAt: new Date(Date.now() - 48 * 60 * 60 * 1000) } });
    assertConflict(await settled(s.chargeExtraCharge(input(f))));
    saved = await readExtra(f);
    assert.equal(saved.status, "PAYMENT_PROCESSING");
    assert.equal(p.createCalls.length, 1, "expired provider idempotency retention must never lead to another create");
  });

  it("preserves PAID when its webhook wins before the original request times out", async () => {
    const f = await fixture("webhook-before-timeout");
    const intent = extraIntent(f);
    const p = provider(intent);
    const started = deferred<void>();
    const response = deferred<Stripe.PaymentIntent>();
    p.setCreate(async () => { started.resolve(); return response.promise; });
    const s = service(p);
    const charging = settled(s.chargeExtraCharge(input(f)));
    await started.promise;
    try {
      await s.handleStripeEvent(event("payment_intent.succeeded", intent));
      assert.equal((await readExtra(f)).status, "PAID");
    } finally { response.reject(timeoutError()); await charging; }
    const saved = await readExtra(f);
    assert.equal(saved.status, "PAID");
    assert.equal(saved.stripePaymentIntentId, intent.id);
    assert.equal(saved.failureReason, null);
    assert.equal(p.createCalls.length, 1);
  });

  it("rolls back PAID and its audit together, then safely records one audit on webhook retry", async () => {
    const f = await fixture("paid-audit-rollback");
    const intent = extraIntent(f);
    await prisma.rentalExtraCharge.update({ where: { id: f.extra.id }, data: {
      status: "PAYMENT_PROCESSING", stripePaymentIntentId: intent.id
    } });
    const p = provider(intent);
    const s = service(p);
    const delivery = event("payment_intent.succeeded", intent);
    const initial = await readExtra(f);
    const auditCount = () => prisma.auditLog.count({ where: {
      tenantId: f.tenant.id, resourceId: f.extra.id, action: "RENTAL_EXTRA_CHARGE_PAID"
    } });
    const originalTransaction = prisma.$transaction.bind(prisma);
    let injected = 0;
    // Preserve the actual PostgreSQL transaction and all actual writes. Throw
    // only after its targeted audit INSERT, proving both INSERT and money CAS
    // roll back if the transaction fails after the economic state change.
    prisma.$transaction = (async (work: unknown, options?: unknown) => {
      if (typeof work !== "function") return (originalTransaction as any)(work, options);
      return (originalTransaction as any)(async (tx: any) => {
        const audit = new Proxy(tx.auditLog, {
          get(target, property) {
            if (property === "create") return async (args: any) => {
              const row = await target.create(args);
              if (injected === 0 && args.data.tenantId === f.tenant.id && args.data.resourceId === f.extra.id &&
                  args.data.action === "RENTAL_EXTRA_CHARGE_PAID") {
                const changed = await tx.rentalExtraCharge.findUniqueOrThrow({ where: { id: f.extra.id } });
                assert.equal(changed.status, "PAID", "the real money write must precede the targeted audit failure");
                injected += 1;
                throw new Error("Synthetic transaction failure after paid audit insert");
              }
              return row;
            };
            const value = Reflect.get(target, property);
            return typeof value === "function" ? value.bind(target) : value;
          }
        });
        const proxy = new Proxy(tx, { get(target, property) {
          if (property === "auditLog") return audit;
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        } });
        return work(proxy);
      }, options);
    }) as typeof prisma.$transaction;
    try {
      await assert.rejects(() => s.handleStripeEvent(delivery), /Synthetic transaction failure after paid audit insert/);
      assert.equal(injected, 1, "failure injection must intercept the real transaction audit write");
      assert.deepEqual(await readExtra(f), initial, "the payment row, timestamps and intent binding must all roll back");
      assert.equal(await auditCount(), 0, "the inserted audit must roll back with the payment row");
      const failedEvent = await prisma.rentalPaymentEvent.findUniqueOrThrow({
        where: { provider_eventId: { provider: "stripe", eventId: delivery.id } }
      });
      assert.equal(failedEvent.status, "FAILED");
      assert.equal(failedEvent.processedAt, null);
    } finally { prisma.$transaction = originalTransaction as typeof prisma.$transaction; }
    await s.handleStripeEvent(delivery);
    assert.equal((await readExtra(f)).status, "PAID");
    assert.equal(await auditCount(), 1, "a failed delivery must remain retryable without losing its economic audit");
    const replay = await s.handleStripeEvent(delivery);
    assert.equal(replay.duplicate, true);
    assert.equal(await auditCount(), 1);
    assert.equal(p.createCalls.length, 0, "audit recovery must never create another payment");
  });

  it("rejects a delayed provider snapshot after a newer nonterminal state has committed", async () => {
    const f = await fixture("provider-snapshot-fence");
    const obsolete = extraIntent(f, "requires_action");
    const authoritative = { ...extraIntent(f, "requires_payment_method"),
      last_payment_error: { message: "Synthetic current decline", code: "card_declined" }
    } as Stripe.PaymentIntent;
    await prisma.rentalExtraCharge.update({ where: { id: f.extra.id }, data: {
      status: "PAYMENT_PROCESSING", stripePaymentIntentId: obsolete.id
    } });
    const p = provider(obsolete);
    const s = service(p);
    const started = deferred<void>();
    const release = deferred<Stripe.PaymentIntent>();
    const originalRetrieve = p.stripe.paymentIntents.retrieve.bind(p.stripe.paymentIntents);
    let paused = false;
    p.stripe.paymentIntents.retrieve = (async (id: string) => {
      if (!paused && id === obsolete.id) {
        paused = true;
        p.retrieveCalls.push(id);
        started.resolve();
        return release.promise;
      }
      return originalRetrieve(id);
    }) as typeof p.stripe.paymentIntents.retrieve;
    const staleRequest = settled(s.chargeExtraCharge(input(f)));
    try {
      await started.promise;
      p.current.set(authoritative.id, authoritative);
      await s.handleStripeEvent(event("payment_intent.payment_failed", authoritative));
      const committed = await readExtra(f);
      assert.equal(committed.status, "FAILED");
      assert.equal(committed.failureReason, "Synthetic current decline");
      release.resolve(obsolete);
      const result = await staleRequest;
      assert.equal(result.ok, true);
      if (result.ok) assert.equal(result.value.status, "FAILED", "conflicting reconciliation must recover the current provider state");
      assert.deepEqual(await readExtra(f), committed, "a response received before the winning state must not overwrite that state or its timestamp");
      assert.ok(p.retrieveCalls.length >= 4, "after CAS conflict the provider object must be retrieved again");
      assert.equal(p.createCalls.length, 0);
    } finally {
      release.resolve(obsolete);
      await staleRequest;
      p.stripe.paymentIntents.retrieve = originalRetrieve as typeof p.stripe.paymentIntents.retrieve;
    }
  });

  for (const status of ["PAID", "REFUNDED", "DISPUTED"] as RentalExtraChargeStatus[]) {
    it(`preserves terminal extra ${status} against distinct delayed failed and canceled events`, async () => {
      const f = await fixture(`extra-${status.toLowerCase()}`);
      const current = extraIntent(f);
      await prisma.rentalExtraCharge.update({ where: { id: f.extra.id }, data: {
        status, stripePaymentIntentId: current.id, chargedAt: new Date()
      } });
      const p = provider(current);
      const s = service(p);
      for (const [type, oldStatus] of [["payment_intent.payment_failed", "requires_payment_method"], ["payment_intent.canceled", "canceled"]] as const) {
        const old = { ...extraIntent(f, oldStatus), last_payment_error: { message: "Synthetic obsolete failure", code: "card_declined" } } as Stripe.PaymentIntent;
        await s.handleStripeEvent(event(type, old));
        assert.equal((await readExtra(f)).status, status);
      }
      assert.equal(p.createCalls.length, 0);
    });
  }

  for (const [status, captured] of [["CAPTURED", 50_000], ["PARTIALLY_CAPTURED", 20_000]] as const) {
    it(`preserves terminal deposit ${status} and captured cents against delayed failure/cancel/authorization`, async () => {
      const f = await fixture(`deposit-${status.toLowerCase()}`);
      const deposit = await createDeposit(f, status, captured);
      const current = depositIntent(f, deposit.id, "succeeded", captured);
      const p = provider(current);
      const s = service(p);
      for (const [type, oldStatus] of [["payment_intent.payment_failed", "requires_payment_method"], ["payment_intent.canceled", "canceled"], ["payment_intent.amount_capturable_updated", "requires_capture"]] as const) {
        await s.handleStripeEvent(event(type, depositIntent(f, deposit.id, oldStatus)));
        const saved = await prisma.rentalDeposit.findUniqueOrThrow({ where: { id: deposit.id } });
        assert.equal(saved.status, status);
        assert.equal(saved.capturedAmountCents, captured);
      }
      assert.equal(p.createCalls.length, 0);
    });
  }

  it("does not reauthorize a released deposit from an obsolete capturable event", async () => {
    const f = await fixture("released-deposit");
    const deposit = await createDeposit(f, "RELEASED");
    const p = provider(depositIntent(f, deposit.id, "canceled"));
    await service(p).handleStripeEvent(event("payment_intent.amount_capturable_updated", depositIntent(f, deposit.id, "requires_capture")));
    const saved = await prisma.rentalDeposit.findUniqueOrThrow({ where: { id: deposit.id } });
    assert.equal(saved.status, "RELEASED");
    assert.equal(saved.capturedAmountCents, 0);
  });

  it("refuses an obsolete foreign PaymentIntent for an extra already bound to another intent", async () => {
    const f = await fixture("foreign-pi");
    const bound = extraIntent(f, "processing");
    const foreign = extraIntent(f, "succeeded", `pi_foreign_${f.marker}`);
    await prisma.rentalExtraCharge.update({ where: { id: f.extra.id }, data: { status: "PAYMENT_PROCESSING", stripePaymentIntentId: bound.id } });
    const p = provider(bound);
    p.current.set(foreign.id, foreign);
    const before = await businessSnapshot();
    await acceptOrControlledRejection(() => service(p).handleStripeEvent(event("payment_intent.succeeded", foreign)));
    assert.equal(await businessSnapshot(), before, "event must not replace the existing intent binding or payment state");
    assert.equal(p.createCalls.length, 0);
  });

  it("refuses cross-tenant event metadata and cross-tenant payment commands without business mutations", async () => {
    const a = await fixture("owner-a");
    const b = await fixture("foreign-b");
    const foreign = extraIntent(b);
    const tampered = { ...foreign, metadata: { ...foreign.metadata, tenantId: a.tenant.id, rentalExtraChargeId: a.extra.id,
      bookingId: a.booking.id, rentalCustomerId: a.customer.id, paymentMethodId: a.method.id } } as Stripe.PaymentIntent;
    const p = provider(foreign);
    const s = service(p);
    const before = await businessSnapshot();
    await acceptOrControlledRejection(() => s.handleStripeEvent(event("payment_intent.succeeded", tampered)));
    await assert.rejects(() => s.chargeExtraCharge({ tenantId: a.tenant.id, extraChargeId: b.extra.id, userId: a.user.id }),
      (error) => error instanceof AppError && error.statusCode === 404);
    await assert.rejects(() => s.cancelExtraCharge({ tenantId: a.tenant.id, extraChargeId: b.extra.id, userId: a.user.id }),
      (error) => error instanceof AppError && error.statusCode === 404);
    assert.equal(await businessSnapshot(), before, "neither tenant's financial records may change");
    assert.equal(p.createCalls.length, 0);
  });
});
