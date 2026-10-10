import crypto from "node:crypto";
import Stripe from "stripe";
import { Prisma } from "@prisma/client";
import { AuditLogRepository } from "../../domain/repositories/audit-log-repository.js";
import { prisma } from "../../infrastructure/database/prisma/client.js";
import { createAuditLog } from "../../infrastructure/repositories/prisma-audit-log-repository.js";
import { EmailQueueService } from "../../infrastructure/email/email-queue-service.js";
import { env } from "../../shared/config/env.js";
import { AppError } from "../../shared/errors/app-error.js";
import { ownedVehicleWhere } from "../../infrastructure/repositories/vehicle-tenant-scope.js";
import { requestExtraChargeNotice, withExtraChargeNoticeStates } from "../../infrastructure/email/extra-charge-notice.js";
import type { ExtraNoticeStatus } from "../../infrastructure/email/extra-charge-notice.js";

const RENTAL_PAYMENT_DOMAIN = "rental_payments";
const SETUP_PURPOSE = "rental_guarantee_card";
const DEPOSIT_PURPOSE = "rental_deposit";
const EXTRA_CHARGE_PURPOSE = "rental_extra_charge";

const RentalPaymentMethodStatus = {
  SETUP_PENDING: "SETUP_PENDING",
  ACTIVE: "ACTIVE",
  FAILED: "FAILED",
  REQUIRES_ACTION: "REQUIRES_ACTION",
  EXPIRED: "EXPIRED",
  REMOVED: "REMOVED"
} as const;
type RentalPaymentMethodStatus = typeof RentalPaymentMethodStatus[keyof typeof RentalPaymentMethodStatus];

const RentalDepositStatus = {
  DRAFT: "DRAFT",
  AUTHORIZING: "AUTHORIZING",
  AUTHORIZED: "AUTHORIZED",
  PARTIALLY_CAPTURED: "PARTIALLY_CAPTURED",
  CAPTURED: "CAPTURED",
  RELEASED: "RELEASED",
  CANCELED: "CANCELED",
  FAILED: "FAILED",
  EXPIRED: "EXPIRED"
} as const;
type RentalDepositStatus = typeof RentalDepositStatus[keyof typeof RentalDepositStatus];

const RentalExtraChargeStatus = {
  DRAFT: "DRAFT",
  PENDING_APPROVAL: "PENDING_APPROVAL",
  APPROVED: "APPROVED",
  NOTIFIED: "NOTIFIED",
  PAYMENT_PROCESSING: "PAYMENT_PROCESSING",
  PAID: "PAID",
  FAILED: "FAILED",
  REQUIRES_ACTION: "REQUIRES_ACTION",
  CANCELED: "CANCELED",
  REFUNDED: "REFUNDED",
  DISPUTED: "DISPUTED"
} as const;
type RentalExtraChargeStatus = typeof RentalExtraChargeStatus[keyof typeof RentalExtraChargeStatus];

const RentalExtraChargeType = {
  FINE: "FINE",
  DAMAGE: "DAMAGE",
  DEDUCTIBLE: "DEDUCTIBLE",
  FUEL: "FUEL",
  TOLL: "TOLL",
  LATE_RETURN: "LATE_RETURN",
  CLEANING: "CLEANING",
  MISSING_ACCESSORY: "MISSING_ACCESSORY",
  ADMIN_FEE: "ADMIN_FEE",
  OTHER: "OTHER"
} as const;
type RentalExtraChargeType = typeof RentalExtraChargeType[keyof typeof RentalExtraChargeType];

const RENTAL_CANDIDATE_EVENTS = new Set([
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "payment_intent.amount_capturable_updated",
  "payment_intent.canceled",
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.closed"
]);

const ACTIVE_DEPOSIT_STATUSES: RentalDepositStatus[] = [
  RentalDepositStatus.AUTHORIZING,
  RentalDepositStatus.AUTHORIZED
];

const CAPTURABLE_DEPOSIT_STATUSES: readonly RentalDepositStatus[] = [
  RentalDepositStatus.AUTHORIZED
];

const RELEASABLE_DEPOSIT_STATUSES: readonly RentalDepositStatus[] = [
  RentalDepositStatus.AUTHORIZING,
  RentalDepositStatus.AUTHORIZED
];

const CHARGEABLE_EXTRA_STATUSES: RentalExtraChargeStatus[] = [
  RentalExtraChargeStatus.APPROVED,
  RentalExtraChargeStatus.NOTIFIED,
  RentalExtraChargeStatus.FAILED,
  RentalExtraChargeStatus.REQUIRES_ACTION
];

const APPROVABLE_EXTRA_STATUSES: readonly RentalExtraChargeStatus[] = [
  RentalExtraChargeStatus.DRAFT,
  RentalExtraChargeStatus.PENDING_APPROVAL
];

const NON_CANCELABLE_EXTRA_STATUSES: readonly RentalExtraChargeStatus[] = [
  RentalExtraChargeStatus.PAYMENT_PROCESSING,
  RentalExtraChargeStatus.PAID,
  RentalExtraChargeStatus.REFUNDED,
  RentalExtraChargeStatus.DISPUTED
];

const optionalString = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
const stripeId = (value: unknown) => {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string") return (value as { id: string }).id;
  return null;
};

const jsonPayload = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value ?? {}));

const metadataFromObject = (source: unknown): Record<string, string> => {
  if (!source || typeof source !== "object") return {};
  const metadata = (source as { metadata?: unknown }).metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  return Object.fromEntries(
    Object.entries(metadata as Record<string, unknown>)
      .filter(([, value]) => typeof value === "string")
      .map(([key, value]) => [key, String(value)])
  );
};

export const isRentalStripeEvent = (event: Stripe.Event, dataObject?: Record<string, unknown>) => {
  const object = dataObject ?? event.data.object as unknown;
  const metadata = metadataFromObject(object);
  if (metadata.domain === RENTAL_PAYMENT_DOMAIN) return true;
  return RENTAL_CANDIDATE_EVENTS.has(event.type) && Boolean(
    metadata.rentalDepositId ||
    metadata.rentalExtraChargeId ||
    metadata.purpose === DEPOSIT_PURPOSE ||
    metadata.purpose === EXTRA_CHARGE_PURPOSE
  );
};

const stripeErrorCode = (error: unknown) => optionalString((error as { code?: unknown }).code);
const stripeDeclineCode = (error: unknown) => optionalString((error as { decline_code?: unknown }).decline_code);
const stripeErrorMessage = (error: unknown) => optionalString((error as { message?: unknown }).message) ?? "Errore Stripe";

const statusForStripePaymentError = (error: unknown): RentalExtraChargeStatus => {
  const code = stripeErrorCode(error);
  const declineCode = stripeDeclineCode(error);
  if (code === "authentication_required" || declineCode === "authentication_required") {
    return RentalExtraChargeStatus.REQUIRES_ACTION;
  }
  return RentalExtraChargeStatus.FAILED;
};

const INDETERMINATE_STRIPE_ERROR_TYPES = new Set([
  "StripeAPIError",
  "StripeConnectionError",
  "StripeRateLimitError",
  "StripeUnknownError"
]);

const INDETERMINATE_STRIPE_ERROR_CODES = new Set([
  "ECONNABORTED",
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
  "idempotency_key_in_use"
]);

const isIndeterminateStripeError = (error: unknown) => {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { type?: unknown; name?: unknown; code?: unknown; statusCode?: unknown };
  const type = optionalString(candidate.type) ?? optionalString(candidate.name);
  const code = optionalString(candidate.code);
  const statusCode = typeof candidate.statusCode === "number" ? candidate.statusCode : null;

  return Boolean(
    (type && INDETERMINATE_STRIPE_ERROR_TYPES.has(type)) ||
    (code && INDETERMINATE_STRIPE_ERROR_CODES.has(code)) ||
    statusCode === 409 ||
    statusCode === 429 ||
    (statusCode !== null && statusCode >= 500)
  );
};

const isDefinitiveStripeError = (error: unknown) => {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { type?: unknown; statusCode?: unknown };
  return ["StripeCardError", "StripeInvalidRequestError", "StripeAuthenticationError", "StripePermissionError"].includes(String(candidate.type))
    || [400, 401, 402, 403, 404].includes(Number(candidate.statusCode))
    || stripeErrorCode(error) === "authentication_required";
};

type BookingForPayment = {
  id: string;
  tenantId: string;
  code: string;
  customerId: string | null;
  vehicleId: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  customer: {
    id: string;
    tenantId: string;
    customerType: string;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    companyName: string | null;
    deletedAt: Date | null;
  } | null;
};

type PaymentProfileRecord = {
  id: string;
  tenantId: string;
  rentalCustomerId: string;
  stripeCustomerId: string;
  status: string;
  deletedAt: Date | null;
};

type PaymentMethodRecord = {
  id: string;
  tenantId: string;
  paymentProfileId: string;
  rentalCustomerId: string;
  bookingId: string | null;
  stripeCustomerId: string;
  stripePaymentMethodId: string;
  stripeSetupIntentId: string | null;
  status: RentalPaymentMethodStatus;
  cardBrand: string | null;
  cardLast4: string | null;
  cardExpMonth: number | null;
  cardExpYear: number | null;
  mandateAccepted: boolean;
  mandateAcceptedAt: Date | null;
  termsVersion: string | null;
  deletedAt: Date | null;
};

type DepositRecord = {
  createdAt?: Date;
  updatedAt?: Date;
  id: string;
  tenantId: string;
  bookingId: string;
  rentalCustomerId: string;
  vehicleId: string | null;
  paymentMethodId: string;
  stripePaymentIntentId: string | null;
  amountCents: number;
  capturedAmountCents: number;
  currency: string;
  status: RentalDepositStatus;
  failureReason: string | null;
};

type ExtraChargeRecord = {
  updatedAt?: Date;
  id: string;
  tenantId: string;
  bookingId: string;
  rentalCustomerId: string;
  vehicleId: string | null;
  paymentMethodId: string | null;
  stripePaymentIntentId: string | null;
  type: RentalExtraChargeType;
  description: string;
  amountCents: number;
  adminFeeCents: number;
  totalAmountCents: number;
  currency: string;
  status: RentalExtraChargeStatus;
  failureReason: string | null;
  notifiedAt?: Date | null;
  notificationStatus?: ExtraNoticeStatus;
};

type RentalPaymentEventRecord = {
  eventId: string;
  status: string;
  processedAt: Date | null;
};

type PaymentAudit = Parameters<AuditLogRepository["create"]>[0];

type RentalPaymentServiceDeps = {
  findBookingForPayment(tenantId: string, bookingId: string): Promise<BookingForPayment | null>;
  findPaymentProfile(tenantId: string, rentalCustomerId: string): Promise<PaymentProfileRecord | null>;
  createPaymentProfile(input: Prisma.RentalCustomerPaymentProfileUncheckedCreateInput): Promise<PaymentProfileRecord>;
  createPendingPaymentMethod(input: Prisma.RentalCustomerPaymentMethodUncheckedCreateInput): Promise<PaymentMethodRecord>;
  updatePaymentMethod(tenantId: string, paymentMethodId: string, data: Prisma.RentalCustomerPaymentMethodUncheckedUpdateInput): Promise<PaymentMethodRecord>;
  findPaymentMethodById(tenantId: string, paymentMethodId: string): Promise<PaymentMethodRecord | null>;
  findHistoricalPaymentMethodById(tenantId: string, paymentMethodId: string): Promise<PaymentMethodRecord | null>;
  findPaymentMethodByStripeId(stripePaymentMethodId: string): Promise<PaymentMethodRecord | null>;
  findPaymentMethodBySetupIntentId(stripeSetupIntentId: string): Promise<PaymentMethodRecord | null>;
  listPaymentMethods(tenantId: string, rentalCustomerId: string): Promise<PaymentMethodRecord[]>;
  listDepositsByBooking(tenantId: string, bookingId: string): Promise<DepositRecord[]>;
  listExtraChargesByBooking(tenantId: string, bookingId: string): Promise<ExtraChargeRecord[]>;
  findActiveDeposit(tenantId: string, bookingId: string): Promise<DepositRecord | null>;
  createDeposit(input: Prisma.RentalDepositUncheckedCreateInput): Promise<DepositRecord>;
  claimActiveDeposit(input: Prisma.RentalDepositUncheckedCreateInput): Promise<{ deposit: DepositRecord; created: boolean }>;
  updateDeposit(tenantId: string, depositId: string, data: Prisma.RentalDepositUncheckedUpdateInput): Promise<DepositRecord>;
  compareAndUpdateDeposit(expected: DepositRecord, data: Prisma.RentalDepositUncheckedUpdateInput, audit?: PaymentAudit): Promise<DepositRecord | null>;
  findDepositById(tenantId: string, depositId: string): Promise<DepositRecord | null>;
  findDepositByStripePaymentIntentId(stripePaymentIntentId: string): Promise<DepositRecord | null>;
  createExtraCharge(input: Prisma.RentalExtraChargeUncheckedCreateInput): Promise<ExtraChargeRecord>;
  updateExtraCharge(tenantId: string, extraChargeId: string, data: Prisma.RentalExtraChargeUncheckedUpdateInput): Promise<ExtraChargeRecord>;
  compareAndUpdateExtraCharge(expected: ExtraChargeRecord, data: Prisma.RentalExtraChargeUncheckedUpdateInput, audit?: PaymentAudit): Promise<ExtraChargeRecord | null>;
  findExtraChargeById(tenantId: string, extraChargeId: string): Promise<ExtraChargeRecord | null>;
  findExtraChargeByStripePaymentIntentId(stripePaymentIntentId: string): Promise<ExtraChargeRecord | null>;
  createRentalPaymentEvent(event: Stripe.Event, tenantId: string, refs: RentalPaymentEventRefs): Promise<RentalPaymentEventRecord>;
  updateRentalPaymentEvent(eventId: string, data: { status: string; processedAt?: Date | null; errorMessage?: string | null }): Promise<void>;
};

type RentalPaymentEventRefs = {
  paymentProfileId?: string | null;
  paymentMethodId?: string | null;
  depositId?: string | null;
  extraChargeId?: string | null;
  bookingId?: string | null;
  rentalCustomerId?: string | null;
};

const paymentMethodSelect = {
  id: true,
  tenantId: true,
  paymentProfileId: true,
  rentalCustomerId: true,
  bookingId: true,
  stripeCustomerId: true,
  stripePaymentMethodId: true,
  stripeSetupIntentId: true,
  status: true,
  cardBrand: true,
  cardLast4: true,
  cardExpMonth: true,
  cardExpYear: true,
  mandateAccepted: true,
  mandateAcceptedAt: true,
  termsVersion: true,
  deletedAt: true
} as const;

const depositSelect = {
  createdAt: true,
  updatedAt: true,
  id: true,
  tenantId: true,
  bookingId: true,
  rentalCustomerId: true,
  vehicleId: true,
  paymentMethodId: true,
  stripePaymentIntentId: true,
  amountCents: true,
  capturedAmountCents: true,
  currency: true,
  status: true,
  failureReason: true
} as const;

const extraChargeSelect = {
  updatedAt: true,
  id: true,
  tenantId: true,
  bookingId: true,
  rentalCustomerId: true,
  vehicleId: true,
  paymentMethodId: true,
  stripePaymentIntentId: true,
  type: true,
  description: true,
  amountCents: true,
  adminFeeCents: true,
  totalAmountCents: true,
  currency: true,
  status: true,
  failureReason: true,
  notifiedAt: true
} as const;

const defaultDeps: RentalPaymentServiceDeps = {
  async findBookingForPayment(tenantId, bookingId) {
    return prisma.rentalBooking.findFirst({
      where: {
        id: bookingId,
        tenantId,
        deletedAt: null,
        vehicle: ownedVehicleWhere(tenantId, true),
        OR: [{ customerId: null }, { customer: { tenantId } }]
      },
      select: {
        id: true,
        tenantId: true,
        code: true,
        customerId: true,
        vehicleId: true,
        customerName: true,
        customerEmail: true,
        customerPhone: true,
        customer: {
          select: {
            id: true,
            tenantId: true,
            customerType: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            companyName: true,
            deletedAt: true
          }
        }
      }
    });
  },
  async findPaymentProfile(tenantId, rentalCustomerId) {
    return prisma.rentalCustomerPaymentProfile.findUnique({
      where: { tenantId_rentalCustomerId: { tenantId, rentalCustomerId } },
      select: { id: true, tenantId: true, rentalCustomerId: true, stripeCustomerId: true, status: true, deletedAt: true }
    });
  },
  async createPaymentProfile(input) {
    return prisma.rentalCustomerPaymentProfile.create({
      data: input,
      select: { id: true, tenantId: true, rentalCustomerId: true, stripeCustomerId: true, status: true, deletedAt: true }
    });
  },
  async createPendingPaymentMethod(input) {
    return prisma.rentalCustomerPaymentMethod.create({ data: input, select: paymentMethodSelect });
  },
  async updatePaymentMethod(tenantId, paymentMethodId, data) {
    const updated = await prisma.rentalCustomerPaymentMethod.updateMany({ where: { id: paymentMethodId, tenantId }, data });
    if (updated.count !== 1) throw new AppError("Metodo di pagamento non trovato", 404, "RENTAL_PAYMENT_METHOD_NOT_FOUND");
    const row = await prisma.rentalCustomerPaymentMethod.findFirst({ where: { id: paymentMethodId, tenantId }, select: paymentMethodSelect });
    if (!row) throw new AppError("Metodo di pagamento non trovato", 404, "RENTAL_PAYMENT_METHOD_NOT_FOUND");
    return row;
  },
  async findPaymentMethodById(tenantId, paymentMethodId) {
    return prisma.rentalCustomerPaymentMethod.findFirst({ where: { id: paymentMethodId, tenantId, deletedAt: null }, select: paymentMethodSelect });
  },
  async findHistoricalPaymentMethodById(tenantId, paymentMethodId) {
    return prisma.rentalCustomerPaymentMethod.findFirst({ where: { id: paymentMethodId, tenantId }, select: paymentMethodSelect });
  },
  async findPaymentMethodByStripeId(stripePaymentMethodId) {
    return prisma.rentalCustomerPaymentMethod.findUnique({ where: { stripePaymentMethodId }, select: paymentMethodSelect });
  },
  async findPaymentMethodBySetupIntentId(stripeSetupIntentId) {
    return prisma.rentalCustomerPaymentMethod.findFirst({ where: { stripeSetupIntentId, deletedAt: null }, select: paymentMethodSelect });
  },
  async listPaymentMethods(tenantId, rentalCustomerId) {
    return prisma.rentalCustomerPaymentMethod.findMany({
      where: { tenantId, rentalCustomerId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: paymentMethodSelect
    });
  },
  async listDepositsByBooking(tenantId, bookingId) {
    return prisma.rentalDeposit.findMany({ where: { tenantId, bookingId, deletedAt: null }, orderBy: { createdAt: "desc" }, select: depositSelect });
  },
  async listExtraChargesByBooking(tenantId, bookingId) {
    const rows = await prisma.rentalExtraCharge.findMany({ where: { tenantId, bookingId, deletedAt: null }, orderBy: { createdAt: "desc" }, select: extraChargeSelect });
    return withExtraChargeNoticeStates(tenantId, rows);
  },
  async findActiveDeposit(tenantId, bookingId) {
    return prisma.rentalDeposit.findFirst({ where: { tenantId, bookingId, status: { in: ACTIVE_DEPOSIT_STATUSES }, deletedAt: null }, select: depositSelect });
  },
  async createDeposit(input) {
    return prisma.rentalDeposit.create({ data: input, select: depositSelect });
  },
  async claimActiveDeposit(input) {
    return prisma.$transaction(async (tx) => {
      const lockKey = `fleetum:rental-deposit-claim:${input.tenantId}:${input.bookingId}`;
      await tx.$queryRaw<Array<{ lock: unknown }>>`
        SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text AS lock
      `;

      const existing = await tx.rentalDeposit.findFirst({
        where: {
          tenantId: input.tenantId,
          bookingId: input.bookingId,
          status: { in: ACTIVE_DEPOSIT_STATUSES },
          deletedAt: null
        },
        select: depositSelect
      });
      if (existing) return { deposit: existing, created: false };

      const deposit = await tx.rentalDeposit.create({ data: input, select: depositSelect });
      return { deposit, created: true };
    });
  },
  async updateDeposit(tenantId, depositId, data) {
    const updated = await prisma.rentalDeposit.updateMany({ where: { id: depositId, tenantId }, data });
    if (updated.count !== 1) throw new AppError("Deposito non trovato", 404, "RENTAL_DEPOSIT_NOT_FOUND");
    const row = await prisma.rentalDeposit.findFirst({ where: { id: depositId, tenantId }, select: depositSelect });
    if (!row) throw new AppError("Deposito non trovato", 404, "RENTAL_DEPOSIT_NOT_FOUND");
    return row;
  },
  async compareAndUpdateDeposit(expected, data, audit) {
    return prisma.$transaction(async (tx) => {
      // Match privacy/notice lock order before locking the financial row and audit FKs.
      await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id" = ${expected.tenantId} FOR KEY SHARE`;
      const result = await tx.rentalDeposit.updateMany({ where: {
        id: expected.id, tenantId: expected.tenantId, deletedAt: null,
        status: expected.status, stripePaymentIntentId: expected.stripePaymentIntentId,
        paymentMethodId: expected.paymentMethodId, amountCents: expected.amountCents,
        capturedAmountCents: expected.capturedAmountCents, currency: expected.currency,
        bookingId: expected.bookingId, rentalCustomerId: expected.rentalCustomerId,
        ...(expected.updatedAt ? { updatedAt: expected.updatedAt } : {})
      }, data });
      if (result.count !== 1) return null;
      if (audit) await createAuditLog(tx, audit);
      return tx.rentalDeposit.findFirst({ where: { id: expected.id, tenantId: expected.tenantId }, select: depositSelect });
    });
  },
  async findDepositById(tenantId, depositId) {
    return prisma.rentalDeposit.findFirst({ where: { id: depositId, tenantId, deletedAt: null }, select: depositSelect });
  },
  async findDepositByStripePaymentIntentId(stripePaymentIntentId) {
    return prisma.rentalDeposit.findFirst({ where: { stripePaymentIntentId, deletedAt: null }, select: depositSelect });
  },
  async createExtraCharge(input) {
    return prisma.rentalExtraCharge.create({ data: input, select: extraChargeSelect });
  },
  async updateExtraCharge(tenantId, extraChargeId, data) {
    const updated = await prisma.rentalExtraCharge.updateMany({ where: { id: extraChargeId, tenantId }, data });
    if (updated.count !== 1) throw new AppError("Extra charge non trovato", 404, "RENTAL_EXTRA_CHARGE_NOT_FOUND");
    const row = await prisma.rentalExtraCharge.findFirst({ where: { id: extraChargeId, tenantId }, select: extraChargeSelect });
    if (!row) throw new AppError("Extra charge non trovato", 404, "RENTAL_EXTRA_CHARGE_NOT_FOUND");
    return row;
  },
  async compareAndUpdateExtraCharge(expected, data, audit) {
    return prisma.$transaction(async (tx) => {
      // Match privacy/notice lock order before locking the financial row and audit FKs.
      await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id" = ${expected.tenantId} FOR KEY SHARE`;
      const result = await tx.rentalExtraCharge.updateMany({ where: {
        id: expected.id, tenantId: expected.tenantId, deletedAt: null,
        status: expected.status, stripePaymentIntentId: expected.stripePaymentIntentId,
        paymentMethodId: expected.paymentMethodId, amountCents: expected.amountCents,
        adminFeeCents: expected.adminFeeCents, totalAmountCents: expected.totalAmountCents,
        currency: expected.currency, bookingId: expected.bookingId, rentalCustomerId: expected.rentalCustomerId,
        ...(expected.updatedAt ? { updatedAt: expected.updatedAt } : {})
      }, data });
      if (result.count !== 1) return null;
      if (audit) await createAuditLog(tx, audit);
      return tx.rentalExtraCharge.findFirst({ where: { id: expected.id, tenantId: expected.tenantId }, select: extraChargeSelect });
    });
  },
  async findExtraChargeById(tenantId, extraChargeId) {
    return prisma.rentalExtraCharge.findFirst({ where: { id: extraChargeId, tenantId, deletedAt: null }, select: extraChargeSelect });
  },
  async findExtraChargeByStripePaymentIntentId(stripePaymentIntentId) {
    return prisma.rentalExtraCharge.findFirst({ where: { stripePaymentIntentId, deletedAt: null }, select: extraChargeSelect });
  },
  async createRentalPaymentEvent(event, tenantId, refs) {
    try {
      return await prisma.rentalPaymentEvent.create({
        data: {
          tenantId,
          provider: "stripe",
          eventId: event.id,
          type: event.type,
          status: "RECEIVED",
          payload: jsonPayload(event),
          paymentProfileId: refs.paymentProfileId ?? undefined,
          paymentMethodId: refs.paymentMethodId ?? undefined,
          depositId: refs.depositId ?? undefined,
          extraChargeId: refs.extraChargeId ?? undefined,
          bookingId: refs.bookingId ?? undefined,
          rentalCustomerId: refs.rentalCustomerId ?? undefined
        },
        select: { eventId: true, status: true, processedAt: true }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existing = await prisma.rentalPaymentEvent.findUnique({
          where: { provider_eventId: { provider: "stripe", eventId: event.id } },
          select: { eventId: true, status: true, processedAt: true }
        });
        if (existing) return existing;
      }
      throw error;
    }
  },
  async updateRentalPaymentEvent(eventId, data) {
    await prisma.rentalPaymentEvent.update({
      where: { provider_eventId: { provider: "stripe", eventId } },
      data: {
        status: data.status,
        processedAt: data.processedAt,
        errorMessage: data.errorMessage
      }
    });
  }
};

export class RentalPaymentService {
  constructor(
    private readonly auditRepository: AuditLogRepository,
    private readonly stripeClient: Stripe | null = env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY) : null,
    deps: Partial<RentalPaymentServiceDeps> = {},
    private readonly emailQueueService: EmailQueueService = new EmailQueueService()
  ) {
    this.deps = { ...defaultDeps, ...deps };
  }

  private readonly deps: RentalPaymentServiceDeps;

  async getBookingPaymentSummary(tenantId: string, bookingId: string) {
    const booking = await this.getBookingOrThrow(tenantId, bookingId);
    const customerId = this.requireBookingCustomerId(booking);
    const [paymentMethods, deposits, extraCharges] = await Promise.all([
      this.deps.listPaymentMethods(tenantId, customerId),
      this.deps.listDepositsByBooking(tenantId, bookingId),
      this.deps.listExtraChargesByBooking(tenantId, bookingId)
    ]);

    return { booking: { id: booking.id, code: booking.code, customerId }, paymentMethods, deposits, extraCharges };
  }

  async listPaymentMethods(tenantId: string, rentalCustomerId: string) {
    return this.deps.listPaymentMethods(tenantId, rentalCustomerId);
  }

  async createSetupSession(input: {
    tenantId: string;
    bookingId: string;
    userId: string;
    mandateAccepted: boolean;
    termsVersion: string;
    mandateIp?: string | null;
    mandateUserAgent?: string | null;
  }) {
    if (!input.mandateAccepted) {
      throw new AppError("Consenso mandato obbligatorio", 400, "RENTAL_PAYMENT_MANDATE_REQUIRED");
    }

    const stripe = this.requireStripeClient();
    const booking = await this.getBookingOrThrow(input.tenantId, input.bookingId);
    const rentalCustomerId = this.requireBookingCustomerId(booking);
    const profile = await this.getOrCreateRentalStripeCustomer(input.tenantId, rentalCustomerId, booking);
    const pending = await this.deps.createPendingPaymentMethod({
      tenantId: input.tenantId,
      paymentProfileId: profile.id,
      rentalCustomerId,
      bookingId: booking.id,
      stripeCustomerId: profile.stripeCustomerId,
      stripePaymentMethodId: `pending_${crypto.randomUUID()}`,
      status: RentalPaymentMethodStatus.SETUP_PENDING,
      mandateAccepted: true,
      mandateAcceptedAt: new Date(),
      mandateIp: input.mandateIp ?? undefined,
      mandateUserAgent: input.mandateUserAgent ?? undefined,
      termsVersion: input.termsVersion,
      createdByUserId: input.userId
    });

    const session = await stripe.checkout.sessions.create({
      mode: "setup",
      customer: profile.stripeCustomerId,
      client_reference_id: booking.id,
      payment_method_types: ["card"],
      success_url: `${env.APP_URL}/rental-bookings/${booking.id}?payment_setup=success`,
      cancel_url: `${env.APP_URL}/rental-bookings/${booking.id}?payment_setup=cancelled`,
      metadata: {
        domain: RENTAL_PAYMENT_DOMAIN,
        purpose: SETUP_PURPOSE,
        tenantId: input.tenantId,
        bookingId: booking.id,
        rentalCustomerId,
        createdByUserId: input.userId,
        paymentMethodRecordId: pending.id
      },
      setup_intent_data: {
        metadata: {
          domain: RENTAL_PAYMENT_DOMAIN,
          purpose: SETUP_PURPOSE,
          tenantId: input.tenantId,
          bookingId: booking.id,
          rentalCustomerId,
          createdByUserId: input.userId,
          paymentMethodRecordId: pending.id
        }
      }
    });

    const setupIntentId = stripeId(session.setup_intent);
    const updated = setupIntentId
      ? await this.deps.updatePaymentMethod(input.tenantId, pending.id, { stripeSetupIntentId: setupIntentId })
      : pending;

    await this.auditRepository.create({
      tenantId: input.tenantId,
      userId: input.userId,
      action: "RENTAL_PAYMENT_SETUP_SESSION_CREATED",
      resource: "rental-payment-method",
      resourceId: updated.id,
      details: {
        bookingId: booking.id,
        rentalCustomerId,
        stripeCustomerId: profile.stripeCustomerId,
        stripeSessionId: session.id,
        termsVersion: input.termsVersion
      }
    });

    if (!session.url) throw new AppError("Creazione setup session Stripe fallita", 502, "RENTAL_PAYMENT_SETUP_SESSION_FAILED");
    return { mode: "stripe", checkoutUrl: session.url, paymentMethodId: updated.id, stripeSessionId: session.id };
  }

  async createDeposit(input: { tenantId: string; bookingId: string; paymentMethodId: string; amountCents: number; userId: string }) {
    if (input.amountCents <= 0) throw new AppError("Importo deposito non valido", 400, "RENTAL_DEPOSIT_AMOUNT_INVALID");
    const stripe = this.requireStripeClient();
    const booking = await this.getBookingOrThrow(input.tenantId, input.bookingId);
    const rentalCustomerId = this.requireBookingCustomerId(booking);
    const paymentMethod = await this.getActivePaymentMethodOrThrow(input.tenantId, input.paymentMethodId, rentalCustomerId);
    const claim = await this.deps.claimActiveDeposit({
      tenantId: input.tenantId,
      bookingId: booking.id,
      rentalCustomerId,
      vehicleId: booking.vehicleId,
      paymentMethodId: paymentMethod.id,
      amountCents: input.amountCents,
      currency: "EUR",
      status: RentalDepositStatus.AUTHORIZING,
      createdByUserId: input.userId,
      approvedByUserId: input.userId
    });
    const deposit = claim.deposit;

    if (!claim.created) {
      const sameRequest = deposit.rentalCustomerId === rentalCustomerId &&
        deposit.paymentMethodId === paymentMethod.id &&
        deposit.amountCents === input.amountCents &&
        deposit.currency.toUpperCase() === "EUR";
      if (!sameRequest) {
        throw new AppError("Esiste gia un deposito attivo per questa prenotazione", 409, "RENTAL_DEPOSIT_ALREADY_ACTIVE");
      }
      if (deposit.stripePaymentIntentId) return this.reconcileIntent("deposit", input.tenantId, deposit.id, deposit.stripePaymentIntentId);
      if (!deposit.createdAt || Date.now() - deposit.createdAt.getTime() >= 23 * 60 * 60 * 1000) {
        throw new AppError("Autorizzazione deposito da verificare prima di un nuovo tentativo", 409, "RENTAL_DEPOSIT_OUTCOME_UNCERTAIN");
      }
    }

    if (claim.created) {
      await this.auditRepository.create({
        tenantId: input.tenantId,
        userId: input.userId,
        action: "RENTAL_DEPOSIT_CREATED",
        resource: "rental-deposit",
        resourceId: deposit.id,
        details: { bookingId: booking.id, rentalCustomerId, amountCents: input.amountCents }
      });
    }

    let paymentIntent: Stripe.PaymentIntent;
    try {
      paymentIntent = await stripe.paymentIntents.create({
        amount: input.amountCents,
        currency: "eur",
        customer: paymentMethod.stripeCustomerId,
        payment_method: paymentMethod.stripePaymentMethodId,
        capture_method: "manual",
        confirm: true,
        off_session: true,
        metadata: {
          domain: RENTAL_PAYMENT_DOMAIN,
          purpose: DEPOSIT_PURPOSE,
          tenantId: input.tenantId,
          bookingId: booking.id,
          rentalCustomerId,
          rentalDepositId: deposit.id,
          paymentMethodId: paymentMethod.id
        }
      }, { idempotencyKey: `rental-deposit:${input.tenantId}:${deposit.id}` });

    } catch (error) {
      const current = await this.getDepositOrThrow(input.tenantId, deposit.id);
      if (current.stripePaymentIntentId) return this.reconcileIntent("deposit", input.tenantId, current.id, current.stripePaymentIntentId);
      const errorIntentId = stripeId((error as { payment_intent?: unknown; raw?: { payment_intent?: unknown } })?.payment_intent)
        ?? stripeId((error as { raw?: { payment_intent?: unknown } })?.raw?.payment_intent);
      if (errorIntentId) return this.reconcileIntent("deposit", input.tenantId, current.id, errorIntentId);
      if (isIndeterminateStripeError(error) || !isDefinitiveStripeError(error)) {
        await this.auditRepository.create({
          tenantId: input.tenantId,
          userId: input.userId,
          action: "RENTAL_DEPOSIT_AUTHORIZATION_UNCERTAIN",
          resource: "rental-deposit",
          resourceId: deposit.id,
          details: { errorCode: stripeErrorCode(error) }
        });
        throw error;
      }
      const updated = await this.deps.compareAndUpdateDeposit(deposit, {
        status: RentalDepositStatus.FAILED, failureReason: stripeErrorMessage(error)
      }, { tenantId: input.tenantId, userId: input.userId, action: "RENTAL_DEPOSIT_FAILED",
        resource: "rental-deposit", resourceId: deposit.id,
        details: { errorCode: stripeErrorCode(error), declineCode: stripeDeclineCode(error) } });
      if (!updated) return this.getDepositOrThrow(input.tenantId, deposit.id);
      throw error;
    }
    return this.applyDepositPaymentIntent(input.tenantId, deposit.id, paymentIntent);
  }

  async captureDeposit(input: { tenantId: string; depositId: string; amountToCaptureCents?: number; userId: string }) {
    const stripe = this.requireStripeClient();
    const deposit = await this.getDepositOrThrow(input.tenantId, input.depositId);
    if (!deposit.stripePaymentIntentId) throw new AppError("PaymentIntent deposito mancante", 409, "RENTAL_DEPOSIT_PAYMENT_INTENT_MISSING");
    if (!CAPTURABLE_DEPOSIT_STATUSES.includes(deposit.status)) {
      throw new AppError("Deposito non catturabile nello stato corrente", 409, "RENTAL_DEPOSIT_NOT_CAPTURABLE");
    }

    const remaining = deposit.amountCents - deposit.capturedAmountCents;
    const amountToCapture = input.amountToCaptureCents ?? remaining;
    if (amountToCapture <= 0 || amountToCapture > remaining) {
      throw new AppError("Importo cattura deposito non valido", 400, "RENTAL_DEPOSIT_CAPTURE_AMOUNT_INVALID");
    }

    const beforeCapture = await stripe.paymentIntents.retrieve(deposit.stripePaymentIntentId);
    await this.validateIntent("deposit", deposit, beforeCapture);
    if (beforeCapture.status !== "requires_capture") return this.reconcileIntent("deposit", input.tenantId, deposit.id, deposit.stripePaymentIntentId);
    const paymentIntent = await stripe.paymentIntents.capture(
      deposit.stripePaymentIntentId,
      { amount_to_capture: amountToCapture },
      { idempotencyKey: `rental-deposit-capture:${input.tenantId}:${deposit.id}:${amountToCapture}` }
    );

    if (paymentIntent.id !== deposit.stripePaymentIntentId) this.bindingError();
    const updated = await this.reconcileIntent("deposit", input.tenantId, deposit.id, deposit.stripePaymentIntentId);
    return updated;
  }

  async releaseDeposit(input: { tenantId: string; depositId: string; userId: string }) {
    const stripe = this.requireStripeClient();
    const deposit = await this.getDepositOrThrow(input.tenantId, input.depositId);
    if (!deposit.stripePaymentIntentId) throw new AppError("PaymentIntent deposito mancante", 409, "RENTAL_DEPOSIT_PAYMENT_INTENT_MISSING");
    if (!RELEASABLE_DEPOSIT_STATUSES.includes(deposit.status)) {
      throw new AppError("Deposito non rilasciabile nello stato corrente", 409, "RENTAL_DEPOSIT_NOT_RELEASABLE");
    }

    const beforeRelease = await stripe.paymentIntents.retrieve(deposit.stripePaymentIntentId);
    await this.validateIntent("deposit", deposit, beforeRelease);
    if (beforeRelease.status === "succeeded" || beforeRelease.status === "canceled") return this.reconcileIntent("deposit", input.tenantId, deposit.id, deposit.stripePaymentIntentId);
    const canceled = await stripe.paymentIntents.cancel(deposit.stripePaymentIntentId, {}, {
      idempotencyKey: `rental-deposit-release:${input.tenantId}:${deposit.id}`
    });

    if (canceled.id !== deposit.stripePaymentIntentId) this.bindingError();
    const updated = await this.reconcileIntent("deposit", input.tenantId, deposit.id, deposit.stripePaymentIntentId);

    return updated;
  }

  async createExtraCharge(input: {
    tenantId: string;
    bookingId: string;
    paymentMethodId?: string;
    type: RentalExtraChargeType;
    description: string;
    amountCents: number;
    adminFeeCents?: number;
    evidenceFileUrl?: string;
    userId: string;
  }) {
    if (input.amountCents <= 0) throw new AppError("Importo extra charge non valido", 400, "RENTAL_EXTRA_CHARGE_AMOUNT_INVALID");
    if (!input.description.trim()) throw new AppError("Causale extra charge obbligatoria", 400, "RENTAL_EXTRA_CHARGE_REASON_REQUIRED");

    const booking = await this.getBookingOrThrow(input.tenantId, input.bookingId);
    const rentalCustomerId = this.requireBookingCustomerId(booking);
    const paymentMethod = input.paymentMethodId
      ? await this.getActivePaymentMethodOrThrow(input.tenantId, input.paymentMethodId, rentalCustomerId)
      : null;
    const adminFeeCents = input.adminFeeCents ?? 0;
    const totalAmountCents = input.amountCents + adminFeeCents;

    const extraCharge = await this.deps.createExtraCharge({
      tenantId: input.tenantId,
      bookingId: booking.id,
      rentalCustomerId,
      vehicleId: booking.vehicleId,
      paymentMethodId: paymentMethod?.id,
      type: input.type,
      description: input.description.trim(),
      amountCents: input.amountCents,
      adminFeeCents,
      totalAmountCents,
      currency: "EUR",
      status: RentalExtraChargeStatus.PENDING_APPROVAL,
      evidenceFileUrl: input.evidenceFileUrl,
      createdByUserId: input.userId
    });

    await this.auditRepository.create({
      tenantId: input.tenantId,
      userId: input.userId,
      action: "RENTAL_EXTRA_CHARGE_CREATED",
      resource: "rental-extra-charge",
      resourceId: extraCharge.id,
      details: { bookingId: booking.id, rentalCustomerId, type: input.type, totalAmountCents }
    });

    return extraCharge;
  }

  async approveExtraCharge(input: { tenantId: string; extraChargeId: string; userId: string }) {
    const extraCharge = await this.getExtraChargeOrThrow(input.tenantId, input.extraChargeId);
    if (!APPROVABLE_EXTRA_STATUSES.includes(extraCharge.status)) {
      throw new AppError("Extra charge non approvabile nello stato corrente", 409, "RENTAL_EXTRA_CHARGE_NOT_APPROVABLE");
    }
    const updated = await this.deps.compareAndUpdateExtraCharge(extraCharge, {
      status: RentalExtraChargeStatus.APPROVED, approvedByUserId: input.userId
    }, { tenantId: input.tenantId, userId: input.userId, action: "RENTAL_EXTRA_CHARGE_APPROVED",
      resource: "rental-extra-charge", resourceId: input.extraChargeId,
      details: { bookingId: extraCharge.bookingId, totalAmountCents: extraCharge.totalAmountCents } });
    if (!updated) throw new AppError("Pagamento modificato da un'altra richiesta", 409, "RENTAL_PAYMENT_CONFLICT");
    return updated;
  }

  async notifyExtraCharge(input: { tenantId: string; extraChargeId: string; userId: string }) {
    return requestExtraChargeNotice(input, this.emailQueueService);
  }

  async chargeExtraCharge(input: { tenantId: string; extraChargeId: string; paymentMethodId?: string; userId: string }) {
    const stripe = this.requireStripeClient();
    const extra = await this.getExtraChargeOrThrow(input.tenantId, input.extraChargeId);
    if (!CHARGEABLE_EXTRA_STATUSES.includes(extra.status) && extra.status !== RentalExtraChargeStatus.PAYMENT_PROCESSING) {
      throw new AppError("Extra charge non addebitabile nello stato corrente", 409, "RENTAL_EXTRA_CHARGE_NOT_CHARGEABLE");
    }
    // A known intent is reconciled, never replaced by a second create request.
    if (extra.stripePaymentIntentId) {
      return this.reconcileIntent("extra", extra.tenantId, extra.id, extra.stripePaymentIntentId);
    }
    if (!CHARGEABLE_EXTRA_STATUSES.includes(extra.status)) {
      throw new AppError("Extra charge non addebitabile nello stato corrente", 409, "RENTAL_EXTRA_CHARGE_NOT_CHARGEABLE");
    }
    const paymentMethodId = input.paymentMethodId ?? extra.paymentMethodId;
    if (!paymentMethodId) throw new AppError("Metodo di pagamento obbligatorio", 400, "RENTAL_EXTRA_CHARGE_PAYMENT_METHOD_REQUIRED");
    const method = await this.getActivePaymentMethodOrThrow(input.tenantId, paymentMethodId, extra.rentalCustomerId);
    const claimed = await this.deps.compareAndUpdateExtraCharge(extra, {
      status: RentalExtraChargeStatus.PAYMENT_PROCESSING, paymentMethodId: method.id, failureReason: null
    }, { tenantId: input.tenantId, userId: input.userId,
      action: "RENTAL_EXTRA_CHARGE_PAYMENT_STARTED", resource: "rental-extra-charge", resourceId: extra.id,
      details: { bookingId: extra.bookingId, totalAmountCents: extra.totalAmountCents } });
    if (!claimed) throw new AppError("Pagamento modificato da un'altra richiesta", 409, "RENTAL_PAYMENT_CONFLICT");
    let intent: Stripe.PaymentIntent;
    try {
      intent = await stripe.paymentIntents.create({
        amount: claimed.totalAmountCents, currency: claimed.currency.toLowerCase(), customer: method.stripeCustomerId,
        payment_method: method.stripePaymentMethodId, off_session: true, confirm: true,
        description: `Addebito extra noleggio ${claimed.bookingId} - ${claimed.type}`,
        metadata: { domain: RENTAL_PAYMENT_DOMAIN, purpose: EXTRA_CHARGE_PURPOSE, tenantId: claimed.tenantId,
          bookingId: claimed.bookingId, rentalCustomerId: claimed.rentalCustomerId,
          rentalExtraChargeId: claimed.id, paymentMethodId: method.id, chargeType: claimed.type }
      }, { idempotencyKey: `rental-extra-charge:${claimed.tenantId}:${claimed.id}` });
    } catch (error) {
      const current = await this.getExtraChargeOrThrow(input.tenantId, extra.id);
      if (current.stripePaymentIntentId) return this.reconcileIntent("extra", current.tenantId, current.id, current.stripePaymentIntentId);
      const errorIntentId = stripeId((error as { payment_intent?: unknown; raw?: { payment_intent?: unknown } })?.payment_intent)
        ?? stripeId((error as { raw?: { payment_intent?: unknown } })?.raw?.payment_intent);
      if (errorIntentId) return this.reconcileIntent("extra", current.tenantId, current.id, errorIntentId);
      if (isIndeterminateStripeError(error) || !isDefinitiveStripeError(error)) {
        // No automatic re-create: Stripe can prune idempotency keys after 24 hours.
        await this.auditRepository.create({ tenantId: input.tenantId, userId: input.userId,
          action: "RENTAL_EXTRA_CHARGE_PAYMENT_UNCERTAIN", resource: "rental-extra-charge", resourceId: extra.id,
          details: { errorCode: stripeErrorCode(error) } });
        throw error;
      }
      const nextStatus = statusForStripePaymentError(error);
      const updated = await this.deps.compareAndUpdateExtraCharge(claimed, { status: nextStatus, failureReason: stripeErrorMessage(error) }, { tenantId: input.tenantId, userId: input.userId,
        action: nextStatus === RentalExtraChargeStatus.REQUIRES_ACTION ? "RENTAL_EXTRA_CHARGE_REQUIRES_ACTION" : "RENTAL_EXTRA_CHARGE_FAILED",
        resource: "rental-extra-charge", resourceId: extra.id,
        details: { errorCode: stripeErrorCode(error), declineCode: stripeDeclineCode(error) } });
      if (!updated) return this.getExtraChargeOrThrow(input.tenantId, extra.id);
      return updated;
    }
    // Provider success must not be caught and mistaken for a declined charge if persistence fails.
    return this.reconcileIntent("extra", claimed.tenantId, claimed.id, intent.id);
  }

  async cancelExtraCharge(input: { tenantId: string; extraChargeId: string; userId: string }) {
    const extra = await this.getExtraChargeOrThrow(input.tenantId, input.extraChargeId);
    if (NON_CANCELABLE_EXTRA_STATUSES.includes(extra.status) || extra.stripePaymentIntentId) {
      throw new AppError("Extra charge non annullabile mentre il pagamento e in verifica", 409, "RENTAL_EXTRA_CHARGE_NOT_CANCELABLE");
    }
    if (extra.status === RentalExtraChargeStatus.CANCELED) return extra;
    const updated = await this.deps.compareAndUpdateExtraCharge(extra, { status: RentalExtraChargeStatus.CANCELED }, { tenantId: input.tenantId, userId: input.userId,
      action: "RENTAL_EXTRA_CHARGE_CANCELED", resource: "rental-extra-charge", resourceId: extra.id,
      details: { bookingId: extra.bookingId } });
    if (!updated) throw new AppError("Pagamento modificato da un'altra richiesta", 409, "RENTAL_PAYMENT_CONFLICT");
    return updated;
  }

  async handleStripeEvent(event: Stripe.Event) {
    const dataObject = event.data.object as unknown as Record<string, unknown> | undefined;
    let metadata = metadataFromObject(dataObject);
    if (event.type.startsWith("payment_intent.")) {
      const intentId = stripeId(dataObject?.id);
      if (!intentId) this.bindingError();
      const verified = await this.verifiedEventIntent(intentId, metadata);
      if (!verified) return { ignored: true, tenantId: null };
      metadata = verified.metadata;
    } else if (["charge.refunded", "charge.dispute.created", "charge.dispute.closed"].includes(event.type)) {
      const charge = await this.eventCharge(event);
      const intentId = stripeId(charge.payment_intent);
      if (!intentId) return { ignored: true, tenantId: null };
      const verified = await this.verifiedEventIntent(intentId, metadata);
      if (!verified || verified.kind !== "extra") return { ignored: true, tenantId: null };
      metadata = verified.metadata;
    }
    const tenantId = metadata.tenantId;
    if (!tenantId) return { ignored: true, tenantId: null };

    const refs: RentalPaymentEventRefs = {
      paymentProfileId: metadata.paymentProfileId,
      paymentMethodId: metadata.paymentMethodRecordId ?? metadata.paymentMethodId,
      depositId: metadata.rentalDepositId,
      extraChargeId: metadata.rentalExtraChargeId,
      bookingId: metadata.bookingId,
      rentalCustomerId: metadata.rentalCustomerId
    };
    const paymentEvent = await this.deps.createRentalPaymentEvent(event, tenantId, refs);
    if (paymentEvent.processedAt && paymentEvent.status === "PROCESSED") {
      return { duplicate: true, tenantId };
    }

    try {
      await this.processRentalStripeEvent(event, dataObject, metadata);
      await this.deps.updateRentalPaymentEvent(event.id, { status: "PROCESSED", processedAt: new Date(), errorMessage: null });
      return { received: true, tenantId };
    } catch (error) {
      await this.deps.updateRentalPaymentEvent(event.id, {
        status: "FAILED",
        errorMessage: error instanceof Error ? error.message.slice(0, 1000) : "Rental webhook failed"
      });
      throw error;
    }
  }

  private async processRentalStripeEvent(event: Stripe.Event, dataObject: Record<string, unknown> | undefined, metadata: Record<string, string>) {
    if (!dataObject) return;

    if (event.type === "checkout.session.completed") {
      const session = dataObject as unknown as Stripe.Checkout.Session;
      if (session.mode === "setup") {
        const setupIntentId = stripeId(session.setup_intent);
        if (setupIntentId) await this.activatePaymentMethodFromSetupIntent(setupIntentId, metadata);
      }
      return;
    }

    if (event.type === "setup_intent.succeeded") {
      await this.activatePaymentMethodFromSetupIntent(stripeId(dataObject.id) ?? "", metadata);
      return;
    }

    if (event.type === "setup_intent.setup_failed") {
      const paymentMethodId = metadata.paymentMethodRecordId;
      if (paymentMethodId) {
        await this.deps.updatePaymentMethod(metadata.tenantId, paymentMethodId, { status: RentalPaymentMethodStatus.FAILED });
        await this.auditRepository.create({
          tenantId: metadata.tenantId,
          userId: metadata.createdByUserId ?? null,
          action: "RENTAL_PAYMENT_METHOD_FAILED",
          resource: "rental-payment-method",
          resourceId: paymentMethodId,
          details: { setupIntentId: stripeId(dataObject.id) }
        });
      }
      return;
    }

    if (event.type.startsWith("payment_intent.")) {
      await this.applyPaymentIntentEvent(event.type, dataObject, metadata);
      return;
    }

    if (event.type === "charge.refunded") {
      await this.markPaymentIntentLinkedRecord(event, metadata);
      return;
    }

    if (event.type === "charge.dispute.created" || event.type === "charge.dispute.closed") {
      await this.markPaymentIntentLinkedRecord(event, metadata);
    }
  }

  private async activatePaymentMethodFromSetupIntent(setupIntentId: string, fallbackMetadata: Record<string, string>) {
    if (!setupIntentId) return;
    const stripe = this.requireStripeClient();
    const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
    const metadata = { ...fallbackMetadata, ...metadataFromObject(setupIntent) };
    const tenantId = metadata.tenantId;
    const paymentMethodRecordId = metadata.paymentMethodRecordId;
    const stripePaymentMethodId = stripeId(setupIntent.payment_method);
    if (!tenantId || !stripePaymentMethodId) return;

    const stripePaymentMethod = await stripe.paymentMethods.retrieve(stripePaymentMethodId);
    const existing = await this.deps.findPaymentMethodByStripeId(stripePaymentMethodId);
    const pending = paymentMethodRecordId
      ? await this.deps.findPaymentMethodById(tenantId, paymentMethodRecordId)
      : await this.deps.findPaymentMethodBySetupIntentId(setupIntentId);
    const target = existing ?? pending;
    if (!target) return;

    const card = stripePaymentMethod.card;
    const updated = await this.deps.updatePaymentMethod(tenantId, target.id, {
      stripePaymentMethodId,
      stripeSetupIntentId: setupIntentId,
      cardBrand: card?.brand ?? null,
      cardLast4: card?.last4 ?? null,
      cardExpMonth: card?.exp_month ?? null,
      cardExpYear: card?.exp_year ?? null,
      cardholderName: stripePaymentMethod.billing_details?.name ?? null,
      status: RentalPaymentMethodStatus.ACTIVE,
      isDefault: true
    });

    await this.auditRepository.create({
      tenantId,
      userId: metadata.createdByUserId ?? null,
      action: "RENTAL_PAYMENT_METHOD_ACTIVATED",
      resource: "rental-payment-method",
      resourceId: updated.id,
      details: {
        rentalCustomerId: updated.rentalCustomerId,
        bookingId: updated.bookingId,
        stripeCustomerId: updated.stripeCustomerId,
        stripeSetupIntentId: setupIntentId,
        cardBrand: updated.cardBrand,
        cardLast4: updated.cardLast4
      }
    });
  }

  private bindingError(): never {
    throw new AppError("Identita o importo del pagamento non coerente", 409, "RENTAL_PAYMENT_BINDING_MISMATCH");
  }

  private assertMetadataAgreement(observed: Record<string, string>, authoritative: Record<string, string>) {
    for (const key of ["domain", "purpose", "tenantId", "bookingId", "rentalCustomerId", "paymentMethodId", "rentalDepositId", "rentalExtraChargeId"]) {
      if (observed[key] && observed[key] !== authoritative[key]) this.bindingError();
    }
  }

  private async validateIntent(kind: "extra" | "deposit", row: ExtraChargeRecord | DepositRecord, intent: Stripe.PaymentIntent) {
    const metadata = metadataFromObject(intent);
    const resourceKey = kind === "extra" ? "rentalExtraChargeId" : "rentalDepositId";
    const oppositeKey = kind === "extra" ? "rentalDepositId" : "rentalExtraChargeId";
    const expectedAmount = kind === "extra" ? (row as ExtraChargeRecord).totalAmountCents : (row as DepositRecord).amountCents;
    if (metadata.domain !== RENTAL_PAYMENT_DOMAIN || metadata.purpose !== (kind === "extra" ? EXTRA_CHARGE_PURPOSE : DEPOSIT_PURPOSE)
      || metadata[resourceKey] !== row.id || metadata[oppositeKey] || metadata.tenantId !== row.tenantId
      || metadata.bookingId !== row.bookingId || metadata.rentalCustomerId !== row.rentalCustomerId
      || !row.paymentMethodId || metadata.paymentMethodId !== row.paymentMethodId
      || intent.object !== "payment_intent" || !["requires_payment_method", "requires_confirmation", "requires_action", "processing", "requires_capture", "canceled", "succeeded"].includes(intent.status)
      || !intent.id || !Number.isSafeInteger(intent.amount) || intent.amount !== expectedAmount
      || intent.currency?.toLowerCase() !== row.currency.toLowerCase()
      || !Number.isSafeInteger(intent.amount_received) || intent.amount_received < 0 || intent.amount_received > expectedAmount) this.bindingError();
    if (row.stripePaymentIntentId ? row.stripePaymentIntentId !== intent.id
      : row.status !== (kind === "extra" ? RentalExtraChargeStatus.PAYMENT_PROCESSING : RentalDepositStatus.AUTHORIZING)) this.bindingError();
    const method = await this.deps.findHistoricalPaymentMethodById(row.tenantId, row.paymentMethodId!);
    if (!method || method.id !== row.paymentMethodId || method.tenantId !== row.tenantId || method.rentalCustomerId !== row.rentalCustomerId
      || stripeId(intent.customer) !== method.stripeCustomerId || stripeId(intent.payment_method) !== method.stripePaymentMethodId) this.bindingError();
  }

  private async verifiedEventIntent(intentId: string, observed: Record<string, string>) {
    const intent = await this.requireStripeClient().paymentIntents.retrieve(intentId);
    if (intent.id !== intentId) this.bindingError();
    const metadata = metadataFromObject(intent);
    if (metadata.domain !== RENTAL_PAYMENT_DOMAIN) {
      if (observed.domain === RENTAL_PAYMENT_DOMAIN || observed.rentalDepositId || observed.rentalExtraChargeId) this.bindingError();
      return null;
    }
    this.assertMetadataAgreement(observed, metadata);
    const kind = metadata.purpose === DEPOSIT_PURPOSE ? "deposit" : metadata.purpose === EXTRA_CHARGE_PURPOSE ? "extra" : null;
    if (!kind || !metadata.tenantId) this.bindingError();
    const row = kind === "deposit" ? await this.deps.findDepositById(metadata.tenantId, metadata.rentalDepositId)
      : await this.deps.findExtraChargeById(metadata.tenantId, metadata.rentalExtraChargeId);
    if (!row) this.bindingError();
    await this.validateIntent(kind, row, intent);
    return { intent, metadata, kind, row };
  }

  private async reconcileIntent(kind: "extra", tenantId: string, recordId: string, intentId: string): Promise<ExtraChargeRecord>;
  private async reconcileIntent(kind: "deposit", tenantId: string, recordId: string, intentId: string): Promise<DepositRecord>;
  private async reconcileIntent(kind: "extra" | "deposit", tenantId: string, recordId: string, intentId: string): Promise<ExtraChargeRecord | DepositRecord> {
    // Each conflict reloads both the committed row and the provider object; never reuse a stale snapshot.
    for (let attempt = 0; attempt < 5; attempt++) {
      const snapshot = kind === "extra" ? await this.getExtraChargeOrThrow(tenantId, recordId) : await this.getDepositOrThrow(tenantId, recordId);
      const intent = await this.requireStripeClient().paymentIntents.retrieve(intentId);
      if (intent.id !== intentId) this.bindingError();
      if (kind === "extra") {
        const row = snapshot as ExtraChargeRecord;
        await this.validateIntent(kind, row, intent);
        if (["PAID", "REFUNDED", "DISPUTED"].includes(row.status)) return row;
        if (row.status === "CANCELED" && intent.status !== "canceled") this.bindingError();
        const status = intent.status === "succeeded" ? RentalExtraChargeStatus.PAID
          : intent.status === "canceled" ? RentalExtraChargeStatus.CANCELED
          : intent.status === "requires_action" ? RentalExtraChargeStatus.REQUIRES_ACTION
          : intent.status === "requires_payment_method" ? RentalExtraChargeStatus.FAILED : RentalExtraChargeStatus.PAYMENT_PROCESSING;
        if (status === "PAID" && intent.amount_received !== row.totalAmountCents) this.bindingError();
        if (row.status === status && row.stripePaymentIntentId === intent.id) return row;
        const updated = await this.deps.compareAndUpdateExtraCharge(row, {
          stripePaymentIntentId: intent.id, status,
          chargedAt: status === "PAID" ? new Date() : undefined,
          failureReason: status === "FAILED" || status === "REQUIRES_ACTION" ? optionalString(intent.last_payment_error?.message) : null
        }, row.status !== status ? { tenantId, userId: null,
          action: `RENTAL_EXTRA_CHARGE_${status}`, resource: "rental-extra-charge", resourceId: row.id,
          details: { bookingId: row.bookingId, totalAmountCents: row.totalAmountCents } } : undefined);
        if (!updated) continue;
        return updated;
      }
      const row = snapshot as DepositRecord;
      await this.validateIntent(kind, row, intent);
      if (row.capturedAmountCents > 0 || ["CAPTURED", "PARTIALLY_CAPTURED"].includes(row.status)) return row;
      if (["RELEASED", "CANCELED", "EXPIRED"].includes(row.status) && intent.status !== "canceled") this.bindingError();
      const status = intent.status === "succeeded" ? (intent.amount_received < row.amountCents ? RentalDepositStatus.PARTIALLY_CAPTURED : RentalDepositStatus.CAPTURED)
        : intent.status === "requires_capture" ? RentalDepositStatus.AUTHORIZED
        : intent.status === "canceled" ? RentalDepositStatus.RELEASED
        : ["requires_payment_method", "requires_action"].includes(intent.status) ? RentalDepositStatus.FAILED : RentalDepositStatus.AUTHORIZING;
      if (intent.status === "succeeded" && intent.amount_received <= 0) this.bindingError();
      if (row.status === status && row.stripePaymentIntentId === intent.id) return row;
      const updated = await this.deps.compareAndUpdateDeposit(row, {
        stripePaymentIntentId: intent.id, status,
        capturedAmountCents: intent.status === "succeeded" ? intent.amount_received : row.capturedAmountCents,
        capturedAt: intent.status === "succeeded" ? new Date() : undefined,
        authorizedAt: status === "AUTHORIZED" ? new Date() : undefined,
        releasedAt: status === "RELEASED" ? new Date() : undefined,
        failureReason: status === "FAILED" ? optionalString(intent.last_payment_error?.message) : null
      }, row.status !== status ? { tenantId, userId: null,
        action: `RENTAL_DEPOSIT_${status}`, resource: "rental-deposit", resourceId: row.id,
        details: { bookingId: row.bookingId, stripePaymentIntentId: intent.id, capturedTotalCents: intent.amount_received } } : undefined);
      if (!updated) continue;
      return updated;
    }
    throw new AppError("Pagamento aggiornato da richieste concorrenti, riprovare la verifica", 503, "RENTAL_PAYMENT_RECONCILIATION_CONFLICT");
  }

  private async applyPaymentIntentEvent(_eventType: string, dataObject: Record<string, unknown>, metadata: Record<string, string>) {
    const intentId = stripeId(dataObject.id);
    if (!intentId) this.bindingError();
    if (metadata.purpose === EXTRA_CHARGE_PURPOSE) await this.reconcileIntent("extra", metadata.tenantId, metadata.rentalExtraChargeId, intentId);
    else await this.reconcileIntent("deposit", metadata.tenantId, metadata.rentalDepositId, intentId);
  }

  private async eventCharge(event: Stripe.Event) {
    const object = event.data.object as unknown as Record<string, unknown>;
    const stripe = this.requireStripeClient();
    let chargeId = event.type === "charge.refunded" ? stripeId(object.id) : stripeId(object.charge);
    if (event.type.startsWith("charge.dispute.")) {
      const disputeId = stripeId(object.id);
      if (!disputeId) this.bindingError();
      const dispute = await stripe.disputes.retrieve(disputeId);
      if (dispute.id !== disputeId) this.bindingError();
      chargeId = stripeId(dispute.charge);
    }
    if (!chargeId) this.bindingError();
    const charge = await stripe.charges.retrieve(chargeId);
    if (charge.id !== chargeId || (stripeId(object.payment_intent) && stripeId(object.payment_intent) !== stripeId(charge.payment_intent))) this.bindingError();
    return charge;
  }

  private async markPaymentIntentLinkedRecord(event: Stripe.Event, metadata: Record<string, string>) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const charge = await this.eventCharge(event);
      const intentId = stripeId(charge.payment_intent);
      if (!intentId) return;
      const verified = await this.verifiedEventIntent(intentId, metadata);
      if (!verified || verified.kind !== "extra") return;
      const row = verified.row as ExtraChargeRecord;
      if (charge.amount !== row.totalAmountCents || charge.currency.toLowerCase() !== row.currency.toLowerCase()
        || stripeId(charge.customer) !== stripeId(verified.intent.customer)) this.bindingError();
      const status = event.type.startsWith("charge.dispute.") || charge.disputed || row.status === "DISPUTED"
        ? RentalExtraChargeStatus.DISPUTED : charge.amount_refunded > 0 ? RentalExtraChargeStatus.REFUNDED : null;
      if (!status || row.status === status) return;
      const updated = await this.deps.compareAndUpdateExtraCharge(row, { stripePaymentIntentId: intentId, status }, { tenantId: row.tenantId, userId: null,
        action: status === "DISPUTED" ? "RENTAL_EXTRA_CHARGE_DISPUTED" : "RENTAL_EXTRA_CHARGE_REFUNDED",
        resource: "rental-extra-charge", resourceId: row.id,
        details: { bookingId: row.bookingId, stripePaymentIntentId: intentId } });
      if (!updated) continue;
      return;
    }
    throw new AppError("Riconciliazione pagamento concorrente", 503, "RENTAL_PAYMENT_RECONCILIATION_CONFLICT");
  }

  private async applyDepositPaymentIntent(tenantId: string, depositId: string, paymentIntent: Stripe.PaymentIntent) {
    return this.reconcileIntent("deposit", tenantId, depositId, paymentIntent.id);
  }

  private async getOrCreateRentalStripeCustomer(tenantId: string, rentalCustomerId: string, booking: BookingForPayment) {
    const existing = await this.deps.findPaymentProfile(tenantId, rentalCustomerId);
    if (existing?.stripeCustomerId && !existing.deletedAt) return existing;

    const stripe = this.requireStripeClient();
    const customer = booking.customer;
    const displayName = customer?.customerType === "PERSONA_GIURIDICA"
      ? customer.companyName || booking.customerName
      : [customer?.firstName, customer?.lastName].filter(Boolean).join(" ") || booking.customerName;

    const stripeCustomer = await stripe.customers.create({
      email: customer?.email ?? booking.customerEmail ?? undefined,
      phone: customer?.phone ?? booking.customerPhone ?? undefined,
      name: displayName || undefined,
      metadata: {
        domain: RENTAL_PAYMENT_DOMAIN,
        tenantId,
        rentalCustomerId,
        source: "fleetum"
      }
    });

    const profile = await this.deps.createPaymentProfile({
      tenantId,
      rentalCustomerId,
      stripeCustomerId: stripeCustomer.id,
      status: "ACTIVE"
    });

    await this.auditRepository.create({
      tenantId,
      userId: null,
      action: "RENTAL_PAYMENT_PROFILE_CREATED",
      resource: "rental-payment-profile",
      resourceId: profile.id,
      details: { rentalCustomerId, stripeCustomerId: stripeCustomer.id }
    });

    return profile;
  }

  private requireStripeClient() {
    if (!env.STRIPE_SECRET_KEY || !this.stripeClient) {
      throw new AppError("Stripe non configurato per garanzie noleggio", 500, "RENTAL_STRIPE_NOT_CONFIGURED");
    }
    return this.stripeClient;
  }

  private async getBookingOrThrow(tenantId: string, bookingId: string) {
    const booking = await this.deps.findBookingForPayment(tenantId, bookingId);
    if (!booking) throw new AppError("Prenotazione non trovata", 404, "RENTAL_BOOKING_NOT_FOUND");
    return booking;
  }

  private requireBookingCustomerId(booking: BookingForPayment) {
    if (!booking.customerId || !booking.customer || booking.customer.deletedAt) {
      throw new AppError("Cliente noleggio mancante", 409, "RENTAL_BOOKING_CUSTOMER_MISSING");
    }
    return booking.customerId;
  }

  private async getActivePaymentMethodOrThrow(tenantId: string, paymentMethodId: string, rentalCustomerId: string) {
    const paymentMethod = await this.deps.findPaymentMethodById(tenantId, paymentMethodId);
    if (!paymentMethod || paymentMethod.rentalCustomerId !== rentalCustomerId) {
      throw new AppError("Metodo di pagamento non trovato", 404, "RENTAL_PAYMENT_METHOD_NOT_FOUND");
    }
    if (paymentMethod.status !== RentalPaymentMethodStatus.ACTIVE || !paymentMethod.mandateAccepted) {
      throw new AppError("Metodo di pagamento non attivo o mandato mancante", 409, "RENTAL_PAYMENT_METHOD_NOT_ACTIVE");
    }
    return paymentMethod;
  }

  private async getDepositOrThrow(tenantId: string, depositId: string) {
    const deposit = await this.deps.findDepositById(tenantId, depositId);
    if (!deposit) throw new AppError("Deposito non trovato", 404, "RENTAL_DEPOSIT_NOT_FOUND");
    return deposit;
  }

  private async getExtraChargeOrThrow(tenantId: string, extraChargeId: string) {
    const extraCharge = await this.deps.findExtraChargeById(tenantId, extraChargeId);
    if (!extraCharge) throw new AppError("Extra charge non trovato", 404, "RENTAL_EXTRA_CHARGE_NOT_FOUND");
    return extraCharge;
  }
}
