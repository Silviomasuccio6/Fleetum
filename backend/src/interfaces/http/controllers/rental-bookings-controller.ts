import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { Prisma, RentalBookingStatus } from "@prisma/client";
import { Request, Response } from "express";
import { EmailQueueService } from "../../../infrastructure/email/email-queue-service.js";
import { prisma } from "../../../infrastructure/database/prisma/client.js";
import { AppError } from "../../../shared/errors/app-error.js";
import { env } from "../../../shared/config/env.js";
import {
  buildContractTemplateMap,
  buildSimplePdfBuffer,
  defaultContractTemplate,
  renderContractTemplate,
  sanitizeTemplateInput
} from "../../../application/services/booking-contract-service.js";
import { buildEnterpriseContractPdf } from "../../../application/services/enterprise-contract-pdf-service.js";
import {
  parseCustomerDocumentDraft,
  type CustomerDocumentDraftFields,
  type ParsedCustomerDocumentDraft,
  type RecognizedCustomerDocumentType
} from "../../../application/services/customer-document-parser-service.js";
import {
  computeRentalQuote,
  toSafeNonNegativeInt
} from "../../../application/services/rental-pricing-service.js";
import { TenantProfileService } from "../../../application/services/tenant-profile-service.js";
import {
  bookingContractEmailSchema,
  bookingContractWhatsappSchema,
  bookingContractMarkSignedSchema,
  bookingContractUpdateSchema,
  contractTemplatePreviewSchema,
  contractTemplateUpdateSchema,
  rentalBookingPricingUpdateSchema,
  rentalBookingCargosSchema,
  rentalBookingContractSchema,
  rentalBookingCreateSchema,
  rentalBookingDayAvailabilityQuerySchema,
  rentalBookingListQuerySchema,
  rentalBookingMonthAvailabilityQuerySchema,
  rentalBookingNoteSchema,
  rentalBookingSuggestCustomersQuerySchema,
  rentalBookingSuggestVehiclesQuerySchema,
  rentalBookingTransitionSchema,
  rentalBookingUpdateSchema,
  rentalCustomerCreateSchema,
  rentalCustomerBookingsQuerySchema,
  rentalContractsMonitoringQuerySchema,
  rentalCustomerContractsQuerySchema,
  rentalCustomerListQuerySchema,
  rentalCustomerUpdateSchema
} from "../validators/rental-bookings-validators.js";

const ACTIVE_BOOKING_STATUSES = [
  "DRAFT",
  "QUOTED",
  "HOLD",
  "CONFIRMED",
  "CONTRACT_SIGNED",
  "READY_FOR_HANDOVER",
  "IN_RENT"
] as const satisfies readonly RentalBookingStatus[];

const MONTHLY_VISIBLE_STATUSES = [
  "DRAFT",
  "QUOTED",
  "HOLD",
  "CONFIRMED",
  "CONTRACT_SIGNED",
  "READY_FOR_HANDOVER",
  "IN_RENT",
  "CLOSED",
  "NO_SHOW"
] as const satisfies readonly RentalBookingStatus[];

const IDEMPOTENCY_HEADER = "x-idempotency-key";
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const CONTRACT_DELIVERY_DEDUPE_WINDOW_MS = 2 * 60 * 1000;

const TRANSITIONS: Record<RentalBookingStatus, RentalBookingStatus[]> = {
  DRAFT: ["QUOTED", "HOLD", "CANCELED"],
  QUOTED: ["HOLD", "CONFIRMED", "CANCELED"],
  HOLD: ["QUOTED", "CONFIRMED", "CANCELED", "NO_SHOW"],
  CONFIRMED: ["CONTRACT_SIGNED", "CANCELED", "NO_SHOW"],
  CONTRACT_SIGNED: ["READY_FOR_HANDOVER", "CANCELED", "NO_SHOW"],
  READY_FOR_HANDOVER: ["IN_RENT", "NO_SHOW", "CANCELED"],
  IN_RENT: ["CLOSED"],
  CLOSED: [],
  CANCELED: [],
  NO_SHOW: []
};

const customerSelect = {
  id: true,
  customerType: true,
  firstName: true,
  lastName: true,
  drivingLicenseNumber: true,
  drivingLicenseIssuedAt: true,
  drivingLicenseExpiresAt: true,
  drivingLicenseAuthority: true,
  drivingLicenseCategory: true,
  email: true,
  phone: true,
  dateOfBirth: true,
  placeOfBirth: true,
  nationality: true,
  residenceAddress: true,
  taxCode: true,
  documentType: true,
  documentNumber: true,
  documentIssuedAt: true,
  documentExpiresAt: true,
  documentAuthority: true,
  companyName: true,
  companyLegalForm: true,
  companyVatNumber: true,
  companyTaxCode: true,
  companyLegalAddress: true,
  companyPec: true,
  companySdi: true,
  companyRea: true,
  legalRepFirstName: true,
  legalRepLastName: true,
  legalRepTaxCode: true,
  legalRepRole: true,
  legalRepEmail: true,
  legalRepPhone: true
} as const;

const vehicleSelect = {
  id: true,
  plate: true,
  brand: true,
  model: true,
  currentKm: true,
  maintenanceIntervalKm: true,
  revisionDueAt: true,
  site: { select: { id: true, name: true, city: true } }
} as const;

const monthAvailabilityVehicleSelect = {
  ...vehicleSelect,
  revisionDueAt: true,
  maintenances: {
    where: { deletedAt: null },
    orderBy: [{ performedAt: "desc" }, { createdAt: "desc" }] as Prisma.VehicleMaintenanceOrderByWithRelationInput[],
    take: 1,
    select: { kmAtService: true, performedAt: true }
  }
};

const withDefined = <T extends Record<string, unknown>>(input: T): Partial<T> =>
  Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<T>;

const normalizeText = (value?: string | null) => String(value ?? "").trim();

const fullCustomerName = (input: { firstName?: string | null; lastName?: string | null }) =>
  [normalizeText(input.firstName), normalizeText(input.lastName)].filter(Boolean).join(" ").trim();

const customerDisplayName = (input: {
  customerType?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
}) => {
  const isCompany = input.customerType === "PERSONA_GIURIDICA";
  const companyName = normalizeText(input.companyName);
  const personName = fullCustomerName(input);
  if (isCompany) return companyName || personName || "Societa";
  return personName || companyName || "Cliente";
};

const startOfToday = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
};

const vehicleMaintenanceDeadlineStatus = (vehicle: {
  currentKm?: number | null;
  maintenanceIntervalKm?: number | null;
  maintenances?: Array<{ kmAtService: number | null; performedAt: Date }>;
}) => {
  const intervalKm = typeof vehicle.maintenanceIntervalKm === "number" ? vehicle.maintenanceIntervalKm : null;
  const currentKm = typeof vehicle.currentKm === "number" ? vehicle.currentKm : null;
  const baselineKm = typeof vehicle.maintenances?.[0]?.kmAtService === "number" ? vehicle.maintenances[0]!.kmAtService : null;

  if (!intervalKm || intervalKm <= 0 || currentKm == null) {
    return {
      status: "OK" as const,
      label: "Manutenzione ok",
      detail: "Intervallo manutenzione non configurato"
    };
  }

  const kmDrivenSinceMaintenance =
    baselineKm != null && currentKm >= baselineKm
      ? Math.max(0, currentKm - baselineKm)
      : ((currentKm % intervalKm) + intervalKm) % intervalKm;
  const remainingKm = intervalKm - kmDrivenSinceMaintenance;
  const warningKm = Math.min(1000, Math.floor(intervalKm * 0.08));

  if (remainingKm <= 0) {
    return {
      status: "EXPIRED" as const,
      label: "Manutenzione scaduta",
      detail: `Da fare subito · ${Math.abs(remainingKm)} km oltre soglia`
    };
  }

  if (remainingKm <= warningKm) {
    return {
      status: "DUE_SOON" as const,
      label: "Manutenzione in scadenza",
      detail: `${remainingKm} km residui`
    };
  }

  return {
    status: "OK" as const,
    label: "Manutenzione ok",
    detail: `${remainingKm} km residui`
  };
};

const vehicleRevisionDeadlineStatus = (revisionDueAt?: Date | null) => {
  if (!revisionDueAt) {
    return {
      status: "OK" as const,
      label: "Revisione ok",
      detail: "Scadenza revisione non configurata"
    };
  }

  const today = startOfToday();
  const due = new Date(revisionDueAt);
  due.setHours(0, 0, 0, 0);
  const days = Math.ceil((due.getTime() - today.getTime()) / 86400000);

  if (days <= 0) {
    return {
      status: "EXPIRED" as const,
      label: "Revisione scaduta",
      detail: days === 0 ? "Scade oggi" : `Scaduta da ${Math.abs(days)} giorni`
    };
  }

  if (days <= 30) {
    return {
      status: "DUE_SOON" as const,
      label: "Revisione in scadenza",
      detail: `${days} giorni residui`
    };
  }

  return {
    status: "OK" as const,
    label: "Revisione ok",
    detail: `Scadenza ${due.toLocaleDateString("it-IT", { month: "2-digit", year: "numeric" })}`
  };
};

const customerPrimaryDocument = (input: {
  customerType?: string | null;
  companyVatNumber?: string | null;
  documentNumber?: string | null;
  drivingLicenseNumber?: string | null;
}) => {
  if (input.customerType === "PERSONA_GIURIDICA") {
    return normalizeText(input.companyVatNumber) || normalizeText(input.documentNumber) || null;
  }
  return normalizeText(input.documentNumber) || normalizeText(input.drivingLicenseNumber) || null;
};

export class RentalBookingsController {
  constructor(
    private readonly emailQueueService: EmailQueueService = new EmailQueueService(),
    private readonly tenantProfileService: TenantProfileService = new TenantProfileService()
  ) {}

  private readonly uploadRootDir = path.resolve(process.cwd(), env.UPLOAD_DIR);

  private resolveUploadPath(filePath: string) {
    const fullPath = path.resolve(process.cwd(), filePath);
    if (fullPath !== this.uploadRootDir && !fullPath.startsWith(`${this.uploadRootDir}${path.sep}`)) {
      throw new AppError("Percorso file non valido", 400, "INVALID_FILE_PATH");
    }
    return fullPath;
  }

  private extractContractSignatureDetails(details: Prisma.JsonValue | null | undefined): {
    signatureFilePath?: string;
    signatureMimeType?: string;
    signatureSizeBytes?: number;
  } | null {
    if (!details || typeof details !== "object" || Array.isArray(details)) return null;
    const payload = details as Record<string, unknown>;
    const signatureFilePath = typeof payload.signatureFilePath === "string" ? payload.signatureFilePath : undefined;
    if (!signatureFilePath) return null;
    return {
      signatureFilePath,
      signatureMimeType: typeof payload.signatureMimeType === "string" ? payload.signatureMimeType : undefined,
      signatureSizeBytes: typeof payload.signatureSizeBytes === "number" ? payload.signatureSizeBytes : undefined
    };
  }

  private decodeSignatureDataUrl(signatureDataUrl: string): { mimeType: string; buffer: Buffer; extension: string } {
    const match = signatureDataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
    if (!match) {
      throw new AppError("Formato firma non valido", 400, "SIGNATURE_INVALID_FORMAT");
    }
    const mimeType = match[1].toLowerCase();
    const base64Payload = match[2].replace(/\s+/g, "");
    const buffer = Buffer.from(base64Payload, "base64");
    if (!buffer.length) {
      throw new AppError("Firma vuota", 400, "SIGNATURE_EMPTY");
    }
    if (buffer.length > 2 * 1024 * 1024) {
      throw new AppError("Firma troppo grande (max 2MB)", 400, "SIGNATURE_TOO_LARGE");
    }
    const extension = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
    return { mimeType, buffer, extension };
  }

  private async persistContractSignature(input: {
    tenantId: string;
    contractId: string;
    signatureDataUrl: string;
  }) {
    const decoded = this.decodeSignatureDataUrl(input.signatureDataUrl);
    const safeTenant = input.tenantId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const fileName = `${input.contractId}-${Date.now()}.${decoded.extension}`;
    const relativePath = path.posix.join(env.UPLOAD_DIR, "contract-signatures", safeTenant, fileName);
    const absolutePath = this.resolveUploadPath(relativePath);

    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, decoded.buffer);

    return {
      filePath: relativePath,
      mimeType: decoded.mimeType,
      sizeBytes: decoded.buffer.length
    };
  }

  private normalizeHexColor(input: string | null | undefined, fallback: string) {
    const raw = String(input ?? "").trim();
    if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw;
    return fallback;
  }

  private normalizeVatNumber(input?: string | null) {
    return normalizeText(input).replace(/\s+/g, "");
  }

  private normalizeCustomerType(input?: string | null) {
    return input === "PERSONA_GIURIDICA" ? "PERSONA_GIURIDICA" : "PERSONA_FISICA";
  }

  private assertCustomerBusinessRules(input: {
    customerType?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    drivingLicenseNumber?: string | null;
    email?: string | null;
    phone?: string | null;
    companyName?: string | null;
    companyVatNumber?: string | null;
    companySdi?: string | null;
  }) {
    const customerType = this.normalizeCustomerType(input.customerType);
    const firstName = normalizeText(input.firstName);
    const lastName = normalizeText(input.lastName);
    const drivingLicenseNumber = normalizeText(input.drivingLicenseNumber);
    const email = normalizeText(input.email);
    const phone = normalizeText(input.phone);
    const companyName = normalizeText(input.companyName);
    const companyVatNumber = this.normalizeVatNumber(input.companyVatNumber);
    const companySdi = normalizeText(input.companySdi);

    if (customerType === "PERSONA_GIURIDICA") {
      if (!companyName || companyName.length < 2) {
        throw new AppError("Ragione sociale obbligatoria per persona giuridica.", 400, "CUSTOMER_COMPANY_NAME_REQUIRED");
      }
      if (!/^\d{11}$/.test(companyVatNumber)) {
        throw new AppError("Partita IVA non valida (11 cifre).", 400, "CUSTOMER_COMPANY_VAT_INVALID");
      }
      if (!email && !phone) {
        throw new AppError(
          "Per persona giuridica è obbligatorio almeno un contatto (email o telefono).",
          400,
          "CUSTOMER_COMPANY_CONTACT_REQUIRED"
        );
      }
      if (companySdi && !/^[A-Za-z0-9]{7}$/.test(companySdi)) {
        throw new AppError("Codice SDI non valido (7 caratteri alfanumerici).", 400, "CUSTOMER_COMPANY_SDI_INVALID");
      }
      return;
    }

    if (!firstName || firstName.length < 2) {
      throw new AppError("Nome obbligatorio per persona fisica.", 400, "CUSTOMER_FIRST_NAME_REQUIRED");
    }
    if (!lastName || lastName.length < 2) {
      throw new AppError("Cognome obbligatorio per persona fisica.", 400, "CUSTOMER_LAST_NAME_REQUIRED");
    }
    if (!drivingLicenseNumber || drivingLicenseNumber.length < 5) {
      throw new AppError("Numero patente obbligatorio per persona fisica.", 400, "CUSTOMER_LICENSE_REQUIRED");
    }
  }

  private buildContractContext(booking: Awaited<ReturnType<RentalBookingsController["getBookingOrThrow"]>>) {
    return buildContractTemplateMap({
      booking: {
        code: booking.code,
        pickupAt: booking.pickupAt,
        returnAt: booking.returnAt,
        pickupLocation: booking.pickupLocation,
        returnLocation: booking.returnLocation,
        pickupKm: booking.pickupKm ?? null,
        returnKm: booking.returnKm ?? null,
        kmDriven:
          typeof booking.pickupKm === "number" && typeof booking.returnKm === "number"
            ? Math.max(0, booking.returnKm - booking.pickupKm)
            : null
      },
      customer: {
        type: booking.customer?.customerType ?? "PERSONA_FISICA",
        firstName: booking.customer?.firstName ?? null,
        lastName: booking.customer?.lastName ?? null,
        email: booking.customer?.email ?? booking.customerEmail ?? null,
        phone: booking.customer?.phone ?? booking.customerPhone ?? null,
        documentNumber:
          booking.customer?.documentNumber ??
          booking.customer?.drivingLicenseNumber ??
          booking.customerDocument ??
          null,
        drivingLicenseNumber: booking.customer?.drivingLicenseNumber ?? null,
        taxCode: booking.customer?.taxCode ?? null,
        residenceAddress: booking.customer?.residenceAddress ?? null,
        companyName: booking.customer?.companyName ?? null,
        companyVat: booking.customer?.companyVatNumber ?? null,
        companyTaxCode: booking.customer?.companyTaxCode ?? null,
        companyAddress: booking.customer?.companyLegalAddress ?? null,
        companyPec: booking.customer?.companyPec ?? null,
        companySdi: booking.customer?.companySdi ?? null,
        companyRea: booking.customer?.companyRea ?? null,
        companyLegalRepFullName: fullCustomerName({
          firstName: booking.customer?.legalRepFirstName,
          lastName: booking.customer?.legalRepLastName
        }),
        companyLegalRepTaxCode: booking.customer?.legalRepTaxCode ?? null
      },
      vehicle: {
        plate: booking.vehicle?.plate ?? null,
        brand: booking.vehicle?.brand ?? null,
        model: booking.vehicle?.model ?? null
      },
      pricing: {
        expectedTotal: booking.expectedTotal,
        finalTotal: booking.finalTotal,
        priceListName: booking.pricingSnapshot?.priceListName ?? booking.pricingSnapshot?.priceList?.name ?? null,
        pricePackageName: booking.pricingSnapshot?.pricePackageName ?? booking.pricingSnapshot?.pricePackage?.name ?? null,
        extraKmPolicyName: booking.pricingSnapshot?.extraKmPolicyName ?? booking.pricingSnapshot?.extraKmPolicy?.name ?? null,
        estimatedKm: booking.pricingSnapshot?.estimatedKm ?? null,
        actualKm: booking.pricingSnapshot?.actualKm ?? null,
        includedKmTotal: booking.pricingSnapshot?.includedKmTotal ?? null,
        extraKmEstimated: booking.pricingSnapshot?.extraKmEstimated ?? null,
        extraKmActual: booking.pricingSnapshot?.extraKmActual ?? null
      }
    });
  }

  private withTenantEmailSignature(body: string, companyName?: string | null, replyTo?: string | null) {
    const brand = normalizeText(companyName);
    if (!brand) return body;
    const alreadySigned = body.toLowerCase().includes(brand.toLowerCase());
    if (alreadySigned) return body;

    const lines = [body.trimEnd(), "", brand];
    const email = normalizeText(replyTo);
    if (email) lines.push(email);
    return lines.join("\n");
  }

  private async getOrCreateDefaultTemplate(tenantId: string, userId?: string) {
    const existing = await prisma.contractTemplate.findFirst({
      where: { tenantId, isDefault: true, deletedAt: null },
      orderBy: [{ updatedAt: "desc" }]
    });
    if (existing) return existing;

    const defaults = defaultContractTemplate();
    const tenantBranding = await this.tenantProfileService.contractBranding(tenantId);
    return prisma.contractTemplate.create({
      data: {
        tenantId,
        name: defaults.name,
        content: defaults.content,
        emailSubject: defaults.emailSubject,
        emailBody: defaults.emailBody,
        companyName: tenantBranding.companyName ?? "Fleetum",
        companyAddress: tenantBranding.companyAddress ?? "Via Demo 1, 00100 Roma",
        companyVat: tenantBranding.companyVat ?? "P.IVA 00000000000",
        companyEmail: tenantBranding.companyEmail ?? "contratti@fleetops.demo",
        companyPhone: tenantBranding.companyPhone ?? "+39 000 0000000",
        logoFilePath: tenantBranding.logoFilePath,
        logoFileName: tenantBranding.logoFileName,
        brandPrimary: tenantBranding.brandPrimary ?? "#21375d",
        brandAccent: tenantBranding.brandAccent ?? "#5d82c2",
        brandFont: tenantBranding.brandFont ?? "helvetica",
        version: 1,
        isDefault: true,
        createdByUserId: userId
      }
    });
  }

  private async logContractEvent(input: {
    tenantId: string;
    bookingId: string;
    contractId: string;
    actorUserId?: string;
    type: string;
    message: string;
    details?: Prisma.InputJsonValue;
  }) {
    await prisma.bookingContractEvent.create({
      data: {
        tenantId: input.tenantId,
        bookingId: input.bookingId,
        contractId: input.contractId,
        actorUserId: input.actorUserId,
        type: input.type,
        message: input.message,
        details: input.details
      }
    });
  }

  private contractFileName(code: string, customerName?: string | null) {
    const safeCustomer = String(customerName ?? "cliente")
      .toLowerCase()
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
    return `Contratto_${code}_${safeCustomer || "cliente"}.pdf`;
  }

  private normalizeWhatsAppPhone(input?: string | null) {
    const raw = normalizeText(input);
    if (!raw) return null;
    const compact = raw.replace(/\s+/g, "").replace(/\(0\)/g, "");
    const digits = compact.replace(/[^\d+]/g, "");
    if (!digits) return null;
    const numeric = digits.startsWith("+")
      ? digits.slice(1).replace(/\D/g, "")
      : digits.startsWith("00")
        ? digits.slice(2).replace(/\D/g, "")
        : digits.replace(/\D/g, "");
    if (!numeric) return null;
    if (numeric.length >= 8 && numeric.length <= 15) {
      if (numeric.startsWith("39")) return numeric;
      if (numeric.startsWith("3") && numeric.length === 10) return `39${numeric}`;
      return numeric;
    }
    return null;
  }

  private extractIdempotencyKey(req: Request) {
    const fromHelper = typeof req.header === "function" ? req.header(IDEMPOTENCY_HEADER) : undefined;
    const fromHeaders = req.headers?.[IDEMPOTENCY_HEADER];
    const raw = fromHelper ?? (Array.isArray(fromHeaders) ? fromHeaders[0] : fromHeaders);
    if (!raw) return null;
    const normalized = String(raw).trim();
    if (!normalized) return null;
    if (!IDEMPOTENCY_KEY_PATTERN.test(normalized)) {
      throw new AppError(
        "Header x-idempotency-key non valido (usa 8-128 caratteri alfanumerici, ., _, :, -).",
        400,
        "INVALID_IDEMPOTENCY_KEY"
      );
    }
    return normalized;
  }

  private extractIdempotencyKeyFromDetails(details: Prisma.JsonValue | null | undefined) {
    if (!details || typeof details !== "object" || Array.isArray(details)) return null;
    const payload = details as Record<string, unknown>;
    return typeof payload.idempotencyKey === "string" ? payload.idempotencyKey : null;
  }

  private async findDuplicateContractDelivery(input: {
    tenantId: string;
    contractId: string;
    channel: "EMAIL" | "WHATSAPP";
    recipient: string;
    subject: string;
    body: string;
    matchBody?: boolean;
    idempotencyKey?: string | null;
  }) {
    if (input.idempotencyKey) {
      const byKey = await prisma.bookingContractDelivery.findFirst({
        where: {
          tenantId: input.tenantId,
          contractId: input.contractId,
          channel: input.channel,
          details: {
            path: ["idempotencyKey"],
            equals: input.idempotencyKey
          }
        },
        orderBy: [{ createdAt: "desc" }]
      });
      if (byKey) return byKey;
    }

    const threshold = new Date(Date.now() - CONTRACT_DELIVERY_DEDUPE_WINDOW_MS);
    return prisma.bookingContractDelivery.findFirst({
      where: {
        tenantId: input.tenantId,
        contractId: input.contractId,
        channel: input.channel,
        recipient: input.recipient,
        subject: input.subject,
        ...(input.matchBody === false ? {} : { body: input.body }),
        status: { in: ["PENDING", "SENT"] },
        createdAt: { gte: threshold }
      },
      orderBy: [{ createdAt: "desc" }]
    });
  }

  private buildPublicContractToken(input: { tenantId: string; bookingId: string; expiresAt: Date }) {
    const payload = Buffer.from(
      JSON.stringify({
        tenantId: input.tenantId,
        bookingId: input.bookingId,
        exp: input.expiresAt.getTime()
      }),
      "utf8"
    ).toString("base64url");

    const signature = crypto.createHmac("sha256", env.JWT_SECRET).update(payload).digest("base64url");
    return `${payload}.${signature}`;
  }

  private verifyPublicContractToken(token: string) {
    const [payload, signature] = String(token ?? "").split(".");
    if (!payload || !signature) {
      throw new AppError("Token condivisione non valido", 401, "INVALID_CONTRACT_SHARE_TOKEN");
    }
    const expected = crypto.createHmac("sha256", env.JWT_SECRET).update(payload).digest("base64url");
    const receivedBuffer = Buffer.from(signature, "utf8");
    const expectedBuffer = Buffer.from(expected, "utf8");
    if (receivedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(receivedBuffer, expectedBuffer)) {
      throw new AppError("Token condivisione non valido", 401, "INVALID_CONTRACT_SHARE_TOKEN");
    }

    let parsed: { tenantId: string; bookingId: string; exp: number };
    try {
      parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
        tenantId: string;
        bookingId: string;
        exp: number;
      };
    } catch {
      throw new AppError("Token condivisione non valido", 401, "INVALID_CONTRACT_SHARE_TOKEN");
    }

    if (!parsed?.tenantId || !parsed?.bookingId || !Number.isFinite(parsed?.exp)) {
      throw new AppError("Token condivisione non valido", 401, "INVALID_CONTRACT_SHARE_TOKEN");
    }

    if (Date.now() > Number(parsed.exp)) {
      throw new AppError("Link contratto scaduto", 410, "CONTRACT_SHARE_LINK_EXPIRED");
    }

    return parsed;
  }

  private buildPublicContractUrl(token: string) {
    return `${env.BACKEND_PUBLIC_URL}/api/contracts/public/${encodeURIComponent(token)}`;
  }

  private async assertPublicContractLinkActive(input: { tenantId: string; bookingId: string; token: string }) {
    const shareUrl = this.buildPublicContractUrl(input.token);
    const deliveries = await prisma.bookingContractDelivery.findMany({
      where: {
        tenantId: input.tenantId,
        bookingId: input.bookingId,
        channel: "WHATSAPP"
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, details: true }
    });

    const matching = deliveries.find((delivery) => {
      const details = delivery.details && typeof delivery.details === "object" && !Array.isArray(delivery.details)
        ? (delivery.details as Record<string, unknown>)
        : {};
      return details.shareUrl === shareUrl;
    });

    if (!matching) return;

    const details = matching.details && typeof matching.details === "object" && !Array.isArray(matching.details)
      ? (matching.details as Record<string, unknown>)
      : {};
    if (typeof details.revokedAt === "string" && details.revokedAt) {
      throw new AppError("Link contratto revocato", 410, "CONTRACT_SHARE_LINK_REVOKED");
    }
  }

  private async upsertBookingContractFromTemplate(input: {
    tenantId: string;
    bookingId: string;
    actorUserId?: string;
    forceTemplate?: string;
  }) {
    const booking = await this.getBookingOrThrow(input.tenantId, input.bookingId);
    const template = await this.getOrCreateDefaultTemplate(input.tenantId, input.actorUserId);
    const dictionary = this.buildContractContext(booking);
    const content = renderContractTemplate(input.forceTemplate ?? template.content, dictionary);
    const emailSubject = renderContractTemplate(template.emailSubject ?? `Contratto noleggio {{booking.code}}`, dictionary);
    const emailBody = renderContractTemplate(template.emailBody ?? "In allegato il contratto.", dictionary);
    const emailTo = booking.customer?.email ?? booking.customerEmail ?? null;
    const title = `Contratto ${booking.code}`;

    const existing = await prisma.bookingContract.findFirst({
      where: { tenantId: input.tenantId, bookingId: input.bookingId, deletedAt: null }
    });

    const contract = existing
      ? await prisma.bookingContract.update({
          where: { id: existing.id },
          data: {
            templateId: template.id,
            templateVersion: template.version,
            title,
            content,
            emailTo,
            emailSubject,
            emailBody,
            status: "DRAFT",
            updatedByUserId: input.actorUserId,
            errorMessage: null
          }
        })
      : await prisma.bookingContract.create({
          data: {
            tenantId: input.tenantId,
            bookingId: input.bookingId,
            templateId: template.id,
            templateVersion: template.version,
            title,
            content,
            emailTo,
            emailSubject,
            emailBody,
            status: "DRAFT",
            createdByUserId: input.actorUserId,
            updatedByUserId: input.actorUserId
          }
        });

    await this.logContractEvent({
      tenantId: input.tenantId,
      bookingId: input.bookingId,
      contractId: contract.id,
      actorUserId: input.actorUserId,
      type: existing ? "REGENERATED" : "GENERATED",
      message: existing ? "Contratto rigenerato da template" : "Contratto generato da template",
      details: { templateVersion: template.version }
    });

    return contract;
  }

  private async getContractOrThrow(tenantId: string, bookingId: string) {
    const contract = await prisma.bookingContract.findFirst({
      where: { tenantId, bookingId, deletedAt: null },
      include: {
        booking: {
          include: {
            vehicle: { select: vehicleSelect },
            customer: { select: customerSelect },
            pricingSnapshot: true
          }
        },
        template: true,
        events: { orderBy: [{ createdAt: "desc" }], take: 50 },
        deliveries: { orderBy: [{ createdAt: "desc" }], take: 20 }
      }
    });
    if (!contract) throw new AppError("Contratto non trovato", 404, "BOOKING_CONTRACT_NOT_FOUND");
    return contract;
  }

  private async buildContractPdf(contract: Awaited<ReturnType<RentalBookingsController["getContractOrThrow"]>>) {
    const events = Array.isArray(contract.events) ? contract.events : [];
    const deliveries = Array.isArray(contract.deliveries) ? contract.deliveries : [];
    const latestDelivery = deliveries[0] ?? null;

    const signedEventWithSignature = events.find((entry) => {
      if (entry.type !== "SIGNED") return false;
      return Boolean(this.extractContractSignatureDetails(entry.details));
    });
    const signatureDetails = signedEventWithSignature
      ? this.extractContractSignatureDetails(signedEventWithSignature.details)
      : null;

    try {
      const tenantBranding = await this.tenantProfileService.contractBranding(contract.tenantId);
      const templateBranding = contract.template
        ? {
            companyName: contract.template.companyName,
            companyAddress: contract.template.companyAddress,
            companyVat: contract.template.companyVat,
            companyEmail: contract.template.companyEmail,
            companyPhone: contract.template.companyPhone,
            logoFilePath: contract.template.logoFilePath,
            logoFileName: contract.template.logoFileName,
            brandPrimary: contract.template.brandPrimary,
            brandAccent: contract.template.brandAccent,
            brandFont: contract.template.brandFont
          }
        : {};
      return await buildEnterpriseContractPdf({
        contract: {
          title: contract.title,
          content: contract.content,
          status: contract.status,
          templateVersion: contract.templateVersion,
          emailTo: contract.emailTo,
          createdAt: contract.createdAt,
          updatedAt: contract.updatedAt,
          lastSentAt: contract.lastSentAt,
          signedAt: contract.signedAt,
          latestDelivery: latestDelivery
            ? {
                channel: latestDelivery.channel,
                recipient: latestDelivery.recipient,
                status: latestDelivery.status,
                sentAt: latestDelivery.sentAt,
                createdAt: latestDelivery.createdAt,
                errorMessage: latestDelivery.errorMessage
              }
            : null,
          signatureFilePath: signatureDetails?.signatureFilePath ?? null,
          signatureMimeType: signatureDetails?.signatureMimeType ?? null,
          signatureSizeBytes: signatureDetails?.signatureSizeBytes ?? null
        },
        booking: {
          code: contract.booking.code,
          status: contract.booking.status,
          contractStatus: contract.booking.contractStatus,
          customerName: contract.booking.customerName,
          customerEmail: contract.booking.customerEmail,
          customerPhone: contract.booking.customerPhone,
          customerDocument: contract.booking.customerDocument,
          pickupAt: contract.booking.pickupAt,
          returnAt: contract.booking.returnAt,
          pickupLocation: contract.booking.pickupLocation,
          returnLocation: contract.booking.returnLocation,
          pickupKm: contract.booking.pickupKm,
          returnKm: contract.booking.returnKm,
          expectedTotal: contract.booking.expectedTotal,
          finalTotal: contract.booking.finalTotal,
          vehicle: contract.booking.vehicle,
          customer: contract.booking.customer,
          contractSignedAt: contract.booking.contractSignedAt,
          pricingSnapshot: contract.booking.pricingSnapshot
        },
        branding: { ...templateBranding, ...tenantBranding }
      });
    } catch {
      return buildSimplePdfBuffer(contract.title, contract.content);
    }
  }

  private dayBoundsFromIsoDate(isoDate: string) {
    const dayStart = new Date(`${isoDate}T00:00:00`);
    if (Number.isNaN(dayStart.getTime())) {
      throw new AppError("Data non valida. Usa formato YYYY-MM-DD.", 400, "BOOKING_INVALID_DAY");
    }
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    return { dayStart, dayEnd };
  }

  private monthBoundsFromIsoMonth(isoMonth: string) {
    const [y, m] = isoMonth.split("-").map((part) => Number(part));
    if (!Number.isInteger(y) || !Number.isInteger(m) || y < 1970 || m < 1 || m > 12) {
      throw new AppError("Mese non valido. Usa formato YYYY-MM.", 400, "BOOKING_INVALID_MONTH");
    }
    const monthStart = new Date(y, m - 1, 1, 0, 0, 0, 0);
    const monthEnd = new Date(y, m, 1, 0, 0, 0, 0);
    return { monthStart, monthEnd };
  }

  private resolvePeriodRange(input: {
    period?: "all" | "7d" | "30d" | "90d" | "custom";
    dateFrom?: string;
    dateTo?: string;
  }) {
    const now = new Date();
    if (!input.period || input.period === "all") return null;

    if (input.period === "custom") {
      const from = input.dateFrom ? new Date(input.dateFrom) : null;
      const to = input.dateTo ? new Date(input.dateTo) : null;
      if (!from || Number.isNaN(from.getTime()) || !to || Number.isNaN(to.getTime())) {
        throw new AppError("Per il periodo personalizzato devi indicare date valide.", 400, "CUSTOMER_PERIOD_INVALID");
      }
      if (to.getTime() < from.getTime()) {
        throw new AppError("La data finale deve essere successiva alla data iniziale.", 400, "CUSTOMER_PERIOD_INVALID_RANGE");
      }
      return { from, to };
    }

    const days = input.period === "7d" ? 7 : input.period === "30d" ? 30 : 90;
    const from = new Date(now);
    from.setDate(from.getDate() - days);
    return { from, to: now };
  }

  private async generateCode(tenantId: string) {
    const year = String(new Date().getFullYear()).slice(-2);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const suffix = String(Math.floor(Math.random() * 99999) + 1).padStart(5, "0");
      const code = `BK${year}-${suffix}`;
      const exists = await prisma.rentalBooking.findFirst({
        where: { tenantId, code, deletedAt: null },
        select: { id: true }
      });
      if (!exists) return code;
    }
    throw new AppError("Impossibile generare il codice prenotazione. Riprova.", 500, "BOOKING_CODE_GENERATION_FAILED");
  }

  private async assertVehicleAvailability(input: {
    tenantId: string;
    vehicleId: string;
    pickupAt: Date;
    returnAt: Date;
    excludeBookingId?: string;
  }) {
    const overlap = await prisma.rentalBooking.findFirst({
      where: {
        tenantId: input.tenantId,
        vehicleId: input.vehicleId,
        deletedAt: null,
        status: { in: [...ACTIVE_BOOKING_STATUSES] },
        ...(input.excludeBookingId ? { id: { not: input.excludeBookingId } } : {}),
        pickupAt: { lt: input.returnAt },
        returnAt: { gt: input.pickupAt }
      },
      select: { id: true, code: true, pickupAt: true, returnAt: true }
    });

    if (overlap) {
      throw new AppError(
        `Veicolo già impegnato dalla prenotazione ${overlap.code} nello stesso intervallo.`,
        409,
        "BOOKING_VEHICLE_OVERLAP",
        { overlapBookingId: overlap.id }
      );
    }
  }

  private async getBookingOrThrow(tenantId: string, bookingId: string) {
    const booking = await prisma.rentalBooking.findFirst({
      where: { tenantId, id: bookingId, deletedAt: null },
      include: {
        vehicle: { select: vehicleSelect },
        customer: { select: customerSelect },
        pricingSnapshot: {
          include: {
            priceList: { select: { id: true, name: true } },
            pricePackage: { select: { id: true, name: true, type: true, kmScope: true, kmIncluded: true } },
            extraKmPolicy: { select: { id: true, name: true, type: true } }
          }
        }
      }
    });
    if (!booking) throw new AppError("Prenotazione non trovata", 404, "BOOKING_NOT_FOUND");
    return booking;
  }

  private async getCustomerOrThrow(tenantId: string, customerId: string) {
    const customer = await prisma.rentalCustomer.findFirst({
      where: { tenantId, id: customerId, deletedAt: null },
      select: customerSelect
    });
    if (!customer) throw new AppError("Cliente non trovato", 404, "CUSTOMER_NOT_FOUND");
    return customer;
  }

  private async resolvePricingSelection(input: {
    tenantId: string;
    priceListId: string;
    pricePackageId?: string | null;
    extraKmPolicyId?: string | null;
  }) {
    const list = await prisma.rentalPriceList.findFirst({
      where: { tenantId: input.tenantId, id: input.priceListId, deletedAt: null },
      include: {
        packages: {
          where: { tenantId: input.tenantId, deletedAt: null, isActive: true },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
        },
        extraKmPolicies: {
          where: { tenantId: input.tenantId, deletedAt: null, isActive: true },
          include: {
            tiers: {
              where: { tenantId: input.tenantId },
              orderBy: [{ sortOrder: "asc" }, { fromKm: "asc" }]
            }
          },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
        }
      }
    });

    if (!list) throw new AppError("Listino noleggio non trovato.", 404, "RENTAL_PRICE_LIST_NOT_FOUND");

    const selectedPackage = input.pricePackageId
      ? list.packages.find((pkg) => pkg.id === input.pricePackageId) ?? null
      : (list.packages.find((pkg) => pkg.isDefault) ?? list.packages[0] ?? null);

    if (input.pricePackageId && !selectedPackage) {
      throw new AppError("Pacchetto km non trovato per il listino selezionato.", 404, "RENTAL_PRICE_PACKAGE_NOT_FOUND");
    }

    const matchingPolicies = list.extraKmPolicies.filter((policy) => {
      if (!selectedPackage) return policy.packageId == null;
      return policy.packageId == null || policy.packageId === selectedPackage.id;
    });

    const selectedPolicy = input.extraKmPolicyId
      ? matchingPolicies.find((policy) => policy.id === input.extraKmPolicyId) ?? null
      : (matchingPolicies.find((policy) => policy.isDefault) ?? matchingPolicies[0] ?? null);

    if (input.extraKmPolicyId && !selectedPolicy) {
      throw new AppError(
        "Tariffario km extra non trovato per il listino/pacchetto selezionato.",
        404,
        "RENTAL_EXTRA_POLICY_NOT_FOUND"
      );
    }

    return { list, selectedPackage, selectedPolicy };
  }

  private async logNote(input: {
    tenantId: string;
    bookingId: string;
    userId?: string;
    type?: "NOTE" | "SYSTEM" | "CARGOS";
    message: string;
  }) {
    await prisma.rentalBookingNote.create({
      data: {
        tenantId: input.tenantId,
        bookingId: input.bookingId,
        userId: input.userId,
        type: input.type ?? "NOTE",
        message: input.message
      }
    });
  }

  private canTransition(from: RentalBookingStatus, to: RentalBookingStatus) {
    return TRANSITIONS[from].includes(to);
  }

  private computeDrivenKm(pickupKm?: number | null, returnKm?: number | null) {
    if (typeof pickupKm !== "number" || typeof returnKm !== "number") return null;
    if (returnKm < pickupKm) return null;
    return Math.max(0, returnKm - pickupKm);
  }

  private async syncVehicleCurrentKmFromBooking(input: {
    tenantId: string;
    vehicleId: string;
    nextKm: number;
  }) {
    const vehicle = await prisma.vehicle.findFirst({
      where: { id: input.vehicleId, tenantId: input.tenantId, deletedAt: null },
      include: {
        maintenances: {
          where: { tenantId: input.tenantId, deletedAt: null },
          orderBy: [{ performedAt: "desc" }, { createdAt: "desc" }],
          take: 1,
          select: { kmAtService: true }
        }
      }
    });

    if (!vehicle) throw new AppError("Veicolo non trovato", 404, "VEHICLE_NOT_FOUND");
    if (vehicle.currentKm != null && input.nextKm < vehicle.currentKm) {
      throw new AppError(
        `Km non validi: ${input.nextKm} è inferiore al km attuale veicolo (${vehicle.currentKm}).`,
        400,
        "BOOKING_KM_INCONSISTENT"
      );
    }

    await prisma.vehicle.update({
      where: { id: vehicle.id },
      data: { currentKm: input.nextKm }
    });

    const intervalKm = typeof vehicle.maintenanceIntervalKm === "number" ? vehicle.maintenanceIntervalKm : null;
    const baselineKm = typeof vehicle.maintenances[0]?.kmAtService === "number" ? vehicle.maintenances[0]!.kmAtService : null;
    if (intervalKm == null || intervalKm <= 0) {
      return {
        previousKm: vehicle.currentKm,
        nextKm: input.nextKm,
        remainingKm: null,
        dueByKm: false,
        dueSoonByKm: false
      };
    }

    const kmDrivenSinceMaintenance =
      baselineKm != null && input.nextKm >= baselineKm
        ? Math.max(0, input.nextKm - baselineKm)
        : ((input.nextKm % intervalKm) + intervalKm) % intervalKm;
    const remainingKm = intervalKm - kmDrivenSinceMaintenance;
    return {
      previousKm: vehicle.currentKm,
      nextKm: input.nextKm,
      remainingKm,
      dueByKm: remainingKm <= 0,
      dueSoonByKm: remainingKm > 0 && remainingKm <= Math.min(1000, Math.floor(intervalKm * 0.08))
    };
  }

  list = async (req: Request, res: Response) => {
    const query = rentalBookingListQuerySchema.parse(req.query);
    const tenantId = req.auth!.tenantId;
    const pagination = { skip: (query.page - 1) * query.pageSize, take: query.pageSize };

    const where: Prisma.RentalBookingWhereInput = {
      tenantId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.contractStatus ? { contractStatus: query.contractStatus } : {}),
      ...(query.cargosStatus ? { cargosStatus: query.cargosStatus } : {}),
      ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            pickupAt: {
              ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
              ...(query.dateTo ? { lte: new Date(query.dateTo) } : {})
            }
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { code: { contains: query.search, mode: "insensitive" } },
              { customerName: { contains: query.search, mode: "insensitive" } },
              { customerEmail: { contains: query.search, mode: "insensitive" } },
              { customerPhone: { contains: query.search, mode: "insensitive" } },
              { customerDocument: { contains: query.search, mode: "insensitive" } },
              { customer: { is: { firstName: { contains: query.search, mode: "insensitive" } } } },
              { customer: { is: { lastName: { contains: query.search, mode: "insensitive" } } } },
              { customer: { is: { companyName: { contains: query.search, mode: "insensitive" } } } },
              { customer: { is: { companyVatNumber: { contains: query.search, mode: "insensitive" } } } },
              { customer: { is: { legalRepFirstName: { contains: query.search, mode: "insensitive" } } } },
              { customer: { is: { legalRepLastName: { contains: query.search, mode: "insensitive" } } } },
              { customer: { is: { documentNumber: { contains: query.search, mode: "insensitive" } } } },
              { customer: { is: { drivingLicenseNumber: { contains: query.search, mode: "insensitive" } } } },
              { vehicle: { is: { plate: { contains: query.search, mode: "insensitive" } } } },
              { vehicle: { is: { brand: { contains: query.search, mode: "insensitive" } } } },
              { vehicle: { is: { model: { contains: query.search, mode: "insensitive" } } } }
            ]
          }
        : {})
    };

    const [total, data, activeCount, readyCount, inRentCount, cargosPendingCount, cargosErrorCount] = await Promise.all([
      prisma.rentalBooking.count({ where }),
      prisma.rentalBooking.findMany({
        where,
        ...pagination,
        orderBy: [{ pickupAt: "asc" }, { createdAt: "desc" }],
        include: {
          vehicle: { select: vehicleSelect },
          customer: { select: customerSelect },
          pricingSnapshot: {
            select: {
              id: true,
              priceListId: true,
              priceListName: true,
              pricePackageId: true,
              pricePackageName: true,
              extraKmPolicyId: true,
              extraKmPolicyName: true,
              estimatedKm: true,
              actualKm: true,
              expectedTotal: true,
              finalTotal: true
            }
          },
          _count: { select: { notes: true, attachments: true } }
        }
      }),
      prisma.rentalBooking.count({
        where: { tenantId, deletedAt: null, status: { in: ["DRAFT", "QUOTED", "HOLD", "CONFIRMED", "CONTRACT_SIGNED", "READY_FOR_HANDOVER"] } }
      }),
      prisma.rentalBooking.count({ where: { tenantId, deletedAt: null, status: "READY_FOR_HANDOVER" } }),
      prisma.rentalBooking.count({ where: { tenantId, deletedAt: null, status: "IN_RENT" } }),
      prisma.rentalBooking.count({ where: { tenantId, deletedAt: null, cargosStatus: "PENDING" } }),
      prisma.rentalBooking.count({ where: { tenantId, deletedAt: null, cargosStatus: "ERROR" } })
    ]);

    res.json({
      data,
      total,
      page: query.page,
      pageSize: query.pageSize,
      kpis: {
        active: activeCount,
        readyForHandover: readyCount,
        inRent: inRentCount,
        cargosPending: cargosPendingCount,
        cargosErrors: cargosErrorCount
      }
    });
  };

  listContractsMonitoring = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const query = rentalContractsMonitoringQuerySchema.parse(req.query);
    const pagination = { skip: (query.page - 1) * query.pageSize, take: query.pageSize };
    const period = this.resolvePeriodRange({
      period: query.period,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo
    });

    const bookingWhere: Prisma.RentalBookingWhereInput = {
      tenantId,
      deletedAt: null,
      ...(query.bookingStatus ? { status: query.bookingStatus } : {}),
      ...(query.siteId ? { vehicle: { is: { siteId: query.siteId } } } : {}),
      ...(period ? { pickupAt: { gte: period.from, lte: period.to } } : {}),
      ...(query.search
        ? {
            OR: [
              { code: { contains: query.search, mode: "insensitive" } },
              { customerName: { contains: query.search, mode: "insensitive" } },
              { customerEmail: { contains: query.search, mode: "insensitive" } },
              { customerPhone: { contains: query.search, mode: "insensitive" } },
              { vehicle: { is: { plate: { contains: query.search, mode: "insensitive" } } } },
              { vehicle: { is: { brand: { contains: query.search, mode: "insensitive" } } } },
              { vehicle: { is: { model: { contains: query.search, mode: "insensitive" } } } }
            ]
          }
        : {})
    };

    const where: Prisma.BookingContractWhereInput = {
      tenantId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      booking: bookingWhere
    };

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);

    const baseBookingDayFilter = {
      tenantId,
      deletedAt: null,
      ...(query.siteId ? { vehicle: { is: { siteId: query.siteId } } } : {})
    } as const;

    const [total, rows, contractsToSend, sentToday, signedCount, errorCount, exitsToday, returnsToday, latestPickups, latestReturns, latestDeliveries] =
      await Promise.all([
        prisma.bookingContract.count({ where }),
        prisma.bookingContract.findMany({
          where,
          ...pagination,
          orderBy: [{ booking: { pickupAt: "desc" } }, { updatedAt: "desc" }],
          include: {
            booking: {
              select: {
                id: true,
                code: true,
                status: true,
                contractStatus: true,
                customerName: true,
                pickupAt: true,
                returnAt: true,
                expectedTotal: true,
                finalTotal: true,
                vehicle: {
                  select: {
                    id: true,
                    plate: true,
                    brand: true,
                    model: true,
                    site: { select: { id: true, name: true, city: true } }
                  }
                },
                customer: {
                  select: { id: true, customerType: true, firstName: true, lastName: true, companyName: true, phone: true, email: true }
                }
              }
            },
            deliveries: {
              orderBy: [{ createdAt: "desc" }],
              take: 1
            }
          }
        }),
        prisma.bookingContract.count({
          where: {
            tenantId,
            deletedAt: null,
            status: { in: ["DRAFT", "READY"] },
            booking: { tenantId, deletedAt: null }
          }
        }),
        prisma.bookingContractDelivery.count({
          where: {
            tenantId,
            status: "SENT",
            sentAt: { gte: todayStart, lt: tomorrowStart },
            ...(query.siteId
              ? {
                  contract: {
                    booking: {
                      tenantId,
                      deletedAt: null,
                      vehicle: { is: { siteId: query.siteId } }
                    }
                  }
                }
              : {})
          }
        }),
        prisma.bookingContract.count({
          where: {
            tenantId,
            deletedAt: null,
            status: "SIGNED",
            booking: { tenantId, deletedAt: null, ...(query.siteId ? { vehicle: { is: { siteId: query.siteId } } } : {}) }
          }
        }),
        prisma.bookingContract.count({
          where: {
            tenantId,
            deletedAt: null,
            OR: [{ status: "ERROR" }, { deliveries: { some: { status: "FAILED" } } }],
            booking: { tenantId, deletedAt: null, ...(query.siteId ? { vehicle: { is: { siteId: query.siteId } } } : {}) }
          }
        }),
        prisma.rentalBooking.count({
          where: {
            ...baseBookingDayFilter,
            pickupAt: { gte: todayStart, lt: tomorrowStart },
            status: { in: ["READY_FOR_HANDOVER", "IN_RENT", "CLOSED"] }
          }
        }),
        prisma.rentalBooking.count({
          where: {
            ...baseBookingDayFilter,
            returnAt: { gte: todayStart, lt: tomorrowStart },
            status: { in: ["IN_RENT", "CLOSED"] }
          }
        }),
        prisma.rentalBooking.findMany({
          where: {
            ...baseBookingDayFilter,
            pickupAt: { lte: new Date() },
            status: { in: ["READY_FOR_HANDOVER", "IN_RENT", "CLOSED"] }
          },
          orderBy: [{ pickupAt: "desc" }],
          take: 6,
          select: {
            id: true,
            code: true,
            customerName: true,
            pickupAt: true,
            status: true,
            vehicle: { select: { plate: true, brand: true, model: true } }
          }
        }),
        prisma.rentalBooking.findMany({
          where: {
            ...baseBookingDayFilter,
            returnAt: { lte: new Date() },
            status: { in: ["IN_RENT", "CLOSED"] }
          },
          orderBy: [{ returnAt: "desc" }],
          take: 6,
          select: {
            id: true,
            code: true,
            customerName: true,
            returnAt: true,
            status: true,
            vehicle: { select: { plate: true, brand: true, model: true } }
          }
        }),
        prisma.bookingContractDelivery.findMany({
          where: {
            tenantId,
            ...(query.siteId
              ? {
                  contract: {
                    booking: {
                      tenantId,
                      deletedAt: null,
                      vehicle: { is: { siteId: query.siteId } }
                    }
                  }
                }
              : {})
          },
          orderBy: [{ createdAt: "desc" }],
          take: 8,
          select: {
            id: true,
            channel: true,
            recipient: true,
            status: true,
            sentAt: true,
            errorMessage: true,
            createdAt: true,
            bookingId: true,
            contract: {
              select: {
                booking: {
                  select: {
                    code: true,
                    customerName: true,
                    vehicle: { select: { plate: true, brand: true, model: true } }
                  }
                }
              }
            }
          }
        })
      ]);

    const data = rows.map((row) => {
      const latestDelivery = row.deliveries[0] ?? null;
      return {
        id: row.id,
        bookingId: row.bookingId,
        status: row.status,
        title: row.title,
        emailTo: row.emailTo,
        lastSentAt: row.lastSentAt,
        signedAt: row.signedAt,
        pdfGeneratedAt: row.pdfGeneratedAt,
        errorMessage: row.errorMessage,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        latestDelivery: latestDelivery
          ? {
              id: latestDelivery.id,
              channel: latestDelivery.channel,
              recipient: latestDelivery.recipient,
              status: latestDelivery.status,
              sentAt: latestDelivery.sentAt,
              errorMessage: latestDelivery.errorMessage,
              createdAt: latestDelivery.createdAt
            }
          : null,
        booking: row.booking
      };
    });

    const timeline = [
      ...latestPickups.map((row) => ({
        type: "PICKUP" as const,
        occurredAt: row.pickupAt,
        bookingId: row.id,
        bookingCode: row.code,
        customerName: row.customerName,
        bookingStatus: row.status,
        channel: null,
        deliveryStatus: null,
        recipient: null,
        vehicle: row.vehicle
      })),
      ...latestReturns.map((row) => ({
        type: "RETURN" as const,
        occurredAt: row.returnAt,
        bookingId: row.id,
        bookingCode: row.code,
        customerName: row.customerName,
        bookingStatus: row.status,
        channel: null,
        deliveryStatus: null,
        recipient: null,
        vehicle: row.vehicle
      })),
      ...latestDeliveries.map((row) => ({
        type: "DELIVERY" as const,
        occurredAt: row.sentAt ?? row.createdAt,
        bookingId: row.bookingId,
        bookingCode: row.contract.booking.code,
        customerName: row.contract.booking.customerName,
        bookingStatus: null,
        channel: row.channel,
        deliveryStatus: row.status,
        recipient: row.recipient,
        vehicle: row.contract.booking.vehicle
      }))
    ]
      .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
      .slice(0, 14);

    res.json({
      data,
      total,
      page: query.page,
      pageSize: query.pageSize,
      kpis: {
        contractsToSend,
        sentToday,
        signed: signedCount,
        inError: errorCount,
        exitsToday,
        returnsToday
      },
      timeline,
      filters: {
        period: query.period,
        status: query.status ?? null,
        bookingStatus: query.bookingStatus ?? null,
        siteId: query.siteId ?? null,
        search: query.search ?? null,
        dateFrom: period?.from ?? null,
        dateTo: period?.to ?? null
      }
    });
  };

  getById = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const booking = await prisma.rentalBooking.findFirst({
      where: { tenantId, id: req.params.id, deletedAt: null },
      include: {
        vehicle: { select: vehicleSelect },
        customer: {
          select: {
            ...customerSelect,
            attachments: {
              orderBy: [{ createdAt: "desc" }],
              select: {
                id: true,
                fileName: true,
                mimeType: true,
                sizeBytes: true,
                bookingId: true,
                createdAt: true
              }
            }
          }
        },
        notes: { orderBy: [{ createdAt: "desc" }], take: 100 },
        attachments: {
          orderBy: [{ createdAt: "desc" }],
          select: {
            id: true,
            fileName: true,
            mimeType: true,
            sizeBytes: true,
            customerId: true,
            bookingId: true,
            createdAt: true
          }
        },
        pricingSnapshot: {
          include: {
            priceList: { select: { id: true, name: true, baseRateUnit: true, baseRateAmount: true, vatRate: true, discountPercent: true } },
            pricePackage: { select: { id: true, name: true, type: true, kmScope: true, kmIncluded: true } },
            extraKmPolicy: { select: { id: true, name: true, type: true, flatRatePerKm: true } }
          }
        }
      }
    });
    if (!booking) throw new AppError("Prenotazione non trovata", 404, "BOOKING_NOT_FOUND");
    res.json(booking);
  };

  quickDetail = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const booking = await prisma.rentalBooking.findFirst({
      where: { tenantId, id: req.params.id, deletedAt: null },
      select: {
        id: true,
        code: true,
        status: true,
        pickupAt: true,
        returnAt: true,
        pickupKm: true,
        returnKm: true,
        customerName: true,
        customer: { select: { id: true, firstName: true, lastName: true } }
      }
    });
    if (!booking) throw new AppError("Prenotazione non trovata", 404, "BOOKING_NOT_FOUND");
    res.json({
      id: booking.id,
      code: booking.code,
      status: booking.status,
      pickupAt: booking.pickupAt,
      returnAt: booking.returnAt,
      pickupKm: booking.pickupKm,
      returnKm: booking.returnKm,
      customerName: booking.customer ? fullCustomerName({ firstName: booking.customer.firstName, lastName: booking.customer.lastName }) : booking.customerName
    });
  };

  getPricing = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const booking = await this.getBookingOrThrow(tenantId, req.params.id);
    const snapshot = await prisma.rentalBookingPricingSnapshot.findFirst({
      where: { tenantId, bookingId: booking.id, deletedAt: null },
      include: {
        priceList: {
          select: {
            id: true,
            name: true,
            baseRateUnit: true,
            baseRateAmount: true,
            vatRate: true,
            discountPercent: true,
            hourOverflowRule: true
          }
        },
        pricePackage: { select: { id: true, name: true, type: true, kmScope: true, kmIncluded: true } },
        extraKmPolicy: { select: { id: true, name: true, type: true, flatRatePerKm: true } }
      }
    });

    res.json({
      bookingId: booking.id,
      bookingCode: booking.code,
      snapshot
    });
  };

  updatePricing = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const userId = req.auth?.userId;
    const booking = await this.getBookingOrThrow(tenantId, req.params.id);
    const payload = rentalBookingPricingUpdateSchema.parse(req.body);

    const setup = await this.resolvePricingSelection({
      tenantId,
      priceListId: payload.priceListId,
      pricePackageId: payload.pricePackageId,
      extraKmPolicyId: payload.extraKmPolicyId
    });

    const estimatedKm = toSafeNonNegativeInt(payload.estimatedKm);
    const actualKm = toSafeNonNegativeInt(payload.actualKm);

    const quote = computeRentalQuote({
      priceList: setup.list,
      pricePackage: setup.selectedPackage,
      extraKmPolicy: setup.selectedPolicy,
      pickupAt: booking.pickupAt,
      returnAt: booking.returnAt,
      estimatedKm,
      actualKm
    });

    const existingSnapshot = await prisma.rentalBookingPricingSnapshot.findFirst({
      where: { tenantId, bookingId: booking.id, deletedAt: null },
      select: { id: true }
    });

    const snapshotData = {
      tenantId,
      bookingId: booking.id,
      priceListId: setup.list.id,
      pricePackageId: setup.selectedPackage?.id ?? null,
      extraKmPolicyId: setup.selectedPolicy?.id ?? null,
      priceListName: setup.list.name,
      pricePackageName: setup.selectedPackage?.name ?? null,
      extraKmPolicyName: setup.selectedPolicy?.name ?? null,
      baseRateUnit: setup.list.baseRateUnit,
      baseRateAmount: setup.list.baseRateAmount,
      vatRate: setup.list.vatRate,
      discountPercent: setup.list.discountPercent,
      hourOverflowRule: setup.list.hourOverflowRule,
      estimatedKm: quote.km.estimatedKm,
      actualKm: quote.km.actualKm,
      includedKmTotal: quote.km.includedKmTotal,
      extraKmEstimated: quote.km.extraKmEstimated,
      extraKmActual: quote.km.extraKmActual,
      extraKmEstimatedCost: quote.pricing.extraKmEstimatedCost,
      extraKmActualCost: quote.pricing.extraKmActualCost,
      daysCharged: quote.duration.daysCharged,
      expectedSubtotal: quote.pricing.expectedSubtotal,
      expectedTaxAmount: quote.pricing.expectedTaxAmount,
      expectedTotal: quote.pricing.expectedTotal,
      finalSubtotal: quote.pricing.finalSubtotal,
      finalTaxAmount: quote.pricing.finalTaxAmount,
      finalTotal: quote.pricing.finalTotal,
      notes: payload.notes
    } as const;

    const [snapshot] = await prisma.$transaction([
      existingSnapshot
        ? prisma.rentalBookingPricingSnapshot.update({
            where: { id: existingSnapshot.id },
            data: snapshotData
          })
        : prisma.rentalBookingPricingSnapshot.create({
            data: snapshotData
          }),
      prisma.rentalBooking.update({
        where: { id: booking.id },
        data: {
          expectedTotal: quote.pricing.expectedTotal,
          ...(actualKm != null ? { finalTotal: quote.pricing.finalTotal } : {})
        }
      }),
      prisma.rentalBookingNote.create({
        data: {
          tenantId,
          bookingId: booking.id,
          userId,
          type: "SYSTEM",
          message: `Pricing aggiornato: ${setup.list.name}${setup.selectedPackage ? ` · ${setup.selectedPackage.name}` : ""}${
            setup.selectedPolicy ? ` · ${setup.selectedPolicy.name}` : ""
          }`
        }
      })
    ]);

    res.json({
      bookingId: booking.id,
      bookingCode: booking.code,
      quote,
      snapshot
    });
  };

  suggestVehicles = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const query = rentalBookingSuggestVehiclesQuerySchema.parse(req.query);

    const vehicles = await prisma.vehicle.findMany({
      where: {
        tenantId,
        deletedAt: null,
        isActive: true,
        ...(query.siteId ? { siteId: query.siteId } : {}),
        OR: [
          { plate: { contains: query.q, mode: "insensitive" } },
          { brand: { contains: query.q, mode: "insensitive" } },
          { model: { contains: query.q, mode: "insensitive" } }
        ]
      },
      orderBy: [{ plate: "asc" }],
      take: 25,
      select: vehicleSelect
    });

    res.json({ data: vehicles });
  };

  suggestCustomers = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const query = rentalBookingSuggestCustomersQuerySchema.parse(req.query);

    const customers = await prisma.rentalCustomer.findMany({
      where: {
        tenantId,
        deletedAt: null,
        OR: [
          { firstName: { contains: query.q, mode: "insensitive" } },
          { lastName: { contains: query.q, mode: "insensitive" } },
          { companyName: { contains: query.q, mode: "insensitive" } },
          { companyVatNumber: { contains: query.q, mode: "insensitive" } },
          { companyTaxCode: { contains: query.q, mode: "insensitive" } },
          { legalRepFirstName: { contains: query.q, mode: "insensitive" } },
          { legalRepLastName: { contains: query.q, mode: "insensitive" } },
          { email: { contains: query.q, mode: "insensitive" } },
          { phone: { contains: query.q, mode: "insensitive" } },
          { documentNumber: { contains: query.q, mode: "insensitive" } },
          { drivingLicenseNumber: { contains: query.q, mode: "insensitive" } },
          { taxCode: { contains: query.q, mode: "insensitive" } }
        ]
      },
      orderBy: [{ companyName: "asc" }, { lastName: "asc" }, { firstName: "asc" }],
      take: 25,
      select: customerSelect
    });

    res.json({ data: customers });
  };

  getContract = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const booking = await this.getBookingOrThrow(tenantId, req.params.id);
    const contract = await prisma.bookingContract.findFirst({
      where: { tenantId, bookingId: booking.id, deletedAt: null },
      include: {
        template: true,
        events: { orderBy: [{ createdAt: "desc" }], take: 50 },
        deliveries: { orderBy: [{ createdAt: "desc" }], take: 20 }
      }
    });
    if (!contract) {
      res.status(404).json({ error: "BOOKING_CONTRACT_NOT_FOUND", message: "Contratto non trovato" });
      return;
    }
    res.json(contract);
  };

  generateContract = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const actorUserId = req.auth?.userId;
    const booking = await this.getBookingOrThrow(tenantId, req.params.id);
    const contract = await this.upsertBookingContractFromTemplate({
      tenantId,
      bookingId: booking.id,
      actorUserId
    });
    await prisma.rentalBooking.update({
      where: { id: booking.id },
      data: { contractStatus: "READY" }
    });
    res.status(201).json(contract);
  };

  updateContractDocument = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const actorUserId = req.auth?.userId;
    const payload = bookingContractUpdateSchema.parse(req.body);
    const contract = await this.getContractOrThrow(tenantId, req.params.id);

    const updated = await prisma.bookingContract.update({
      where: { id: contract.id },
      data: withDefined({
        title: payload.title ? sanitizeTemplateInput(payload.title) : undefined,
        content: payload.content ? sanitizeTemplateInput(payload.content) : undefined,
        emailTo: payload.emailTo,
        emailSubject: payload.emailSubject ? sanitizeTemplateInput(payload.emailSubject) : undefined,
        emailBody: payload.emailBody ? sanitizeTemplateInput(payload.emailBody) : undefined,
        status: payload.status,
        updatedByUserId: actorUserId
      })
    });

    await this.logContractEvent({
      tenantId,
      bookingId: contract.bookingId,
      contractId: contract.id,
      actorUserId,
      type: "UPDATED",
      message: "Contratto aggiornato manualmente"
    });

    res.json(updated);
  };

  downloadContractPdf = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const actorUserId = req.auth?.userId;
    const contract = await this.getContractOrThrow(tenantId, req.params.id);
    const pdfBuffer = await this.buildContractPdf(contract);
    const filename = this.contractFileName(contract.booking.code, contract.booking.customerName);

    await prisma.bookingContract.update({
      where: { id: contract.id },
      data: {
        pdfFileName: filename,
        pdfGeneratedAt: new Date(),
        updatedByUserId: actorUserId
      }
    });

    await this.logContractEvent({
      tenantId,
      bookingId: contract.bookingId,
      contractId: contract.id,
      actorUserId,
      type: "PDF_GENERATED",
      message: "PDF contratto generato",
      details: { filename }
    });

    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=\"${filename}\"`);
    res.send(pdfBuffer);
  };

  sendContractEmail = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const actorUserId = req.auth?.userId;
    const idempotencyKey = this.extractIdempotencyKey(req);
    const payload = bookingContractEmailSchema.parse(req.body);
    const contract = await this.getContractOrThrow(tenantId, req.params.id);
    const dictionary = this.buildContractContext(contract.booking as Awaited<ReturnType<RentalBookingsController["getBookingOrThrow"]>>);
    const tenantBranding = await this.tenantProfileService.contractBranding(tenantId);
    const senderName = tenantBranding.companyName ?? undefined;
    const replyTo = tenantBranding.companyEmail ?? undefined;

    const recipient =
      payload.to ??
      contract.emailTo ??
      contract.booking.customer?.email ??
      contract.booking.customerEmail;
    if (!recipient) throw new AppError("Email cliente mancante. Completa l'anagrafica cliente.", 400, "CONTRACT_EMAIL_MISSING");

    const subject = payload.subject
      ? sanitizeTemplateInput(payload.subject)
      : renderContractTemplate(contract.emailSubject ?? "Contratto noleggio {{booking.code}}", dictionary);
    const body = this.withTenantEmailSignature(
      payload.body ? sanitizeTemplateInput(payload.body) : renderContractTemplate(contract.emailBody ?? "In allegato il contratto.", dictionary),
      senderName,
      replyTo
    );

    const duplicateDelivery = idempotencyKey
      ? await this.findDuplicateContractDelivery({
          tenantId,
          contractId: contract.id,
          channel: "EMAIL",
          recipient,
          subject,
          body,
          idempotencyKey
        })
      : null;
    if (duplicateDelivery) {
      await this.logContractEvent({
        tenantId,
        bookingId: contract.bookingId,
        contractId: contract.id,
        actorUserId,
        type: "EMAIL_DEDUPED",
        message: `Invio email duplicato ignorato per ${recipient}`,
        details: withDefined({
          deliveryId: duplicateDelivery.id,
          idempotencyKey: idempotencyKey ?? undefined
        })
      });
      res.status(200).json({ queued: duplicateDelivery.status === "PENDING", deliveryId: duplicateDelivery.id, duplicate: true });
      return;
    }

    const filename = this.contractFileName(contract.booking.code, contract.booking.customerName);
    const pdfBuffer = await this.buildContractPdf(contract);

    const delivery = await prisma.bookingContractDelivery.create({
      data: {
        tenantId,
        bookingId: contract.bookingId,
        contractId: contract.id,
        channel: "EMAIL",
        recipient,
        subject,
        body,
        status: "PENDING",
        details: withDefined({
          idempotencyKey: idempotencyKey ?? undefined,
          requestId: req.requestId ?? undefined
        })
      }
    });

    const queuedEmail = await this.emailQueueService.enqueue({
      tenantId,
      type: "BOOKING_CONTRACT",
      recipient,
      subject,
      body,
      meta: {
        tenantId,
        bookingId: contract.bookingId,
        contractId: contract.id,
        contractDeliveryId: delivery.id,
        fromName: senderName,
        replyTo,
        attachments: [
          {
            filename,
            contentType: "application/pdf",
            contentBase64: Buffer.from(pdfBuffer).toString("base64")
          }
        ]
      }
    });

    await this.emailQueueService.processPending(new Date(), { ids: [queuedEmail.id], take: 1 });
    const processedDelivery = await prisma.bookingContractDelivery.findUnique({
      where: { id: delivery.id },
      select: { status: true, errorMessage: true, sentAt: true }
    });

    if (processedDelivery?.status === "FAILED") {
      throw new AppError(
        processedDelivery.errorMessage ?? "Invio email contratto fallito",
        502,
        "CONTRACT_EMAIL_FAILED"
      );
    }

    await prisma.bookingContract.update({
      where: { id: contract.id },
      data: {
        emailTo: recipient,
        emailSubject: subject,
        emailBody: body,
        lastSentAt: new Date(),
        status: "SENT",
        errorMessage: null,
        updatedByUserId: actorUserId
      }
    });

    await this.logContractEvent({
      tenantId,
      bookingId: contract.bookingId,
      contractId: contract.id,
      actorUserId,
      type: "EMAIL_QUEUED",
      message: `Email contratto accodata per ${recipient}`,
      details: withDefined({
        deliveryId: delivery.id,
        idempotencyKey: idempotencyKey ?? undefined
      })
    });

    res.status(201).json({
      queued: processedDelivery?.status !== "SENT",
      deliveryId: delivery.id,
      status: processedDelivery?.status ?? "PENDING",
      sentAt: processedDelivery?.sentAt ?? null
    });
  };

  sendContractWhatsapp = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const actorUserId = req.auth?.userId;
    const idempotencyKey = this.extractIdempotencyKey(req);
    const payload = bookingContractWhatsappSchema.parse(req.body);
    const contract = await this.getContractOrThrow(tenantId, req.params.id);

    const rawPhone = payload.phone ?? contract.booking.customer?.phone ?? contract.booking.customerPhone;
    const normalizedPhone = this.normalizeWhatsAppPhone(rawPhone);
    if (!normalizedPhone) {
      throw new AppError("Numero WhatsApp cliente mancante o non valido.", 400, "CONTRACT_WHATSAPP_PHONE_MISSING");
    }

    const subject = `WhatsApp contratto ${contract.booking.code}`;
    const duplicateDelivery = idempotencyKey
      ? await this.findDuplicateContractDelivery({
          tenantId,
          contractId: contract.id,
          channel: "WHATSAPP",
          recipient: `+${normalizedPhone}`,
          subject,
          body: contract.booking.code,
          matchBody: false,
          idempotencyKey
        })
      : null;
    if (duplicateDelivery) {
      const duplicateDetails =
        duplicateDelivery.details && typeof duplicateDelivery.details === "object" && !Array.isArray(duplicateDelivery.details)
          ? (duplicateDelivery.details as Record<string, unknown>)
          : null;
      const whatsappUrl = typeof duplicateDetails?.whatsappUrl === "string" ? duplicateDetails.whatsappUrl : null;
      const shareUrl = typeof duplicateDetails?.shareUrl === "string" ? duplicateDetails.shareUrl : null;
      const expiresAtRaw = typeof duplicateDetails?.expiresAt === "string" ? duplicateDetails.expiresAt : null;
      await this.logContractEvent({
        tenantId,
        bookingId: contract.bookingId,
        contractId: contract.id,
        actorUserId,
        type: "WHATSAPP_DEDUPED",
        message: `Invio WhatsApp duplicato ignorato per +${normalizedPhone}`,
        details: withDefined({
          deliveryId: duplicateDelivery.id,
          idempotencyKey: idempotencyKey ?? undefined
        })
      });
      res.status(200).json({
        queued: false,
        channel: "WHATSAPP",
        deliveryId: duplicateDelivery.id,
        phone: `+${normalizedPhone}`,
        whatsappUrl,
        shareUrl,
        expiresAt: expiresAtRaw,
        duplicate: true
      });
      return;
    }

    const expiresAt = new Date(Date.now() + payload.shareExpiresHours * 60 * 60 * 1000);
    const token = this.buildPublicContractToken({
      tenantId,
      bookingId: contract.bookingId,
      expiresAt
    });
    const shareUrl = this.buildPublicContractUrl(token);

    const message =
      sanitizeTemplateInput(payload.message ?? "").trim() ||
      [
        `Contratto noleggio ${contract.booking.code}`,
        `Cliente: ${contract.booking.customerName}`,
        "",
        "Puoi visualizzare/scaricare il contratto da questo link sicuro:",
        shareUrl
      ].join("\n");

    const whatsappUrl = `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message)}`;

    const delivery = await prisma.bookingContractDelivery.create({
      data: {
        tenantId,
        bookingId: contract.bookingId,
        contractId: contract.id,
        channel: "WHATSAPP",
        recipient: `+${normalizedPhone}`,
        subject,
        body: message,
        status: "SENT",
        sentAt: new Date(),
        details: withDefined({
          whatsappUrl,
          shareUrl,
          expiresAt: expiresAt.toISOString(),
          idempotencyKey: idempotencyKey ?? undefined,
          requestId: req.requestId ?? undefined
        })
      }
    });

    await prisma.bookingContract.update({
      where: { id: contract.id },
      data: {
        lastSentAt: new Date(),
        status: "SENT",
        errorMessage: null,
        updatedByUserId: actorUserId
      }
    });

    await this.logContractEvent({
      tenantId,
      bookingId: contract.bookingId,
      contractId: contract.id,
      actorUserId,
      type: "WHATSAPP_SENT",
      message: `Contratto condiviso via WhatsApp a +${normalizedPhone}`,
      details: {
        deliveryId: delivery.id,
        expiresAt: expiresAt.toISOString(),
        idempotencyKey: idempotencyKey ?? undefined
      }
    });

    res.status(201).json({
      queued: false,
      channel: "WHATSAPP",
      deliveryId: delivery.id,
      phone: `+${normalizedPhone}`,
      whatsappUrl,
      shareUrl,
      expiresAt
    });
  };

  markContractSigned = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const actorUserId = req.auth?.userId;
    const idempotencyKey = this.extractIdempotencyKey(req);
    const payload = bookingContractMarkSignedSchema.parse(req.body);
    const contract = await this.getContractOrThrow(tenantId, req.params.id);
    const events = Array.isArray(contract.events) ? contract.events : [];

    if (idempotencyKey) {
      const alreadySignedByKey = events.find(
        (entry) => entry.type === "SIGNED" && this.extractIdempotencyKeyFromDetails(entry.details) === idempotencyKey
      );
      if (alreadySignedByKey) {
        const signatureDetails = this.extractContractSignatureDetails(alreadySignedByKey.details);
        res.status(200).json({
          ...contract,
          signatureSaved: Boolean(signatureDetails),
          signatureFilePath: signatureDetails?.signatureFilePath ?? null,
          duplicate: true,
          idempotent: true
        });
        return;
      }
    }

    if (contract.status === "SIGNED" && !payload.signatureDataUrl) {
      const latestSignedEvent = events.find((entry) => entry.type === "SIGNED");
      const signatureDetails = latestSignedEvent ? this.extractContractSignatureDetails(latestSignedEvent.details) : null;
      res.status(200).json({
        ...contract,
        signatureSaved: Boolean(signatureDetails),
        signatureFilePath: signatureDetails?.signatureFilePath ?? null,
        duplicate: true,
        idempotent: true
      });
      return;
    }

    const signedAt = payload.signedAt ?? new Date();
    const signature = payload.signatureDataUrl
      ? await this.persistContractSignature({
          tenantId,
          contractId: contract.id,
          signatureDataUrl: payload.signatureDataUrl
        })
      : null;

    const updated = await prisma.bookingContract.update({
      where: { id: contract.id },
      data: {
        status: "SIGNED",
        signedAt,
        errorMessage: null,
        updatedByUserId: actorUserId
      }
    });

    await prisma.rentalBooking.update({
      where: { id: contract.bookingId },
      data: {
        contractStatus: "SIGNED",
        contractSignedAt: signedAt,
        ...(contract.booking.status === "CONFIRMED" ? { status: "CONTRACT_SIGNED" } : {})
      }
    });

    await this.logContractEvent({
      tenantId,
      bookingId: contract.bookingId,
      contractId: contract.id,
      actorUserId,
      type: "SIGNED",
      message: signature ? "Contratto firmato con acquisizione grafica" : "Contratto marcato come firmato",
      details: withDefined({
        signedAt: signedAt.toISOString(),
        signatureFilePath: signature?.filePath,
        signatureMimeType: signature?.mimeType,
        signatureSizeBytes: signature?.sizeBytes,
        idempotencyKey: idempotencyKey ?? undefined
      })
    });

    res.json({
      ...updated,
      signatureSaved: Boolean(signature),
      signatureFilePath: signature?.filePath ?? null
    });
  };

  downloadContractPdfPublic = async (req: Request, res: Response) => {
    const token = req.params.token;
    const decoded = this.verifyPublicContractToken(token);
    await this.assertPublicContractLinkActive({ tenantId: decoded.tenantId, bookingId: decoded.bookingId, token });
    const contract = await this.getContractOrThrow(decoded.tenantId, decoded.bookingId);
    const pdfBuffer = await this.buildContractPdf(contract);
    const filename = this.contractFileName(contract.booking.code, contract.booking.customerName);

    await this.logContractEvent({
      tenantId: decoded.tenantId,
      bookingId: decoded.bookingId,
      contractId: contract.id,
      type: "PUBLIC_PDF_DOWNLOADED",
      message: "Contratto scaricato tramite link pubblico sicuro",
      details: {
        requestId: req.requestId ?? undefined,
        expiresAt: new Date(decoded.exp).toISOString()
      }
    });
    await prisma.auditLog.create({
      data: {
        tenantId: decoded.tenantId,
        userId: null,
        action: "PUBLIC_CONTRACT_DOWNLOAD",
        resource: "BookingContract",
        resourceId: contract.id,
        details: {
          bookingId: decoded.bookingId,
          requestId: req.requestId ?? null,
          expiresAt: new Date(decoded.exp).toISOString()
        }
      }
    });

    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename=\"${filename}\"`);
    res.send(pdfBuffer);
  };

  revokeContractShareLinks = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const actorUserId = req.auth?.userId;
    const contract = await this.getContractOrThrow(tenantId, req.params.id);
    const deliveries = await prisma.bookingContractDelivery.findMany({
      where: {
        tenantId,
        contractId: contract.id,
        channel: "WHATSAPP"
      },
      select: { id: true, details: true }
    });

    const revokedAt = new Date().toISOString();
    let revoked = 0;
    for (const delivery of deliveries) {
      const details = delivery.details && typeof delivery.details === "object" && !Array.isArray(delivery.details)
        ? { ...(delivery.details as Record<string, unknown>) }
        : {};
      if (details.shareUrl && !details.revokedAt) {
        await prisma.bookingContractDelivery.update({
          where: { id: delivery.id },
          data: {
            details: {
              ...details,
              revokedAt,
              revokedByUserId: actorUserId ?? null
            } as Prisma.InputJsonValue
          }
        });
        revoked += 1;
      }
    }

    await this.logContractEvent({
      tenantId,
      bookingId: contract.bookingId,
      contractId: contract.id,
      actorUserId,
      type: "PUBLIC_LINKS_REVOKED",
      message: "Link pubblici contratto revocati",
      details: { revoked, revokedAt }
    });

    await prisma.auditLog.create({
      data: {
        tenantId,
        userId: actorUserId ?? null,
        action: "PUBLIC_CONTRACT_LINKS_REVOKED",
        resource: "BookingContract",
        resourceId: contract.id,
        details: { bookingId: contract.bookingId, revoked, revokedAt }
      }
    });

    res.json({ revoked, revokedAt });
  };

  getDefaultContractTemplate = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const template = await this.getOrCreateDefaultTemplate(tenantId, req.auth?.userId);
    res.json(template);
  };

  updateDefaultContractTemplate = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const actorUserId = req.auth?.userId;
    const payload = contractTemplateUpdateSchema.parse(req.body);
    const current = await this.getOrCreateDefaultTemplate(tenantId, actorUserId);

    const updated = await prisma.contractTemplate.update({
      where: { id: current.id },
      data: {
        name: payload.name ? sanitizeTemplateInput(payload.name) : current.name,
        content: payload.content ? sanitizeTemplateInput(payload.content) : current.content,
        emailSubject: payload.emailSubject ? sanitizeTemplateInput(payload.emailSubject) : current.emailSubject,
        emailBody: payload.emailBody ? sanitizeTemplateInput(payload.emailBody) : current.emailBody,
        companyName: payload.companyName != null ? sanitizeTemplateInput(payload.companyName) : current.companyName,
        companyAddress: payload.companyAddress != null ? sanitizeTemplateInput(payload.companyAddress) : current.companyAddress,
        companyVat: payload.companyVat != null ? sanitizeTemplateInput(payload.companyVat) : current.companyVat,
        companyEmail: payload.companyEmail != null ? sanitizeTemplateInput(payload.companyEmail) : current.companyEmail,
        companyPhone: payload.companyPhone != null ? sanitizeTemplateInput(payload.companyPhone) : current.companyPhone,
        brandPrimary:
          payload.brandPrimary != null ? this.normalizeHexColor(payload.brandPrimary, "#21375d") : current.brandPrimary,
        brandAccent:
          payload.brandAccent != null ? this.normalizeHexColor(payload.brandAccent, "#5d82c2") : current.brandAccent,
        brandFont:
          payload.brandFont != null
            ? sanitizeTemplateInput(payload.brandFont).toLowerCase().slice(0, 40)
            : current.brandFont,
        version: { increment: 1 }
      }
    });

    res.json(updated);
  };

  uploadDefaultContractLogo = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const actorUserId = req.auth?.userId;
    const file = req.file as Express.Multer.File | undefined;
    if (!file) throw new AppError("Logo mancante", 400, "MISSING_FILE");

    const template = await this.getOrCreateDefaultTemplate(tenantId, actorUserId);
    const nextLogoPath = `${env.UPLOAD_DIR}/${file.filename}`;

    await prisma.contractTemplate.update({
      where: { id: template.id },
      data: {
        logoFilePath: nextLogoPath,
        logoFileName: file.originalname || file.filename,
        logoMimeType: file.mimetype,
        version: { increment: 1 }
      }
    });

    if (template.logoFilePath && template.logoFilePath !== nextLogoPath) {
      const oldPath = this.resolveUploadPath(template.logoFilePath);
      await fs.unlink(oldPath).catch(() => undefined);
    }

    const refreshed = await this.getOrCreateDefaultTemplate(tenantId, actorUserId);
    res.status(201).json(refreshed);
  };

  removeDefaultContractLogo = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const actorUserId = req.auth?.userId;
    const template = await this.getOrCreateDefaultTemplate(tenantId, actorUserId);

    if (template.logoFilePath) {
      const fullPath = this.resolveUploadPath(template.logoFilePath);
      await fs.unlink(fullPath).catch(() => undefined);
    }

    const updated = await prisma.contractTemplate.update({
      where: { id: template.id },
      data: {
        logoFilePath: null,
        logoFileName: null,
        logoMimeType: null,
        version: { increment: 1 }
      }
    });

    res.json(updated);
  };

  getDefaultContractLogoFile = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const template = await this.getOrCreateDefaultTemplate(tenantId, req.auth?.userId);
    if (!template.logoFilePath) throw new AppError("Logo template non configurato", 404, "NOT_FOUND");

    const fullPath = this.resolveUploadPath(template.logoFilePath);
    try {
      await fs.access(fullPath);
    } catch {
      throw new AppError("File logo non trovato", 404, "NOT_FOUND");
    }

    res.setHeader("Cache-Control", "private, max-age=60");
    res.type(template.logoMimeType || "application/octet-stream");
    res.sendFile(fullPath);
  };

  previewContractTemplate = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const payload = contractTemplatePreviewSchema.parse(req.body);
    const booking = await this.getBookingOrThrow(tenantId, payload.bookingId);
    const dictionary = this.buildContractContext(booking);
    const template = await this.getOrCreateDefaultTemplate(tenantId, req.auth?.userId);

    const content = renderContractTemplate(payload.content ?? template.content, dictionary);
    const emailSubject = renderContractTemplate(payload.emailSubject ?? template.emailSubject ?? "", dictionary);
    const emailBody = renderContractTemplate(payload.emailBody ?? template.emailBody ?? "", dictionary);

    res.json({ content, emailSubject, emailBody });
  };

  parseCustomerDocument = async (req: Request, res: Response) => {
    const files: Express.Multer.File[] = [];
    if (req.file) files.push(req.file as Express.Multer.File);

    const incoming = req.files as Express.Multer.File[] | Record<string, Express.Multer.File[]> | undefined;
    if (Array.isArray(incoming)) {
      files.push(...incoming);
    } else if (incoming && typeof incoming === "object") {
      Object.values(incoming).forEach((bucket) => files.push(...bucket));
    }

    if (files.length === 0) throw new AppError("File documento mancante", 400, "MISSING_FILE");

    const parsedItems: Array<
      ParsedCustomerDocumentDraft & {
        fileName: string;
        mimeType: string;
        documentType: RecognizedCustomerDocumentType | undefined;
      }
    > = [];
    const fallbackWarnings: string[] = [];

    try {
      for (const file of files) {
        try {
          const parsed = await parseCustomerDocumentDraft(file.path, file.mimetype);
          const documentType = parsed.fields.documentType as RecognizedCustomerDocumentType | undefined;
          parsedItems.push({
            ...parsed,
            fileName: file.originalname,
            mimeType: file.mimetype,
            documentType
          });
        } catch {
          fallbackWarnings.push(`Analisi non riuscita per ${file.originalname}.`);
        }
      }
    } finally {
      await Promise.all(files.map((file) => fs.unlink(file.path).catch(() => undefined)));
    }

    if (parsedItems.length === 0) {
      throw new AppError("Impossibile analizzare i documenti caricati", 422, "DOCUMENT_PARSE_FAILED");
    }

    const ordered = [...parsedItems].sort((a, b) => b.score - a.score);
    const merged: CustomerDocumentDraftFields = {};

    const setIfEmpty = <K extends keyof CustomerDocumentDraftFields>(key: K, value: CustomerDocumentDraftFields[K]) => {
      if (value === undefined || value === null || value === "") return;
      if (merged[key] === undefined || merged[key] === null || merged[key] === "") merged[key] = value;
    };
    const setValue = <K extends keyof CustomerDocumentDraftFields>(key: K, value: CustomerDocumentDraftFields[K]) => {
      if (value === undefined || value === null || value === "") return;
      merged[key] = value;
    };

    const setPersonalCore = (fields: CustomerDocumentDraftFields) => {
      setIfEmpty("firstName", fields.firstName);
      setIfEmpty("lastName", fields.lastName);
      setIfEmpty("dateOfBirth", fields.dateOfBirth);
      setIfEmpty("placeOfBirth", fields.placeOfBirth);
      setIfEmpty("nationality", fields.nationality);
      setIfEmpty("residenceAddress", fields.residenceAddress);
      setIfEmpty("taxCode", fields.taxCode);
    };

    const applyDocumentFields = (
      fields: CustomerDocumentDraftFields,
      typeHint?: RecognizedCustomerDocumentType,
      force = false
    ) => {
      const write = force ? setValue : setIfEmpty;
      write("documentType", (typeHint ?? fields.documentType) as CustomerDocumentDraftFields["documentType"]);
      write("documentNumber", fields.documentNumber);
      write("documentIssuedAt", fields.documentIssuedAt);
      write("documentExpiresAt", fields.documentExpiresAt);
      write("documentAuthority", fields.documentAuthority);
    };

    const applyLicenseFields = (fields: CustomerDocumentDraftFields, force = false) => {
      const write = force ? setValue : setIfEmpty;
      write("drivingLicenseNumber", fields.drivingLicenseNumber ?? fields.documentNumber);
      write("drivingLicenseIssuedAt", fields.drivingLicenseIssuedAt ?? fields.documentIssuedAt);
      write("drivingLicenseExpiresAt", fields.drivingLicenseExpiresAt ?? fields.documentExpiresAt);
      write("drivingLicenseAuthority", fields.drivingLicenseAuthority ?? fields.documentAuthority);
      write("drivingLicenseCategory", fields.drivingLicenseCategory);
    };

    for (const item of ordered) setPersonalCore(item.fields);

    const bestIdentityDoc = ordered.find((item) =>
      item.documentType === "CARTA_IDENTITA" || item.documentType === "PASSAPORTO" || item.documentType === "DOCUMENTO_GENERICO"
    );
    const bestLicenseDoc = ordered.find((item) => item.documentType === "PATENTE");
    const bestHealthDoc = ordered.find((item) => item.documentType === "TESSERA_SANITARIA");

    if (bestIdentityDoc) {
      applyDocumentFields(bestIdentityDoc.fields, bestIdentityDoc.documentType, true);
    }

    if (bestLicenseDoc) {
      applyLicenseFields(bestLicenseDoc.fields, true);
      if (!bestIdentityDoc) {
        applyDocumentFields(bestLicenseDoc.fields, "PATENTE", true);
      }
    }

    if (bestHealthDoc) {
      setIfEmpty("taxCode", bestHealthDoc.fields.taxCode);
      if (!merged.documentType) setIfEmpty("documentType", "TESSERA_SANITARIA");
      setIfEmpty("documentNumber", bestHealthDoc.fields.documentNumber);
    }

    for (const item of ordered) {
      if (item.documentType === "PATENTE") {
        applyLicenseFields(item.fields);
      } else if (item.documentType === "CARTA_IDENTITA" || item.documentType === "PASSAPORTO" || item.documentType === "DOCUMENTO_GENERICO") {
        if (!bestIdentityDoc) applyDocumentFields(item.fields, item.documentType);
      } else if (item.documentType === "TESSERA_SANITARIA") {
        setIfEmpty("taxCode", item.fields.taxCode);
        setIfEmpty("documentNumber", item.fields.documentNumber);
      } else {
        applyDocumentFields(item.fields);
        applyLicenseFields(item.fields);
      }
    }

    for (const item of ordered) {
      Object.entries(item.fields).forEach(([key, value]) => {
        setIfEmpty(key as keyof CustomerDocumentDraftFields, value as CustomerDocumentDraftFields[keyof CustomerDocumentDraftFields]);
      });
    }

    const warnings = Array.from(
      new Set(
        [
          ...fallbackWarnings,
          ...parsedItems.flatMap((item) => item.warnings ?? []),
          ...(merged.drivingLicenseNumber ? [] : ["Numero patente non rilevato automaticamente."])
        ]
          .filter(Boolean)
          .filter((warning) => {
            const normalized = String(warning).toLowerCase();
            if (normalized.includes("numero patente") && merged.drivingLicenseNumber) return false;
            if (normalized.includes("nome/cognome") && merged.firstName && merged.lastName) return false;
            if (normalized.includes("data di nascita") && merged.dateOfBirth) return false;
            return true;
          })
      )
    );

    const score = Math.round(parsedItems.reduce((acc, item) => acc + item.score, 0) / parsedItems.length);
    const best = ordered[0];

    res.json({
      fields: merged,
      score,
      source: best.source,
      warnings,
      textPreview: ordered
        .map((item) => item.textPreview)
        .filter(Boolean)
        .join("\n\n")
        .slice(0, 3000),
      files: ordered.map((item) => ({
        fileName: item.fileName,
        mimeType: item.mimeType,
        documentType: item.documentType ?? null,
        score: item.score,
        source: item.source,
        warnings: item.warnings ?? []
      }))
    });
  };

  listCustomerRegistry = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const query = rentalCustomerListQuerySchema.parse(req.query);
    const pagination = { skip: (query.page - 1) * query.pageSize, take: query.pageSize };

    const where: Prisma.RentalCustomerWhereInput = {
      tenantId,
      deletedAt: null,
      ...(query.customerType ? { customerType: query.customerType } : {}),
      ...(query.search
        ? {
            OR: [
              { firstName: { contains: query.search, mode: "insensitive" } },
              { lastName: { contains: query.search, mode: "insensitive" } },
              { companyName: { contains: query.search, mode: "insensitive" } },
              { companyVatNumber: { contains: query.search, mode: "insensitive" } },
              { companyTaxCode: { contains: query.search, mode: "insensitive" } },
              { email: { contains: query.search, mode: "insensitive" } },
              { phone: { contains: query.search, mode: "insensitive" } },
              { documentNumber: { contains: query.search, mode: "insensitive" } },
              { drivingLicenseNumber: { contains: query.search, mode: "insensitive" } },
              { taxCode: { contains: query.search, mode: "insensitive" } }
            ]
          }
        : {})
    };

    const [total, customers] = await Promise.all([
      prisma.rentalCustomer.count({ where }),
      prisma.rentalCustomer.findMany({
        where,
        ...pagination,
        orderBy: [{ updatedAt: "desc" }],
        include: {
          _count: { select: { bookings: true, attachments: true } }
        }
      })
    ]);

    const customerIds = customers.map((customer) => customer.id);
    const customerBookings =
      customerIds.length === 0
        ? []
        : await prisma.rentalBooking.findMany({
            where: { tenantId, deletedAt: null, customerId: { in: customerIds } },
            orderBy: [{ pickupAt: "desc" }, { createdAt: "desc" }],
            select: {
              id: true,
              customerId: true,
              code: true,
              status: true,
              contractStatus: true,
              pickupAt: true,
              createdAt: true,
              contract: { select: { id: true } }
            }
          });

    const statsByCustomer = new Map<
      string,
      {
        bookingsTotal: number;
        contractsTotal: number;
        lastRentalAt: Date | null;
        lastRentalCode: string | null;
        lastRentalStatus: string | null;
        lastRentalContractStatus: string | null;
      }
    >();

    for (const booking of customerBookings) {
      const customerId = booking.customerId;
      if (!customerId) continue;
      const current =
        statsByCustomer.get(customerId) ??
        {
          bookingsTotal: 0,
          contractsTotal: 0,
          lastRentalAt: null,
          lastRentalCode: null,
          lastRentalStatus: null,
          lastRentalContractStatus: null
        };

      current.bookingsTotal += 1;
      if (booking.contract?.id) current.contractsTotal += 1;
      if (!current.lastRentalAt) {
        current.lastRentalAt = booking.pickupAt;
        current.lastRentalCode = booking.code;
        current.lastRentalStatus = booking.status;
        current.lastRentalContractStatus = booking.contractStatus;
      }
      statsByCustomer.set(customerId, current);
    }

    const data = customers.map((customer) => {
      const stats = statsByCustomer.get(customer.id);
      return {
        ...customer,
        bookingsTotal: stats?.bookingsTotal ?? customer._count.bookings,
        contractsTotal: stats?.contractsTotal ?? 0,
        attachmentsTotal: customer._count.attachments,
        lastRentalAt: stats?.lastRentalAt ?? null,
        lastRentalCode: stats?.lastRentalCode ?? null,
        lastRentalStatus: stats?.lastRentalStatus ?? null,
        lastRentalContractStatus: stats?.lastRentalContractStatus ?? null
      };
    });

    res.json({ data, total, page: query.page, pageSize: query.pageSize });
  };

  getCustomerProfile = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const customerId = req.params.customerId;
    const customer = await prisma.rentalCustomer.findFirst({
      where: { tenantId, id: customerId, deletedAt: null },
      include: {
        attachments: {
          orderBy: [{ createdAt: "desc" }],
          select: {
            id: true,
            fileName: true,
            mimeType: true,
            sizeBytes: true,
            bookingId: true,
            category: true,
            createdAt: true
          }
        },
        _count: { select: { bookings: true, attachments: true } }
      }
    });
    if (!customer) throw new AppError("Cliente non trovato", 404, "CUSTOMER_NOT_FOUND");

    const bookings = await prisma.rentalBooking.findMany({
      where: { tenantId, customerId: customer.id, deletedAt: null },
      orderBy: [{ pickupAt: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        code: true,
        pickupAt: true,
        status: true,
        contractStatus: true,
        contract: { select: { id: true } }
      }
    });

    const contractsTotal = bookings.filter((booking) => Boolean(booking.contract?.id)).length;
    const last = bookings[0] ?? null;

    res.json({
      ...customer,
      stats: {
        bookingsTotal: customer._count.bookings,
        contractsTotal,
        attachmentsTotal: customer._count.attachments,
        lastRentalAt: last?.pickupAt ?? null,
        lastRentalCode: last?.code ?? null,
        lastRentalStatus: last?.status ?? null,
        lastRentalContractStatus: last?.contractStatus ?? null
      }
    });
  };

  listCustomerContracts = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const customerId = req.params.customerId;
    await this.getCustomerOrThrow(tenantId, customerId);
    const query = rentalCustomerContractsQuerySchema.parse(req.query);
    const pagination = { skip: (query.page - 1) * query.pageSize, take: query.pageSize };
    const period = this.resolvePeriodRange({
      period: query.period,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo
    });

    const where: Prisma.BookingContractWhereInput = {
      tenantId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      booking: {
        tenantId,
        customerId,
        deletedAt: null,
        ...(period ? { pickupAt: { gte: period.from, lte: period.to } } : {})
      }
    };

    const [total, rows] = await Promise.all([
      prisma.bookingContract.count({ where }),
      prisma.bookingContract.findMany({
        where,
        ...pagination,
        orderBy: [{ booking: { pickupAt: "desc" } }, { createdAt: "desc" }],
        include: {
          booking: {
            select: {
              id: true,
              code: true,
              pickupAt: true,
              returnAt: true,
              status: true,
              contractStatus: true,
              expectedTotal: true,
              finalTotal: true,
              customerName: true,
              vehicle: { select: { id: true, plate: true, brand: true, model: true } }
            }
          }
        }
      })
    ]);

    const data = rows.map((item) => ({
      id: item.id,
      bookingId: item.bookingId,
      status: item.status,
      title: item.title,
      emailTo: item.emailTo,
      emailSubject: item.emailSubject,
      lastSentAt: item.lastSentAt,
      signedAt: item.signedAt,
      pdfGeneratedAt: item.pdfGeneratedAt,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      booking: item.booking
    }));

    res.json({
      data,
      total,
      page: query.page,
      pageSize: query.pageSize,
      filters: {
        period: query.period,
        status: query.status ?? null,
        dateFrom: period?.from ?? null,
        dateTo: period?.to ?? null
      }
    });
  };

  listCustomerBookings = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const customerId = req.params.customerId;
    await this.getCustomerOrThrow(tenantId, customerId);
    const query = rentalCustomerBookingsQuerySchema.parse(req.query);
    const pagination = { skip: (query.page - 1) * query.pageSize, take: query.pageSize };
    const period = this.resolvePeriodRange({
      period: query.period,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo
    });

    const where: Prisma.RentalBookingWhereInput = {
      tenantId,
      customerId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.contractStatus ? { contractStatus: query.contractStatus } : {}),
      ...(period ? { pickupAt: { gte: period.from, lte: period.to } } : {})
    };

    const [total, rows] = await Promise.all([
      prisma.rentalBooking.count({ where }),
      prisma.rentalBooking.findMany({
        where,
        ...pagination,
        orderBy: [{ pickupAt: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          code: true,
          status: true,
          contractStatus: true,
          cargosStatus: true,
          pickupAt: true,
          returnAt: true,
          expectedTotal: true,
          finalTotal: true,
          createdAt: true,
          updatedAt: true,
          vehicle: { select: { id: true, plate: true, brand: true, model: true } },
          contract: {
            select: {
              id: true,
              status: true,
              signedAt: true,
              lastSentAt: true
            }
          }
        }
      })
    ]);

    res.json({
      data: rows,
      total,
      page: query.page,
      pageSize: query.pageSize,
      filters: {
        period: query.period,
        status: query.status ?? null,
        contractStatus: query.contractStatus ?? null,
        dateFrom: period?.from ?? null,
        dateTo: period?.to ?? null
      }
    });
  };

  // Backward-compatible alias per i vecchi endpoint /rental-bookings/customers...
  listCustomers = async (req: Request, res: Response) => this.listCustomerRegistry(req, res);

  // Backward-compatible alias per i vecchi endpoint /rental-bookings/customers/:customerId
  getCustomerById = async (req: Request, res: Response) => this.getCustomerProfile(req, res);

  createCustomer = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const payload = rentalCustomerCreateSchema.parse(req.body);
    const customerType = this.normalizeCustomerType(payload.customerType);

    this.assertCustomerBusinessRules({
      customerType,
      firstName: payload.firstName,
      lastName: payload.lastName,
      drivingLicenseNumber: payload.drivingLicenseNumber,
      email: payload.email,
      phone: payload.phone,
      companyName: payload.companyName,
      companyVatNumber: payload.companyVatNumber,
      companySdi: payload.companySdi
    });

    const created = await prisma.rentalCustomer.create({
      data: {
        tenantId,
        customerType,
        firstName: normalizeText(payload.firstName),
        lastName: normalizeText(payload.lastName),
        drivingLicenseNumber: normalizeText(payload.drivingLicenseNumber).toUpperCase(),
        drivingLicenseIssuedAt: payload.drivingLicenseIssuedAt,
        drivingLicenseExpiresAt: payload.drivingLicenseExpiresAt,
        drivingLicenseAuthority: payload.drivingLicenseAuthority,
        drivingLicenseCategory: payload.drivingLicenseCategory,
        email: payload.email,
        phone: payload.phone,
        dateOfBirth: payload.dateOfBirth,
        placeOfBirth: payload.placeOfBirth,
        nationality: payload.nationality,
        residenceAddress: payload.residenceAddress,
        taxCode: payload.taxCode,
        documentType: payload.documentType,
        documentNumber: payload.documentNumber,
        documentIssuedAt: payload.documentIssuedAt,
        documentExpiresAt: payload.documentExpiresAt,
        documentAuthority: payload.documentAuthority,
        companyName: payload.companyName,
        companyLegalForm: payload.companyLegalForm,
        companyVatNumber: this.normalizeVatNumber(payload.companyVatNumber) || null,
        companyTaxCode: payload.companyTaxCode,
        companyLegalAddress: payload.companyLegalAddress,
        companyPec: payload.companyPec,
        companySdi: normalizeText(payload.companySdi).toUpperCase() || null,
        companyRea: payload.companyRea,
        legalRepFirstName: payload.legalRepFirstName,
        legalRepLastName: payload.legalRepLastName,
        legalRepTaxCode: payload.legalRepTaxCode,
        legalRepRole: payload.legalRepRole,
        legalRepEmail: payload.legalRepEmail,
        legalRepPhone: payload.legalRepPhone,
        notes: payload.notes
      }
    });
    res.status(201).json(created);
  };

  updateCustomer = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const payload = rentalCustomerUpdateSchema.parse(req.body);
    const customer = await this.getCustomerOrThrow(tenantId, req.params.customerId);

    const customerType = this.normalizeCustomerType(payload.customerType ?? customer.customerType);
    const merged = {
      customerType,
      firstName: payload.firstName ?? customer.firstName,
      lastName: payload.lastName ?? customer.lastName,
      drivingLicenseNumber: payload.drivingLicenseNumber ?? customer.drivingLicenseNumber,
      email: payload.email ?? customer.email,
      phone: payload.phone ?? customer.phone,
      companyName: payload.companyName ?? customer.companyName,
      companyVatNumber: payload.companyVatNumber ?? customer.companyVatNumber,
      companySdi: payload.companySdi ?? customer.companySdi
    };

    this.assertCustomerBusinessRules(merged);

    const updated = await prisma.rentalCustomer.update({
      where: { id: customer.id },
      data: withDefined({
        ...payload,
        customerType,
        firstName: payload.firstName !== undefined ? normalizeText(payload.firstName) : undefined,
        lastName: payload.lastName !== undefined ? normalizeText(payload.lastName) : undefined,
        drivingLicenseNumber:
          payload.drivingLicenseNumber !== undefined ? normalizeText(payload.drivingLicenseNumber).toUpperCase() : undefined,
        companyVatNumber:
          payload.companyVatNumber !== undefined ? this.normalizeVatNumber(payload.companyVatNumber) || null : undefined,
        companySdi: payload.companySdi !== undefined ? normalizeText(payload.companySdi).toUpperCase() || null : undefined
      })
    });
    res.json(updated);
  };

  create = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const userId = req.auth?.userId;
    const payload = rentalBookingCreateSchema.parse(req.body);

    const [vehicle, customer] = await Promise.all([
      prisma.vehicle.findFirst({
        where: { tenantId, id: payload.vehicleId, deletedAt: null, isActive: true },
        select: { id: true }
      }),
      this.getCustomerOrThrow(tenantId, payload.customerId)
    ]);

    if (!vehicle) throw new AppError("Veicolo non valido o non attivo", 404, "VEHICLE_NOT_FOUND");

    if (
      typeof payload.pickupKm === "number" &&
      typeof payload.returnKm === "number" &&
      payload.returnKm < payload.pickupKm
    ) {
      throw new AppError("I km rientro devono essere maggiori o uguali ai km uscita.", 400, "BOOKING_KM_RANGE_INVALID");
    }

    await this.assertVehicleAvailability({
      tenantId,
      vehicleId: payload.vehicleId,
      pickupAt: payload.pickupAt,
      returnAt: payload.returnAt
    });

    const code = await this.generateCode(tenantId);
    const created = await prisma.rentalBooking.create({
      data: {
        tenantId,
        createdByUserId: userId,
        vehicleId: payload.vehicleId,
        customerId: customer.id,
        contractRequired: payload.contractRequired ?? true,
        code,
        customerName: customerDisplayName(customer),
        customerEmail: customer.email ?? null,
        customerPhone: customer.phone ?? null,
        customerDocument: customerPrimaryDocument(customer),
        pickupAt: payload.pickupAt,
        returnAt: payload.returnAt,
        pickupKm: payload.pickupKm ?? null,
        returnKm: payload.returnKm ?? null,
        pickupLocation: payload.pickupLocation,
        returnLocation: payload.returnLocation,
        expectedTotal: payload.expectedTotal ?? null,
        finalTotal: payload.finalTotal ?? null,
        reason: payload.reason,
        internalNotes: payload.internalNotes,
        contractStatus: payload.contractStatus ?? "NOT_READY",
        cargosStatus: payload.cargosStatus ?? "NOT_REQUIRED"
      },
      include: {
        vehicle: { select: vehicleSelect },
        customer: { select: customerSelect }
      }
    });

    await this.logNote({
      tenantId,
      bookingId: created.id,
      userId,
      type: "SYSTEM",
      message: `Prenotazione creata (${created.code})`
    });

    if ((payload.generateContract ?? true) && (payload.contractRequired ?? true)) {
      await this.upsertBookingContractFromTemplate({
        tenantId,
        bookingId: created.id,
        actorUserId: userId
      });
      await prisma.rentalBooking.update({
        where: { id: created.id },
        data: { contractStatus: "READY" }
      });
    }

    res.status(201).json(created);
  };

  update = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const userId = req.auth?.userId;
    const payload = rentalBookingUpdateSchema.parse(req.body);
    const current = await this.getBookingOrThrow(tenantId, req.params.id);

    const nextVehicleId = payload.vehicleId ?? current.vehicleId;
    const nextPickupAt = payload.pickupAt ?? current.pickupAt;
    const nextReturnAt = payload.returnAt ?? current.returnAt;
    const nextPickupKm = payload.pickupKm ?? current.pickupKm;
    const nextReturnKm = payload.returnKm ?? current.returnKm;
    const nextCustomerId = payload.customerId ?? current.customerId;

    if (!nextCustomerId) throw new AppError("Cliente obbligatorio", 400, "CUSTOMER_REQUIRED");
    const nextCustomer = await this.getCustomerOrThrow(tenantId, nextCustomerId);

    if (nextReturnAt.getTime() <= nextPickupAt.getTime()) {
      throw new AppError("La data/ora di rientro deve essere successiva al ritiro", 400, "BOOKING_DATE_RANGE_INVALID");
    }
    if (typeof nextPickupKm === "number" && typeof nextReturnKm === "number" && nextReturnKm < nextPickupKm) {
      throw new AppError("I km rientro devono essere maggiori o uguali ai km uscita.", 400, "BOOKING_KM_RANGE_INVALID");
    }

    if (
      nextVehicleId !== current.vehicleId ||
      nextPickupAt.getTime() !== current.pickupAt.getTime() ||
      nextReturnAt.getTime() !== current.returnAt.getTime()
    ) {
      await this.assertVehicleAvailability({
        tenantId,
        vehicleId: nextVehicleId,
        pickupAt: nextPickupAt,
        returnAt: nextReturnAt,
        excludeBookingId: current.id
      });
    }

    const updated = await prisma.rentalBooking.update({
      where: { id: current.id },
      data: {
        ...(payload.vehicleId !== undefined ? { vehicleId: payload.vehicleId } : {}),
        ...(payload.customerId !== undefined ? { customerId: payload.customerId } : {}),
        ...(payload.contractRequired !== undefined ? { contractRequired: payload.contractRequired } : {}),
        customerName: customerDisplayName(nextCustomer),
        customerEmail: nextCustomer.email ?? null,
        customerPhone: nextCustomer.phone ?? null,
        customerDocument: customerPrimaryDocument(nextCustomer),
        ...(payload.pickupAt !== undefined ? { pickupAt: payload.pickupAt } : {}),
        ...(payload.returnAt !== undefined ? { returnAt: payload.returnAt } : {}),
        ...(payload.pickupKm !== undefined ? { pickupKm: payload.pickupKm } : {}),
        ...(payload.returnKm !== undefined ? { returnKm: payload.returnKm } : {}),
        ...(payload.pickupLocation !== undefined ? { pickupLocation: payload.pickupLocation } : {}),
        ...(payload.returnLocation !== undefined ? { returnLocation: payload.returnLocation } : {}),
        ...(payload.expectedTotal !== undefined ? { expectedTotal: payload.expectedTotal } : {}),
        ...(payload.finalTotal !== undefined ? { finalTotal: payload.finalTotal } : {}),
        ...(payload.reason !== undefined ? { reason: payload.reason } : {}),
        ...(payload.internalNotes !== undefined ? { internalNotes: payload.internalNotes } : {}),
        ...(payload.contractStatus !== undefined
          ? {
              contractStatus: payload.contractStatus,
              contractSignedAt: payload.contractStatus === "SIGNED" ? current.contractSignedAt ?? new Date() : null
            }
          : {}),
        ...(payload.cargosStatus !== undefined
          ? {
              cargosStatus: payload.cargosStatus,
              cargosSentAt: payload.cargosStatus === "SENT" ? current.cargosSentAt ?? new Date() : null
            }
          : {})
      },
      include: {
        vehicle: { select: vehicleSelect },
        customer: { select: customerSelect }
      }
    });

    await this.logNote({
      tenantId,
      bookingId: updated.id,
      userId,
      type: "SYSTEM",
      message: "Prenotazione aggiornata"
    });

    res.json(updated);
  };

  remove = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const userId = req.auth?.userId;
    const current = await this.getBookingOrThrow(tenantId, req.params.id);

    await prisma.rentalBooking.update({
      where: { id: current.id },
      data: {
        deletedAt: new Date(),
        status: "CANCELED"
      }
    });

    await this.logNote({
      tenantId,
      bookingId: current.id,
      userId,
      type: "SYSTEM",
      message: "Prenotazione eliminata"
    });

    res.status(204).send();
  };

  transition = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const userId = req.auth?.userId;
    const payload = rentalBookingTransitionSchema.parse(req.body);
    const current = await this.getBookingOrThrow(tenantId, req.params.id);

    if (!this.canTransition(current.status, payload.toStatus)) {
      throw new AppError(
        `Transizione non consentita: ${current.status} -> ${payload.toStatus}`,
        400,
        "BOOKING_TRANSITION_NOT_ALLOWED"
      );
    }

    if (payload.toStatus === "READY_FOR_HANDOVER") {
      if (current.contractStatus !== "SIGNED" || !current.contractSignedAt) {
        throw new AppError(
          "Per passare a 'Pronta consegna' il contratto deve essere firmato.",
          400,
          "BOOKING_CONTRACT_REQUIRED"
        );
      }
      if (current.cargosStatus === "PENDING" || current.cargosStatus === "ERROR") {
        throw new AppError(
          "Per passare a 'Pronta consegna' risolvi prima lo stato CARGOS.",
          400,
          "BOOKING_CARGOS_BLOCKED"
        );
      }
    }

    if (payload.toStatus === "IN_RENT" && typeof current.pickupKm !== "number") {
      throw new AppError(
        "Per avviare il noleggio devi inserire i km all'uscita.",
        400,
        "BOOKING_PICKUP_KM_REQUIRED"
      );
    }

    if (payload.toStatus === "CLOSED") {
      if (typeof current.pickupKm !== "number") {
        throw new AppError(
          "Per chiudere il noleggio devi inserire i km all'uscita.",
          400,
          "BOOKING_PICKUP_KM_REQUIRED"
        );
      }
      if (typeof current.returnKm !== "number") {
        throw new AppError(
          "Per chiudere il noleggio devi inserire i km al rientro.",
          400,
          "BOOKING_RETURN_KM_REQUIRED"
        );
      }
      if (current.returnKm < current.pickupKm) {
        throw new AppError(
          "I km rientro devono essere maggiori o uguali ai km uscita.",
          400,
          "BOOKING_KM_RANGE_INVALID"
        );
      }
    }

    const kmSyncTarget =
      payload.toStatus === "IN_RENT" && typeof current.pickupKm === "number"
        ? current.pickupKm
        : payload.toStatus === "CLOSED" && typeof current.returnKm === "number"
          ? current.returnKm
          : null;
    if (
      kmSyncTarget != null &&
      typeof current.vehicle.currentKm === "number" &&
      kmSyncTarget < current.vehicle.currentKm
    ) {
      throw new AppError(
        `Km non validi: ${kmSyncTarget} è inferiore al km attuale veicolo (${current.vehicle.currentKm}).`,
        400,
        "BOOKING_KM_INCONSISTENT"
      );
    }

    const drivenKm = this.computeDrivenKm(current.pickupKm, current.returnKm);
    let finalTotalFromKm: number | null = null;
    let snapshotUpdateData: Prisma.RentalBookingPricingSnapshotUpdateManyMutationInput | null = null;

    if (
      payload.toStatus === "CLOSED" &&
      typeof drivenKm === "number" &&
      current.pricingSnapshot?.priceListId
    ) {
      const setup = await this.resolvePricingSelection({
        tenantId,
        priceListId: current.pricingSnapshot.priceListId,
        pricePackageId: current.pricingSnapshot.pricePackageId,
        extraKmPolicyId: current.pricingSnapshot.extraKmPolicyId
      });

      const quote = computeRentalQuote({
        priceList: setup.list,
        pricePackage: setup.selectedPackage,
        extraKmPolicy: setup.selectedPolicy,
        pickupAt: current.pickupAt,
        returnAt: current.returnAt,
        estimatedKm: toSafeNonNegativeInt(current.pricingSnapshot.estimatedKm),
        actualKm: drivenKm
      });

      finalTotalFromKm = quote.pricing.finalTotal;
      snapshotUpdateData = {
        actualKm: quote.km.actualKm,
        extraKmActual: quote.km.extraKmActual,
        extraKmActualCost: quote.pricing.extraKmActualCost,
        finalSubtotal: quote.pricing.finalSubtotal,
        finalTaxAmount: quote.pricing.finalTaxAmount,
        finalTotal: quote.pricing.finalTotal
      };
    } else if (payload.toStatus === "CLOSED" && typeof drivenKm === "number") {
      snapshotUpdateData = { actualKm: drivenKm };
    }

    const updated = await prisma.rentalBooking.update({
      where: { id: current.id },
      data: {
        status: payload.toStatus,
        ...(payload.toStatus === "CONTRACT_SIGNED"
          ? { contractStatus: "SIGNED", contractSignedAt: current.contractSignedAt ?? new Date() }
          : {}),
        ...(finalTotalFromKm != null
          ? { finalTotal: finalTotalFromKm }
          : {}),
        ...(finalTotalFromKm == null &&
        payload.toStatus === "CLOSED" &&
        current.finalTotal == null &&
        current.expectedTotal != null
          ? { finalTotal: current.expectedTotal }
          : {})
      }
    });

    if (snapshotUpdateData) {
      await prisma.rentalBookingPricingSnapshot.updateMany({
        where: { tenantId, bookingId: updated.id, deletedAt: null },
        data: snapshotUpdateData
      });
    }

    let kmSyncMessage = "";
    if (kmSyncTarget != null) {
      const syncResult = await this.syncVehicleCurrentKmFromBooking({
        tenantId,
        vehicleId: updated.vehicleId,
        nextKm: kmSyncTarget
      });
      kmSyncMessage = `Km veicolo aggiornati a ${syncResult.nextKm}`;
      if (syncResult.dueByKm) {
        kmSyncMessage += " · manutenzione km SCADUTA";
      } else if (syncResult.dueSoonByKm && syncResult.remainingKm != null) {
        kmSyncMessage += ` · manutenzione in scadenza (${syncResult.remainingKm} km residui)`;
      }
    }

    await this.logNote({
      tenantId,
      bookingId: updated.id,
      userId,
      type: "SYSTEM",
      message: `Stato prenotazione: ${current.status} -> ${updated.status}${payload.reason ? ` (${payload.reason})` : ""}${
        kmSyncMessage ? ` · ${kmSyncMessage}` : ""
      }`
    });

    res.json(updated);
  };

  setContract = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const userId = req.auth?.userId;
    const payload = rentalBookingContractSchema.parse(req.body);
    const current = await this.getBookingOrThrow(tenantId, req.params.id);

    const signedAt = payload.status === "SIGNED" ? payload.signedAt ?? current.contractSignedAt ?? new Date() : null;
    const shouldPromoteToContractSigned = payload.status === "SIGNED" && ["DRAFT", "QUOTED", "HOLD", "CONFIRMED"].includes(current.status);

    const updated = await prisma.rentalBooking.update({
      where: { id: current.id },
      data: {
        contractStatus: payload.status,
        contractSignedAt: signedAt,
        ...(shouldPromoteToContractSigned ? { status: "CONTRACT_SIGNED" } : {})
      }
    });

    await this.logNote({
      tenantId,
      bookingId: updated.id,
      userId,
      type: "SYSTEM",
      message: `Contratto aggiornato: ${payload.status}${payload.note ? ` (${payload.note})` : ""}`
    });

    res.json(updated);
  };

  setCargosStatus = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const userId = req.auth?.userId;
    const payload = rentalBookingCargosSchema.parse(req.body);
    const current = await this.getBookingOrThrow(tenantId, req.params.id);

    const shouldPromoteToReady = payload.status === "SENT" && current.status === "CONTRACT_SIGNED";

    const updated = await prisma.rentalBooking.update({
      where: { id: current.id },
      data: {
        cargosStatus: payload.status,
        cargosTransmissionId: payload.transmissionId ?? current.cargosTransmissionId,
        cargosOutcomeMessage: payload.message ?? null,
        cargosSentAt: payload.status === "SENT" ? new Date() : current.cargosSentAt,
        ...(shouldPromoteToReady ? { status: "READY_FOR_HANDOVER" } : {})
      }
    });

    await this.logNote({
      tenantId,
      bookingId: updated.id,
      userId,
      type: "CARGOS",
      message: `CARGOS: ${payload.status}${payload.transmissionId ? ` · id ${payload.transmissionId}` : ""}${payload.message ? ` · ${payload.message}` : ""}`
    });

    res.json(updated);
  };

  addNote = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const userId = req.auth?.userId;
    const payload = rentalBookingNoteSchema.parse(req.body);
    const booking = await this.getBookingOrThrow(tenantId, req.params.id);

    const note = await prisma.rentalBookingNote.create({
      data: {
        tenantId,
        bookingId: booking.id,
        userId,
        type: payload.type ?? "NOTE",
        message: payload.message
      }
    });

    res.status(201).json(note);
  };

  dayAvailability = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const parsed = rentalBookingDayAvailabilityQuerySchema.parse(req.query);
    const isoDate = parsed.date ?? new Date().toISOString().slice(0, 10);
    const { dayStart, dayEnd } = this.dayBoundsFromIsoDate(isoDate);

    const vehicles = await prisma.vehicle.findMany({
      where: {
        tenantId,
        deletedAt: null,
        isActive: true,
        ...(parsed.siteId ? { siteId: parsed.siteId } : {})
      },
      orderBy: [{ plate: "asc" }],
      select: monthAvailabilityVehicleSelect
    });

    const vehicleIds = vehicles.map((vehicle) => vehicle.id);
    const bookings = vehicleIds.length
      ? await prisma.rentalBooking.findMany({
          where: {
            tenantId,
            deletedAt: null,
            vehicleId: { in: vehicleIds },
            status: { in: [...ACTIVE_BOOKING_STATUSES] },
            pickupAt: { lt: dayEnd },
            returnAt: { gt: dayStart }
          },
          orderBy: [{ pickupAt: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            code: true,
            status: true,
            contractStatus: true,
            cargosStatus: true,
            customerName: true,
            pickupAt: true,
            returnAt: true,
            pickupKm: true,
            returnKm: true,
            pickupLocation: true,
            returnLocation: true,
            vehicleId: true,
            customer: { select: { id: true, firstName: true, lastName: true } }
          }
        })
      : [];

    const byVehicle = new Map<string, typeof bookings>();
    bookings.forEach((booking) => {
      const list = byVehicle.get(booking.vehicleId) ?? [];
      list.push(booking);
      byVehicle.set(booking.vehicleId, list);
    });

    const data = vehicles.map((vehicle) => {
      const slots = byVehicle.get(vehicle.id) ?? [];
      return {
        vehicle,
        bookings: slots.map((booking) => ({
          ...booking,
          customerName: booking.customer ? fullCustomerName({ firstName: booking.customer.firstName, lastName: booking.customer.lastName }) : booking.customerName
        })),
        isAvailable: slots.length === 0
      };
    });

    const totalVehicles = data.length;
    const availableVehicles = data.filter((row) => row.isAvailable).length;
    const busyVehicles = totalVehicles - availableVehicles;
    const occupancyRate = totalVehicles > 0 ? Math.round((busyVehicles / totalVehicles) * 1000) / 10 : 0;

    res.json({
      day: isoDate,
      siteId: parsed.siteId ?? null,
      summary: {
        totalVehicles,
        availableVehicles,
        busyVehicles,
        occupancyRate
      },
      data
    });
  };

  monthAvailability = async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    const parsed = rentalBookingMonthAvailabilityQuerySchema.parse(req.query);
    const currentMonth = new Date().toISOString().slice(0, 7);
    const month = parsed.month ?? currentMonth;
    const { monthStart, monthEnd } = this.monthBoundsFromIsoMonth(month);

    const vehicles = await prisma.vehicle.findMany({
      where: {
        tenantId,
        deletedAt: null,
        isActive: true,
        ...(parsed.siteId ? { siteId: parsed.siteId } : {})
      },
      orderBy: [{ plate: "asc" }],
      select: vehicleSelect
    });

    const vehicleIds = vehicles.map((vehicle) => vehicle.id);
    const bookings = vehicleIds.length
      ? await prisma.rentalBooking.findMany({
          where: {
            tenantId,
            deletedAt: null,
            vehicleId: { in: vehicleIds },
            status: { in: [...MONTHLY_VISIBLE_STATUSES] },
            pickupAt: { lt: monthEnd },
            returnAt: { gt: monthStart }
          },
          orderBy: [{ pickupAt: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            code: true,
            status: true,
            contractStatus: true,
            cargosStatus: true,
            customerName: true,
            pickupAt: true,
            returnAt: true,
            pickupKm: true,
            returnKm: true,
            pickupLocation: true,
            returnLocation: true,
            vehicleId: true,
            customer: { select: { id: true, firstName: true, lastName: true } }
          }
        })
      : [];

    const byVehicle = new Map<string, typeof bookings>();
    bookings.forEach((booking) => {
      const list = byVehicle.get(booking.vehicleId) ?? [];
      list.push(booking);
      byVehicle.set(booking.vehicleId, list);
    });

    const data = vehicles.map((vehicle) => {
      const rows = byVehicle.get(vehicle.id) ?? [];
      return {
        vehicle: {
          ...vehicle,
          deadlineStatus: {
            maintenance: vehicleMaintenanceDeadlineStatus(vehicle),
            revision: vehicleRevisionDeadlineStatus(vehicle.revisionDueAt)
          }
        },
        bookings: rows.map((booking) => ({
          ...booking,
          customerName: booking.customer ? fullCustomerName({ firstName: booking.customer.firstName, lastName: booking.customer.lastName }) : booking.customerName
        })),
        hasBookings: rows.length > 0
      };
    });

    const searchTerm = parsed.search?.trim().toLowerCase();
    const filteredData = searchTerm
      ? data
          .map((row) => {
            const vehicleMatch = [row.vehicle.plate, row.vehicle.brand, row.vehicle.model]
              .filter((value): value is string => Boolean(value))
              .some((value) => value.toLowerCase().includes(searchTerm));

            const bookingMatches = row.bookings.filter((booking) =>
              [booking.code, booking.customerName]
                .filter((value): value is string => Boolean(value))
                .some((value) => value.toLowerCase().includes(searchTerm))
            );

            if (!vehicleMatch && bookingMatches.length === 0) return null;
            return {
              ...row,
              bookings: vehicleMatch ? row.bookings : bookingMatches,
              hasBookings: (vehicleMatch ? row.bookings : bookingMatches).length > 0
            };
          })
          .filter((row): row is (typeof data)[number] => row !== null)
      : data;

    const totalVehicles = filteredData.length;
    const bookedVehicles = filteredData.filter((row) => row.hasBookings).length;
    const availableVehicles = totalVehicles - bookedVehicles;
    const occupancyRate = totalVehicles > 0 ? Math.round((bookedVehicles / totalVehicles) * 1000) / 10 : 0;

    res.json({
      month,
      siteId: parsed.siteId ?? null,
      range: {
        from: monthStart.toISOString(),
        to: monthEnd.toISOString()
      },
      summary: {
        totalVehicles,
        availableVehicles,
        bookedVehicles,
        occupancyRate
      },
      data: filteredData
    });
  };
}
