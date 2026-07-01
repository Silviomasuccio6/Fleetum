import crypto from "node:crypto";
import Stripe from "stripe";
import { Prisma } from "@prisma/client";
import { AuditLogRepository } from "../../domain/repositories/audit-log-repository.js";
import { prisma } from "../../infrastructure/database/prisma/client.js";
import { EmailQueueService } from "../../infrastructure/email/email-queue-service.js";
import { env } from "../../shared/config/env.js";
import { AppError } from "../../shared/errors/app-error.js";

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

const EXTRA_CHARGE_ALREADY_PROCESSING_STATUSES: readonly RentalExtraChargeStatus[] = [
  RentalExtraChargeStatus.PAYMENT_PROCESSING,
  RentalExtraChargeStatus.PAID
];

const NON_CANCELABLE_EXTRA_STATUSES: readonly RentalExtraChargeStatus[] = [
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
};

type RentalPaymentEventRecord = {
  eventId: string;
  status: string;
  processedAt: Date | null;
};

type RentalPaymentServiceDeps = {
  findBookingForPayment(tenantId: string, bookingId: string): Promise<BookingForPayment | null>;
  findPaymentProfile(tenantId: string, rentalCustomerId: string): Promise<PaymentProfileRecord | null>;
  createPaymentProfile(input: Prisma.RentalCustomerPaymentProfileUncheckedCreateInput): Promise<PaymentProfileRecord>;
  createPendingPaymentMethod(input: Prisma.RentalCustomerPaymentMethodUncheckedCreateInput): Promise<PaymentMethodRecord>;
  updatePaymentMethod(tenantId: string, paymentMethodId: string, data: Prisma.RentalCustomerPaymentMethodUncheckedUpdateInput): Promise<PaymentMethodRecord>;
  findPaymentMethodById(tenantId: string, paymentMethodId: string): Promise<PaymentMethodRecord | null>;
  findPaymentMethodByStripeId(stripePaymentMethodId: string): Promise<PaymentMethodRecord | null>;
  findPaymentMethodBySetupIntentId(stripeSetupIntentId: string): Promise<PaymentMethodRecord | null>;
  listPaymentMethods(tenantId: string, rentalCustomerId: string): Promise<PaymentMethodRecord[]>;
  listDepositsByBooking(tenantId: string, bookingId: string): Promise<DepositRecord[]>;
  listExtraChargesByBooking(tenantId: string, bookingId: string): Promise<ExtraChargeRecord[]>;
  findActiveDeposit(tenantId: string, bookingId: string): Promise<DepositRecord | null>;
  createDeposit(input: Prisma.RentalDepositUncheckedCreateInput): Promise<DepositRecord>;
  updateDeposit(tenantId: string, depositId: string, data: Prisma.RentalDepositUncheckedUpdateInput): Promise<DepositRecord>;
  findDepositById(tenantId: string, depositId: string): Promise<DepositRecord | null>;
  findDepositByStripePaymentIntentId(stripePaymentIntentId: string): Promise<DepositRecord | null>;
  createExtraCharge(input: Prisma.RentalExtraChargeUncheckedCreateInput): Promise<ExtraChargeRecord>;
  updateExtraCharge(tenantId: string, extraChargeId: string, data: Prisma.RentalExtraChargeUncheckedUpdateInput): Promise<ExtraChargeRecord>;
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
  failureReason: true
} as const;

const defaultDeps: RentalPaymentServiceDeps = {
  async findBookingForPayment(tenantId, bookingId) {
    return prisma.rentalBooking.findFirst({
      where: { id: bookingId, tenantId, deletedAt: null },
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
    return prisma.rentalExtraCharge.findMany({ where: { tenantId, bookingId, deletedAt: null }, orderBy: { createdAt: "desc" }, select: extraChargeSelect });
  },
  async findActiveDeposit(tenantId, bookingId) {
    return prisma.rentalDeposit.findFirst({ where: { tenantId, bookingId, status: { in: ACTIVE_DEPOSIT_STATUSES }, deletedAt: null }, select: depositSelect });
  },
  async createDeposit(input) {
    return prisma.rentalDeposit.create({ data: input, select: depositSelect });
  },
  async updateDeposit(tenantId, depositId, data) {
    const updated = await prisma.rentalDeposit.updateMany({ where: { id: depositId, tenantId }, data });
    if (updated.count !== 1) throw new AppError("Deposito non trovato", 404, "RENTAL_DEPOSIT_NOT_FOUND");
    const row = await prisma.rentalDeposit.findFirst({ where: { id: depositId, tenantId }, select: depositSelect });
    if (!row) throw new AppError("Deposito non trovato", 404, "RENTAL_DEPOSIT_NOT_FOUND");
    return row;
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
    const activeDeposit = await this.deps.findActiveDeposit(input.tenantId, input.bookingId);
    if (activeDeposit) throw new AppError("Esiste gia un deposito attivo per questa prenotazione", 409, "RENTAL_DEPOSIT_ALREADY_ACTIVE");

    let deposit = await this.deps.createDeposit({
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

    await this.auditRepository.create({
      tenantId: input.tenantId,
      userId: input.userId,
      action: "RENTAL_DEPOSIT_CREATED",
      resource: "rental-deposit",
      resourceId: deposit.id,
      details: { bookingId: booking.id, rentalCustomerId, amountCents: input.amountCents }
    });

    try {
      const paymentIntent = await stripe.paymentIntents.create({
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

      deposit = await this.applyDepositPaymentIntent(input.tenantId, deposit.id, paymentIntent);
      return deposit;
    } catch (error) {
      deposit = await this.deps.updateDeposit(input.tenantId, deposit.id, {
        status: RentalDepositStatus.FAILED,
        failureReason: stripeErrorMessage(error)
      });
      await this.auditRepository.create({
        tenantId: input.tenantId,
        userId: input.userId,
        action: "RENTAL_DEPOSIT_FAILED",
        resource: "rental-deposit",
        resourceId: deposit.id,
        details: { errorCode: stripeErrorCode(error), declineCode: stripeDeclineCode(error) }
      });
      throw error;
    }
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

    const paymentIntent = await stripe.paymentIntents.capture(
      deposit.stripePaymentIntentId,
      { amount_to_capture: amountToCapture },
      { idempotencyKey: `rental-deposit-capture:${input.tenantId}:${deposit.id}:${amountToCapture}` }
    );

    const capturedTotal = deposit.capturedAmountCents + amountToCapture;
    const nextStatus = capturedTotal >= deposit.amountCents ? RentalDepositStatus.CAPTURED : RentalDepositStatus.PARTIALLY_CAPTURED;
    const updated = await this.deps.updateDeposit(input.tenantId, deposit.id, {
      status: nextStatus,
      capturedAmountCents: capturedTotal,
      capturedAt: new Date(),
      stripePaymentIntentId: paymentIntent.id
    });

    await this.auditRepository.create({
      tenantId: input.tenantId,
      userId: input.userId,
      action: nextStatus === RentalDepositStatus.CAPTURED ? "RENTAL_DEPOSIT_CAPTURED" : "RENTAL_DEPOSIT_PARTIALLY_CAPTURED",
      resource: "rental-deposit",
      resourceId: deposit.id,
      details: { amountToCaptureCents: amountToCapture, capturedTotalCents: capturedTotal }
    });

    return updated;
  }

  async releaseDeposit(input: { tenantId: string; depositId: string; userId: string }) {
    const stripe = this.requireStripeClient();
    const deposit = await this.getDepositOrThrow(input.tenantId, input.depositId);
    if (!deposit.stripePaymentIntentId) throw new AppError("PaymentIntent deposito mancante", 409, "RENTAL_DEPOSIT_PAYMENT_INTENT_MISSING");
    if (!RELEASABLE_DEPOSIT_STATUSES.includes(deposit.status)) {
      throw new AppError("Deposito non rilasciabile nello stato corrente", 409, "RENTAL_DEPOSIT_NOT_RELEASABLE");
    }

    await stripe.paymentIntents.cancel(deposit.stripePaymentIntentId, {}, {
      idempotencyKey: `rental-deposit-release:${input.tenantId}:${deposit.id}`
    });

    const updated = await this.deps.updateDeposit(input.tenantId, deposit.id, {
      status: RentalDepositStatus.RELEASED,
      releasedAt: new Date()
    });

    await this.auditRepository.create({
      tenantId: input.tenantId,
      userId: input.userId,
      action: "RENTAL_DEPOSIT_RELEASED",
      resource: "rental-deposit",
      resourceId: deposit.id,
      details: { bookingId: deposit.bookingId, capturedAmountCents: deposit.capturedAmountCents }
    });

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
    const updated = await this.deps.updateExtraCharge(input.tenantId, input.extraChargeId, {
      status: RentalExtraChargeStatus.APPROVED,
      approvedByUserId: input.userId
    });
    await this.auditRepository.create({
      tenantId: input.tenantId,
      userId: input.userId,
      action: "RENTAL_EXTRA_CHARGE_APPROVED",
      resource: "rental-extra-charge",
      resourceId: input.extraChargeId,
      details: { bookingId: extraCharge.bookingId, totalAmountCents: extraCharge.totalAmountCents }
    });
    return updated;
  }

  async notifyExtraCharge(input: { tenantId: string; extraChargeId: string; userId: string }) {
    const extraCharge = await this.getExtraChargeOrThrow(input.tenantId, input.extraChargeId);
    const booking = await this.getBookingOrThrow(input.tenantId, extraCharge.bookingId);
    const recipient = booking.customer?.email ?? booking.customerEmail;
    if (!recipient) throw new AppError("Email cliente mancante per notifica extra charge", 400, "RENTAL_EXTRA_CHARGE_EMAIL_MISSING");

    const queued = await this.emailQueueService.enqueue({
      tenantId: input.tenantId,
      type: "RENTAL_EXTRA_CHARGE_NOTICE",
      recipient,
      subject: `Preavviso addebito extra noleggio ${booking.code}`,
      body: [
        `Gentile ${booking.customerName},`,
        "ti informiamo che e stato registrato un importo extra collegato al tuo noleggio.",
        `Causale: ${extraCharge.description}`,
        `Importo: ${(extraCharge.totalAmountCents / 100).toFixed(2)} EUR`,
        "Se hai domande contatta l'autonoleggio prima dell'addebito."
      ].join("\n\n"),
      meta: { bookingId: booking.id, extraChargeId: extraCharge.id, type: extraCharge.type }
    });

    const updated = await this.deps.updateExtraCharge(input.tenantId, input.extraChargeId, {
      status: RentalExtraChargeStatus.NOTIFIED,
      notifiedAt: new Date()
    });

    await this.auditRepository.create({
      tenantId: input.tenantId,
      userId: input.userId,
      action: "RENTAL_EXTRA_CHARGE_NOTIFIED",
      resource: "rental-extra-charge",
      resourceId: input.extraChargeId,
      details: { bookingId: booking.id, queueEmailId: queued.id }
    });

    return updated;
  }

  async chargeExtraCharge(input: { tenantId: string; extraChargeId: string; paymentMethodId?: string; userId: string }) {
    const stripe = this.requireStripeClient();
    let extraCharge = await this.getExtraChargeOrThrow(input.tenantId, input.extraChargeId);
    if (!CHARGEABLE_EXTRA_STATUSES.includes(extraCharge.status)) {
      throw new AppError("Extra charge non addebitabile nello stato corrente", 409, "RENTAL_EXTRA_CHARGE_NOT_CHARGEABLE");
    }
    if (extraCharge.stripePaymentIntentId && EXTRA_CHARGE_ALREADY_PROCESSING_STATUSES.includes(extraCharge.status)) {
      throw new AppError("Extra charge gia in pagamento o pagato", 409, "RENTAL_EXTRA_CHARGE_ALREADY_CHARGED");
    }

    const paymentMethodId = input.paymentMethodId ?? extraCharge.paymentMethodId;
    if (!paymentMethodId) throw new AppError("Metodo di pagamento obbligatorio", 400, "RENTAL_EXTRA_CHARGE_PAYMENT_METHOD_REQUIRED");
    const paymentMethod = await this.getActivePaymentMethodOrThrow(input.tenantId, paymentMethodId, extraCharge.rentalCustomerId);

    extraCharge = await this.deps.updateExtraCharge(input.tenantId, input.extraChargeId, {
      status: RentalExtraChargeStatus.PAYMENT_PROCESSING,
      paymentMethodId: paymentMethod.id,
      failureReason: null
    });

    await this.auditRepository.create({
      tenantId: input.tenantId,
      userId: input.userId,
      action: "RENTAL_EXTRA_CHARGE_PAYMENT_STARTED",
      resource: "rental-extra-charge",
      resourceId: input.extraChargeId,
      details: { bookingId: extraCharge.bookingId, totalAmountCents: extraCharge.totalAmountCents }
    });

    try {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: extraCharge.totalAmountCents,
        currency: "eur",
        customer: paymentMethod.stripeCustomerId,
        payment_method: paymentMethod.stripePaymentMethodId,
        off_session: true,
        confirm: true,
        description: `Addebito extra noleggio ${extraCharge.bookingId} - ${extraCharge.type}`,
        metadata: {
          domain: RENTAL_PAYMENT_DOMAIN,
          purpose: EXTRA_CHARGE_PURPOSE,
          tenantId: input.tenantId,
          bookingId: extraCharge.bookingId,
          rentalCustomerId: extraCharge.rentalCustomerId,
          rentalExtraChargeId: extraCharge.id,
          paymentMethodId: paymentMethod.id,
          chargeType: extraCharge.type
        }
      }, { idempotencyKey: `rental-extra-charge:${input.tenantId}:${extraCharge.id}` });

      const status = paymentIntent.status === "succeeded" ? RentalExtraChargeStatus.PAID : RentalExtraChargeStatus.PAYMENT_PROCESSING;
      const updated = await this.deps.updateExtraCharge(input.tenantId, extraCharge.id, {
        stripePaymentIntentId: paymentIntent.id,
        status,
        chargedAt: status === RentalExtraChargeStatus.PAID ? new Date() : undefined
      });
      return updated;
    } catch (error) {
      const nextStatus = statusForStripePaymentError(error);
      const updated = await this.deps.updateExtraCharge(input.tenantId, extraCharge.id, {
        status: nextStatus,
        failureReason: stripeErrorMessage(error)
      });
      await this.auditRepository.create({
        tenantId: input.tenantId,
        userId: input.userId,
        action: nextStatus === RentalExtraChargeStatus.REQUIRES_ACTION ? "RENTAL_EXTRA_CHARGE_REQUIRES_ACTION" : "RENTAL_EXTRA_CHARGE_FAILED",
        resource: "rental-extra-charge",
        resourceId: input.extraChargeId,
        details: { errorCode: stripeErrorCode(error), declineCode: stripeDeclineCode(error) }
      });
      return updated;
    }
  }

  async cancelExtraCharge(input: { tenantId: string; extraChargeId: string; userId: string }) {
    const extraCharge = await this.getExtraChargeOrThrow(input.tenantId, input.extraChargeId);
    if (NON_CANCELABLE_EXTRA_STATUSES.includes(extraCharge.status)) {
      throw new AppError("Extra charge non annullabile nello stato corrente", 409, "RENTAL_EXTRA_CHARGE_NOT_CANCELABLE");
    }
    const updated = await this.deps.updateExtraCharge(input.tenantId, input.extraChargeId, {
      status: RentalExtraChargeStatus.CANCELED
    });
    await this.auditRepository.create({
      tenantId: input.tenantId,
      userId: input.userId,
      action: "RENTAL_EXTRA_CHARGE_CANCELED",
      resource: "rental-extra-charge",
      resourceId: input.extraChargeId,
      details: { bookingId: extraCharge.bookingId }
    });
    return updated;
  }

  async handleStripeEvent(event: Stripe.Event) {
    const dataObject = event.data.object as unknown as Record<string, unknown> | undefined;
    const metadata = metadataFromObject(dataObject);
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
      await this.markPaymentIntentLinkedRecord(dataObject, RentalExtraChargeStatus.REFUNDED, "RENTAL_EXTRA_CHARGE_REFUNDED");
      return;
    }

    if (event.type === "charge.dispute.created" || event.type === "charge.dispute.closed") {
      await this.markPaymentIntentLinkedRecord(dataObject, RentalExtraChargeStatus.DISPUTED, "RENTAL_EXTRA_CHARGE_DISPUTED");
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

  private async applyPaymentIntentEvent(eventType: string, dataObject: Record<string, unknown>, metadata: Record<string, string>) {
    const paymentIntentId = stripeId(dataObject.id);
    if (!paymentIntentId) return;
    const purpose = metadata.purpose;

    if (purpose === DEPOSIT_PURPOSE || metadata.rentalDepositId) {
      const deposit = metadata.rentalDepositId
        ? await this.deps.findDepositById(metadata.tenantId, metadata.rentalDepositId)
        : await this.deps.findDepositByStripePaymentIntentId(paymentIntentId);
      if (!deposit) return;

      if (eventType === "payment_intent.amount_capturable_updated") {
        await this.deps.updateDeposit(deposit.tenantId, deposit.id, {
          stripePaymentIntentId: paymentIntentId,
          status: RentalDepositStatus.AUTHORIZED,
          authorizedAt: new Date(),
          failureReason: null
        });
        await this.auditRepository.create({
          tenantId: deposit.tenantId,
          userId: null,
          action: "RENTAL_DEPOSIT_AUTHORIZED",
          resource: "rental-deposit",
          resourceId: deposit.id,
          details: { bookingId: deposit.bookingId, stripePaymentIntentId: paymentIntentId }
        });
      }

      if (eventType === "payment_intent.succeeded") {
        await this.deps.updateDeposit(deposit.tenantId, deposit.id, {
          stripePaymentIntentId: paymentIntentId,
          status: RentalDepositStatus.CAPTURED,
          capturedAmountCents: Number(dataObject.amount_received ?? deposit.amountCents),
          capturedAt: new Date()
        });
      }

      if (eventType === "payment_intent.payment_failed") {
        await this.deps.updateDeposit(deposit.tenantId, deposit.id, {
          stripePaymentIntentId: paymentIntentId,
          status: RentalDepositStatus.FAILED,
          failureReason: optionalString((dataObject.last_payment_error as { message?: unknown } | undefined)?.message) ?? "Pagamento deposito fallito"
        });
      }

      if (eventType === "payment_intent.canceled") {
        await this.deps.updateDeposit(deposit.tenantId, deposit.id, {
          stripePaymentIntentId: paymentIntentId,
          status: RentalDepositStatus.RELEASED,
          releasedAt: new Date()
        });
      }
      return;
    }

    if (purpose === EXTRA_CHARGE_PURPOSE || metadata.rentalExtraChargeId) {
      const extraCharge = metadata.rentalExtraChargeId
        ? await this.deps.findExtraChargeById(metadata.tenantId, metadata.rentalExtraChargeId)
        : await this.deps.findExtraChargeByStripePaymentIntentId(paymentIntentId);
      if (!extraCharge) return;

      if (eventType === "payment_intent.succeeded") {
        await this.deps.updateExtraCharge(extraCharge.tenantId, extraCharge.id, {
          stripePaymentIntentId: paymentIntentId,
          status: RentalExtraChargeStatus.PAID,
          chargedAt: new Date(),
          failureReason: null
        });
        await this.auditRepository.create({
          tenantId: extraCharge.tenantId,
          userId: null,
          action: "RENTAL_EXTRA_CHARGE_PAID",
          resource: "rental-extra-charge",
          resourceId: extraCharge.id,
          details: { bookingId: extraCharge.bookingId, totalAmountCents: extraCharge.totalAmountCents }
        });
      }

      if (eventType === "payment_intent.payment_failed") {
        const nextStatus = statusForStripePaymentError(dataObject.last_payment_error);
        await this.deps.updateExtraCharge(extraCharge.tenantId, extraCharge.id, {
          stripePaymentIntentId: paymentIntentId,
          status: nextStatus,
          failureReason: optionalString((dataObject.last_payment_error as { message?: unknown } | undefined)?.message) ?? "Addebito extra fallito"
        });
      }

      if (eventType === "payment_intent.canceled") {
        await this.deps.updateExtraCharge(extraCharge.tenantId, extraCharge.id, {
          stripePaymentIntentId: paymentIntentId,
          status: RentalExtraChargeStatus.CANCELED
        });
      }
    }
  }

  private async markPaymentIntentLinkedRecord(dataObject: Record<string, unknown> | undefined, status: RentalExtraChargeStatus, action: string) {
    const paymentIntentId = stripeId(dataObject?.payment_intent);
    if (!paymentIntentId) return;
    const extraCharge = await this.deps.findExtraChargeByStripePaymentIntentId(paymentIntentId);
    if (!extraCharge) return;
    await this.deps.updateExtraCharge(extraCharge.tenantId, extraCharge.id, { status });
    await this.auditRepository.create({
      tenantId: extraCharge.tenantId,
      userId: null,
      action,
      resource: "rental-extra-charge",
      resourceId: extraCharge.id,
      details: { bookingId: extraCharge.bookingId, stripePaymentIntentId: paymentIntentId }
    });
  }

  private async applyDepositPaymentIntent(tenantId: string, depositId: string, paymentIntent: Stripe.PaymentIntent) {
    if (paymentIntent.status === "requires_capture") {
      const updated = await this.deps.updateDeposit(tenantId, depositId, {
        stripePaymentIntentId: paymentIntent.id,
        status: RentalDepositStatus.AUTHORIZED,
        authorizedAt: new Date(),
        failureReason: null
      });
      await this.auditRepository.create({
        tenantId,
        userId: null,
        action: "RENTAL_DEPOSIT_AUTHORIZED",
        resource: "rental-deposit",
        resourceId: depositId,
        details: { stripePaymentIntentId: paymentIntent.id }
      });
      return updated;
    }

    if (paymentIntent.status === "succeeded") {
      return this.deps.updateDeposit(tenantId, depositId, {
        stripePaymentIntentId: paymentIntent.id,
        status: RentalDepositStatus.CAPTURED,
        capturedAmountCents: paymentIntent.amount_received,
        capturedAt: new Date(),
        failureReason: null
      });
    }

    return this.deps.updateDeposit(tenantId, depositId, {
      stripePaymentIntentId: paymentIntent.id,
      status: RentalDepositStatus.AUTHORIZING
    });
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
