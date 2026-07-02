import { FormEvent, KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookingContract,
  BookingContractStatus,
  RentalExtraKmPolicy,
  RentalPriceList,
  RentalPricePackage,
  RentalPricingQuote,
  rentalBookingsUseCases,
  RentalBookingStatus,
  RentalCargosStatus,
  RentalContractStatus,
  RentalCustomer,
  RentalCustomerDocumentDraft,
  RentalCustomerType
} from "../../../application/usecases/rental-bookings-usecases";
import { masterDataUseCases } from "../../../application/usecases/master-data-usecases";
import { RentalBookingMonthlyGrid } from "../../components/bookings/rental-booking-monthly-grid";
import { FleetumInlineLoader } from "../../components/brand/fleetum-logo-loader";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Select } from "../../components/ui/select";
import { Textarea } from "../../components/ui/textarea";
import { useRentalMonthAvailability } from "../../hooks/use-rental-month-availability";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AlertTriangle, CalendarCheck2, CalendarDays, Car, ChevronLeft, ChevronRight, Clock3, Plus, RotateCcw, Search, UserPlus } from "lucide-react";
import { RentalPaymentGuaranteePanel } from "../../components/rental-payments/RentalPaymentGuaranteePanel";
import {
  CountrySelect,
  CustomerAddressFields,
  StructuredAddressValue,
  countryNameFromCode
} from "../../components/customers/customer-geography-fields";

type Site = {
  id: string;
  name: string;
  city?: string;
};

type VehicleOption = {
  id: string;
  plate: string;
  brand: string;
  model: string;
  currentKm?: number | null;
  site?: { id: string; name: string; city?: string | null };
};

type BookingDetail = {
  id: string;
  code: string;
  status: RentalBookingStatus;
  contractStatus: RentalContractStatus;
  contractRequired?: boolean;
  cargosStatus: RentalCargosStatus;
  customerName: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  pickupAt: string;
  returnAt: string;
  pickupKm?: number | null;
  returnKm?: number | null;
  pickupLocation?: string | null;
  returnLocation?: string | null;
  expectedTotal?: number | null;
  finalTotal?: number | null;
  reason?: string | null;
  internalNotes?: string | null;
  cargosTransmissionId?: string | null;
  cargosOutcomeMessage?: string | null;
  vehicle: {
    id: string;
    plate: string;
    brand: string;
    model: string;
    site?: { id: string; name: string; city?: string };
  };
  customer?: RentalCustomer | null;
  notes?: Array<{ id: string; type: string; message: string; createdAt: string }>;
  attachments?: Array<{
    id: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    createdAt: string;
  }>;
};

type ContextBooking = {
  id: string;
  code: string;
  status: RentalBookingStatus;
  customerName: string;
  pickupAt: string;
  returnAt: string;
  pickupKm?: number | null;
  returnKm?: number | null;
};

type BookingFormState = {
  mode: "create" | "edit";
  bookingId?: string;
  vehicleId: string;
  customerId: string;
  contractRequired: boolean;
  generateContract: boolean;
  pickupAt: string;
  returnAt: string;
  pickupKm: string;
  returnKm: string;
  pickupLocation: string;
  returnLocation: string;
  expectedTotal: string;
  priceListId: string;
  pricePackageId: string;
  extraKmPolicyId: string;
  estimatedKm: string;
  actualKm: string;
  pricingNotes: string;
  reason: string;
  internalNotes: string;
};

type CustomerFormState = {
  mode: "create" | "edit";
  customerId?: string;
  customerType: RentalCustomerType;
  firstName: string;
  lastName: string;
  drivingLicenseNumber: string;
  drivingLicenseIssuedAt: string;
  drivingLicenseExpiresAt: string;
  drivingLicenseAuthority: string;
  drivingLicenseCategory: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  placeOfBirth: string;
  birthCountry: string;
  birthProvince: string;
  birthMunicipalityCode: string;
  birthCity: string;
  nationality: string;
  nationalityCountry: string;
  residenceAddress: string;
  residenceCountry: string;
  residenceRegion: string;
  residenceProvince: string;
  residenceMunicipalityCode: string;
  residenceCity: string;
  residencePostalCode: string;
  residenceStreetAddress: string;
  taxCode: string;
  documentType: string;
  documentNumber: string;
  documentIssuedAt: string;
  documentExpiresAt: string;
  documentAuthority: string;
  companyName: string;
  companyLegalForm: string;
  companyVatNumber: string;
  companyTaxCode: string;
  companyLegalAddress: string;
  companyCountry: string;
  companyRegion: string;
  companyProvince: string;
  companyMunicipalityCode: string;
  companyCity: string;
  companyPostalCode: string;
  companyStreetAddress: string;
  companyPec: string;
  companySdi: string;
  companyRea: string;
  legalRepFirstName: string;
  legalRepLastName: string;
  legalRepTaxCode: string;
  legalRepRole: string;
  legalRepEmail: string;
  legalRepPhone: string;
  notes: string;
};

type ContractEditorState = {
  title: string;
  content: string;
  emailTo: string;
  emailSubject: string;
  emailBody: string;
  status: BookingContractStatus;
};

type TemplateFormState = {
  name: string;
  content: string;
  emailSubject: string;
  emailBody: string;
  companyName: string;
  companyAddress: string;
  companyVat: string;
  companyEmail: string;
  companyPhone: string;
  brandPrimary: string;
  brandAccent: string;
  brandFont: string;
};

const BOOKING_STATUS_LABELS: Record<RentalBookingStatus, string> = {
  DRAFT: "Bozza",
  QUOTED: "Preventivo",
  HOLD: "Opzione",
  CONFIRMED: "Confermata",
  CONTRACT_SIGNED: "Contratto firmato",
  READY_FOR_HANDOVER: "Pronta consegna",
  IN_RENT: "In noleggio",
  CLOSED: "Chiusa",
  CANCELED: "Annullata",
  NO_SHOW: "No-show"
};

const CONTRACT_STATUS_LABELS: Record<RentalContractStatus, string> = {
  NOT_READY: "Da preparare",
  READY: "Pronto",
  SIGNED: "Firmato"
};

const CARGOS_STATUS_LABELS: Record<RentalCargosStatus, string> = {
  NOT_REQUIRED: "Non richiesto",
  PENDING: "In attesa invio",
  SENT: "Inviato",
  ERROR: "Errore"
};

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

const toDateInputValue = (value?: Date | string) => {
  const date = value ? new Date(value) : new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const toDateTimeInputValue = (value?: Date | string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const toDateInputSafe = (value?: Date | string | null) => {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return toDateInputValue(value);
};

const toMonthIso = (date: Date) => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
};

const toDayKey = (value: Date | string) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const monthDays = (monthCursor: Date) => {
  const y = monthCursor.getFullYear();
  const m = monthCursor.getMonth();
  const start = new Date(y, m, 1);
  const end = new Date(y, m + 1, 1);
  const rows: Date[] = [];
  for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
    rows.push(new Date(d));
  }
  return rows;
};

const customerDisplayName = (customer?: RentalCustomer | null) => {
  if (!customer) return "-";
  if (customer.customerType === "PERSONA_GIURIDICA") {
    return customer.companyName?.trim() || `${customer.firstName || ""} ${customer.lastName || ""}`.trim() || "Societa";
  }
  return `${customer.firstName || ""} ${customer.lastName || ""}`.trim() || customer.companyName?.trim() || "Cliente";
};

const customerSearchSubtitle = (customer?: RentalCustomer | null) => {
  if (!customer) return "-";
  if (customer.customerType === "PERSONA_GIURIDICA") {
    return [customer.companyVatNumber, customer.email || customer.phone].filter(Boolean).join(" · ") || "-";
  }
  return [customer.taxCode, customer.email || customer.phone, customer.documentNumber].filter(Boolean).join(" · ") || "-";
};

const toBadgeClass = (status: string) => {
  if (status === "READY_FOR_HANDOVER" || status === "SENT" || status === "SIGNED") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300";
  }
  if (status === "IN_RENT" || status === "CONFIRMED" || status === "CONTRACT_SIGNED" || status === "PENDING") {
    return "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-300";
  }
  if (status === "ERROR" || status === "FAILED" || status === "CANCELED" || status === "NO_SHOW") {
    return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300";
  }
  if (status === "HOLD" || status === "READY" || status === "QUOTED") {
    return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300";
  }
  return "border-border bg-muted/50 text-foreground";
};

const BOOKING_CONTRACT_STATUS_LABELS: Record<BookingContractStatus, string> = {
  DRAFT: "Bozza",
  READY: "Pronto",
  SENT: "Inviato",
  SIGNED: "Firmato",
  ERROR: "Errore"
};

const BOOKING_STATUS_LEGEND: Array<{ status: RentalBookingStatus; tone: string }> = [
  { status: "CONFIRMED", tone: "Confermata" },
  { status: "READY_FOR_HANDOVER", tone: "Consegna" },
  { status: "IN_RENT", tone: "In corso" },
  { status: "QUOTED", tone: "Preventivo" },
  { status: "HOLD", tone: "Opzione" },
  { status: "CANCELED", tone: "Annullata" }
];

const defaultCustomerForm = (): CustomerFormState => ({
  mode: "create",
  customerType: "PERSONA_FISICA",
  firstName: "",
  lastName: "",
  drivingLicenseNumber: "",
  drivingLicenseIssuedAt: "",
  drivingLicenseExpiresAt: "",
  drivingLicenseAuthority: "",
  drivingLicenseCategory: "",
  email: "",
  phone: "",
  dateOfBirth: "",
  placeOfBirth: "",
  birthCountry: "IT",
  birthProvince: "",
  birthMunicipalityCode: "",
  birthCity: "",
  nationality: countryNameFromCode("IT"),
  nationalityCountry: "IT",
  residenceAddress: "",
  residenceCountry: "IT",
  residenceRegion: "",
  residenceProvince: "",
  residenceMunicipalityCode: "",
  residenceCity: "",
  residencePostalCode: "",
  residenceStreetAddress: "",
  taxCode: "",
  documentType: "",
  documentNumber: "",
  documentIssuedAt: "",
  documentExpiresAt: "",
  documentAuthority: "",
  companyName: "",
  companyLegalForm: "",
  companyVatNumber: "",
  companyTaxCode: "",
  companyLegalAddress: "",
  companyCountry: "IT",
  companyRegion: "",
  companyProvince: "",
  companyMunicipalityCode: "",
  companyCity: "",
  companyPostalCode: "",
  companyStreetAddress: "",
  companyPec: "",
  companySdi: "",
  companyRea: "",
  legalRepFirstName: "",
  legalRepLastName: "",
  legalRepTaxCode: "",
  legalRepRole: "",
  legalRepEmail: "",
  legalRepPhone: "",
  notes: ""
});

const residenceAddressValueFromCustomerForm = (form: CustomerFormState): StructuredAddressValue => ({
  country: form.residenceCountry,
  region: form.residenceRegion,
  province: form.residenceProvince,
  municipalityCode: form.residenceMunicipalityCode,
  city: form.residenceCity,
  postalCode: form.residencePostalCode,
  streetAddress: form.residenceStreetAddress
});

const companyAddressValueFromCustomerForm = (form: CustomerFormState): StructuredAddressValue => ({
  country: form.companyCountry,
  region: form.companyRegion,
  province: form.companyProvince,
  municipalityCode: form.companyMunicipalityCode,
  city: form.companyCity,
  postalCode: form.companyPostalCode,
  streetAddress: form.companyStreetAddress
});

const buildBookingFormForCell = (input?: { vehicleId: string; date: Date }): BookingFormState => {
  const baseDate = input?.date ?? new Date();
  const pickup = new Date(baseDate);
  pickup.setHours(9, 0, 0, 0);
  const ret = new Date(baseDate);
  ret.setHours(18, 0, 0, 0);
  return {
    mode: "create",
    vehicleId: input?.vehicleId ?? "",
    customerId: "",
    contractRequired: true,
    generateContract: true,
    pickupAt: toDateTimeInputValue(pickup),
    returnAt: toDateTimeInputValue(ret),
    pickupKm: "",
    returnKm: "",
    pickupLocation: "",
    returnLocation: "",
    expectedTotal: "",
    priceListId: "",
    pricePackageId: "",
    extraKmPolicyId: "",
    estimatedKm: "",
    actualKm: "",
    pricingNotes: "",
    reason: "",
    internalNotes: ""
  };
};

const defaultContractEditor = (): ContractEditorState => ({
  title: "",
  content: "",
  emailTo: "",
  emailSubject: "",
  emailBody: "",
  status: "DRAFT"
});

const defaultTemplateEditor = (): TemplateFormState => ({
  name: "",
  content: "",
  emailSubject: "",
  emailBody: "",
  companyName: "",
  companyAddress: "",
  companyVat: "",
  companyEmail: "",
  companyPhone: "",
  brandPrimary: "#21375d",
  brandAccent: "#5d82c2",
  brandFont: "helvetica"
});

export const RentalBookingsPage = () => {
  const navigate = useNavigate();
  const { bookingId: routeBookingId } = useParams<{ bookingId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sites, setSites] = useState<Site[]>([]);
  const [vehicles, setVehicles] = useState<VehicleOption[]>([]);
  const [customers, setCustomers] = useState<RentalCustomer[]>([]);
  const [customerSearch, setCustomerSearch] = useState("");
  const [vehicleSuggestions, setVehicleSuggestions] = useState<VehicleOption[]>([]);
  const [customerSuggestions, setCustomerSuggestions] = useState<RentalCustomer[]>([]);
  const [vehicleSuggestOpen, setVehicleSuggestOpen] = useState(false);
  const [customerSuggestOpen, setCustomerSuggestOpen] = useState(false);
  const [vehicleInput, setVehicleInput] = useState("");
  const [customerInput, setCustomerInput] = useState("");
  const [vehicleActiveIdx, setVehicleActiveIdx] = useState(-1);
  const [customerActiveIdx, setCustomerActiveIdx] = useState(-1);

  const [monthCursor, setMonthCursor] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [siteId, setSiteId] = useState("");
  const [vehicleSearch, setVehicleSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<RentalBookingStatus | "">("");
  const [refreshKey, setRefreshKey] = useState(0);

  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const [selectedBooking, setSelectedBooking] = useState<BookingDetail | null>(null);

  const [transitionTo, setTransitionTo] = useState<RentalBookingStatus | "">("");
  const [contractTo, setContractTo] = useState<RentalContractStatus>("NOT_READY");
  const [cargosTo, setCargosTo] = useState<RentalCargosStatus>("NOT_REQUIRED");
  const [cargosTransmissionId, setCargosTransmissionId] = useState("");
  const [cargosMessage, setCargosMessage] = useState("");
  const [noteInput, setNoteInput] = useState("");

  const [bookingModalOpen, setBookingModalOpen] = useState(false);
  const [bookingForm, setBookingForm] = useState<BookingFormState>(() => buildBookingFormForCell());
  const [bookingFormDirty, setBookingFormDirty] = useState(false);
  const [bookingCloseConfirmOpen, setBookingCloseConfirmOpen] = useState(false);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [customerForm, setCustomerForm] = useState<CustomerFormState>(() => defaultCustomerForm());
  const [customerUploadFiles, setCustomerUploadFiles] = useState<File[]>([]);
  const [customerScanFiles, setCustomerScanFiles] = useState<File[]>([]);
  const [customerScanRunning, setCustomerScanRunning] = useState(false);
  const [customerScanInfo, setCustomerScanInfo] = useState<string | null>(null);
  const [contract, setContract] = useState<BookingContract | null>(null);
  const [contractEditor, setContractEditor] = useState<ContractEditorState>(() => defaultContractEditor());
  const [contractLoading, setContractLoading] = useState(false);
  const [priceLists, setPriceLists] = useState<RentalPriceList[]>([]);
  const [pricePackages, setPricePackages] = useState<RentalPricePackage[]>([]);
  const [extraPolicies, setExtraPolicies] = useState<RentalExtraKmPolicy[]>([]);
  const [pricingQuote, setPricingQuote] = useState<RentalPricingQuote | null>(null);
  const [pricingLoading, setPricingLoading] = useState(false);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateEditor, setTemplateEditor] = useState<TemplateFormState>(() => defaultTemplateEditor());
  const [templatePreview, setTemplatePreview] = useState<{ content: string; emailSubject: string; emailBody: string } | null>(null);
  const [templateLogoPreviewUrl, setTemplateLogoPreviewUrl] = useState<string | null>(null);
  const [templateLogoFileName, setTemplateLogoFileName] = useState<string>("");
  const [templateLogoUploading, setTemplateLogoUploading] = useState(false);
  const [controlPanelPulse, setControlPanelPulse] = useState(false);

  const [ctxMenu, setCtxMenu] = useState<{ open: boolean; x: number; y: number; booking: ContextBooking | null }>({
    open: false,
    x: 0,
    y: 0,
    booking: null
  });
  const ctxMenuRef = useRef<HTMLDivElement | null>(null);
  const controlPanelRef = useRef<HTMLDivElement | null>(null);
  const vehicleSuggestRef = useRef<HTMLDivElement | null>(null);
  const customerSuggestRef = useRef<HTMLDivElement | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const paymentSetupStatus = searchParams.get("payment_setup") ?? searchParams.get("rental_payment");

  const forceCloseBookingModal = useCallback(() => {
    setBookingModalOpen(false);
    setBookingCloseConfirmOpen(false);
    setBookingFormDirty(false);
    setVehicleSuggestOpen(false);
    setCustomerSuggestOpen(false);
    setVehicleActiveIdx(-1);
    setCustomerActiveIdx(-1);
  }, []);

  const requestCloseBookingModal = useCallback(() => {
    if (saving) return;
    setVehicleSuggestOpen(false);
    setCustomerSuggestOpen(false);
    setVehicleActiveIdx(-1);
    setCustomerActiveIdx(-1);
    if (bookingFormDirty) {
      setBookingCloseConfirmOpen(true);
      return;
    }
    forceCloseBookingModal();
  }, [bookingFormDirty, forceCloseBookingModal, saving]);

  const markBookingFormDirty = useCallback(() => {
    setBookingFormDirty(true);
  }, []);

  const monthIso = useMemo(() => toMonthIso(monthCursor), [monthCursor]);
  const days = useMemo(() => monthDays(monthCursor), [monthCursor]);
  const monthLabel = useMemo(
    () => monthCursor.toLocaleDateString("it-IT", { month: "long", year: "numeric" }),
    [monthCursor]
  );

  const monthAvailability = useRentalMonthAvailability({
    month: monthIso,
    siteId: siteId || undefined,
    search: vehicleSearch || undefined,
    refreshKey
  });

  const bookingSummaryPills = useMemo(
    () => [
      { label: "Veicoli", value: monthAvailability.summary.totalVehicles },
      { label: "Occupati", value: monthAvailability.summary.bookedVehicles },
      { label: "Liberi", value: monthAvailability.summary.availableVehicles },
      { label: "Occupazione", value: `${monthAvailability.summary.occupancyRate}%` }
    ],
    [
      monthAvailability.summary.availableVehicles,
      monthAvailability.summary.bookedVehicles,
      monthAvailability.summary.occupancyRate,
      monthAvailability.summary.totalVehicles
    ]
  );

  const operationalStats = useMemo(() => {
    const todayKey = toDayKey(new Date());
    const bookings = monthAvailability.data.flatMap((row) =>
      row.bookings.map((booking) => ({ ...booking, vehicleId: row.vehicle.id }))
    );
    const validBookings = bookings.filter((booking) => booking.status !== "CANCELED" && booking.status !== "NO_SHOW");
    const activeVehicleIds = new Set(
      validBookings
        .filter((booking) => {
          const pickup = new Date(booking.pickupAt);
          const ret = new Date(booking.returnAt);
          const now = new Date();
          return pickup <= now && ret >= now;
        })
        .map((booking) => booking.vehicleId)
    );

    return {
      activeRentals: activeVehicleIds.size,
      pickupsToday: validBookings.filter((booking) => toDayKey(booking.pickupAt) === todayKey).length,
      returnsToday: validBookings.filter((booking) => toDayKey(booking.returnAt) === todayKey).length,
      pendingBookings: validBookings.filter((booking) => booking.status === "DRAFT" || booking.status === "QUOTED" || booking.status === "HOLD").length,
      availableVehicles: monthAvailability.summary.availableVehicles,
      occupancyRate: monthAvailability.summary.occupancyRate
    };
  }, [monthAvailability.data, monthAvailability.summary.availableVehicles, monthAvailability.summary.occupancyRate]);

  const bookingMetricCards = useMemo(
    () => [
      {
        label: "Noleggi in corso",
        value: operationalStats.activeRentals,
        hint: "Veicoli attualmente occupati",
        icon: Car,
        tone: "text-blue-700 bg-blue-50 border-blue-100 dark:text-blue-300 dark:bg-blue-950/30 dark:border-blue-900/50"
      },
      {
        label: "Consegne oggi",
        value: operationalStats.pickupsToday,
        hint: "Uscite previste in giornata",
        icon: CalendarCheck2,
        tone: "text-emerald-700 bg-emerald-50 border-emerald-100 dark:text-emerald-300 dark:bg-emerald-950/30 dark:border-emerald-900/50"
      },
      {
        label: "Riconsegne oggi",
        value: operationalStats.returnsToday,
        hint: "Rientri da presidiare",
        icon: Clock3,
        tone: "text-amber-700 bg-amber-50 border-amber-100 dark:text-amber-300 dark:bg-amber-950/30 dark:border-amber-900/50"
      },
      {
        label: "In attesa",
        value: operationalStats.pendingBookings,
        hint: "Bozze, preventivi e opzioni aperte",
        icon: CalendarDays,
        tone: "text-violet-700 bg-violet-50 border-violet-100 dark:text-violet-300 dark:bg-violet-950/30 dark:border-violet-900/50"
      },
      {
        label: "Disponibili",
        value: operationalStats.availableVehicles,
        hint: `${operationalStats.occupancyRate}% occupazione mese`,
        icon: AlertTriangle,
        tone: "text-slate-700 bg-slate-50 border-slate-200 dark:text-slate-300 dark:bg-slate-900/40 dark:border-slate-800"
      }
    ],
    [operationalStats]
  );

  useEffect(
    () => () => {
      if (templateLogoPreviewUrl) URL.revokeObjectURL(templateLogoPreviewUrl);
    },
    [templateLogoPreviewUrl]
  );

  const availableTransitions = useMemo(
    () => (selectedBooking ? TRANSITIONS[selectedBooking.status] : []),
    [selectedBooking]
  );

  const compatiblePolicyOptions = useMemo(
    () =>
      extraPolicies.filter((policy) => {
        if (!bookingForm.pricePackageId) return !policy.packageId;
        return !policy.packageId || policy.packageId === bookingForm.pricePackageId;
      }),
    [extraPolicies, bookingForm.pricePackageId]
  );

  const loadMasterData = async () => {
    const pageSize = 200;
    const [sitesRes, firstVehiclesPage] = await Promise.all([
      masterDataUseCases.listSites({ page: 1, pageSize }),
      masterDataUseCases.listVehicles({ page: 1, pageSize })
    ]);

    const allVehicles = [...((firstVehiclesPage.data as VehicleOption[]) ?? [])];
    const totalVehicles = Number(firstVehiclesPage.total ?? allVehicles.length);
    const totalPages = Math.max(1, Math.ceil(totalVehicles / pageSize));

    if (totalPages > 1) {
      const otherPages = await Promise.all(
        Array.from({ length: totalPages - 1 }, (_, index) =>
          masterDataUseCases.listVehicles({ page: index + 2, pageSize })
        )
      );
      otherPages.forEach((pageRes) => {
        allVehicles.push(...((pageRes.data as VehicleOption[]) ?? []));
      });
    }

    setSites((sitesRes.data as Site[]) ?? []);
    setVehicles(allVehicles);
  };

  const loadCustomers = async (search = "") => {
    const res = await rentalBookingsUseCases.listCustomers({ page: 1, pageSize: 200, search: search || undefined });
    setCustomers(res.data ?? []);
  };

  const loadPricingLists = async () => {
    const res = await rentalBookingsUseCases.listPriceLists({ page: 1, pageSize: 200, isActive: "true" });
    setPriceLists(res.data ?? []);
  };

  const loadPricingRules = async (listId: string, preferredPackageId?: string, preferredPolicyId?: string) => {
    if (!listId) {
      setPricePackages([]);
      setExtraPolicies([]);
      return;
    }

    const [pkgRes, policyRes] = await Promise.all([
      rentalBookingsUseCases.listPricePackages(listId),
      rentalBookingsUseCases.listExtraKmPolicies({ priceListId: listId })
    ]);

    const activePackages = (pkgRes.data ?? []).filter((pkg) => pkg.isActive);
    const activePolicies = (policyRes.data ?? []).filter((policy) => policy.isActive);
    setPricePackages(activePackages);
    setExtraPolicies(activePolicies);

    setBookingForm((current) => {
      const selectedPackageId =
        preferredPackageId && activePackages.some((pkg) => pkg.id === preferredPackageId)
          ? preferredPackageId
          : current.pricePackageId && activePackages.some((pkg) => pkg.id === current.pricePackageId)
            ? current.pricePackageId
            : (activePackages.find((pkg) => pkg.isDefault)?.id ?? activePackages[0]?.id ?? "");

      const compatiblePolicies = activePolicies.filter((policy) => !policy.packageId || policy.packageId === selectedPackageId);
      const selectedPolicyId =
        preferredPolicyId && compatiblePolicies.some((policy) => policy.id === preferredPolicyId)
          ? preferredPolicyId
          : current.extraKmPolicyId && compatiblePolicies.some((policy) => policy.id === current.extraKmPolicyId)
            ? current.extraKmPolicyId
            : (compatiblePolicies.find((policy) => policy.isDefault)?.id ?? compatiblePolicies[0]?.id ?? "");

      return {
        ...current,
        pricePackageId: selectedPackageId,
        extraKmPolicyId: selectedPolicyId
      };
    });
  };

  const loadBookingPricingSnapshot = async (bookingId: string) => {
    try {
      const payload = await rentalBookingsUseCases.getBookingPricing(bookingId);
      if (!payload.snapshot) {
        setPricingQuote(null);
        return;
      }

      setBookingForm((current) => ({
        ...current,
        priceListId: payload.snapshot?.priceListId ?? current.priceListId,
        pricePackageId: payload.snapshot?.pricePackageId ?? "",
        extraKmPolicyId: payload.snapshot?.extraKmPolicyId ?? "",
        estimatedKm: payload.snapshot?.estimatedKm != null ? String(payload.snapshot.estimatedKm) : "",
        actualKm: payload.snapshot?.actualKm != null ? String(payload.snapshot.actualKm) : "",
        pricingNotes: payload.snapshot?.notes ?? "",
        expectedTotal: payload.snapshot?.expectedTotal != null ? String(payload.snapshot.expectedTotal) : current.expectedTotal
      }));

      if (payload.snapshot?.priceListId) {
        await loadPricingRules(payload.snapshot.priceListId, payload.snapshot.pricePackageId ?? undefined, payload.snapshot.extraKmPolicyId ?? undefined);
      }
    } catch {
      // Best effort: se non esiste snapshot non blocchiamo l'operativita.
    }
  };

  const loadSelectedBooking = async (bookingId: string) => {
    try {
      const detail = (await rentalBookingsUseCases.getById(bookingId)) as BookingDetail;
      setSelectedBooking(detail);
      setContractTo(detail.contractStatus);
      setCargosTo(detail.cargosStatus);
      setTransitionTo("");
      setCargosTransmissionId(detail.cargosTransmissionId ?? "");
      setCargosMessage(detail.cargosOutcomeMessage ?? "");
      setVehicleInput(`${detail.vehicle.plate} · ${detail.vehicle.brand} ${detail.vehicle.model}`);
      setCustomerInput(detail.customer ? customerDisplayName(detail.customer) : detail.customerName);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const syncContractEditor = (next: BookingContract | null) => {
    if (!next) {
      setContractEditor(defaultContractEditor());
      return;
    }
    setContractEditor({
      title: next.title || "",
      content: next.content || "",
      emailTo: next.emailTo || "",
      emailSubject: next.emailSubject || "",
      emailBody: next.emailBody || "",
      status: next.status
    });
  };

  const loadContract = async (bookingId: string) => {
    setContractLoading(true);
    try {
      const contractData = await rentalBookingsUseCases.getContract(bookingId);
      setContract(contractData);
      syncContractEditor(contractData);
    } catch (e) {
      const message = (e as Error).message || "";
      if (message.toLowerCase().includes("non trovato") || message.includes("404")) {
        setContract(null);
        syncContractEditor(null);
      } else {
        setError(message);
      }
    } finally {
      setContractLoading(false);
    }
  };

  useEffect(() => {
    void loadMasterData();
    void loadCustomers();
    void loadPricingLists();
  }, []);

  useEffect(() => {
    const bookingIdFromQuery = routeBookingId ?? searchParams.get("bookingId");
    if (bookingIdFromQuery && bookingIdFromQuery !== selectedBookingId) {
      setSelectedBookingId(bookingIdFromQuery);
    }
  }, [routeBookingId, searchParams, selectedBookingId]);

  useEffect(() => {
    const currentBookingId = searchParams.get("bookingId");
    const nextBookingId = selectedBookingId ?? null;
    if (currentBookingId === nextBookingId) return;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (selectedBookingId) {
        next.set("bookingId", selectedBookingId);
      } else {
        next.delete("bookingId");
      }
      return next;
    }, { replace: true });
  }, [selectedBookingId, searchParams, setSearchParams]);

  useEffect(() => {
    if (!bookingModalOpen && !customerModalOpen && !templateModalOpen) return undefined;

    const originalOverflow = document.body.style.overflow;
    const originalOverscrollBehavior = document.body.style.overscrollBehavior;

    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";

    return () => {
      document.body.style.overflow = originalOverflow;
      document.body.style.overscrollBehavior = originalOverscrollBehavior;
    };
  }, [bookingModalOpen, customerModalOpen, templateModalOpen]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadCustomers(customerSearch.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [customerSearch]);

  useEffect(() => {
    if (!selectedBookingId) {
      setSelectedBooking(null);
      setContract(null);
      syncContractEditor(null);
      return;
    }
    void loadSelectedBooking(selectedBookingId);
    void loadContract(selectedBookingId);
  }, [selectedBookingId, refreshKey]);

  useEffect(() => {
    if (!bookingModalOpen) return;
    if (!bookingForm.priceListId) {
      setPricePackages([]);
      setExtraPolicies([]);
      setPricingQuote(null);
      return;
    }
    void loadPricingRules(bookingForm.priceListId);
  }, [bookingModalOpen, bookingForm.priceListId]);

  useEffect(() => {
    if (!bookingModalOpen) return;
    const compatiblePolicies = extraPolicies.filter((policy) => !policy.packageId || policy.packageId === bookingForm.pricePackageId);
    if (compatiblePolicies.some((policy) => policy.id === bookingForm.extraKmPolicyId)) return;
    const nextPolicyId = compatiblePolicies.find((policy) => policy.isDefault)?.id ?? compatiblePolicies[0]?.id ?? "";
    setBookingForm((current) => ({ ...current, extraKmPolicyId: nextPolicyId }));
  }, [bookingModalOpen, bookingForm.pricePackageId, bookingForm.extraKmPolicyId, extraPolicies]);

  useEffect(() => {
    if (!bookingModalOpen || !bookingForm.priceListId) {
      setPricingQuote(null);
      return;
    }
    const pickupAt = new Date(bookingForm.pickupAt);
    const returnAt = new Date(bookingForm.returnAt);
    if (Number.isNaN(pickupAt.getTime()) || Number.isNaN(returnAt.getTime()) || returnAt.getTime() <= pickupAt.getTime()) {
      setPricingQuote(null);
      return;
    }

    const timer = window.setTimeout(async () => {
      setPricingLoading(true);
      try {
        const response = await rentalBookingsUseCases.previewPricingQuote({
          priceListId: bookingForm.priceListId,
          pricePackageId: bookingForm.pricePackageId || undefined,
          extraKmPolicyId: bookingForm.extraKmPolicyId || undefined,
          pickupAt: pickupAt.toISOString(),
          returnAt: returnAt.toISOString(),
          estimatedKm: bookingForm.estimatedKm ? Number(bookingForm.estimatedKm) : undefined,
          actualKm: bookingForm.actualKm ? Number(bookingForm.actualKm) : undefined
        });
        setPricingQuote(response.quote);
        setBookingForm((current) => ({
          ...current,
          expectedTotal: response.quote.pricing.expectedTotal.toFixed(2)
        }));
      } catch (e) {
        setPricingQuote(null);
        setError((e as Error).message);
      } finally {
        setPricingLoading(false);
      }
    }, 250);

    return () => window.clearTimeout(timer);
  }, [
    bookingModalOpen,
    bookingForm.priceListId,
    bookingForm.pricePackageId,
    bookingForm.extraKmPolicyId,
    bookingForm.pickupAt,
    bookingForm.returnAt,
    bookingForm.estimatedKm,
    bookingForm.actualKm
  ]);

  useEffect(() => {
    if (!ctxMenu.open) return;
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(target)) {
        setCtxMenu((prev) => ({ ...prev, open: false, booking: null }));
      }
    };
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCtxMenu((prev) => ({ ...prev, open: false, booking: null }));
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onEsc);
    };
  }, [ctxMenu.open]);

  useEffect(() => {
    if (!bookingModalOpen) return;
    const query = vehicleInput.trim();
    if (!query || query.length < 1) {
      setVehicleSuggestions([]);
      setVehicleActiveIdx(-1);
      return;
    }

    const timer = window.setTimeout(async () => {
      try {
        const response = await rentalBookingsUseCases.suggestVehicles({ q: query, siteId: siteId || undefined });
        setVehicleSuggestions(response.data ?? []);
      } catch {
        setVehicleSuggestions([]);
      }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [bookingModalOpen, vehicleInput, siteId]);

  useEffect(() => {
    if (!bookingModalOpen) return;
    const query = customerInput.trim();
    if (!query || query.length < 1) {
      setCustomerSuggestions([]);
      setCustomerActiveIdx(-1);
      return;
    }

    const timer = window.setTimeout(async () => {
      try {
        const response = await rentalBookingsUseCases.suggestCustomers({ q: query });
        setCustomerSuggestions(response.data ?? []);
      } catch {
        setCustomerSuggestions([]);
      }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [bookingModalOpen, customerInput]);

  useEffect(() => {
    if (!bookingModalOpen) return;
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (vehicleSuggestRef.current && !vehicleSuggestRef.current.contains(target)) {
        setVehicleSuggestOpen(false);
      }
      if (customerSuggestRef.current && !customerSuggestRef.current.contains(target)) {
        setCustomerSuggestOpen(false);
      }
    };
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (bookingCloseConfirmOpen) {
          setBookingCloseConfirmOpen(false);
          return;
        }
        if (vehicleSuggestOpen || customerSuggestOpen) {
          setVehicleSuggestOpen(false);
          setCustomerSuggestOpen(false);
          return;
        }
        requestCloseBookingModal();
      }
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onEsc);
    };
  }, [bookingCloseConfirmOpen, bookingModalOpen, customerSuggestOpen, requestCloseBookingModal, vehicleSuggestOpen]);

  useEffect(() => {
    const firstBooking = monthAvailability.data
      .flatMap((row) => row.bookings)
      .filter((booking) => (statusFilter ? booking.status === statusFilter : true))[0];
    if (!selectedBookingId && firstBooking?.id) {
      setSelectedBookingId(firstBooking.id);
    }
  }, [monthAvailability.data, selectedBookingId, statusFilter]);

  const goPrevMonth = () => {
    setMonthCursor((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1));
  };

  const goNextMonth = () => {
    setMonthCursor((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1));
  };

  const openCreateModalFromCell = (input?: { vehicleId: string; date: Date }) => {
    const nextForm = buildBookingFormForCell(input);
    const defaultPriceListId = priceLists[0]?.id ?? "";
    nextForm.priceListId = defaultPriceListId;
    const preselectedVehicle =
      vehicles.find((vehicle) => vehicle.id === nextForm.vehicleId) ??
      monthAvailability.data.find((row) => row.vehicle.id === nextForm.vehicleId)?.vehicle;
    if (typeof preselectedVehicle?.currentKm === "number") {
      nextForm.pickupKm = String(preselectedVehicle.currentKm);
    }
    setBookingForm(nextForm);
    setPricingQuote(null);
    setVehicleInput(preselectedVehicle ? `${preselectedVehicle.plate} · ${preselectedVehicle.brand} ${preselectedVehicle.model}` : "");
    setCustomerInput("");
    setVehicleSuggestions([]);
    setCustomerSuggestions([]);
    setVehicleActiveIdx(-1);
    setCustomerActiveIdx(-1);
    setVehicleSuggestOpen(false);
    setCustomerSuggestOpen(false);
    setBookingFormDirty(false);
    setBookingCloseConfirmOpen(false);
    setBookingModalOpen(true);
    setError(null);
    setSuccess(null);
    if (defaultPriceListId) {
      void loadPricingRules(defaultPriceListId);
    }
  };

  const openEditModal = () => {
    if (!selectedBooking) return;
    setBookingForm({
      mode: "edit",
      bookingId: selectedBooking.id,
      vehicleId: selectedBooking.vehicle.id,
      customerId: selectedBooking.customer?.id ?? "",
      contractRequired: selectedBooking.contractRequired ?? true,
      generateContract: false,
      pickupAt: toDateTimeInputValue(selectedBooking.pickupAt),
      returnAt: toDateTimeInputValue(selectedBooking.returnAt),
      pickupKm: selectedBooking.pickupKm != null ? String(selectedBooking.pickupKm) : "",
      returnKm: selectedBooking.returnKm != null ? String(selectedBooking.returnKm) : "",
      pickupLocation: selectedBooking.pickupLocation ?? "",
      returnLocation: selectedBooking.returnLocation ?? "",
      expectedTotal: selectedBooking.expectedTotal != null ? String(selectedBooking.expectedTotal) : "",
      priceListId: "",
      pricePackageId: "",
      extraKmPolicyId: "",
      estimatedKm: "",
      actualKm: "",
      pricingNotes: "",
      reason: selectedBooking.reason ?? "",
      internalNotes: selectedBooking.internalNotes ?? ""
    });
    setVehicleInput(`${selectedBooking.vehicle.plate} · ${selectedBooking.vehicle.brand} ${selectedBooking.vehicle.model}`);
    setCustomerInput(selectedBooking.customer ? customerDisplayName(selectedBooking.customer) : selectedBooking.customerName);
    setVehicleSuggestions([]);
    setCustomerSuggestions([]);
    setVehicleActiveIdx(-1);
    setCustomerActiveIdx(-1);
    setVehicleSuggestOpen(false);
    setCustomerSuggestOpen(false);
    setBookingFormDirty(false);
    setBookingCloseConfirmOpen(false);
    setBookingModalOpen(true);
    setPricingQuote(null);
    setError(null);
    setSuccess(null);
    void loadBookingPricingSnapshot(selectedBooking.id);
  };

  const scrollToControlPanel = () => {
    window.requestAnimationFrame(() => {
      controlPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      setControlPanelPulse(true);
      window.setTimeout(() => setControlPanelPulse(false), 1200);
    });
  };

  const openDetailFromContext = async (bookingId: string) => {
    setCtxMenu((prev) => ({ ...prev, open: false, booking: null }));
    if (selectedBookingId !== bookingId) {
      setSelectedBookingId(bookingId);
      // Aspettiamo il render successivo così il pannello risulta subito visibile.
      window.setTimeout(scrollToControlPanel, 80);
      return;
    }
    await loadSelectedBooking(bookingId);
    await loadContract(bookingId);
    scrollToControlPanel();
  };

  const pickVehicle = (vehicle: VehicleOption) => {
    markBookingFormDirty();
    setBookingForm((state) => ({ ...state, vehicleId: vehicle.id }));
    setVehicleInput(`${vehicle.plate} · ${vehicle.brand} ${vehicle.model}`);
    setVehicleSuggestOpen(false);
    setVehicleActiveIdx(-1);
  };

  const pickCustomer = (customer: RentalCustomer) => {
    markBookingFormDirty();
    setBookingForm((state) => ({ ...state, customerId: customer.id }));
    setCustomerInput(customerDisplayName(customer));
    setCustomerSuggestOpen(false);
    setCustomerActiveIdx(-1);
  };

  const openInlineNewCustomer = () => {
    const raw = customerInput.trim();
    const [firstName = "", ...rest] = raw.split(/\s+/);
    const looksLikeVat = /^\d{11}$/.test(raw.replace(/\s+/g, ""));
    setCustomerForm({
      ...defaultCustomerForm(),
      customerType: looksLikeVat ? "PERSONA_GIURIDICA" : "PERSONA_FISICA",
      firstName: looksLikeVat ? "" : firstName || "",
      lastName: looksLikeVat ? "" : rest.join(" ") || "",
      companyName: looksLikeVat ? raw : ""
    });
    setCustomerScanFiles([]);
    setCustomerScanInfo(null);
    setCustomerModalOpen(true);
  };

  const handleVehicleAutocompleteKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (!vehicleSuggestOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      setVehicleSuggestOpen(true);
      return;
    }
    if (event.key === "Escape") {
      setVehicleSuggestOpen(false);
      setVehicleActiveIdx(-1);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setVehicleActiveIdx((idx) => Math.min(vehicleSuggestions.length - 1, idx + 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setVehicleActiveIdx((idx) => Math.max(0, idx - 1));
      return;
    }
    if (event.key === "Enter" && vehicleSuggestOpen && vehicleActiveIdx >= 0) {
      event.preventDefault();
      const match = vehicleSuggestions[vehicleActiveIdx];
      if (match) pickVehicle(match);
    }
  };

  const handleCustomerAutocompleteKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (!customerSuggestOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      setCustomerSuggestOpen(true);
      return;
    }
    if (event.key === "Escape") {
      setCustomerSuggestOpen(false);
      setCustomerActiveIdx(-1);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCustomerActiveIdx((idx) => Math.min(customerSuggestions.length - 1, idx + 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setCustomerActiveIdx((idx) => Math.max(0, idx - 1));
      return;
    }
    if (event.key === "Enter") {
      if (customerSuggestOpen && customerActiveIdx >= 0) {
        event.preventDefault();
        const match = customerSuggestions[customerActiveIdx];
        if (match) pickCustomer(match);
      } else if (customerSuggestOpen && customerSuggestions.length === 0 && customerInput.trim().length >= 2) {
        event.preventDefault();
        openInlineNewCustomer();
      }
    }
  };

  const onBookingSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const payload = {
        vehicleId: bookingForm.vehicleId,
        customerId: bookingForm.customerId,
        contractRequired: bookingForm.contractRequired,
        generateContract: bookingForm.generateContract,
        pickupAt: new Date(bookingForm.pickupAt).toISOString(),
        returnAt: new Date(bookingForm.returnAt).toISOString(),
        pickupKm: bookingForm.pickupKm ? Number(bookingForm.pickupKm) : undefined,
        returnKm: bookingForm.returnKm ? Number(bookingForm.returnKm) : undefined,
        pickupLocation: bookingForm.pickupLocation || undefined,
        returnLocation: bookingForm.returnLocation || undefined,
        expectedTotal: bookingForm.expectedTotal ? Number(bookingForm.expectedTotal) : undefined,
        reason: bookingForm.reason || undefined,
        internalNotes: bookingForm.internalNotes || undefined
      };
      if (!payload.vehicleId || !payload.customerId) {
        throw new Error("Seleziona veicolo e cliente.");
      }
      if (Number.isNaN(new Date(payload.pickupAt).getTime()) || Number.isNaN(new Date(payload.returnAt).getTime())) {
        throw new Error("Date prenotazione non valide.");
      }
      if ((payload.pickupKm ?? null) != null && Number.isNaN(payload.pickupKm as number)) {
        throw new Error("Km uscita non validi.");
      }
      if ((payload.returnKm ?? null) != null && Number.isNaN(payload.returnKm as number)) {
        throw new Error("Km rientro non validi.");
      }
      if (
        typeof payload.pickupKm === "number" &&
        typeof payload.returnKm === "number" &&
        payload.returnKm < payload.pickupKm
      ) {
        throw new Error("I km rientro devono essere maggiori o uguali ai km uscita.");
      }

      let targetBookingId: string | undefined = bookingForm.bookingId;
      if (bookingForm.mode === "create") {
        const created = await rentalBookingsUseCases.create(payload);
        targetBookingId = created.id;
        setSelectedBookingId(created.id);
        setSuccess("Prenotazione creata con successo.");
      } else if (bookingForm.bookingId) {
        await rentalBookingsUseCases.update(bookingForm.bookingId, payload);
        targetBookingId = bookingForm.bookingId;
        setSelectedBookingId(bookingForm.bookingId);
        setSuccess("Prenotazione aggiornata.");
      }

      if (targetBookingId && bookingForm.priceListId) {
        const pricing = await rentalBookingsUseCases.updateBookingPricing(targetBookingId, {
          priceListId: bookingForm.priceListId,
          pricePackageId: bookingForm.pricePackageId || undefined,
          extraKmPolicyId: bookingForm.extraKmPolicyId || undefined,
          estimatedKm: bookingForm.estimatedKm ? Number(bookingForm.estimatedKm) : undefined,
          actualKm: bookingForm.actualKm ? Number(bookingForm.actualKm) : undefined,
          notes: bookingForm.pricingNotes || undefined
        });
        setPricingQuote(pricing.quote);
      }

      forceCloseBookingModal();
      setRefreshKey((prev) => prev + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const applyCustomerDraft = (draft: Partial<RentalCustomer>) => {
    setCustomerForm((current) => ({
      ...current,
      customerType: (draft.customerType as RentalCustomerType) ?? current.customerType,
      firstName: draft.firstName ?? current.firstName,
      lastName: draft.lastName ?? current.lastName,
      drivingLicenseNumber: draft.drivingLicenseNumber ?? current.drivingLicenseNumber,
      drivingLicenseIssuedAt: toDateInputSafe(draft.drivingLicenseIssuedAt) || current.drivingLicenseIssuedAt,
      drivingLicenseExpiresAt: toDateInputSafe(draft.drivingLicenseExpiresAt) || current.drivingLicenseExpiresAt,
      drivingLicenseAuthority: draft.drivingLicenseAuthority ?? current.drivingLicenseAuthority,
      drivingLicenseCategory: draft.drivingLicenseCategory ?? current.drivingLicenseCategory,
      email: draft.email ?? current.email,
      phone: draft.phone ?? current.phone,
      dateOfBirth: toDateInputSafe(draft.dateOfBirth) || current.dateOfBirth,
      placeOfBirth: draft.placeOfBirth ?? current.placeOfBirth,
      nationality: draft.nationality ?? current.nationality,
      residenceAddress: draft.residenceAddress ?? current.residenceAddress,
      taxCode: draft.taxCode ?? current.taxCode,
      documentType: draft.documentType ?? current.documentType,
      documentNumber: draft.documentNumber ?? current.documentNumber,
      documentIssuedAt: toDateInputSafe(draft.documentIssuedAt) || current.documentIssuedAt,
      documentExpiresAt: toDateInputSafe(draft.documentExpiresAt) || current.documentExpiresAt,
      documentAuthority: draft.documentAuthority ?? current.documentAuthority,
      companyName: draft.companyName ?? current.companyName,
      companyLegalForm: draft.companyLegalForm ?? current.companyLegalForm,
      companyVatNumber: draft.companyVatNumber ?? current.companyVatNumber,
      companyTaxCode: draft.companyTaxCode ?? current.companyTaxCode,
      companyLegalAddress: draft.companyLegalAddress ?? current.companyLegalAddress,
      companyPec: draft.companyPec ?? current.companyPec,
      companySdi: draft.companySdi ?? current.companySdi,
      companyRea: draft.companyRea ?? current.companyRea,
      legalRepFirstName: draft.legalRepFirstName ?? current.legalRepFirstName,
      legalRepLastName: draft.legalRepLastName ?? current.legalRepLastName,
      legalRepTaxCode: draft.legalRepTaxCode ?? current.legalRepTaxCode,
      legalRepRole: draft.legalRepRole ?? current.legalRepRole,
      legalRepEmail: draft.legalRepEmail ?? current.legalRepEmail,
      legalRepPhone: draft.legalRepPhone ?? current.legalRepPhone
    }));
  };

  const runCustomerScanAutofill = async () => {
    if (customerScanFiles.length === 0) {
      setError("Seleziona prima almeno una scansione documento (PDF/JPG/PNG/WebP).");
      return;
    }
    setCustomerScanRunning(true);
    setError(null);
    setSuccess(null);
    setCustomerScanInfo(null);
    try {
      const result = (await rentalBookingsUseCases.parseCustomerDocumentDraft(customerScanFiles)) as RentalCustomerDocumentDraft;
      applyCustomerDraft(result.fields ?? {});
      const warningMsg = result.warnings?.filter(Boolean).join(" ") || "";
      const recognizedDocs = (result.files ?? [])
        .map((item) => `${item.fileName} → ${item.documentType || "documento generico"}`)
        .join(" · ");
      setCustomerScanInfo(
        `Analisi completata su ${customerScanFiles.length} file · sorgente ${result.source} · confidenza ${result.score}%${recognizedDocs ? ` · ${recognizedDocs}` : ""}${warningMsg ? ` · ${warningMsg}` : ""}`
      );
      const inferredType = (result.fields?.customerType as RentalCustomerType | undefined) ?? customerForm.customerType;
      if (inferredType !== "PERSONA_GIURIDICA" && !result.fields?.drivingLicenseNumber) {
        setError("Patente non rilevata automaticamente. Inseriscila manualmente (obbligatoria).");
      } else {
        setSuccess("Dati cliente precompilati dalla scansione documento.");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCustomerScanRunning(false);
    }
  };

  const onCustomerSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const payload = {
        customerType: customerForm.customerType,
        firstName: customerForm.firstName.trim() || undefined,
        lastName: customerForm.lastName.trim() || undefined,
        drivingLicenseNumber: customerForm.drivingLicenseNumber.trim().toUpperCase() || undefined,
        drivingLicenseIssuedAt: customerForm.drivingLicenseIssuedAt
          ? new Date(`${customerForm.drivingLicenseIssuedAt}T00:00:00`).toISOString()
          : undefined,
        drivingLicenseExpiresAt: customerForm.drivingLicenseExpiresAt
          ? new Date(`${customerForm.drivingLicenseExpiresAt}T00:00:00`).toISOString()
          : undefined,
        drivingLicenseAuthority: customerForm.drivingLicenseAuthority.trim() || undefined,
        drivingLicenseCategory: customerForm.drivingLicenseCategory.trim() || undefined,
        email: customerForm.email.trim() || undefined,
        phone: customerForm.phone.trim() || undefined,
        dateOfBirth: customerForm.dateOfBirth ? new Date(`${customerForm.dateOfBirth}T00:00:00`).toISOString() : undefined,
        placeOfBirth: customerForm.placeOfBirth.trim() || undefined,
        birthCountry: customerForm.birthCountry || undefined,
        birthProvince: customerForm.birthProvince.trim().toUpperCase() || undefined,
        birthMunicipalityCode: customerForm.birthMunicipalityCode.trim() || undefined,
        birthCity: customerForm.birthCity.trim() || undefined,
        nationality: customerForm.nationality.trim() || undefined,
        nationalityCountry: customerForm.nationalityCountry || undefined,
        residenceAddress: customerForm.residenceAddress.trim() || undefined,
        residenceCountry: customerForm.residenceCountry || undefined,
        residenceRegion: customerForm.residenceRegion.trim() || undefined,
        residenceProvince: customerForm.residenceProvince.trim().toUpperCase() || undefined,
        residenceMunicipalityCode: customerForm.residenceMunicipalityCode.trim() || undefined,
        residenceCity: customerForm.residenceCity.trim() || undefined,
        residencePostalCode: customerForm.residencePostalCode.trim() || undefined,
        residenceStreetAddress: customerForm.residenceStreetAddress.trim() || undefined,
        taxCode: customerForm.taxCode.trim() || undefined,
        documentType: customerForm.documentType.trim() || undefined,
        documentNumber: customerForm.documentNumber.trim() || undefined,
        documentIssuedAt: customerForm.documentIssuedAt ? new Date(`${customerForm.documentIssuedAt}T00:00:00`).toISOString() : undefined,
        documentExpiresAt: customerForm.documentExpiresAt ? new Date(`${customerForm.documentExpiresAt}T00:00:00`).toISOString() : undefined,
        documentAuthority: customerForm.documentAuthority.trim() || undefined,
        companyName: customerForm.companyName.trim() || undefined,
        companyLegalForm: customerForm.companyLegalForm.trim() || undefined,
        companyVatNumber: customerForm.companyVatNumber.replace(/\s+/g, "") || undefined,
        companyTaxCode: customerForm.companyTaxCode.trim() || undefined,
        companyLegalAddress: customerForm.companyLegalAddress.trim() || undefined,
        companyCountry: customerForm.companyCountry || undefined,
        companyRegion: customerForm.companyRegion.trim() || undefined,
        companyProvince: customerForm.companyProvince.trim().toUpperCase() || undefined,
        companyMunicipalityCode: customerForm.companyMunicipalityCode.trim() || undefined,
        companyCity: customerForm.companyCity.trim() || undefined,
        companyPostalCode: customerForm.companyPostalCode.trim() || undefined,
        companyStreetAddress: customerForm.companyStreetAddress.trim() || undefined,
        companyPec: customerForm.companyPec.trim() || undefined,
        companySdi: customerForm.companySdi.trim().toUpperCase() || undefined,
        companyRea: customerForm.companyRea.trim() || undefined,
        legalRepFirstName: customerForm.legalRepFirstName.trim() || undefined,
        legalRepLastName: customerForm.legalRepLastName.trim() || undefined,
        legalRepTaxCode: customerForm.legalRepTaxCode.trim() || undefined,
        legalRepRole: customerForm.legalRepRole.trim() || undefined,
        legalRepEmail: customerForm.legalRepEmail.trim() || undefined,
        legalRepPhone: customerForm.legalRepPhone.trim() || undefined,
        notes: customerForm.notes.trim() || undefined
      };
      if (payload.customerType === "PERSONA_GIURIDICA") {
        if (!payload.companyName) throw new Error("Ragione sociale obbligatoria.");
        if (!payload.companyVatNumber || !/^\d{11}$/.test(payload.companyVatNumber)) {
          throw new Error("Partita IVA non valida (11 cifre).");
        }
        if (!payload.email && !payload.phone) throw new Error("Per società serve almeno un contatto (email o telefono).");
      } else {
        if (!payload.firstName || !payload.lastName) throw new Error("Nome e cognome sono obbligatori.");
        if (!payload.drivingLicenseNumber) throw new Error("Numero patente obbligatorio.");
      }

      let customerId = customerForm.customerId;
      if (customerForm.mode === "create") {
        const created = await rentalBookingsUseCases.createCustomer(payload);
        customerId = created.id;
      } else if (customerForm.customerId) {
        await rentalBookingsUseCases.updateCustomer(customerForm.customerId, payload);
      }

      if (customerId && customerScanFiles.length > 0) {
        await rentalBookingsUseCases.uploadCustomerAttachments(customerId, customerScanFiles);
      }

      const actionLabel = customerForm.mode === "create" ? "Cliente creato." : "Cliente aggiornato.";
      const docsLabel =
        customerScanFiles.length > 0 ? ` Documenti salvati: ${customerScanFiles.length}.` : " Nessun documento allegato.";
      setSuccess(`${actionLabel}${docsLabel}`);

      await loadCustomers(customerSearch.trim());
      if (customerId) {
        setBookingForm((current) => ({ ...current, customerId: customerId! }));
        setCustomerInput(
          payload.customerType === "PERSONA_GIURIDICA"
            ? (payload.companyName ?? "")
            : `${payload.firstName ?? ""} ${payload.lastName ?? ""}`.trim()
        );
      }
      setCustomerModalOpen(false);
      setCustomerForm(defaultCustomerForm());
      setCustomerScanFiles([]);
      setCustomerScanInfo(null);
      setRefreshKey((prev) => prev + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const runTransition = async () => {
    if (!selectedBooking || !transitionTo) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await rentalBookingsUseCases.transition(selectedBooking.id, transitionTo);
      setSuccess(`Stato aggiornato a ${BOOKING_STATUS_LABELS[transitionTo]}.`);
      setRefreshKey((prev) => prev + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const runContractUpdate = async () => {
    if (!selectedBooking) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await rentalBookingsUseCases.setContractStatus(selectedBooking.id, { status: contractTo });
      setSuccess(`Contratto aggiornato: ${CONTRACT_STATUS_LABELS[contractTo]}.`);
      setRefreshKey((prev) => prev + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const runGenerateContract = async () => {
    if (!selectedBooking) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const generated = await rentalBookingsUseCases.generateContract(selectedBooking.id);
      setContract(generated);
      syncContractEditor(generated);
      setSuccess("Contratto generato dal template tenant.");
      setRefreshKey((prev) => prev + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const runSaveContractDocument = async () => {
    if (!selectedBooking || !contract) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = await rentalBookingsUseCases.updateContract(selectedBooking.id, {
        title: contractEditor.title,
        content: contractEditor.content,
        emailTo: contractEditor.emailTo || undefined,
        emailSubject: contractEditor.emailSubject || undefined,
        emailBody: contractEditor.emailBody || undefined,
        status: contractEditor.status
      });
      setContract(updated);
      syncContractEditor(updated);
      setSuccess("Contratto salvato.");
      setRefreshKey((prev) => prev + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const runDownloadContractPdf = async () => {
    if (!selectedBooking) return;
    setError(null);
    try {
      const blob = await rentalBookingsUseCases.downloadContractPdf(selectedBooking.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `Contratto_${selectedBooking.code}_${selectedBooking.customerName.replace(/\s+/g, "_")}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 120000);
      setSuccess("PDF contratto generato e scaricato.");
      setRefreshKey((prev) => prev + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const runPrintContractPdf = async () => {
    if (!selectedBooking) return;
    setError(null);
    try {
      const blob = await rentalBookingsUseCases.downloadContractPdf(selectedBooking.id);
      const url = URL.createObjectURL(blob);
      const printWindow = window.open(url, "_blank");
      if (!printWindow) {
        throw new Error("Popup bloccato dal browser. Consenti i popup e riprova.");
      }
      const timer = window.setInterval(() => {
        if (printWindow.closed) {
          window.clearInterval(timer);
          URL.revokeObjectURL(url);
        }
      }, 1000);
      window.setTimeout(() => {
        try {
          printWindow.print();
        } catch {
          // no-op
        }
      }, 350);
      setSuccess("Anteprima stampa contratto aperta.");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const runSendContractEmail = async () => {
    if (!selectedBooking || !contract) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await rentalBookingsUseCases.sendContractEmail(selectedBooking.id, {
        to: contractEditor.emailTo || undefined,
        subject: contractEditor.emailSubject || undefined,
        body: contractEditor.emailBody || undefined
      });
      await loadContract(selectedBooking.id);
      setSuccess("Invio email contratto accodato.");
      setRefreshKey((prev) => prev + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const runSendContractWhatsapp = async () => {
    if (!selectedBooking || !contract) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await rentalBookingsUseCases.sendContractWhatsapp(selectedBooking.id, {
        phone: selectedBooking.customer?.phone || selectedBooking.customerPhone || undefined
      });
      const popup = window.open(response.whatsappUrl, "_blank", "noopener,noreferrer");
      if (!popup) {
        setError("Popup WhatsApp bloccato dal browser. Consenti i popup e riprova.");
      } else {
        setSuccess("Finestra WhatsApp aperta con link contratto sicuro.");
      }
      await loadContract(selectedBooking.id);
      setRefreshKey((prev) => prev + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const runMarkContractSigned = async () => {
    if (!selectedBooking || !contract) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = await rentalBookingsUseCases.markContractSigned(selectedBooking.id, {});
      setContract(updated);
      syncContractEditor(updated);
      setContractTo("SIGNED");
      setSuccess("Contratto marcato come firmato.");
      setRefreshKey((prev) => prev + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const openTemplateModal = async () => {
    setTemplateModalOpen(true);
    setTemplatePreview(null);
    setError(null);
    try {
      const template = await rentalBookingsUseCases.getDefaultContractTemplate();
      if (template.logoFilePath) {
        try {
          const logoBlob = await rentalBookingsUseCases.downloadDefaultContractTemplateLogo();
          const logoUrl = URL.createObjectURL(logoBlob);
          setTemplateLogoPreviewUrl((current) => {
            if (current) URL.revokeObjectURL(current);
            return logoUrl;
          });
          setTemplateLogoFileName(template.logoFileName ?? "logo-contratto");
        } catch {
          setTemplateLogoPreviewUrl((current) => {
            if (current) URL.revokeObjectURL(current);
            return null;
          });
          setTemplateLogoFileName("");
        }
      } else {
        setTemplateLogoPreviewUrl((current) => {
          if (current) URL.revokeObjectURL(current);
          return null;
        });
        setTemplateLogoFileName("");
      }
      setTemplateEditor({
        name: template.name,
        content: template.content,
        emailSubject: template.emailSubject ?? "",
        emailBody: template.emailBody ?? "",
        companyName: template.companyName ?? "",
        companyAddress: template.companyAddress ?? "",
        companyVat: template.companyVat ?? "",
        companyEmail: template.companyEmail ?? "",
        companyPhone: template.companyPhone ?? "",
        brandPrimary: template.brandPrimary ?? "#21375d",
        brandAccent: template.brandAccent ?? "#5d82c2",
        brandFont: template.brandFont ?? "helvetica"
      });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const runPreviewTemplate = async () => {
    if (!selectedBooking) {
      setError("Seleziona una prenotazione per vedere la preview del template.");
      return;
    }
    setTemplateSaving(true);
    setError(null);
    try {
      const preview = await rentalBookingsUseCases.previewContractTemplate({
        bookingId: selectedBooking.id,
        content: templateEditor.content,
        emailSubject: templateEditor.emailSubject,
        emailBody: templateEditor.emailBody
      });
      setTemplatePreview(preview);
      setSuccess("Preview template aggiornata.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTemplateSaving(false);
    }
  };

  const runSaveTemplate = async () => {
    setTemplateSaving(true);
    setError(null);
    try {
      const updated = await rentalBookingsUseCases.updateDefaultContractTemplate({
        name: templateEditor.name,
        content: templateEditor.content,
        emailSubject: templateEditor.emailSubject,
        emailBody: templateEditor.emailBody,
        companyName: templateEditor.companyName.trim() || undefined,
        companyAddress: templateEditor.companyAddress.trim() || undefined,
        companyVat: templateEditor.companyVat.trim() || undefined,
        companyEmail: templateEditor.companyEmail.trim() || undefined,
        companyPhone: templateEditor.companyPhone.trim() || undefined,
        brandPrimary: templateEditor.brandPrimary.trim() || undefined,
        brandAccent: templateEditor.brandAccent.trim() || undefined,
        brandFont: templateEditor.brandFont.trim() || undefined
      });
      setTemplateEditor({
        name: updated.name,
        content: updated.content,
        emailSubject: updated.emailSubject ?? "",
        emailBody: updated.emailBody ?? "",
        companyName: updated.companyName ?? "",
        companyAddress: updated.companyAddress ?? "",
        companyVat: updated.companyVat ?? "",
        companyEmail: updated.companyEmail ?? "",
        companyPhone: updated.companyPhone ?? "",
        brandPrimary: updated.brandPrimary ?? "#21375d",
        brandAccent: updated.brandAccent ?? "#5d82c2",
        brandFont: updated.brandFont ?? "helvetica"
      });
      setSuccess("Template default aggiornato.");
      if (selectedBookingId) {
        await loadContract(selectedBookingId);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTemplateSaving(false);
    }
  };

  const uploadTemplateLogo = async (file: File) => {
    setTemplateLogoUploading(true);
    setError(null);
    try {
      const updated = await rentalBookingsUseCases.uploadDefaultContractTemplateLogo(file);
      const blob = await rentalBookingsUseCases.downloadDefaultContractTemplateLogo();
      const logoUrl = URL.createObjectURL(blob);
      setTemplateLogoPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return logoUrl;
      });
      setTemplateLogoFileName(updated.logoFileName ?? file.name);
      setSuccess("Logo contratto aggiornato.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTemplateLogoUploading(false);
    }
  };

  const removeTemplateLogo = async () => {
    setTemplateLogoUploading(true);
    setError(null);
    try {
      await rentalBookingsUseCases.removeDefaultContractTemplateLogo();
      setTemplateLogoPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return null;
      });
      setTemplateLogoFileName("");
      setSuccess("Logo contratto rimosso.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTemplateLogoUploading(false);
    }
  };

  const runCargosUpdate = async () => {
    if (!selectedBooking) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await rentalBookingsUseCases.setCargosStatus(selectedBooking.id, {
        status: cargosTo,
        transmissionId: cargosTransmissionId || undefined,
        message: cargosMessage || undefined
      });
      setSuccess(`CARGOS aggiornato: ${CARGOS_STATUS_LABELS[cargosTo]}.`);
      setRefreshKey((prev) => prev + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const runAddNote = async () => {
    if (!selectedBooking) return;
    const message = noteInput.trim();
    if (!message) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await rentalBookingsUseCases.addNote(selectedBooking.id, message);
      setNoteInput("");
      setSuccess("Nota operativa aggiunta.");
      setRefreshKey((prev) => prev + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const runDeleteBooking = async () => {
    if (!selectedBooking || saving) return;
    const confirmed = window.confirm(`Confermi eliminazione prenotazione ${selectedBooking.code}?`);
    if (!confirmed) return;

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await rentalBookingsUseCases.remove(selectedBooking.id);
      setSelectedBookingId(null);
      setSelectedBooking(null);
      setSuccess("Prenotazione eliminata.");
      setRefreshKey((prev) => prev + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const uploadCustomerDocs = async () => {
    if (!selectedBooking?.customer?.id || customerUploadFiles.length === 0) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await rentalBookingsUseCases.uploadCustomerAttachments(selectedBooking.customer.id, customerUploadFiles, {
        bookingId: selectedBooking.id
      });
      setCustomerUploadFiles([]);
      setSuccess("Documenti cliente caricati.");
      setRefreshKey((prev) => prev + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const openCustomerAttachment = async (attachmentId: string) => {
    try {
      const blob = await rentalBookingsUseCases.downloadCustomerAttachment(attachmentId);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 120000);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const removeCustomerAttachment = async (attachmentId: string) => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await rentalBookingsUseCases.deleteCustomerAttachment(attachmentId);
      setSuccess("Documento cliente eliminato.");
      setRefreshKey((prev) => prev + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="flex min-h-[calc(100vh-5.5rem)] flex-col gap-4 bg-slate-50/40 dark:bg-transparent">
      <div className="saas-hero-header grid gap-5 rounded-[28px] border border-white/70 px-4 py-4 shadow-[0_24px_80px_-52px_rgba(15,23,42,0.55)] backdrop-blur lg:grid-cols-[minmax(280px,1fr)_auto] lg:items-center sm:px-6">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-primary/70">Centro operativo noleggi</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950 dark:text-foreground sm:text-3xl">Booking Noleggi</h1>
          <p className="mt-2 max-w-[660px] text-sm leading-relaxed text-muted-foreground">
            Calendario operativo per leggere consegne, riconsegne, disponibilita veicoli e stato prenotazioni per sede.
          </p>
        </div>

        <div className="flex min-w-0 flex-col gap-3 lg:items-end">
          <div className="hidden flex-wrap items-center justify-start gap-2 xl:flex xl:justify-end">
            {bookingSummaryPills.map((pill) => (
              <span
                key={pill.label}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-border/70 bg-card/85 px-4 text-[11px] font-semibold shadow-sm"
              >
                <span className="text-muted-foreground">{pill.label}</span>
                <span className="text-sm text-foreground">{pill.value}</span>
              </span>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <Button
              variant="outline"
              className="h-11 min-w-[170px] gap-2 rounded-2xl"
              onClick={() => {
                setCustomerForm(defaultCustomerForm());
                setCustomerScanFiles([]);
                setCustomerScanInfo(null);
                setCustomerModalOpen(true);
              }}
            >
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              Nuovo cliente
            </Button>
            <Button className="h-11 min-w-[210px] gap-2 rounded-2xl" onClick={() => openCreateModalFromCell()}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Nuova prenotazione
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {bookingMetricCards.map((metric) => {
          const Icon = metric.icon;
          return (
          <div key={metric.label} className="rounded-[24px] border border-slate-200/80 bg-white/90 px-4 py-3.5 shadow-[0_18px_55px_-44px_rgba(15,23,42,0.75)] dark:border-border dark:bg-card/85">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{metric.label}</p>
                <p className="mt-1 text-2xl font-bold tracking-tight text-slate-950 dark:text-foreground">{metric.value}</p>
              </div>
              <span className={`grid h-10 w-10 place-items-center rounded-2xl border ${metric.tone}`}>
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{metric.hint}</p>
          </div>
          );
        })}
      </div>

      {error ? <p className="rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p> : null}
      {success ? <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{success}</p> : null}
      <Card className="saas-surface overflow-hidden border-slate-200/80 bg-white/95 shadow-[0_22px_70px_-54px_rgba(15,23,42,0.9)] dark:border-border dark:bg-card">
        <CardContent className="!py-4 sm:!py-4">
          <div className="flex min-h-[52px] flex-col justify-center gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="inline-flex h-11 items-center justify-between gap-2 rounded-2xl border bg-card/75 p-1 shadow-sm xl:min-w-[300px]">
              <Button variant="outline" size="sm" className="h-9 w-9 rounded-xl p-0" onClick={goPrevMonth} aria-label="Mese precedente">
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </Button>
              <div className="flex min-w-[170px] items-center justify-center gap-2 px-2 text-center text-sm font-semibold capitalize">
                <CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                {monthLabel}
              </div>
              <Button variant="outline" size="sm" className="h-9 w-9 rounded-xl p-0" onClick={goNextMonth} aria-label="Mese successivo">
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>

            <div className="grid flex-1 items-center gap-2 md:grid-cols-[minmax(150px,0.8fr)_minmax(150px,0.8fr)_minmax(220px,1.2fr)_auto] xl:max-w-[850px]">
              <div className="flex items-center">
                <Select className="h-11 rounded-xl" value={siteId} onChange={(e) => setSiteId(e.target.value)} aria-label="Filtra sede booking">
                  <option value="">Tutte le sedi</option>
                  {sites.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.name}{site.city ? ` · ${site.city}` : ""}
                    </option>
                  ))}
                </Select>
              </div>

              <Select
                className="h-11 rounded-xl"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as RentalBookingStatus | "")}
                aria-label="Filtra stato prenotazione"
              >
                <option value="">Tutti gli stati</option>
                {(Object.keys(BOOKING_STATUS_LABELS) as RentalBookingStatus[]).map((key) => (
                  <option key={key} value={key}>
                    {BOOKING_STATUS_LABELS[key]}
                  </option>
                ))}
              </Select>

              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  className="h-11 rounded-xl pl-9"
                  value={vehicleSearch}
                  onChange={(e) => setVehicleSearch(e.target.value)}
                  placeholder="Cerca targa, modello o cliente..."
                  aria-label="Ricerca booking"
                />
              </div>

              <Button
                className="h-11 rounded-xl gap-2"
                variant="outline"
                onClick={() => {
                  setSiteId("");
                  setVehicleSearch("");
                  setStatusFilter("");
                }}
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                Reset
              </Button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-border/60">
            <span className="mr-1 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Legenda</span>
            {BOOKING_STATUS_LEGEND.map((item) => (
              <span key={item.status} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold ${toBadgeClass(item.status)}`}>
                <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" aria-hidden="true" />
                {item.tone}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid min-h-[calc(100vh-22rem)] flex-1 gap-3 2xl:grid-cols-[minmax(0,1fr)_390px]">
        <Card className="saas-surface flex min-h-[620px] flex-col overflow-hidden border-slate-200/80 bg-white shadow-[0_26px_90px_-60px_rgba(15,23,42,0.85)] dark:border-border dark:bg-card">
          <CardContent className="flex min-h-0 flex-1 flex-col p-2 sm:p-3">
            {monthAvailability.loading ? (
              <div className="space-y-2 p-2" aria-label="Caricamento calendario booking">
                <FleetumInlineLoader label="Caricamento calendario" className="px-2 pb-1" />
                <div className="grid gap-2">
                  {Array.from({ length: 7 }).map((_, index) => (
                    <div key={index} className="h-12 animate-pulse rounded-2xl bg-slate-100 dark:bg-muted/30" />
                  ))}
                </div>
              </div>
            ) : monthAvailability.error ? (
              <div className="grid min-h-[520px] place-items-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-6 text-center dark:border-border dark:bg-muted/10">
                <div className="max-w-sm">
                  <AlertTriangle className="mx-auto h-8 w-8 text-destructive" aria-hidden="true" />
                  <p className="mt-3 text-sm font-semibold text-foreground">Calendario non disponibile</p>
                  <p className="mt-1 text-sm text-muted-foreground">{monthAvailability.error}</p>
                  <Button className="mt-4" variant="outline" onClick={() => void monthAvailability.reload()}>
                    Riprova
                  </Button>
                </div>
              </div>
            ) : (
              <RentalBookingMonthlyGrid
                className="h-full min-h-[590px]"
                monthKey={monthIso}
                monthDays={days}
                rows={monthAvailability.data}
                statusFilter={statusFilter}
                selectedBookingId={selectedBookingId}
                onSelectBooking={(bookingId) => {
                  setSelectedBookingId(bookingId);
                  setCtxMenu((prev) => ({ ...prev, open: false, booking: null }));
                }}
                onEmptyCellClick={({ vehicleId, date }) => {
                  openCreateModalFromCell({ vehicleId, date });
                }}
                onBookingContextMenu={({ booking, x, y }) => {
                  const width = 320;
                  const height = 265;
                  const safeX = Math.max(8, Math.min(window.innerWidth - width - 8, x));
                  const safeY = Math.max(8, Math.min(window.innerHeight - height - 8, y));
                  setCtxMenu({
                    open: true,
                    x: safeX,
                    y: safeY,
                    booking
                  });
                }}
                getStatusClass={toBadgeClass}
              />
            )}
          </CardContent>
        </Card>

        <aside
          ref={controlPanelRef}
          className={`min-w-0 rounded-xl transition-all duration-300 2xl:sticky 2xl:top-3 2xl:max-h-[calc(100vh-7rem)] ${
            controlPanelPulse ? "ring-2 ring-primary/60 shadow-[0_0_0_5px_rgba(109,75,191,0.08)]" : ""
          }`}
        >
        <Card className="saas-surface flex h-full min-h-[560px] flex-col overflow-hidden">
          <CardHeader className="border-b border-border/60 pb-3">
            <CardTitle className="text-base">Control Booking</CardTitle>
            <p className="text-xs text-muted-foreground">Azioni rapide sulla prenotazione selezionata.</p>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-2">
            {!selectedBooking ? (
              <p className="text-sm text-muted-foreground">Seleziona una prenotazione dal calendario.</p>
            ) : (
              <>
                <div className="rounded-2xl border bg-muted/20 p-3 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Prenotazione selezionata</p>
                      <p className="mt-1 truncate text-sm font-semibold">{selectedBooking.customerName}</p>
                      <p className="truncate text-xs text-muted-foreground">{selectedBooking.code}</p>
                    </div>
                    <div className="shrink-0 rounded-2xl border bg-card/85 px-3 py-2 text-right shadow-sm">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Targa</p>
                      <p className="text-sm font-semibold">{selectedBooking.vehicle.plate}</p>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-2 sm:grid-cols-2 2xl:grid-cols-1">
                    <div className="rounded-xl border bg-card/80 p-2">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Uscita</p>
                      <p className="mt-1 text-xs font-semibold">
                        {new Date(selectedBooking.pickupAt).toLocaleString("it-IT", {
                          day: "2-digit",
                          month: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit"
                        })}
                      </p>
                    </div>
                    <div className="rounded-xl border bg-card/80 p-2">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Rientro</p>
                      <p className="mt-1 text-xs font-semibold">
                        {new Date(selectedBooking.returnAt).toLocaleString("it-IT", {
                          day: "2-digit",
                          month: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit"
                        })}
                      </p>
                    </div>
                    <div className="rounded-xl border bg-card/80 p-2">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Km uscita</p>
                      <p className="mt-1 text-xs font-semibold">{selectedBooking.pickupKm ?? "-"}</p>
                    </div>
                    <div className="rounded-xl border bg-card/80 p-2">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Km rientro</p>
                      <p className="mt-1 text-xs font-semibold">
                        {selectedBooking.returnKm ?? "-"}
                        {typeof selectedBooking.pickupKm === "number" && typeof selectedBooking.returnKm === "number"
                          ? ` · ${Math.max(0, selectedBooking.returnKm - selectedBooking.pickupKm)} km`
                          : ""}
                      </p>
                    </div>
                  </div>

                  <p className="mt-2 truncate text-xs text-muted-foreground">
                    {selectedBooking.vehicle.brand} {selectedBooking.vehicle.model}
                    {selectedBooking.vehicle.site?.name ? ` · ${selectedBooking.vehicle.site.name}` : ""}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] font-semibold ${toBadgeClass(selectedBooking.status)}`}>
                      {BOOKING_STATUS_LABELS[selectedBooking.status]}
                    </span>
                    <span className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] font-semibold ${toBadgeClass(selectedBooking.contractStatus)}`}>
                      {CONTRACT_STATUS_LABELS[selectedBooking.contractStatus]}
                    </span>
                    {contract ? (
                      <span className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] font-semibold ${toBadgeClass(contract.status)}`}>
                        Contratto doc: {BOOKING_CONTRACT_STATUS_LABELS[contract.status]}
                      </span>
                    ) : null}
                    <span className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] font-semibold ${toBadgeClass(selectedBooking.cargosStatus)}`}>
                      {CARGOS_STATUS_LABELS[selectedBooking.cargosStatus]}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="outline" onClick={openEditModal} disabled={saving}>
                      Modifica prenotazione
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => void runDeleteBooking()} disabled={saving}>
                      Elimina
                    </Button>
                  </div>
                </div>

                <RentalPaymentGuaranteePanel booking={selectedBooking} paymentSetupStatus={paymentSetupStatus} />

                <div className="space-y-2 rounded-lg border p-3">
                  <Label>Transizione stato</Label>
                  <div className="flex items-center gap-2">
                    <Select value={transitionTo} onChange={(e) => setTransitionTo(e.target.value as RentalBookingStatus | "")}>
                      <option value="">Seleziona stato</option>
                      {availableTransitions.map((status) => (
                        <option key={status} value={status}>
                          {BOOKING_STATUS_LABELS[status]}
                        </option>
                      ))}
                    </Select>
                    <Button onClick={() => void runTransition()} disabled={!transitionTo || saving}>
                      Applica
                    </Button>
                  </div>
                </div>

                <div className="space-y-2 rounded-lg border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label>Contratto operativo</Label>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => void openTemplateModal()} disabled={saving}>
                        Template default
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => void runGenerateContract()} disabled={saving}>
                        Rigenera
                      </Button>
                    </div>
                  </div>

                  {contractLoading ? (
                    <FleetumInlineLoader label="Caricamento contratto" />
                  ) : !contract ? (
                    <div className="rounded-md border border-dashed bg-muted/15 p-3 text-xs text-muted-foreground">
                      Contratto non ancora generato per questa prenotazione.
                    </div>
                  ) : (
                    <>
                      <div className="grid gap-2 md:grid-cols-2 2xl:grid-cols-1">
                        <div className="space-y-1">
                          <Label>Stato documento</Label>
                          <Select
                            value={contractEditor.status}
                            onChange={(e) =>
                              setContractEditor((state) => ({ ...state, status: e.target.value as BookingContractStatus }))
                            }
                          >
                            {(Object.keys(BOOKING_CONTRACT_STATUS_LABELS) as BookingContractStatus[]).map((status) => (
                              <option key={status} value={status}>
                                {BOOKING_CONTRACT_STATUS_LABELS[status]}
                              </option>
                            ))}
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label>Email cliente</Label>
                          <Input
                            type="email"
                            value={contractEditor.emailTo}
                            onChange={(e) => setContractEditor((state) => ({ ...state, emailTo: e.target.value }))}
                            placeholder="cliente@email.it"
                          />
                        </div>
                        <div className="space-y-1 md:col-span-2">
                          <Label>Titolo contratto</Label>
                          <Input
                            value={contractEditor.title}
                            onChange={(e) => setContractEditor((state) => ({ ...state, title: e.target.value }))}
                          />
                        </div>
                        <div className="space-y-1 md:col-span-2">
                          <Label>Oggetto email</Label>
                          <Input
                            value={contractEditor.emailSubject}
                            onChange={(e) => setContractEditor((state) => ({ ...state, emailSubject: e.target.value }))}
                          />
                        </div>
                        <div className="space-y-1 md:col-span-2">
                          <Label>Corpo email</Label>
                          <Textarea
                            rows={3}
                            value={contractEditor.emailBody}
                            onChange={(e) => setContractEditor((state) => ({ ...state, emailBody: e.target.value }))}
                          />
                        </div>
                        <div className="space-y-1 md:col-span-2">
                          <Label>Contenuto contratto</Label>
                          <Textarea
                            rows={7}
                            value={contractEditor.content}
                            onChange={(e) => setContractEditor((state) => ({ ...state, content: e.target.value }))}
                          />
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        <Button size="sm" variant="outline" onClick={() => void runSaveContractDocument()} disabled={saving}>
                          Salva
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => void runDownloadContractPdf()} disabled={saving}>
                          Scarica PDF
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => void runPrintContractPdf()} disabled={saving}>
                          Stampa
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => void runSendContractEmail()} disabled={saving}>
                          Invia email
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => void runSendContractWhatsapp()} disabled={saving}>
                          Invia WhatsApp
                        </Button>
                        <Button size="sm" onClick={() => void runMarkContractSigned()} disabled={saving}>
                          Marca firmato
                        </Button>
                      </div>

                      <div className="grid gap-2 lg:grid-cols-2 2xl:grid-cols-1">
                        <div className="rounded-md border bg-muted/10 p-2">
                          <p className="text-[11px] font-semibold text-muted-foreground">Ultime consegne email</p>
                          <div className="mt-1.5 max-h-[110px] space-y-1 overflow-auto pr-1">
                            {(contract.deliveries ?? []).length === 0 ? (
                              <p className="text-[11px] text-muted-foreground">Nessuna consegna.</p>
                            ) : (
                              (contract.deliveries ?? []).map((delivery) => (
                                <div key={delivery.id} className="rounded border bg-card px-2 py-1 text-[11px]">
                                  <p className="font-medium">{delivery.channel ?? "EMAIL"} · {delivery.recipient}</p>
                                  <p className="text-[10px] text-muted-foreground">{delivery.subject}</p>
                                  <span className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] ${toBadgeClass(delivery.status)}`}>
                                    {delivery.status}
                                  </span>
                                </div>
                              ))
                            )}
                          </div>
                        </div>

                        <div className="rounded-md border bg-muted/10 p-2">
                          <p className="text-[11px] font-semibold text-muted-foreground">Audit contratto</p>
                          <div className="mt-1.5 max-h-[110px] space-y-1 overflow-auto pr-1">
                            {(contract.events ?? []).length === 0 ? (
                              <p className="text-[11px] text-muted-foreground">Nessun evento.</p>
                            ) : (
                              (contract.events ?? []).map((event) => (
                                <div key={event.id} className="rounded border bg-card px-2 py-1 text-[11px]">
                                  <p className="font-medium">{event.type}</p>
                                  <p>{event.message}</p>
                                  <p className="text-[10px] text-muted-foreground">
                                    {new Date(event.createdAt).toLocaleString("it-IT")}
                                  </p>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                <div className="grid gap-2 md:grid-cols-2 2xl:grid-cols-1">
                  <div className="space-y-2 rounded-lg border p-3">
                    <Label>Workflow contratto noleggio</Label>
                    <Select value={contractTo} onChange={(e) => setContractTo(e.target.value as RentalContractStatus)}>
                      {(Object.keys(CONTRACT_STATUS_LABELS) as RentalContractStatus[]).map((status) => (
                        <option key={status} value={status}>
                          {CONTRACT_STATUS_LABELS[status]}
                        </option>
                      ))}
                    </Select>
                    <Button variant="outline" onClick={() => void runContractUpdate()} disabled={saving}>
                      Salva stato workflow
                    </Button>
                  </div>

                  <div className="space-y-2 rounded-lg border p-3">
                    <Label>CARGOS</Label>
                    <Select value={cargosTo} onChange={(e) => setCargosTo(e.target.value as RentalCargosStatus)}>
                      {(Object.keys(CARGOS_STATUS_LABELS) as RentalCargosStatus[]).map((status) => (
                        <option key={status} value={status}>
                          {CARGOS_STATUS_LABELS[status]}
                        </option>
                      ))}
                    </Select>
                    <Input
                      value={cargosTransmissionId}
                      onChange={(e) => setCargosTransmissionId(e.target.value)}
                      placeholder="Transmission ID"
                    />
                    <Textarea
                      value={cargosMessage}
                      onChange={(e) => setCargosMessage(e.target.value)}
                      placeholder="Messaggio CARGOS"
                      rows={2}
                    />
                    <Button variant="outline" onClick={() => void runCargosUpdate()} disabled={saving}>
                      Salva CARGOS
                    </Button>
                  </div>
                </div>

                <div className="space-y-2 rounded-lg border p-3">
                  <Label>Aggiornamento operativo</Label>
                  <Textarea
                    value={noteInput}
                    onChange={(e) => setNoteInput(e.target.value)}
                    rows={2}
                    placeholder="Inserisci nota operativa..."
                  />
                  <Button variant="outline" onClick={() => void runAddNote()} disabled={!noteInput.trim() || saving}>
                    Aggiungi nota
                  </Button>
                </div>

                <div className="space-y-2 rounded-lg border p-3">
                  <Label>Timeline</Label>
                  <div className="max-h-[180px] space-y-2 overflow-auto pr-1">
                    {(selectedBooking.notes ?? []).length === 0 ? (
                      <p className="text-xs text-muted-foreground">Nessuna nota disponibile.</p>
                    ) : (
                      (selectedBooking.notes ?? []).map((note) => (
                        <div key={note.id} className="rounded-md border bg-muted/20 px-2 py-1.5">
                          <p className="text-[11px] font-medium">{note.type}</p>
                          <p className="text-xs">{note.message}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {new Date(note.createdAt).toLocaleString("it-IT", {
                              day: "2-digit",
                              month: "2-digit",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit"
                            })}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
        </aside>
      </div>

        <Card className="saas-surface">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Anagrafica Cliente & Documenti</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <Input
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                placeholder="Cerca cliente per nome, documento, email..."
              />
              <Button
                variant="outline"
                onClick={() => {
                  setCustomerForm(defaultCustomerForm());
                  setCustomerScanFiles([]);
                  setCustomerScanInfo(null);
                  setCustomerModalOpen(true);
                }}
              >
                Nuovo cliente
              </Button>
            </div>

            <div className="max-h-[150px] space-y-1 overflow-auto rounded-md border p-2">
              {customers.slice(0, 20).map((customer) => (
                <button
                  key={customer.id}
                  type="button"
                  className={`w-full rounded-md border px-2 py-1 text-left text-[12px] hover:bg-muted/30 ${
                    bookingForm.customerId === customer.id ? "border-primary/60 bg-primary/5" : ""
                  }`}
                  onClick={() => {
                    setBookingForm((current) => ({ ...current, customerId: customer.id }));
                    setCustomerInput(customerDisplayName(customer));
                  }}
                >
                  <p className="font-medium">{customerDisplayName(customer)}</p>
                  <p className="text-[10px] text-muted-foreground">{customerSearchSubtitle(customer)}</p>
                </button>
              ))}
            </div>

            {!selectedBooking?.customer ? (
              <p className="text-xs text-muted-foreground">Seleziona una prenotazione con cliente associato per gestire i documenti.</p>
            ) : (
              <>
                <div className="rounded-md border bg-muted/20 p-2">
                  <p className="text-sm font-semibold">{customerDisplayName(selectedBooking.customer)}</p>
                  {selectedBooking.customer.customerType === "PERSONA_GIURIDICA" ? (
                    <>
                      <p className="text-xs text-muted-foreground">
                        P.IVA: {selectedBooking.customer.companyVatNumber || "-"} · CF: {selectedBooking.customer.companyTaxCode || "-"}
                      </p>
                      <p className="text-xs text-muted-foreground">Sede: {selectedBooking.customer.companyLegalAddress || "-"}</p>
                    </>
                  ) : (
                    <>
                      <p className="text-xs text-muted-foreground">
                        Doc: {selectedBooking.customer.documentType || "-"} {selectedBooking.customer.documentNumber || "-"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Patente: {selectedBooking.customer.drivingLicenseNumber || "-"}
                        {selectedBooking.customer.drivingLicenseExpiresAt
                          ? ` · scadenza ${toDateInputSafe(selectedBooking.customer.drivingLicenseExpiresAt)}`
                          : ""}
                      </p>
                    </>
                  )}
                  <p className="text-xs text-muted-foreground">{selectedBooking.customer.email || selectedBooking.customer.phone || "-"}</p>
                  <div className="mt-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const customer = selectedBooking.customer!;
                          setCustomerForm({
                            mode: "edit",
                            customerId: customer.id,
                            customerType: (customer.customerType as RentalCustomerType) || "PERSONA_FISICA",
                            firstName: customer.firstName || "",
                            lastName: customer.lastName || "",
                            drivingLicenseNumber: customer.drivingLicenseNumber || "",
                            drivingLicenseIssuedAt: customer.drivingLicenseIssuedAt ? toDateInputSafe(customer.drivingLicenseIssuedAt) : "",
                            drivingLicenseExpiresAt: customer.drivingLicenseExpiresAt
                              ? toDateInputSafe(customer.drivingLicenseExpiresAt)
                              : "",
                            drivingLicenseAuthority: customer.drivingLicenseAuthority || "",
                            drivingLicenseCategory: customer.drivingLicenseCategory || "",
                            email: customer.email || "",
                            phone: customer.phone || "",
                            dateOfBirth: customer.dateOfBirth ? toDateInputSafe(customer.dateOfBirth) : "",
                            placeOfBirth: customer.placeOfBirth || "",
                            birthCountry: customer.birthCountry || "IT",
                            birthProvince: customer.birthProvince || "",
                            birthMunicipalityCode: customer.birthMunicipalityCode || "",
                            birthCity: customer.birthCity || "",
                            nationality: customer.nationality || countryNameFromCode(customer.nationalityCountry),
                            nationalityCountry: customer.nationalityCountry || "IT",
                            residenceAddress: customer.residenceAddress || "",
                            residenceCountry: customer.residenceCountry || "IT",
                            residenceRegion: customer.residenceRegion || "",
                            residenceProvince: customer.residenceProvince || "",
                            residenceMunicipalityCode: customer.residenceMunicipalityCode || "",
                            residenceCity: customer.residenceCity || "",
                            residencePostalCode: customer.residencePostalCode || "",
                            residenceStreetAddress: customer.residenceStreetAddress || customer.residenceAddress || "",
                            taxCode: customer.taxCode || "",
                            documentType: customer.documentType || "",
                            documentNumber: customer.documentNumber || "",
                            documentIssuedAt: customer.documentIssuedAt ? toDateInputSafe(customer.documentIssuedAt) : "",
                            documentExpiresAt: customer.documentExpiresAt ? toDateInputSafe(customer.documentExpiresAt) : "",
                            documentAuthority: customer.documentAuthority || "",
                            companyName: customer.companyName || "",
                            companyLegalForm: customer.companyLegalForm || "",
                            companyVatNumber: customer.companyVatNumber || "",
                            companyTaxCode: customer.companyTaxCode || "",
                            companyLegalAddress: customer.companyLegalAddress || "",
                            companyCountry: customer.companyCountry || "IT",
                            companyRegion: customer.companyRegion || "",
                            companyProvince: customer.companyProvince || "",
                            companyMunicipalityCode: customer.companyMunicipalityCode || "",
                            companyCity: customer.companyCity || "",
                            companyPostalCode: customer.companyPostalCode || "",
                            companyStreetAddress: customer.companyStreetAddress || customer.companyLegalAddress || "",
                            companyPec: customer.companyPec || "",
                            companySdi: customer.companySdi || "",
                            companyRea: customer.companyRea || "",
                            legalRepFirstName: customer.legalRepFirstName || "",
                            legalRepLastName: customer.legalRepLastName || "",
                            legalRepTaxCode: customer.legalRepTaxCode || "",
                            legalRepRole: customer.legalRepRole || "",
                            legalRepEmail: customer.legalRepEmail || "",
                            legalRepPhone: customer.legalRepPhone || "",
                            notes: customer.notes || ""
                          });
                          setCustomerScanFiles([]);
                          setCustomerScanInfo(null);
                          setCustomerModalOpen(true);
                        }}
                      >
                        Modifica anagrafica cliente
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => navigate(`/anagrafiche/clienti?customerId=${selectedBooking.customer!.id}`)}
                      >
                        Apri sezione clienti
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="space-y-2 rounded-md border p-2">
                  <Label>Carica documenti cliente (PDF/JPG/PNG)</Label>
                  <Input
                    type="file"
                    multiple
                    accept=".pdf,.jpg,.jpeg,.png,.webp"
                    onChange={(e) => setCustomerUploadFiles(Array.from(e.target.files ?? []))}
                  />
                  <Button
                    variant="outline"
                    onClick={() => void uploadCustomerDocs()}
                    disabled={customerUploadFiles.length === 0 || saving}
                  >
                    Salva documenti
                  </Button>
                </div>

                <div className="space-y-1 rounded-md border p-2">
                  <Label>Documenti salvati</Label>
                  {(selectedBooking.customer.attachments ?? []).length === 0 ? (
                    <p className="text-xs text-muted-foreground">Nessun documento.</p>
                  ) : (
                    (selectedBooking.customer.attachments ?? []).map((attachment) => (
                      <div key={attachment.id} className="flex items-center justify-between gap-2 rounded-md border px-2 py-1 text-[12px]">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{attachment.fileName}</p>
                          <p className="text-[10px] text-muted-foreground">{attachment.mimeType}</p>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button size="sm" variant="outline" onClick={() => void openCustomerAttachment(attachment.id)}>
                            Apri
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => void removeCustomerAttachment(attachment.id)}>
                            Elimina
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>

      {ctxMenu.open && ctxMenu.booking ? (
        <div
          ref={ctxMenuRef}
          className="fixed z-[120] w-[320px] overflow-hidden rounded-2xl border border-border/70 bg-card shadow-[0_28px_80px_-38px_rgba(15,23,42,0.85)] backdrop-blur"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          role="dialog"
          aria-label="Dettaglio prenotazione rapido"
        >
          <div className="border-b bg-muted/20 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Prenotazione</p>
                <p className="mt-1 truncate text-sm font-semibold">{ctxMenu.booking.customerName}</p>
                <p className="truncate text-xs text-muted-foreground">{ctxMenu.booking.code}</p>
              </div>
              <span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-semibold ${toBadgeClass(ctxMenu.booking.status)}`}>
                {BOOKING_STATUS_LABELS[ctxMenu.booking.status]}
              </span>
            </div>
          </div>
          <div className="space-y-2.5 px-4 py-3">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-xl border bg-card/80 p-2">
                <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Uscita</p>
                <p className="mt-1 font-semibold">
                  {new Date(ctxMenu.booking.pickupAt).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
              <div className="rounded-xl border bg-card/80 p-2">
                <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Rientro</p>
                <p className="mt-1 font-semibold">
                  {new Date(ctxMenu.booking.returnAt).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
            </div>
            <div className="rounded-xl border bg-muted/15 px-3 py-2 text-xs text-muted-foreground">
              Km uscita: <strong className="text-foreground">{ctxMenu.booking.pickupKm ?? "-"}</strong> · Km rientro:{" "}
              <strong className="text-foreground">{ctxMenu.booking.returnKm ?? "-"}</strong>
              {typeof ctxMenu.booking.pickupKm === "number" && typeof ctxMenu.booking.returnKm === "number" ? (
                <> · Percorsi: <strong className="text-foreground">{Math.max(0, ctxMenu.booking.returnKm - ctxMenu.booking.pickupKm)}</strong></>
              ) : null}
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t bg-muted/10 px-4 py-3">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void openDetailFromContext(ctxMenu.booking!.id)}
            >
              Apri dettaglio
            </Button>
          </div>
        </div>
      ) : null}

      {bookingModalOpen ? (
        <>
          <div
            className="fixed inset-0 z-[100] cursor-pointer bg-black/55 backdrop-blur-sm"
            onClick={requestCloseBookingModal}
            aria-hidden="true"
          />
          <div className="fixed inset-0 z-[101] overflow-y-auto p-4">
            <div className="mx-auto flex min-h-full w-full max-w-4xl items-center py-4">
            <Card className="w-full saas-surface" onClick={(event) => event.stopPropagation()}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  {bookingForm.mode === "create" ? "Nuova prenotazione da calendario" : "Modifica prenotazione"}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form className="space-y-3" onChangeCapture={markBookingFormDirty} onSubmit={onBookingSubmit}>
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="relative space-y-1" ref={vehicleSuggestRef}>
                      <Label>Veicolo (targa/modello/sede)</Label>
                      <Input
                        value={vehicleInput}
                        onChange={(e) => {
                          const next = e.target.value;
                          setVehicleInput(next);
                          setBookingForm((state) => ({ ...state, vehicleId: "" }));
                          setVehicleSuggestOpen(true);
                          setVehicleActiveIdx(-1);
                        }}
                        onFocus={() => setVehicleSuggestOpen(true)}
                        onKeyDown={handleVehicleAutocompleteKey}
                        placeholder="Scrivi targa o modello..."
                        aria-label="Ricerca veicolo"
                      />
                      {vehicleSuggestOpen ? (
                        <div className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-card p-1 shadow-lg">
                          {vehicleSuggestions.length === 0 ? (
                            <p className="px-2 py-1 text-xs text-muted-foreground">Nessun veicolo trovato.</p>
                          ) : (
                            vehicleSuggestions.map((vehicle, idx) => (
                              <button
                                key={vehicle.id}
                                type="button"
                                className={`w-full rounded px-2 py-1.5 text-left text-xs transition ${
                                  idx === vehicleActiveIdx ? "bg-primary/10" : "hover:bg-muted/35"
                                }`}
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => pickVehicle(vehicle)}
                              >
                                <p className="font-semibold">{vehicle.plate}</p>
                                <p className="text-[10px] text-muted-foreground">
                                  {vehicle.brand} {vehicle.model}
                                  {vehicle.site ? ` · ${vehicle.site.name}` : ""}
                                </p>
                              </button>
                            ))
                          )}
                        </div>
                      ) : null}
                    </div>

                    <div className="relative space-y-1" ref={customerSuggestRef}>
                      <Label>Cliente</Label>
                      <Input
                        value={customerInput}
                        onChange={(e) => {
                          const next = e.target.value;
                          setCustomerInput(next);
                          setBookingForm((state) => ({ ...state, customerId: "" }));
                          setCustomerSuggestOpen(true);
                          setCustomerActiveIdx(-1);
                        }}
                        onFocus={() => setCustomerSuggestOpen(true)}
                        onKeyDown={handleCustomerAutocompleteKey}
                        placeholder="Cerca nome, ragione sociale, email, documento..."
                        aria-label="Ricerca cliente"
                      />
                      {customerSuggestOpen ? (
                        <div className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-card p-1 shadow-lg">
                          {customerSuggestions.length === 0 ? (
                            <div className="space-y-1 px-2 py-1">
                              <p className="text-xs text-muted-foreground">Cliente non trovato.</p>
                              {customerInput.trim().length >= 2 ? (
                                <Button size="sm" variant="outline" onClick={openInlineNewCustomer} type="button">
                                  Nuovo cliente “{customerInput.trim()}”
                                </Button>
                              ) : null}
                            </div>
                          ) : (
                            customerSuggestions.map((customer, idx) => (
                              <button
                                key={customer.id}
                                type="button"
                                className={`w-full rounded px-2 py-1.5 text-left text-xs transition ${
                                  idx === customerActiveIdx ? "bg-primary/10" : "hover:bg-muted/35"
                                }`}
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => pickCustomer(customer)}
                              >
                                <p className="font-semibold">{customerDisplayName(customer)}</p>
                                <p className="text-[10px] text-muted-foreground">
                                  {customer.customerType === "PERSONA_GIURIDICA"
                                    ? `P.IVA ${customer.companyVatNumber || "-"}`
                                    : `CF ${customer.taxCode || "-"} · ${customer.email || customer.phone || customer.documentNumber || "-"}`}
                                </p>
                              </button>
                            ))
                          )}
                        </div>
                      ) : null}
                    </div>
                    <div className="space-y-1">
                      <Label>Listino noleggio</Label>
                      <Select
                        value={bookingForm.priceListId}
                        onChange={(e) => setBookingForm((s) => ({ ...s, priceListId: e.target.value }))}
                      >
                        <option value="">Seleziona listino...</option>
                        {priceLists.map((list) => (
                          <option key={list.id} value={list.id}>
                            {list.name} · {list.baseRateAmount.toFixed(2)}€/{list.baseRateUnit.toLowerCase()}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>Pacchetto km</Label>
                      <Select
                        value={bookingForm.pricePackageId}
                        onChange={(e) => setBookingForm((s) => ({ ...s, pricePackageId: e.target.value }))}
                        disabled={!bookingForm.priceListId || pricePackages.length === 0}
                      >
                        <option value="">Nessun pacchetto</option>
                        {pricePackages.map((pkg) => (
                          <option key={pkg.id} value={pkg.id}>
                            {pkg.name} · {pkg.type === "UNLIMITED" ? "illimitati" : `${pkg.kmIncluded ?? 0}km`}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>Tariffario km extra</Label>
                      <Select
                        value={bookingForm.extraKmPolicyId}
                        onChange={(e) => setBookingForm((s) => ({ ...s, extraKmPolicyId: e.target.value }))}
                        disabled={!bookingForm.priceListId || compatiblePolicyOptions.length === 0}
                      >
                        <option value="">Nessuna policy</option>
                        {compatiblePolicyOptions.map((policy) => (
                          <option key={policy.id} value={policy.id}>
                            {policy.name}
                            {policy.type === "FLAT"
                              ? ` · ${policy.flatRatePerKm ?? 0}€/km`
                              : ` · ${(policy.tiers ?? []).length} scaglioni`}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>Km stimati</Label>
                      <Input
                        type="number"
                        min="0"
                        value={bookingForm.estimatedKm}
                        onChange={(e) => setBookingForm((s) => ({ ...s, estimatedKm: e.target.value }))}
                        placeholder="Es. 320"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Km reali (consuntivo)</Label>
                      <Input
                        type="number"
                        min="0"
                        value={bookingForm.actualKm}
                        onChange={(e) => setBookingForm((s) => ({ ...s, actualKm: e.target.value }))}
                        placeholder="Compila in chiusura"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Totale previsto (EUR)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={bookingForm.expectedTotal}
                        onChange={(e) => setBookingForm((s) => ({ ...s, expectedTotal: e.target.value }))}
                        readOnly={Boolean(pricingQuote)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Data/ora uscita</Label>
                      <Input
                        type="datetime-local"
                        value={bookingForm.pickupAt}
                        onChange={(e) => setBookingForm((s) => ({ ...s, pickupAt: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Data/ora rientro</Label>
                      <Input
                        type="datetime-local"
                        value={bookingForm.returnAt}
                        onChange={(e) => setBookingForm((s) => ({ ...s, returnAt: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Km all'uscita</Label>
                      <Input
                        type="number"
                        min="0"
                        value={bookingForm.pickupKm}
                        onChange={(e) => setBookingForm((s) => ({ ...s, pickupKm: e.target.value }))}
                        placeholder="Es. 120340"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Km al rientro</Label>
                      <Input
                        type="number"
                        min="0"
                        value={bookingForm.returnKm}
                        onChange={(e) => setBookingForm((s) => ({ ...s, returnKm: e.target.value }))}
                        placeholder="Compila in chiusura"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Luogo uscita</Label>
                      <Input
                        value={bookingForm.pickupLocation}
                        onChange={(e) => setBookingForm((s) => ({ ...s, pickupLocation: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Luogo rientro</Label>
                      <Input
                        value={bookingForm.returnLocation}
                        onChange={(e) => setBookingForm((s) => ({ ...s, returnLocation: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <Label>Motivo noleggio</Label>
                      <Input
                        value={bookingForm.reason}
                        onChange={(e) => setBookingForm((s) => ({ ...s, reason: e.target.value }))}
                        placeholder="Es. sostitutiva, lungo termine..."
                      />
                    </div>
                    <div className="space-y-1 md:col-span-3">
                      <Label>Note pricing</Label>
                      <Input
                        value={bookingForm.pricingNotes}
                        onChange={(e) => setBookingForm((s) => ({ ...s, pricingNotes: e.target.value }))}
                        placeholder="Annotazioni economiche (sconti manuali, accordi, ecc.)"
                      />
                    </div>
                    <div className="space-y-1 md:col-span-3">
                      <div className="rounded-lg border bg-muted/20 p-3">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Preview pricing live</p>
                          {pricingLoading ? <FleetumInlineLoader label="Calcolo" /> : null}
                        </div>
                        {!pricingQuote ? (
                          <p className="mt-2 text-xs text-muted-foreground">
                            Seleziona listino/pacchetto e inserisci date per vedere il totale previsto e il consuntivo km extra.
                          </p>
                        ) : (
                          <div className="mt-2 grid gap-2 md:grid-cols-3">
                            <div className="rounded-md border bg-background/80 p-2">
                              <p className="text-[11px] text-muted-foreground">Durata addebitata</p>
                              <p className="text-sm font-semibold">
                                {pricingQuote.duration.daysCharged} gg · {pricingQuote.duration.chargedUnits} {pricingQuote.duration.unit.toLowerCase()}
                              </p>
                            </div>
                            <div className="rounded-md border bg-background/80 p-2">
                              <p className="text-[11px] text-muted-foreground">Km inclusi</p>
                              <p className="text-sm font-semibold">
                                {pricingQuote.km.includedKmTotal == null ? "Illimitati" : `${pricingQuote.km.includedKmTotal} km`}
                              </p>
                            </div>
                            <div className="rounded-md border bg-background/80 p-2">
                              <p className="text-[11px] text-muted-foreground">Extra km stimati</p>
                              <p className="text-sm font-semibold">
                                {pricingQuote.km.extraKmEstimated} km · {pricingQuote.pricing.extraKmEstimatedCost.toFixed(2)} €
                              </p>
                            </div>
                            <div className="rounded-md border bg-background/80 p-2 md:col-span-2">
                              <p className="text-[11px] text-muted-foreground">Totale previsto</p>
                              <p className="text-base font-semibold text-emerald-700">{pricingQuote.pricing.expectedTotal.toFixed(2)} €</p>
                            </div>
                            <div className="rounded-md border bg-background/80 p-2">
                              <p className="text-[11px] text-muted-foreground">Totale finale (se km reali)</p>
                              <p className="text-base font-semibold">{pricingQuote.pricing.finalTotal.toFixed(2)} €</p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="space-y-1 md:col-span-3">
                      <Label>Note interne</Label>
                      <Textarea
                        rows={3}
                        value={bookingForm.internalNotes}
                        onChange={(e) => setBookingForm((s) => ({ ...s, internalNotes: e.target.value }))}
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-4 md:col-span-3">
                      <label className="inline-flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={bookingForm.contractRequired}
                          onChange={(e) => setBookingForm((state) => ({ ...state, contractRequired: e.target.checked }))}
                        />
                        Contratto richiesto
                      </label>
                      {bookingForm.mode === "create" ? (
                        <label className="inline-flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={bookingForm.generateContract}
                            onChange={(e) => setBookingForm((state) => ({ ...state, generateContract: e.target.checked }))}
                          />
                          Genera contratto automatico (DRAFT)
                        </label>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <Button type="button" variant="outline" onClick={requestCloseBookingModal}>
                      Annulla
                    </Button>
                    <Button type="submit" disabled={saving}>
                      {saving ? "Salvataggio..." : "Salva prenotazione"}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
            </div>
          </div>
          {bookingCloseConfirmOpen ? (
            <>
              <div
                className="fixed inset-0 z-[112] cursor-pointer bg-black/25 backdrop-blur-[2px]"
                onClick={() => setBookingCloseConfirmOpen(false)}
                aria-hidden="true"
              />
              <div className="fixed inset-0 z-[113] flex items-center justify-center p-4">
                <Card className="w-full max-w-md border-border/70 bg-card shadow-[0_28px_90px_-42px_rgba(15,23,42,0.9)]">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Modifiche non salvate</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      Hai modificato la prenotazione. Se esci ora, le modifiche non salvate verranno perse.
                    </p>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button type="button" variant="outline" onClick={() => setBookingCloseConfirmOpen(false)}>
                        Continua modifica
                      </Button>
                      <Button type="button" variant="destructive" onClick={forceCloseBookingModal}>
                        Esci senza salvare
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </>
          ) : null}
        </>
      ) : null}

      {customerModalOpen ? (
        <>
          <div
            className="fixed inset-0 z-[102] bg-black/55 backdrop-blur-sm"
            onClick={() => {
              setCustomerModalOpen(false);
              setCustomerScanFiles([]);
              setCustomerScanInfo(null);
            }}
          />
          <div className="fixed inset-0 z-[103] overflow-y-auto p-4">
            <div className="mx-auto flex min-h-full w-full max-w-5xl items-start py-4">
            <Card className="w-full saas-surface">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  {customerForm.mode === "create" ? "Nuova anagrafica cliente" : "Modifica anagrafica cliente"}
                </CardTitle>
              </CardHeader>
              <CardContent className="pr-2">
                <form className="space-y-3" onSubmit={onCustomerSubmit}>
                  <div className="rounded-lg border bg-muted/15 p-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                      Precompilazione da scansione documento
                    </p>
                    <div className="mt-2 grid gap-2 md:grid-cols-[1fr_auto]">
                      <Input
                        type="file"
                        multiple
                        accept=".pdf,.jpg,.jpeg,.png,.webp"
                        onChange={(e) => setCustomerScanFiles(Array.from(e.target.files ?? []))}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        disabled={customerScanFiles.length === 0 || customerScanRunning}
                        onClick={() => void runCustomerScanAutofill()}
                      >
                        {customerScanRunning ? "Analisi..." : "Analizza e compila"}
                      </Button>
                    </div>
                    {customerScanFiles.length > 0 ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        File selezionati: {customerScanFiles.map((file) => file.name).join(", ")}
                      </p>
                    ) : null}
                    {customerScanInfo ? <p className="mt-2 text-xs text-muted-foreground">{customerScanInfo}</p> : null}
                  </div>

                  <div className="grid gap-3 md:grid-cols-4">
                    <div className="space-y-1 md:col-span-2">
                      <Label>Tipo intestatario</Label>
                      <Select
                        value={customerForm.customerType}
                        onChange={(event) =>
                          setCustomerForm((state) => ({
                            ...state,
                            customerType: event.target.value as RentalCustomerType
                          }))
                        }
                      >
                        <option value="PERSONA_FISICA">Persona fisica</option>
                        <option value="PERSONA_GIURIDICA">Persona giuridica</option>
                      </Select>
                    </div>

                    {customerForm.customerType === "PERSONA_GIURIDICA" ? (
                      <>
                        <div className="space-y-1 md:col-span-2">
                          <Label>Ragione sociale *</Label>
                          <Input
                            value={customerForm.companyName}
                            onChange={(e) => setCustomerForm((s) => ({ ...s, companyName: e.target.value }))}
                            required
                          />
                        </div>
                        <div className="space-y-1">
                          <Label>Forma giuridica</Label>
                          <Input
                            value={customerForm.companyLegalForm}
                            onChange={(e) => setCustomerForm((s) => ({ ...s, companyLegalForm: e.target.value }))}
                            placeholder="Es. SRL, SPA, SNC"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label>Partita IVA *</Label>
                          <Input
                            value={customerForm.companyVatNumber}
                            onChange={(e) => setCustomerForm((s) => ({ ...s, companyVatNumber: e.target.value }))}
                            required
                          />
                        </div>
                        <div className="space-y-1">
                          <Label>Codice fiscale società</Label>
                          <Input
                            value={customerForm.companyTaxCode}
                            onChange={(e) => setCustomerForm((s) => ({ ...s, companyTaxCode: e.target.value }))}
                          />
                        </div>
                        <CustomerAddressFields
                          idPrefix="booking-customer-company-address"
                          title="Sede legale"
                          streetLabel="Via e numero civico"
                          value={companyAddressValueFromCustomerForm(customerForm)}
                          onChange={(address) =>
                            setCustomerForm((state) => ({
                              ...state,
                              companyCountry: address.country,
                              companyRegion: address.region,
                              companyProvince: address.province,
                              companyMunicipalityCode: address.municipalityCode,
                              companyCity: address.city,
                              companyPostalCode: address.postalCode,
                              companyStreetAddress: address.streetAddress
                            }))
                          }
                        />
                        <div className="space-y-1">
                          <Label>Email</Label>
                          <Input
                            type="email"
                            value={customerForm.email}
                            onChange={(e) => setCustomerForm((s) => ({ ...s, email: e.target.value }))}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label>Telefono</Label>
                          <Input value={customerForm.phone} onChange={(e) => setCustomerForm((s) => ({ ...s, phone: e.target.value }))} />
                        </div>
                        <div className="space-y-1">
                          <Label>PEC</Label>
                          <Input
                            type="email"
                            value={customerForm.companyPec}
                            onChange={(e) => setCustomerForm((s) => ({ ...s, companyPec: e.target.value }))}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label>Codice SDI</Label>
                          <Input
                            value={customerForm.companySdi}
                            onChange={(e) => setCustomerForm((s) => ({ ...s, companySdi: e.target.value.toUpperCase() }))}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label>REA</Label>
                          <Input
                            value={customerForm.companyRea}
                            onChange={(e) => setCustomerForm((s) => ({ ...s, companyRea: e.target.value }))}
                          />
                        </div>
                        <div className="space-y-1"><Label>Nome legale rappresentante</Label><Input value={customerForm.legalRepFirstName} onChange={(e) => setCustomerForm((s) => ({ ...s, legalRepFirstName: e.target.value }))} /></div>
                        <div className="space-y-1"><Label>Cognome legale rappresentante</Label><Input value={customerForm.legalRepLastName} onChange={(e) => setCustomerForm((s) => ({ ...s, legalRepLastName: e.target.value }))} /></div>
                        <div className="space-y-1"><Label>CF legale rappresentante</Label><Input value={customerForm.legalRepTaxCode} onChange={(e) => setCustomerForm((s) => ({ ...s, legalRepTaxCode: e.target.value }))} /></div>
                        <div className="space-y-1"><Label>Ruolo legale rappresentante</Label><Input value={customerForm.legalRepRole} onChange={(e) => setCustomerForm((s) => ({ ...s, legalRepRole: e.target.value }))} /></div>
                        <div className="space-y-1"><Label>Email legale rappresentante</Label><Input type="email" value={customerForm.legalRepEmail} onChange={(e) => setCustomerForm((s) => ({ ...s, legalRepEmail: e.target.value }))} /></div>
                        <div className="space-y-1"><Label>Telefono legale rappresentante</Label><Input value={customerForm.legalRepPhone} onChange={(e) => setCustomerForm((s) => ({ ...s, legalRepPhone: e.target.value }))} /></div>
                      </>
                    ) : (
                      <>
                        <div className="space-y-1"><Label>Nome</Label><Input value={customerForm.firstName} onChange={(e) => setCustomerForm((s) => ({ ...s, firstName: e.target.value }))} required /></div>
                        <div className="space-y-1"><Label>Cognome</Label><Input value={customerForm.lastName} onChange={(e) => setCustomerForm((s) => ({ ...s, lastName: e.target.value }))} required /></div>
                        <div className="space-y-1"><Label>Patente numero *</Label><Input value={customerForm.drivingLicenseNumber} onChange={(e) => setCustomerForm((s) => ({ ...s, drivingLicenseNumber: e.target.value }))} required /></div>
                        <div className="space-y-1"><Label>Categoria patente</Label><Input value={customerForm.drivingLicenseCategory} onChange={(e) => setCustomerForm((s) => ({ ...s, drivingLicenseCategory: e.target.value }))} placeholder="Es. B, C, C1E" /></div>
                        <div className="space-y-1"><Label>Rilascio patente</Label><Input type="date" value={customerForm.drivingLicenseIssuedAt} onChange={(e) => setCustomerForm((s) => ({ ...s, drivingLicenseIssuedAt: e.target.value }))} /></div>
                        <div className="space-y-1"><Label>Scadenza patente</Label><Input type="date" value={customerForm.drivingLicenseExpiresAt} onChange={(e) => setCustomerForm((s) => ({ ...s, drivingLicenseExpiresAt: e.target.value }))} /></div>
                        <div className="space-y-1 md:col-span-2"><Label>Autorità patente</Label><Input value={customerForm.drivingLicenseAuthority} onChange={(e) => setCustomerForm((s) => ({ ...s, drivingLicenseAuthority: e.target.value }))} /></div>
                        <div className="space-y-1"><Label>Email</Label><Input type="email" value={customerForm.email} onChange={(e) => setCustomerForm((s) => ({ ...s, email: e.target.value }))} /></div>
                        <div className="space-y-1"><Label>Telefono</Label><Input value={customerForm.phone} onChange={(e) => setCustomerForm((s) => ({ ...s, phone: e.target.value }))} /></div>
                        <div className="space-y-1"><Label>Data nascita</Label><Input type="date" value={customerForm.dateOfBirth} onChange={(e) => setCustomerForm((s) => ({ ...s, dateOfBirth: e.target.value }))} /></div>
                        <div className="space-y-1"><Label>Luogo nascita</Label><Input value={customerForm.placeOfBirth} onChange={(e) => setCustomerForm((s) => ({ ...s, placeOfBirth: e.target.value }))} /></div>
                        <div className="space-y-1">
                          <Label>Nazionalità</Label>
                          <CountrySelect
                            value={customerForm.nationalityCountry}
                            onChange={(countryCode) =>
                              setCustomerForm((state) => ({
                                ...state,
                                nationalityCountry: countryCode,
                                nationality: countryNameFromCode(countryCode)
                              }))
                            }
                          />
                        </div>
                        <div className="space-y-1"><Label>Codice fiscale</Label><Input value={customerForm.taxCode} onChange={(e) => setCustomerForm((s) => ({ ...s, taxCode: e.target.value }))} /></div>
                        <CustomerAddressFields
                          idPrefix="booking-customer-residence-address"
                          title="Residenza"
                          streetLabel="Via e numero civico"
                          value={residenceAddressValueFromCustomerForm(customerForm)}
                          onChange={(address) =>
                            setCustomerForm((state) => ({
                              ...state,
                              residenceCountry: address.country,
                              residenceRegion: address.region,
                              residenceProvince: address.province,
                              residenceMunicipalityCode: address.municipalityCode,
                              residenceCity: address.city,
                              residencePostalCode: address.postalCode,
                              residenceStreetAddress: address.streetAddress
                            }))
                          }
                        />
                        <div className="space-y-1"><Label>Documento tipo</Label><Input value={customerForm.documentType} onChange={(e) => setCustomerForm((s) => ({ ...s, documentType: e.target.value }))} /></div>
                        <div className="space-y-1"><Label>Documento numero</Label><Input value={customerForm.documentNumber} onChange={(e) => setCustomerForm((s) => ({ ...s, documentNumber: e.target.value }))} /></div>
                        <div className="space-y-1"><Label>Rilascio documento</Label><Input type="date" value={customerForm.documentIssuedAt} onChange={(e) => setCustomerForm((s) => ({ ...s, documentIssuedAt: e.target.value }))} /></div>
                        <div className="space-y-1"><Label>Scadenza documento</Label><Input type="date" value={customerForm.documentExpiresAt} onChange={(e) => setCustomerForm((s) => ({ ...s, documentExpiresAt: e.target.value }))} /></div>
                        <div className="space-y-1 md:col-span-2"><Label>Autorità rilascio</Label><Input value={customerForm.documentAuthority} onChange={(e) => setCustomerForm((s) => ({ ...s, documentAuthority: e.target.value }))} /></div>
                      </>
                    )}

                    <div className="space-y-1 md:col-span-4"><Label>Note</Label><Textarea rows={3} value={customerForm.notes} onChange={(e) => setCustomerForm((s) => ({ ...s, notes: e.target.value }))} /></div>
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setCustomerModalOpen(false);
                        setCustomerScanFiles([]);
                        setCustomerScanInfo(null);
                      }}
                    >
                      Annulla
                    </Button>
                    <Button type="submit" disabled={saving}>{saving ? "Salvataggio..." : "Salva cliente"}</Button>
                  </div>
                </form>
              </CardContent>
            </Card>
            </div>
          </div>
        </>
      ) : null}

      {templateModalOpen ? (
        <>
          <div className="fixed inset-0 z-[104] bg-black/55 backdrop-blur-sm" onClick={() => setTemplateModalOpen(false)} />
          <div className="fixed inset-0 z-[105] overflow-y-auto p-4">
            <div className="mx-auto flex min-h-full w-full max-w-6xl items-center py-4">
            <Card className="w-full saas-surface">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Template Contratto Default Tenant</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="space-y-2">
                    <div className="rounded-lg border bg-muted/10 p-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Branding documento PDF</p>
                      <div className="mt-2 grid gap-2 md:grid-cols-2">
                        <div className="space-y-1 md:col-span-2">
                          <Label>Logo intestazione</Label>
                          <Input
                            type="file"
                            accept=".png,.jpg,.jpeg,.webp"
                            disabled={templateLogoUploading}
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              if (file) void uploadTemplateLogo(file);
                              event.target.value = "";
                            }}
                          />
                          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                            <span>{templateLogoFileName || "Nessun logo caricato"}</span>
                            {templateLogoPreviewUrl ? (
                              <Button
                                type="button"
                                variant="outline"
                                className="h-7 px-2 text-[11px]"
                                disabled={templateLogoUploading}
                                onClick={() => void removeTemplateLogo()}
                              >
                                Rimuovi logo
                              </Button>
                            ) : null}
                          </div>
                        </div>
                        {templateLogoPreviewUrl ? (
                          <div className="md:col-span-2 rounded-md border bg-white p-2">
                            <img
                              src={templateLogoPreviewUrl}
                              alt="Logo contratto"
                              className="max-h-16 w-auto object-contain"
                            />
                          </div>
                        ) : null}
                        <div className="space-y-1">
                          <Label>Colore primario</Label>
                          <Input
                            value={templateEditor.brandPrimary}
                            onChange={(e) => setTemplateEditor((state) => ({ ...state, brandPrimary: e.target.value }))}
                            placeholder="#21375d"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label>Colore accento</Label>
                          <Input
                            value={templateEditor.brandAccent}
                            onChange={(e) => setTemplateEditor((state) => ({ ...state, brandAccent: e.target.value }))}
                            placeholder="#5d82c2"
                          />
                        </div>
                        <div className="space-y-1 md:col-span-2">
                          <Label>Font documento</Label>
                          <Select
                            value={templateEditor.brandFont}
                            onChange={(event) => setTemplateEditor((state) => ({ ...state, brandFont: event.target.value }))}
                          >
                            <option value="helvetica">Helvetica Modern</option>
                            <option value="times">Times Classic</option>
                          </Select>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <Label>Nome template</Label>
                      <Input
                        value={templateEditor.name}
                        onChange={(e) => setTemplateEditor((state) => ({ ...state, name: e.target.value }))}
                      />
                    </div>
                    <div className="grid gap-2 md:grid-cols-2">
                      <div className="space-y-1">
                        <Label>Azienda</Label>
                        <Input
                          value={templateEditor.companyName}
                          onChange={(e) => setTemplateEditor((state) => ({ ...state, companyName: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>Partita IVA</Label>
                        <Input
                          value={templateEditor.companyVat}
                          onChange={(e) => setTemplateEditor((state) => ({ ...state, companyVat: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-1 md:col-span-2">
                        <Label>Indirizzo azienda</Label>
                        <Input
                          value={templateEditor.companyAddress}
                          onChange={(e) => setTemplateEditor((state) => ({ ...state, companyAddress: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>Email azienda</Label>
                        <Input
                          value={templateEditor.companyEmail}
                          onChange={(e) => setTemplateEditor((state) => ({ ...state, companyEmail: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>Telefono azienda</Label>
                        <Input
                          value={templateEditor.companyPhone}
                          onChange={(e) => setTemplateEditor((state) => ({ ...state, companyPhone: e.target.value }))}
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label>Oggetto email default</Label>
                      <Input
                        value={templateEditor.emailSubject}
                        onChange={(e) => setTemplateEditor((state) => ({ ...state, emailSubject: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Body email default</Label>
                      <Textarea
                        rows={5}
                        value={templateEditor.emailBody}
                        onChange={(e) => setTemplateEditor((state) => ({ ...state, emailBody: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Contenuto contratto</Label>
                      <Textarea
                        rows={12}
                        value={templateEditor.content}
                        onChange={(e) => setTemplateEditor((state) => ({ ...state, content: e.target.value }))}
                      />
                    </div>
                  </div>

                  <div className="space-y-2 rounded-lg border bg-muted/15 p-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Placeholder supportati</p>
                    <div className="grid gap-1 text-xs text-muted-foreground">
                      <code>{`{{booking.code}}`}</code>
                      <code>{`{{booking.pickupAt}}`}</code>
                      <code>{`{{booking.returnAt}}`}</code>
                      <code>{`{{booking.pickupKm}}`}</code>
                      <code>{`{{booking.returnKm}}`}</code>
                      <code>{`{{booking.kmDriven}}`}</code>
                      <code>{`{{customer.firstName}}`}</code>
                      <code>{`{{customer.lastName}}`}</code>
                      <code>{`{{customer.type}}`}</code>
                      <code>{`{{customer.email}}`}</code>
                      <code>{`{{company.name}}`}</code>
                      <code>{`{{company.vat}}`}</code>
                      <code>{`{{company.taxCode}}`}</code>
                      <code>{`{{company.address}}`}</code>
                      <code>{`{{company.pec}}`}</code>
                      <code>{`{{company.sdi}}`}</code>
                      <code>{`{{company.rea}}`}</code>
                      <code>{`{{company.legalRepFullName}}`}</code>
                      <code>{`{{company.legalRepTaxCode}}`}</code>
                      <code>{`{{vehicle.plate}}`}</code>
                      <code>{`{{vehicle.brand}}`}</code>
                      <code>{`{{vehicle.model}}`}</code>
                      <code>{`{{pricing.expectedTotal}}`}</code>
                    </div>

                    {templatePreview ? (
                      <div className="space-y-2 rounded-md border bg-card p-2">
                        <p className="text-xs font-semibold">Preview render</p>
                        <p className="text-[11px]"><strong>Subject:</strong> {templatePreview.emailSubject}</p>
                        <p className="text-[11px] whitespace-pre-wrap">{templatePreview.emailBody}</p>
                        <p className="text-[11px] whitespace-pre-wrap">{templatePreview.content}</p>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Seleziona una prenotazione e usa “Preview render” per vedere la versione compilata.
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setTemplateModalOpen(false)}>
                    Chiudi
                  </Button>
                  <Button type="button" variant="outline" onClick={() => void runPreviewTemplate()} disabled={templateSaving || templateLogoUploading}>
                    Preview render
                  </Button>
                  <Button type="button" onClick={() => void runSaveTemplate()} disabled={templateSaving || templateLogoUploading}>
                    {templateSaving ? "Salvataggio..." : "Salva template"}
                  </Button>
                </div>
              </CardContent>
            </Card>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
};
