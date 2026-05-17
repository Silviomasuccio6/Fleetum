import { httpClient } from "../../infrastructure/api/http-client";
import { getApiBaseUrl } from "../../infrastructure/api/api-base-url";

export type RentalBookingStatus =
  | "DRAFT"
  | "QUOTED"
  | "HOLD"
  | "CONFIRMED"
  | "CONTRACT_SIGNED"
  | "READY_FOR_HANDOVER"
  | "IN_RENT"
  | "CLOSED"
  | "CANCELED"
  | "NO_SHOW";

export type RentalContractStatus = "NOT_READY" | "READY" | "SIGNED";
export type RentalCargosStatus = "NOT_REQUIRED" | "PENDING" | "SENT" | "ERROR";
export type BookingContractStatus = "DRAFT" | "READY" | "SENT" | "SIGNED" | "ERROR";
export type RentalPricingScope = "GLOBAL" | "SITE" | "VEHICLE_CATEGORY" | "VEHICLE";
export type RentalBaseRateUnit = "DAILY" | "WEEKLY" | "MONTHLY";
export type RentalKmPackageType = "LIMITED" | "UNLIMITED";
export type RentalKmScope = "PER_DAY" | "PER_RENTAL";
export type RentalExtraKmPolicyType = "FLAT" | "TIERED";
export type RentalHourOverflowRule = "NONE" | "HALF_DAY" | "FULL_DAY";
export type RentalCustomerType = "PERSONA_FISICA" | "PERSONA_GIURIDICA";

export type RentalCustomer = {
  id: string;
  customerType?: RentalCustomerType;
  firstName?: string | null;
  lastName?: string | null;
  drivingLicenseNumber?: string | null;
  drivingLicenseIssuedAt?: string | null;
  drivingLicenseExpiresAt?: string | null;
  drivingLicenseAuthority?: string | null;
  drivingLicenseCategory?: string | null;
  email?: string | null;
  phone?: string | null;
  dateOfBirth?: string | null;
  placeOfBirth?: string | null;
  nationality?: string | null;
  residenceAddress?: string | null;
  taxCode?: string | null;
  documentType?: string | null;
  documentNumber?: string | null;
  documentIssuedAt?: string | null;
  documentExpiresAt?: string | null;
  documentAuthority?: string | null;
  companyName?: string | null;
  companyLegalForm?: string | null;
  companyVatNumber?: string | null;
  companyTaxCode?: string | null;
  companyLegalAddress?: string | null;
  companyPec?: string | null;
  companySdi?: string | null;
  companyRea?: string | null;
  legalRepFirstName?: string | null;
  legalRepLastName?: string | null;
  legalRepTaxCode?: string | null;
  legalRepRole?: string | null;
  legalRepEmail?: string | null;
  legalRepPhone?: string | null;
  notes?: string | null;
  attachments?: Array<{
    id: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    bookingId?: string | null;
    category?: string | null;
    createdAt: string;
  }>;
};

export type BookingContract = {
  id: string;
  tenantId: string;
  bookingId: string;
  status: BookingContractStatus;
  title: string;
  content: string;
  emailTo?: string | null;
  emailSubject?: string | null;
  emailBody?: string | null;
  pdfFileName?: string | null;
  pdfGeneratedAt?: string | null;
  lastSentAt?: string | null;
  signedAt?: string | null;
  errorMessage?: string | null;
  templateVersion: number;
  events?: Array<{
    id: string;
    type: string;
    message: string;
    createdAt: string;
    details?: unknown;
  }>;
  deliveries?: Array<{
    id: string;
    channel?: "EMAIL" | "WHATSAPP";
    recipient: string;
    subject: string;
    status: "PENDING" | "SENT" | "FAILED";
    sentAt?: string | null;
    errorMessage?: string | null;
    details?: Record<string, unknown> | null;
    createdAt: string;
  }>;
};

export type RentalContractsMonitoringItem = {
  id: string;
  bookingId: string;
  status: BookingContractStatus;
  title: string;
  emailTo?: string | null;
  lastSentAt?: string | null;
  signedAt?: string | null;
  pdfGeneratedAt?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
  latestDelivery?: {
    id: string;
    channel: "EMAIL" | "WHATSAPP";
    recipient: string;
    status: "PENDING" | "SENT" | "FAILED";
    sentAt?: string | null;
    errorMessage?: string | null;
    createdAt: string;
  } | null;
  booking: {
    id: string;
    code: string;
    status: RentalBookingStatus;
    contractStatus: RentalContractStatus;
    customerName: string;
    pickupAt: string;
    returnAt: string;
    expectedTotal?: number | null;
    finalTotal?: number | null;
    vehicle?: {
      id: string;
      plate: string;
      brand: string;
      model: string;
      site?: { id: string; name: string; city?: string | null } | null;
    } | null;
    customer?: {
      id: string;
      customerType?: RentalCustomerType;
      firstName?: string | null;
      lastName?: string | null;
      companyName?: string | null;
      phone?: string | null;
      email?: string | null;
    } | null;
  };
};

export type RentalContractsMonitoringTimelineItem = {
  type: "PICKUP" | "RETURN" | "DELIVERY";
  occurredAt: string;
  bookingId: string;
  bookingCode: string;
  customerName: string;
  bookingStatus?: RentalBookingStatus | null;
  channel?: "EMAIL" | "WHATSAPP" | null;
  deliveryStatus?: "PENDING" | "SENT" | "FAILED" | null;
  recipient?: string | null;
  vehicle?: {
    plate?: string | null;
    brand?: string | null;
    model?: string | null;
  } | null;
};

export type ContractTemplate = {
  id: string;
  name: string;
  content: string;
  emailSubject?: string | null;
  emailBody?: string | null;
  companyName?: string | null;
  companyAddress?: string | null;
  companyVat?: string | null;
  companyEmail?: string | null;
  companyPhone?: string | null;
  logoFilePath?: string | null;
  logoFileName?: string | null;
  logoMimeType?: string | null;
  brandPrimary?: string | null;
  brandAccent?: string | null;
  brandFont?: string | null;
  version: number;
  isDefault: boolean;
  updatedAt: string;
};

export type RentalCustomerDocumentDraft = {
  fields: Partial<RentalCustomer>;
  score: number;
  source: "pdf-text" | "pdf-ocr" | "image-ocr" | "none";
  warnings: string[];
  textPreview: string;
  files?: Array<{
    fileName: string;
    mimeType: string;
    documentType?: string | null;
    score: number;
    source: "pdf-text" | "pdf-ocr" | "image-ocr" | "none";
    warnings: string[];
  }>;
};

export type RentalCustomerRegistryItem = RentalCustomer & {
  bookingsTotal: number;
  contractsTotal: number;
  attachmentsTotal: number;
  lastRentalAt?: string | null;
  lastRentalCode?: string | null;
  lastRentalStatus?: RentalBookingStatus | null;
  lastRentalContractStatus?: RentalContractStatus | null;
  updatedAt?: string;
};

export type RentalCustomerProfile = RentalCustomer & {
  stats?: {
    bookingsTotal: number;
    contractsTotal: number;
    attachmentsTotal: number;
    lastRentalAt?: string | null;
    lastRentalCode?: string | null;
    lastRentalStatus?: RentalBookingStatus | null;
    lastRentalContractStatus?: RentalContractStatus | null;
  };
  _count?: {
    bookings: number;
    attachments: number;
  };
};

export type RentalCustomerContractTimelineItem = {
  id: string;
  bookingId: string;
  status: BookingContractStatus;
  title: string;
  emailTo?: string | null;
  emailSubject?: string | null;
  lastSentAt?: string | null;
  signedAt?: string | null;
  pdfGeneratedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  booking: {
    id: string;
    code: string;
    pickupAt: string;
    returnAt: string;
    status: RentalBookingStatus;
    contractStatus: RentalContractStatus;
    expectedTotal?: number | null;
    finalTotal?: number | null;
    customerName: string;
    vehicle: {
      id: string;
      plate: string;
      brand: string;
      model: string;
    };
  };
};

export type RentalPriceList = {
  id: string;
  name: string;
  description?: string | null;
  isActive: boolean;
  validFrom?: string | null;
  validTo?: string | null;
  scope: RentalPricingScope;
  siteId?: string | null;
  vehicleId?: string | null;
  vehicleCategory?: string | null;
  baseRateUnit: RentalBaseRateUnit;
  baseRateAmount: number;
  vatRate: number;
  discountPercent: number;
  hourOverflowRule: RentalHourOverflowRule;
  priority: number;
  updatedAt: string;
  site?: { id: string; name: string; city?: string | null } | null;
  vehicle?: { id: string; plate: string; brand: string; model: string } | null;
  _count?: { packages: number; extraKmPolicies: number; bookingSnapshots: number };
};

export type RentalPricePackage = {
  id: string;
  priceListId: string;
  name: string;
  code?: string | null;
  type: RentalKmPackageType;
  kmIncluded?: number | null;
  kmScope: RentalKmScope;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
};

export type RentalExtraKmTier = {
  id: string;
  policyId: string;
  fromKm: number;
  toKm?: number | null;
  ratePerKm: number;
  sortOrder: number;
};

export type RentalExtraKmPolicy = {
  id: string;
  priceListId: string;
  packageId?: string | null;
  name: string;
  type: RentalExtraKmPolicyType;
  flatRatePerKm?: number | null;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
  tiers?: RentalExtraKmTier[];
};

export type RentalPricingQuote = {
  pricingRef: {
    priceListId: string;
    pricePackageId: string | null;
    extraKmPolicyId: string | null;
    priceListName: string;
    pricePackageName: string | null;
    extraKmPolicyName: string | null;
  };
  duration: {
    totalHours: number;
    daysCharged: number;
    unit: RentalBaseRateUnit;
    chargedUnits: number;
    overflowRule: RentalHourOverflowRule;
  };
  km: {
    packageType: RentalKmPackageType | null;
    kmScope: RentalKmScope | null;
    includedKmTotal: number | null;
    estimatedKm: number | null;
    actualKm: number | null;
    extraKmEstimated: number;
    extraKmActual: number;
  };
  pricing: {
    baseRateAmount: number;
    baseCost: number;
    discountPercent: number;
    discountedBaseCost: number;
    vatRate: number;
    extraKmPolicyType: RentalExtraKmPolicyType | null;
    extraKmEstimatedCost: number;
    extraKmActualCost: number;
    expectedSubtotal: number;
    expectedTaxAmount: number;
    expectedTotal: number;
    finalSubtotal: number;
    finalTaxAmount: number;
    finalTotal: number;
    extraKmEffectiveRateEstimated: number | null;
    extraKmEffectiveRateActual: number | null;
  };
};

const API_BASE_URL = getApiBaseUrl();

export const rentalBookingsUseCases = {
  list: (params: Record<string, string | number | undefined>) =>
    httpClient.get<{
      data: any[];
      total: number;
      page: number;
      pageSize: number;
      kpis: {
        active: number;
        readyForHandover: number;
        inRent: number;
        cargosPending: number;
        cargosErrors: number;
      };
    }>("/rental-bookings", params),
  getById: (id: string) => httpClient.get<any>(`/rental-bookings/${id}`),
  quickDetail: (id: string) => httpClient.get<any>(`/rental-bookings/${id}/quick`),
  suggestVehicles: (params: { q: string; siteId?: string }) =>
    httpClient.get<{
      data: Array<{
        id: string;
        plate: string;
        brand: string;
        model: string;
        site?: { id: string; name: string; city?: string | null };
      }>;
    }>("/rental-bookings/suggest/vehicles", params),
  suggestCustomers: (params: { q: string }) =>
    httpClient.get<{ data: RentalCustomer[] }>("/rental-bookings/suggest/customers", params),
  create: (input: unknown) => httpClient.post<any>("/rental-bookings", input),
  update: (id: string, input: unknown) => httpClient.patch<any>(`/rental-bookings/${id}`, input),
  remove: (id: string) => httpClient.delete(`/rental-bookings/${id}`),
  transition: (id: string, toStatus: RentalBookingStatus, reason?: string) =>
    httpClient.post<any>(`/rental-bookings/${id}/transition`, { toStatus, reason }),
  setContractStatus: (id: string, input: { status: RentalContractStatus; signedAt?: string; note?: string }) =>
    httpClient.post<any>(`/rental-bookings/${id}/contract`, input),
  generateContract: (bookingId: string) => httpClient.post<BookingContract>(`/rental-bookings/${bookingId}/contract/generate`),
  getContract: (bookingId: string) => httpClient.get<BookingContract>(`/rental-bookings/${bookingId}/contract`),
  updateContract: (
    bookingId: string,
    input: {
      title?: string;
      content?: string;
      emailTo?: string;
      emailSubject?: string;
      emailBody?: string;
      status?: BookingContractStatus;
    }
  ) => httpClient.patch<BookingContract>(`/rental-bookings/${bookingId}/contract`, input),
  sendContractEmail: (bookingId: string, input?: { to?: string; subject?: string; body?: string }) =>
    httpClient.post<{ queued: boolean; deliveryId: string }>(`/rental-bookings/${bookingId}/contract/email`, input),
  sendContractWhatsapp: (bookingId: string, input?: { phone?: string; message?: string; shareExpiresHours?: number }) =>
    httpClient.post<{
      queued: boolean;
      channel: "WHATSAPP";
      deliveryId: string;
      phone: string;
      whatsappUrl: string;
      shareUrl: string;
      expiresAt: string;
    }>(`/rental-bookings/${bookingId}/contract/whatsapp`, input),
  markContractSigned: (bookingId: string, input?: { signedAt?: string; signatureDataUrl?: string }) =>
    httpClient.post<BookingContract>(`/rental-bookings/${bookingId}/contract/mark-signed`, input),
  listContractsMonitoring: (params: Record<string, string | number | undefined>) =>
    httpClient.get<{
      data: RentalContractsMonitoringItem[];
      total: number;
      page: number;
      pageSize: number;
      kpis: {
        contractsToSend: number;
        sentToday: number;
        signed: number;
        inError: number;
        exitsToday: number;
        returnsToday: number;
      };
      timeline: RentalContractsMonitoringTimelineItem[];
      filters: {
        period: "all" | "7d" | "30d" | "90d" | "custom";
        status: BookingContractStatus | null;
        bookingStatus: RentalBookingStatus | null;
        siteId: string | null;
        search: string | null;
        dateFrom: string | null;
        dateTo: string | null;
      };
    }>("/rental-bookings/contracts", params),
  setCargosStatus: (id: string, input: { status: RentalCargosStatus; transmissionId?: string; message?: string }) =>
    httpClient.post<any>(`/rental-bookings/${id}/cargos`, input),
  addNote: (id: string, message: string, type: "NOTE" | "SYSTEM" | "CARGOS" = "NOTE") =>
    httpClient.post<any>(`/rental-bookings/${id}/notes`, { message, type }),
  dayAvailability: (params: { date: string; siteId?: string }) =>
    httpClient.get<{
      day: string;
      siteId: string | null;
      summary: {
        totalVehicles: number;
        availableVehicles: number;
        busyVehicles: number;
        occupancyRate: number;
      };
      data: Array<{
        isAvailable: boolean;
        vehicle: {
          id: string;
          plate: string;
          brand: string;
          model: string;
          currentKm?: number | null;
          maintenanceIntervalKm?: number | null;
          revisionDueAt?: string | null;
          deadlineStatus?: {
            maintenance: {
              status: "OK" | "DUE_SOON" | "EXPIRED";
              label: string;
              detail: string;
            };
            revision: {
              status: "OK" | "DUE_SOON" | "EXPIRED";
              label: string;
              detail: string;
            };
          };
          site?: { id: string; name: string; city?: string | null };
        };
        bookings: Array<{
          id: string;
          code: string;
          status: RentalBookingStatus;
          contractStatus: RentalContractStatus;
          cargosStatus: RentalCargosStatus;
          customerName: string;
          pickupAt: string;
          returnAt: string;
          pickupKm?: number | null;
          returnKm?: number | null;
          pickupLocation?: string | null;
          returnLocation?: string | null;
        }>;
      }>;
    }>("/rental-bookings/availability/day", params),
  monthAvailability: (params: { month: string; siteId?: string; search?: string }) =>
    httpClient.get<{
      month: string;
      siteId: string | null;
      range: { from: string; to: string };
      summary: {
        totalVehicles: number;
        availableVehicles: number;
        bookedVehicles: number;
        occupancyRate: number;
      };
      data: Array<{
        hasBookings: boolean;
        vehicle: {
          id: string;
          plate: string;
          brand: string;
          model: string;
          currentKm?: number | null;
          site?: { id: string; name: string; city?: string | null };
        };
        bookings: Array<{
          id: string;
          code: string;
          status: RentalBookingStatus;
          contractStatus: RentalContractStatus;
          cargosStatus: RentalCargosStatus;
          customerName: string;
          pickupAt: string;
          returnAt: string;
          pickupKm?: number | null;
          returnKm?: number | null;
          pickupLocation?: string | null;
          returnLocation?: string | null;
        }>;
      }>;
    }>("/rental-bookings/availability/month", params),
  listPriceLists: (params: Record<string, string | number | undefined>) =>
    httpClient.get<{ data: RentalPriceList[]; total: number; page: number; pageSize: number }>("/rental-pricing/lists", params),
  createPriceList: (input: Partial<RentalPriceList>) => httpClient.post<RentalPriceList>("/rental-pricing/lists", input),
  updatePriceList: (id: string, input: Partial<RentalPriceList>) => httpClient.patch<RentalPriceList>(`/rental-pricing/lists/${id}`, input),
  deletePriceList: (id: string) => httpClient.delete(`/rental-pricing/lists/${id}`),
  listPricePackages: (priceListId: string) =>
    httpClient.get<{ data: RentalPricePackage[] }>(`/rental-pricing/lists/${priceListId}/packages`),
  createPricePackage: (priceListId: string, input: Partial<RentalPricePackage>) =>
    httpClient.post<RentalPricePackage>(`/rental-pricing/lists/${priceListId}/packages`, input),
  updatePricePackage: (id: string, input: Partial<RentalPricePackage>) =>
    httpClient.patch<RentalPricePackage>(`/rental-pricing/packages/${id}`, input),
  deletePricePackage: (id: string) => httpClient.delete(`/rental-pricing/packages/${id}`),
  listExtraKmPolicies: (params: { priceListId?: string; packageId?: string }) =>
    httpClient.get<{ data: RentalExtraKmPolicy[] }>("/rental-pricing/extra-policies", params),
  createExtraKmPolicy: (input: {
    priceListId: string;
    packageId?: string;
    name: string;
    type: RentalExtraKmPolicyType;
    flatRatePerKm?: number;
    isDefault?: boolean;
    isActive?: boolean;
    sortOrder?: number;
    tiers?: Array<{ fromKm: number; toKm?: number; ratePerKm: number; sortOrder?: number }>;
  }) =>
    httpClient.post<RentalExtraKmPolicy>("/rental-pricing/extra-policies", input),
  updateExtraKmPolicy: (
    id: string,
    input: {
      packageId?: string;
      name?: string;
      type?: RentalExtraKmPolicyType;
      flatRatePerKm?: number;
      isDefault?: boolean;
      isActive?: boolean;
      sortOrder?: number;
      tiers?: Array<{ fromKm: number; toKm?: number; ratePerKm: number; sortOrder?: number }>;
    }
  ) =>
    httpClient.patch<RentalExtraKmPolicy>(`/rental-pricing/extra-policies/${id}`, input),
  deleteExtraKmPolicy: (id: string) => httpClient.delete(`/rental-pricing/extra-policies/${id}`),
  previewPricingQuote: (input: {
    priceListId: string;
    pricePackageId?: string;
    extraKmPolicyId?: string;
    pickupAt: string;
    returnAt: string;
    estimatedKm?: number;
    actualKm?: number;
  }) =>
    httpClient.post<{
      quote: RentalPricingQuote;
      selected: {
        priceList: RentalPriceList;
        pricePackage?: RentalPricePackage | null;
        extraKmPolicy?: RentalExtraKmPolicy | null;
      };
    }>("/rental-pricing/quote/preview", input),
  finalizePricingQuote: (input: {
    priceListId: string;
    pricePackageId?: string;
    extraKmPolicyId?: string;
    pickupAt: string;
    returnAt: string;
    estimatedKm?: number;
    actualKm?: number;
  }) =>
    httpClient.post<{
      quote: RentalPricingQuote;
      selected: {
        priceList: RentalPriceList;
        pricePackage?: RentalPricePackage | null;
        extraKmPolicy?: RentalExtraKmPolicy | null;
      };
    }>("/rental-pricing/quote/finalize", input),
  getBookingPricing: (bookingId: string) =>
    httpClient.get<{
      bookingId: string;
      bookingCode: string;
      snapshot?: {
        id: string;
        priceListId?: string | null;
        pricePackageId?: string | null;
        extraKmPolicyId?: string | null;
        estimatedKm?: number | null;
        actualKm?: number | null;
        expectedTotal?: number | null;
        finalTotal?: number | null;
        notes?: string | null;
      } | null;
    }>(`/rental-bookings/${bookingId}/pricing`),
  updateBookingPricing: (
    bookingId: string,
    input: {
      priceListId: string;
      pricePackageId?: string;
      extraKmPolicyId?: string;
      estimatedKm?: number;
      actualKm?: number;
      notes?: string;
    }
  ) =>
    httpClient.patch<{
      bookingId: string;
      bookingCode: string;
      quote: RentalPricingQuote;
      snapshot: unknown;
    }>(`/rental-bookings/${bookingId}/pricing`, input),
  listCustomers: (params: Record<string, string | number | undefined>) =>
    httpClient.get<{ data: RentalCustomer[]; total: number; page: number; pageSize: number }>("/rental-bookings/customers", params),
  listCustomerRegistry: (params: Record<string, string | number | undefined>) =>
    httpClient.get<{ data: RentalCustomerRegistryItem[]; total: number; page: number; pageSize: number }>(
      "/rental-customers",
      params
    ),
  getCustomerProfile: (id: string) => httpClient.get<RentalCustomerProfile>(`/rental-customers/${id}`),
  updateCustomerProfile: (id: string, input: Partial<RentalCustomer>) =>
    httpClient.patch<RentalCustomerProfile>(`/rental-customers/${id}`, input),
  listCustomerContracts: (
    customerId: string,
    params: Record<string, string | number | undefined>
  ) =>
    httpClient.get<{
      data: RentalCustomerContractTimelineItem[];
      total: number;
      page: number;
      pageSize: number;
      filters: {
        period: string;
        status: string | null;
        dateFrom: string | null;
        dateTo: string | null;
      };
    }>(`/rental-customers/${customerId}/contracts`, params),
  listCustomerBookings: (
    customerId: string,
    params: Record<string, string | number | undefined>
  ) =>
    httpClient.get<{
      data: Array<{
        id: string;
        code: string;
        status: RentalBookingStatus;
        contractStatus: RentalContractStatus;
        cargosStatus: RentalCargosStatus;
        pickupAt: string;
        returnAt: string;
        expectedTotal?: number | null;
        finalTotal?: number | null;
        createdAt: string;
        updatedAt: string;
        vehicle: {
          id: string;
          plate: string;
          brand: string;
          model: string;
        };
        contract?: {
          id: string;
          status: BookingContractStatus;
          signedAt?: string | null;
          lastSentAt?: string | null;
        } | null;
      }>;
      total: number;
      page: number;
      pageSize: number;
      filters: {
        period: string;
        status: string | null;
        contractStatus: string | null;
        dateFrom: string | null;
        dateTo: string | null;
      };
    }>(`/rental-customers/${customerId}/bookings`, params),
  parseCustomerDocumentDraft: async (files: File[]) => {
    const formData = new FormData();
    files.forEach((file) => formData.append("files", file));
    return httpClient.post<RentalCustomerDocumentDraft>("/rental-bookings/customers/parse-document", formData, {
      timeoutMs: 120000
    });
  },
  getCustomerById: (id: string) => httpClient.get<RentalCustomer>(`/rental-bookings/customers/${id}`),
  createCustomer: (input: Partial<RentalCustomer>) => httpClient.post<RentalCustomer>("/rental-bookings/customers", input),
  updateCustomer: (id: string, input: Partial<RentalCustomer>) =>
    httpClient.patch<RentalCustomer>(`/rental-bookings/customers/${id}`, input),
  uploadCustomerAttachments: async (customerId: string, files: File[], input?: { bookingId?: string; category?: string }) => {
    const formData = new FormData();
    files.forEach((file) => formData.append("files", file));
    if (input?.bookingId) formData.append("bookingId", input.bookingId);
    if (input?.category) formData.append("category", input.category);
    return httpClient.post<{ uploaded: number }>(`/uploads/rental-customers/${customerId}/attachments`, formData, {
      timeoutMs: 120000
    });
  },
  deleteCustomerAttachment: (attachmentId: string) =>
    httpClient.delete(`/uploads/rental-customer-attachments/${attachmentId}`),
  downloadCustomerAttachment: async (attachmentId: string) => {
    const response = await fetch(`${API_BASE_URL}/uploads/rental-customer-attachments/${attachmentId}/file`, {
      credentials: "include"
    });
    if (!response.ok) throw new Error("Download allegato cliente fallito");
    return response.blob();
  },
  downloadContractPdf: async (bookingId: string) => {
    const response = await fetch(`${API_BASE_URL}/rental-bookings/${bookingId}/contract/pdf?t=${Date.now()}`, {
      credentials: "include",
      cache: "no-store"
    });
    if (!response.ok) throw new Error("Download contratto fallito");
    return response.blob();
  },
  getDefaultContractTemplate: () => httpClient.get<ContractTemplate>("/contract-templates/default"),
  updateDefaultContractTemplate: (input: {
    name?: string;
    content?: string;
    emailSubject?: string;
    emailBody?: string;
    companyName?: string;
    companyAddress?: string;
    companyVat?: string;
    companyEmail?: string;
    companyPhone?: string;
    brandPrimary?: string;
    brandAccent?: string;
    brandFont?: string;
  }) =>
    httpClient.patch<ContractTemplate>("/contract-templates/default", input),
  uploadDefaultContractTemplateLogo: async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return httpClient.post<ContractTemplate>("/contract-templates/default/logo", formData, { timeoutMs: 120000 });
  },
  removeDefaultContractTemplateLogo: () => httpClient.delete("/contract-templates/default/logo"),
  downloadDefaultContractTemplateLogo: async () => {
    const response = await fetch(`${API_BASE_URL}/contract-templates/default/logo/file`, {
      credentials: "include"
    });
    if (!response.ok) throw new Error("Logo template non disponibile");
    return response.blob();
  },
  previewContractTemplate: (input: { bookingId: string; content?: string; emailSubject?: string; emailBody?: string }) =>
    httpClient.post<{ content: string; emailSubject: string; emailBody: string }>("/contract-templates/preview-render", input)
};
