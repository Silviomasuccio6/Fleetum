import { ContractSigningPanel } from "../../components/contracts/contract-signing-panel";
import { ContractRentalDetailsPanel } from "../../components/contracts/contract-rental-details-panel";
import { ContractCargosDialog } from "../../components/contracts/contract-cargos-dialog";
import { FormEvent, KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { useAuthStore } from "../../../application/stores/auth-store";
import { masterDataUseCases } from "../../../application/usecases/master-data-usecases";
import { WorkspacePageHeader, WorkspaceMetricStrip, WorkspaceFilterGroup } from "../../components/ui/workspace-ui";
import { BookingInvoiceSection } from "../../components/bookings/booking-invoice-section";
import { RentalBookingList } from "../../components/bookings/rental-booking-list";
import { RentalBookingMonthlyGrid } from "../../components/bookings/rental-booking-monthly-grid";
import { FleetumInlineLoader } from "../../components/brand/fleetum-logo-loader";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Select } from "../../components/ui/select";
import { Textarea } from "../../components/ui/textarea";
import { useFleetumLanguage } from "../../i18n/fleetum-language";
import { CommerceDrawer,CommerceNotice } from "../../components/ui/commerce-workspace";
import { ContractTemplateEditor } from "../../components/contracts/contract-template-editor";
import { usePanelMotion } from "../../hooks/use-panel-motion";
import type { PanelMotionHandle } from "../../components/ui/panel-motion";
import { useDialogFocus } from "../../hooks/use-dialog-focus";
import { useRentalMonthAvailability } from "../../hooks/use-rental-month-availability";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AlertTriangle, CalendarCheck2, CalendarDays, Car, ChevronLeft, ChevronRight, Clock3, Plus, RotateCcw, Search, UserPlus, List, LayoutGrid, X, FileText, MessageSquare, Radio, UserRound, ArrowUp } from "lucide-react";
import { BookingDetailSection } from "../../components/bookings/booking-detail-section";
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
  pricingTermsChanged: boolean;
  pricingSnapshotChanged: { estimatedKm: boolean; actualKm: boolean; notes: boolean };
  expectedTotalChanged: boolean;
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
  NOT_REQUIRED: "Da verificare",
  PENDING: "In attesa invio",
  SENT: "Verifica riscontro",
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
    pricingTermsChanged: false,
    pricingSnapshotChanged: { estimatedKm: false, actualKm: false, notes: false },
    expectedTotalChanged: false,
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
  const { language } = useFleetumLanguage();
  const permissions = useAuthStore((state) => state.user?.permissions) ?? [];
  const canManageBookings = permissions.includes("vehicles:write") || permissions.includes("*");
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
  const [bookingView, setBookingView] = useState<"calendar" | "list">(() => typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches ? "list" : "calendar");

  const selectedBookingId = routeBookingId ?? searchParams.get("bookingId");
  const selectedBookingIdRef = useRef(selectedBookingId);
  const detailRequestVersionRef = useRef(0);
  const contractRequestVersionRef = useRef(0);
  const bookingSelectionMountedRef = useRef(false);
  useLayoutEffect(() => {
    if (selectedBookingIdRef.current !== selectedBookingId) {
      selectedBookingIdRef.current = selectedBookingId;
      detailRequestVersionRef.current += 1;
      contractRequestVersionRef.current += 1;
    }
  }, [selectedBookingId]);
  const selectBooking = useCallback((bookingId: string | null, replace = false) => {
    if (selectedBookingId === bookingId) return;
    const next = new URLSearchParams(searchParams);
    if (bookingId) next.set("bookingId", bookingId);
    else next.delete("bookingId");

    if (routeBookingId) {
      navigate({
        pathname: bookingId ? `/rental-bookings/${encodeURIComponent(bookingId)}` : "/booking",
        search: next.toString()
      }, { replace });
    } else {
      setSearchParams(next, { replace });
    }
  }, [navigate, routeBookingId, searchParams, selectedBookingId, setSearchParams]);
  const [selectedBookingDetail, setSelectedBooking] = useState<BookingDetail | null>(null);
  const selectedBooking = selectedBookingDetail?.id === selectedBookingId ? selectedBookingDetail : null;

  const [transitionTo, setTransitionTo] = useState<RentalBookingStatus | "">("");
  const [contractTo, setContractTo] = useState<RentalContractStatus>("NOT_READY");
  const [signingFreeze,setSigningFreeze]=useState<{id:string;locked:boolean}|null>(null);
  const [cargosPromptBookingId,setCargosPromptBookingId]=useState<string|null>(null);
  const [noteInput, setNoteInput] = useState("");

  const [bookingModalOpen, setBookingModalOpen] = useState(false);
  const [bookingForm, setBookingForm] = useState<BookingFormState>(() => buildBookingFormForCell());
  const [bookingFormDirty, setBookingFormDirty] = useState(false);
  const [bookingFieldErrors, setBookingFieldErrors] = useState<Partial<Record<keyof BookingFormState, string>>>({});
  const bookingErrorRef = useRef<HTMLDivElement | null>(null);
  const [bookingCloseConfirmOpen, setBookingCloseConfirmOpen] = useState(false);
  const bookingDialogRef = useRef<HTMLDivElement | null>(null);
  const closeDialogRef = useRef<HTMLDivElement | null>(null);
  const customerDialogRef = useRef<HTMLDivElement | null>(null);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  useDialogFocus(bookingModalOpen, bookingDialogRef);
  useDialogFocus(bookingCloseConfirmOpen, closeDialogRef);
  const [customerFormDirty, setCustomerFormDirty] = useState(false);
  const requestCloseCustomer = () => {
    if (saving) return;
    if (customerFormDirty && !window.confirm("Chiudere l’anagrafica cliente? Le modifiche non salvate verranno perse.")) return;
    setCustomerModalOpen(false);
    setCustomerFormDirty(false);
    setCustomerScanFiles([]);
    setCustomerScanInfo(null);
  };
  useDialogFocus(customerModalOpen, customerDialogRef, () => requestCloseCustomer());
  useEffect(() => { if (customerModalOpen) setCustomerFormDirty(false); }, [customerModalOpen]);
  const [customerForm, setCustomerForm] = useState<CustomerFormState>(() => defaultCustomerForm());
  const [customerUploadFiles, setCustomerUploadFiles] = useState<File[]>([]);
  const [customerScanFiles, setCustomerScanFiles] = useState<File[]>([]);
  const [customerScanRunning, setCustomerScanRunning] = useState(false);
  const [customerScanInfo, setCustomerScanInfo] = useState<string | null>(null);
  const [bookingContract, setContract] = useState<BookingContract | null>(null);
  const contract = bookingContract?.bookingId === selectedBookingId ? bookingContract : null;
  const [contractEditor, setContractEditor] = useState<ContractEditorState>(() => defaultContractEditor());
  const [contractLoading, setContractLoading] = useState(false);
  const [contractError, setContractError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [priceLists, setPriceLists] = useState<RentalPriceList[]>([]);
  const [pricePackages, setPricePackages] = useState<RentalPricePackage[]>([]);
  const [extraPolicies, setExtraPolicies] = useState<RentalExtraKmPolicy[]>([]);
  const [pricingQuote, setPricingQuote] = useState<RentalPricingQuote | null>(null);
  const [pricingLoading, setPricingLoading] = useState(false);
  const bookingPricingModalRef = useRef({ version: 0, open: false });
  const pricingRulesRequestRef = useRef(0);
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
  const calendarPanelRef = useRef<HTMLDivElement | null>(null);
  const vehicleSuggestRef = useRef<HTMLDivElement | null>(null);
  const customerSuggestRef = useRef<HTMLDivElement | null>(null);
  const bookingCreateRequestRef = useRef<string | null>(null);
  const contractEmailRequestRef = useRef<{ fingerprint: string; key: string } | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const paymentSetupStatus = searchParams.get("payment_setup") ?? searchParams.get("rental_payment");

  const [templateLoading,setTemplateLoading]=useState(false),[templateLoaded,setTemplateLoaded]=useState(false),[templateDirty,setTemplateDirty]=useState(false),[templateDiscardOpen,setTemplateDiscardOpen]=useState(false);
  const templateRequestVersion=useRef(0),templateMotion=useRef<PanelMotionHandle|null>(null);
  const closeTemplateNow=()=>{templateRequestVersion.current++;setTemplateDiscardOpen(false);setTemplateDirty(false);const done=()=>setTemplateModalOpen(false);if(templateMotion.current)templateMotion.current.dismiss(done);else done()};
  const requestCloseTemplate=()=>{if(templateSaving||templateLogoUploading)return;if(templateDirty)setTemplateDiscardOpen(true);else closeTemplateNow()};
  useEffect(()=>{if(!templateDirty)return;const protect=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue=''};window.addEventListener('beforeunload',protect);return()=>window.removeEventListener('beforeunload',protect)},[templateDirty]);

  const bookingCardRef = useRef<HTMLDivElement>(null), bookingMotionRef = useRef<PanelMotionHandle|null>(null);
  usePanelMotion(bookingCardRef, bookingCardRef, null, bookingModalOpen, "booking-editor", bookingMotionRef);

  const forceCloseBookingModal = useCallback(() => {
    bookingPricingModalRef.current = { version: bookingPricingModalRef.current.version + 1, open: false };
    setBookingCloseConfirmOpen(false);
    const done = () => {
      setBookingModalOpen(false);
      setBookingFormDirty(false);
      setVehicleSuggestOpen(false);
      setCustomerSuggestOpen(false);
      setVehicleActiveIdx(-1);
      setCustomerActiveIdx(-1);
    };
    if (bookingMotionRef.current) bookingMotionRef.current.dismiss(done); else done();
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
    () => monthCursor.toLocaleDateString(language === "en" ? "en-GB" : "it-IT", { month: "long", year: "numeric" }),
    [monthCursor, language]
  );

  const monthAvailability = useRentalMonthAvailability({
    month: monthIso,
    siteId: siteId || undefined,
    search: vehicleSearch || undefined,
    refreshKey
  });

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
        hint: `${operationalStats.occupancyRate}% ${language === "en" ? "monthly occupancy" : "occupazione mese"}`,
        icon: AlertTriangle,
        tone: "text-slate-700 bg-slate-50 border-slate-200 dark:text-slate-300 dark:bg-slate-900/40 dark:border-slate-800"
      }
    ],
    [operationalStats, language]
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
    const modalVersion = bookingPricingModalRef.current.version;
    const requestVersion = ++pricingRulesRequestRef.current;
    const isCurrent = () => bookingPricingModalRef.current.open &&
      bookingPricingModalRef.current.version === modalVersion && pricingRulesRequestRef.current === requestVersion;
    if (!listId) {
      setPricePackages([]);
      setExtraPolicies([]);
      return;
    }

    const result = await Promise.all([
      rentalBookingsUseCases.listPricePackages(listId),
      rentalBookingsUseCases.listExtraKmPolicies({ priceListId: listId })
    ]).catch((error: unknown) => {
      if (isCurrent()) setError((error as Error).message);
      return null;
    });
    if (!result) return;
    const [pkgRes, policyRes] = result;
    if (!isCurrent()) return;

    const activePackages = (pkgRes.data ?? []).filter((pkg) => pkg.isActive);
    const activePolicies = (policyRes.data ?? []).filter((policy) => policy.isActive);
    setPricePackages(activePackages);
    setExtraPolicies(activePolicies);

    setBookingForm((current) => {
      if (current.priceListId !== listId || (current.mode === "edit" && !current.pricingTermsChanged)) return current;
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
    const modalVersion = bookingPricingModalRef.current.version;
    const isCurrent = () => bookingPricingModalRef.current.open && bookingPricingModalRef.current.version === modalVersion;
    try {
      const payload = await rentalBookingsUseCases.getBookingPricing(bookingId);
      if (!isCurrent()) return;
      if (!payload.snapshot) {
        return;
      }

      setBookingForm((current) => {
        if (current.mode !== "edit" || current.bookingId !== bookingId || current.pricingTermsChanged) return current;
        return {
          ...current,
          priceListId: payload.snapshot?.priceListId ?? "",
          pricePackageId: payload.snapshot?.pricePackageId ?? "",
          extraKmPolicyId: payload.snapshot?.extraKmPolicyId ?? "",
          ...(current.pricingSnapshotChanged.estimatedKm ? {} : {
            estimatedKm: payload.snapshot?.estimatedKm != null ? String(payload.snapshot.estimatedKm) : ""
          }),
          ...(current.pricingSnapshotChanged.actualKm ? {} : {
            actualKm: payload.snapshot?.actualKm != null ? String(payload.snapshot.actualKm) : ""
          }),
          ...(current.pricingSnapshotChanged.notes ? {} : { pricingNotes: payload.snapshot?.notes ?? "" })
        };
      });
    } catch {
      // Best effort: se non esiste snapshot non blocchiamo l'operativita.
    }
  };

  const loadSelectedBooking = async (bookingId: string) => {
    if (!bookingSelectionMountedRef.current || selectedBookingIdRef.current !== bookingId) return;
    const requestVersion = ++detailRequestVersionRef.current;
    const isCurrent = () => bookingSelectionMountedRef.current &&
      selectedBookingIdRef.current === bookingId && detailRequestVersionRef.current === requestVersion;
    setDetailLoading(true);
    try {
      const detail = (await rentalBookingsUseCases.getById(bookingId)) as BookingDetail;
      if (!isCurrent()) return;
      setSelectedBooking(detail);
      setContractTo(detail.contractStatus);
      setTransitionTo("");
      // Form inputs are initialized by their explicit create/edit actions.
      // A background detail refresh must not overwrite an open booking draft.
    } catch (e) {
      if (!isCurrent()) return;
      setError((e as Error).message);
    } finally {
      if (isCurrent()) setDetailLoading(false);
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
    if (!bookingSelectionMountedRef.current || selectedBookingIdRef.current !== bookingId) return;
    const requestVersion = ++contractRequestVersionRef.current;
    const isCurrent = () => bookingSelectionMountedRef.current &&
      selectedBookingIdRef.current === bookingId && contractRequestVersionRef.current === requestVersion;
    setContractLoading(true);
    setContractError(null);
    try {
      const contractData = await rentalBookingsUseCases.getContract(bookingId);
      if (!isCurrent()) return;
      setContract(contractData);
      syncContractEditor(contractData);
    } catch (e) {
      if (!isCurrent()) return;
      const message = (e as Error).message || "";
      // An absent optional document resolves to null. All rejected requests
      // remain errors, including failures whose message mentions a missing dependency.
      setContract(null);
      syncContractEditor(null);
      setContractError(message || "Impossibile caricare il contratto.");
      setError(message);
    } finally {
      if (isCurrent()) setContractLoading(false);
    }
  };

  useLayoutEffect(() => {
    bookingSelectionMountedRef.current = true;
    return () => {
      bookingSelectionMountedRef.current = false;
      detailRequestVersionRef.current += 1;
      contractRequestVersionRef.current += 1;
      bookingPricingModalRef.current = { version: bookingPricingModalRef.current.version + 1, open: false };
    };
  }, []);

  useEffect(() => {
    void loadMasterData();
    void loadCustomers();
    void loadPricingLists();
  }, []);

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
    setSelectedBooking(null);
    setContract(null);
    syncContractEditor(null);
    setContractLoading(false);
    setContractError(null);
    setDetailLoading(false);
    setTransitionTo("");
    setContractTo("NOT_READY");
    setNoteInput("");
    setError(null);
  }, [selectedBookingId]);

  useEffect(() => {
    if (!selectedBookingId) return;
    void loadSelectedBooking(selectedBookingId);
    void loadContract(selectedBookingId);
  }, [selectedBookingId, refreshKey]);

  useEffect(() => {
    if (!bookingModalOpen) return;
    if (bookingForm.mode === "edit" && !bookingForm.pricingTermsChanged) {
      pricingRulesRequestRef.current += 1;
      setPricePackages([]);
      setExtraPolicies([]);
      return;
    }
    if (!bookingForm.priceListId) {
      setPricePackages([]);
      setExtraPolicies([]);
      setPricingQuote(null);
      return;
    }
    void loadPricingRules(bookingForm.priceListId);
  }, [bookingModalOpen, bookingForm.mode, bookingForm.pricingTermsChanged, bookingForm.priceListId]);

  useEffect(() => {
    if (!bookingModalOpen) return;
    if (bookingForm.mode === "edit" && !bookingForm.pricingTermsChanged) return;
    const compatiblePolicies = extraPolicies.filter((policy) => !policy.packageId || policy.packageId === bookingForm.pricePackageId);
    if (compatiblePolicies.some((policy) => policy.id === bookingForm.extraKmPolicyId)) return;
    const nextPolicyId = compatiblePolicies.find((policy) => policy.isDefault)?.id ?? compatiblePolicies[0]?.id ?? "";
    setBookingForm((current) => ({ ...current, extraKmPolicyId: nextPolicyId }));
  }, [bookingModalOpen, bookingForm.mode, bookingForm.pricingTermsChanged, bookingForm.pricePackageId, bookingForm.extraKmPolicyId, extraPolicies]);

  useEffect(() => {
    if (!bookingModalOpen || !bookingForm.priceListId || (bookingForm.mode === "edit" && !bookingForm.pricingTermsChanged)) {
      setPricingQuote(null);
      setPricingLoading(false);
      return;
    }
    const pickupAt = new Date(bookingForm.pickupAt);
    const returnAt = new Date(bookingForm.returnAt);
    if (Number.isNaN(pickupAt.getTime()) || Number.isNaN(returnAt.getTime()) || returnAt.getTime() <= pickupAt.getTime()) {
      setPricingQuote(null);
      return;
    }

    const modalVersion = bookingPricingModalRef.current.version;
    let cancelled = false;
    const isCurrent = () => !cancelled && bookingPricingModalRef.current.open && bookingPricingModalRef.current.version === modalVersion;
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
        if (!isCurrent()) return;
        setPricingQuote(response.quote);
        setBookingForm((current) => ({
          ...current,
          expectedTotal: response.quote.pricing.expectedTotal.toFixed(2)
        }));
      } catch (e) {
        if (!isCurrent()) return;
        setPricingQuote(null);
        setError((e as Error).message);
      } finally {
        if (isCurrent()) setPricingLoading(false);
      }
    }, 250);

    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [
    bookingModalOpen,
    bookingForm.mode,
    bookingForm.pricingTermsChanged,
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
      selectBooking(firstBooking.id, true);
    }
  }, [monthAvailability.data, selectBooking, selectedBookingId, statusFilter]);

  const goPrevMonth = () => {
    setMonthCursor((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1));
  };

  const goNextMonth = () => {
    setMonthCursor((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1));
  };

  const openCreateModalFromCell = (input?: { vehicleId: string; date: Date }) => {
    bookingPricingModalRef.current = { version: bookingPricingModalRef.current.version + 1, open: true };
    bookingCreateRequestRef.current = globalThis.crypto.randomUUID();
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
    setBookingFieldErrors({});
    setBookingModalOpen(true);
    setError(null);
    setSuccess(null);
  };

  const openEditModal = () => {
    if (!selectedBooking) return;
    bookingPricingModalRef.current = { version: bookingPricingModalRef.current.version + 1, open: true };
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
      pricingTermsChanged: false,
      pricingSnapshotChanged: { estimatedKm: false, actualKm: false, notes: false },
      expectedTotalChanged: false,
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
    setBookingFieldErrors({});
    setBookingModalOpen(true);
    setPricingQuote(null);
    setError(null);
    setSuccess(null);
    void loadBookingPricingSnapshot(selectedBooking.id);
  };

  const scrollToControlPanel = () => {
    window.requestAnimationFrame(() => {
      controlPanelRef.current?.focus({ preventScroll: true });
      controlPanelRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      setControlPanelPulse(true);
      window.setTimeout(() => setControlPanelPulse(false), 1200);
    });
  };

  const openDetailFromContext = async (bookingId: string) => {
    setCtxMenu((prev) => ({ ...prev, open: false, booking: null }));
    if (selectedBookingId !== bookingId) {
      selectBooking(bookingId);
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
    clearBookingFieldError("vehicleId");
    setVehicleInput(`${vehicle.plate} · ${vehicle.brand} ${vehicle.model}`);
    setVehicleSuggestOpen(false);
    setVehicleActiveIdx(-1);
  };

  const pickCustomer = (customer: RentalCustomer) => {
    markBookingFormDirty();
    setBookingForm((state) => ({ ...state, customerId: customer.id }));
    clearBookingFieldError("customerId");
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

  const clearBookingFieldError = (field: keyof BookingFormState) => setBookingFieldErrors((current) => {
    if (!current[field]) return current;
    const next = { ...current }; delete next[field]; return next;
  });
  const bookingFieldProps = (field: keyof BookingFormState, id: string, required = false) => ({
    name: field,
    "aria-required": required || undefined,
    "aria-invalid": bookingFieldErrors[field] ? true : undefined,
    "aria-describedby": bookingFieldErrors[field] ? id + "-error" : undefined,
    onInvalid: (event: { currentTarget: { validationMessage: string } }) => {
      const message = event.currentTarget.validationMessage;
      setBookingFieldErrors((current) => ({ ...current, [field]: message }));
    }
  });
  const bookingFieldError = (field: keyof BookingFormState, id: string) => bookingFieldErrors[field]
    ? <p id={id + "-error"} className="booking-editor-field-error">{bookingFieldErrors[field]}</p> : null;
  const formatBookingDate = (value: string) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Da definire" : date.toLocaleString(language === "en" ? "en-GB" : "it-IT", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  const onBookingSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    const invalid: Partial<Record<keyof BookingFormState, string>> = {};
    if (!bookingForm.vehicleId) invalid.vehicleId = "Seleziona un veicolo dai risultati.";
    if (!bookingForm.customerId) invalid.customerId = "Seleziona un cliente dai risultati.";
    const pickupDate = new Date(bookingForm.pickupAt);
    const returnDate = new Date(bookingForm.returnAt);
    if (Number.isNaN(pickupDate.getTime())) invalid.pickupAt = "Inserisci una data e un'ora di uscita valide.";
    if (Number.isNaN(returnDate.getTime())) invalid.returnAt = "Inserisci una data e un'ora di rientro valide.";
    if (!invalid.pickupAt && !invalid.returnAt && returnDate <= pickupDate) invalid.returnAt = "Il rientro deve essere successivo all'uscita.";
    if (bookingForm.mode === "edit" && bookingForm.pricingTermsChanged && !bookingForm.priceListId) invalid.priceListId = "Seleziona un listino per modificare le condizioni economiche.";
    for (const field of ["pickupKm", "returnKm"] as const) {
      if (bookingForm[field] && (!Number.isInteger(Number(bookingForm[field])) || Number(bookingForm[field]) < 0)) invalid[field] = "Inserisci un numero intero di km maggiore o uguale a zero.";
    }
    if (!invalid.pickupKm && !invalid.returnKm && bookingForm.pickupKm && bookingForm.returnKm && Number(bookingForm.returnKm) < Number(bookingForm.pickupKm)) invalid.returnKm = "I km rientro devono essere maggiori o uguali ai km uscita.";
    setBookingFieldErrors(invalid);
    if (Object.keys(invalid).length) {
      setError("Controlla i campi indicati prima di salvare.");
      window.requestAnimationFrame(() => bookingDialogRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
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
        ...(bookingForm.mode === "create" || bookingForm.expectedTotalChanged
          ? { expectedTotal: bookingForm.expectedTotal ? Number(bookingForm.expectedTotal) : undefined }
          : {}),
        reason: bookingForm.reason || undefined,
        internalNotes: bookingForm.internalNotes || undefined
      };
      let targetBookingId: string | undefined = bookingForm.bookingId;
      if (bookingForm.mode === "create") {
        bookingCreateRequestRef.current ??= globalThis.crypto.randomUUID();
        const created = await rentalBookingsUseCases.create(
          payload,
          bookingCreateRequestRef.current
        );
        targetBookingId = created.id;
        selectBooking(created.id);
        setSuccess("Prenotazione creata con successo.");
        if(created.contractCreated)setCargosPromptBookingId(created.id);
      } else if (bookingForm.bookingId) {
        await rentalBookingsUseCases.update(bookingForm.bookingId, payload);
        targetBookingId = bookingForm.bookingId;
        selectBooking(bookingForm.bookingId);
        setSuccess("Prenotazione aggiornata.");
      }

      if (targetBookingId && bookingForm.priceListId && (bookingForm.mode === "create" || bookingForm.pricingTermsChanged)) {
        const pricing = await rentalBookingsUseCases.updateBookingPricing(targetBookingId, {
          priceListId: bookingForm.priceListId,
          pricePackageId: bookingForm.pricePackageId || undefined,
          extraKmPolicyId: bookingForm.extraKmPolicyId || undefined,
          estimatedKm: bookingForm.estimatedKm ? Number(bookingForm.estimatedKm) : undefined,
          actualKm: bookingForm.actualKm ? Number(bookingForm.actualKm) : undefined,
          notes: bookingForm.pricingNotes || undefined
        });
        setPricingQuote(pricing.quote);
      } else if (targetBookingId && bookingForm.mode === "edit" && Object.values(bookingForm.pricingSnapshotChanged).some(Boolean)) {
        await rentalBookingsUseCases.updateBookingPricing(targetBookingId, {
          preserveTerms: true,
          ...(bookingForm.pricingSnapshotChanged.estimatedKm ? {
            estimatedKm: bookingForm.estimatedKm ? Number(bookingForm.estimatedKm) : null
          } : {}),
          ...(bookingForm.pricingSnapshotChanged.actualKm ? {
            actualKm: bookingForm.actualKm ? Number(bookingForm.actualKm) : null
          } : {}),
          ...(bookingForm.pricingSnapshotChanged.notes ? { notes: bookingForm.pricingNotes } : {})
        });
      }

      if (bookingForm.mode === "create") bookingCreateRequestRef.current = null;
      forceCloseBookingModal();
      setRefreshKey((prev) => prev + 1);
    } catch (e) {
      setError((e as Error).message);
      window.requestAnimationFrame(() => bookingErrorRef.current?.focus());
    } finally {
      setSaving(false);
    }
  };

  const applyCustomerDraft = (draft: Partial<RentalCustomer>) => {
    setCustomerFormDirty(true);
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
    let savedCustomerId: string | undefined;
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

      // Persist the primary result before uploads/list refreshes: a retry must
      // update this customer rather than create another record.
      savedCustomerId = customerId;
      if (customerId) {
        setCustomerForm(current => ({ ...current, mode: "edit", customerId }));
        setBookingForm(current => ({ ...current, customerId }));
        setCustomerInput(payload.customerType === "PERSONA_GIURIDICA"
          ? (payload.companyName ?? "")
          : `${payload.firstName ?? ""} ${payload.lastName ?? ""}`.trim());
      }
      if (customerId && customerScanFiles.length > 0) {
        await rentalBookingsUseCases.uploadCustomerAttachments(customerId, customerScanFiles);
        setCustomerScanFiles([]);
      }
      const actionLabel = customerForm.mode === "create" ? "Cliente creato." : "Cliente aggiornato.";
      const docsLabel = customerScanFiles.length > 0 ? ` Documenti salvati: ${customerScanFiles.length}.` : " Nessun documento allegato.";
      setSuccess(`${actionLabel}${docsLabel}`);
      setCustomerModalOpen(false);
      setCustomerForm(defaultCustomerForm());
      setCustomerScanFiles([]);
      setCustomerScanInfo(null);
      setRefreshKey((prev) => prev + 1);
      try { await loadCustomers(customerSearch.trim()); }
      catch { setError("Cliente salvato e selezionato. Non è stato possibile aggiornare l’elenco clienti; riprova ad aggiornarlo."); }
    } catch (e) {
      setError(savedCustomerId
        ? `Cliente salvato e selezionato. ${(e as Error).message} Riprova per completare i documenti senza creare un’altra anagrafica.`
        : (e as Error).message);
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
      if (!bookingSelectionMountedRef.current || selectedBookingIdRef.current !== selectedBooking.id) return;
      contractRequestVersionRef.current += 1;
      setContract(generated);
      syncContractEditor(generated);
      setSuccess("Contratto generato dal template tenant.");
      if(!contract)setCargosPromptBookingId(selectedBooking.id);
      setRefreshKey((prev) => prev + 1);
    } catch (e) {
      if (!bookingSelectionMountedRef.current || selectedBookingIdRef.current !== selectedBooking.id) return;
      setError((e as Error).message);
    } finally {
      if (bookingSelectionMountedRef.current) setSaving(false);
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
      if (!bookingSelectionMountedRef.current || selectedBookingIdRef.current !== selectedBooking.id) return;
      contractRequestVersionRef.current += 1;
      setContract(updated);
      syncContractEditor(updated);
      setSuccess("Contratto salvato.");
      setRefreshKey((prev) => prev + 1);
    } catch (e) {
      if (!bookingSelectionMountedRef.current || selectedBookingIdRef.current !== selectedBooking.id) return;
      setError((e as Error).message);
    } finally {
      if (bookingSelectionMountedRef.current) setSaving(false);
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
      const input = {
        to: contractEditor.emailTo || undefined,
        subject: contractEditor.emailSubject || undefined,
        body: contractEditor.emailBody || undefined
      };
      const fingerprint = JSON.stringify({ bookingId: selectedBooking.id, contractId: contract.id, input });
      if (contractEmailRequestRef.current?.fingerprint !== fingerprint) {
        contractEmailRequestRef.current = { fingerprint, key: globalThis.crypto.randomUUID() };
      }
      await rentalBookingsUseCases.sendContractEmail(
        selectedBooking.id,
        input,
        contractEmailRequestRef.current.key
      );
      contractEmailRequestRef.current = null;
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
      if (!bookingSelectionMountedRef.current || selectedBookingIdRef.current !== selectedBooking.id) return;
      contractRequestVersionRef.current += 1;
      setContract(updated);
      syncContractEditor(updated);
      setContractTo("SIGNED");
      setSuccess("Contratto marcato come firmato.");
      setRefreshKey((prev) => prev + 1);
    } catch (e) {
      if (!bookingSelectionMountedRef.current || selectedBookingIdRef.current !== selectedBooking.id) return;
      setError((e as Error).message);
    } finally {
      if (bookingSelectionMountedRef.current) setSaving(false);
    }
  };

  const openTemplateModal = async () => {
    if(!canManageBookings)return;const sequence=++templateRequestVersion.current;setTemplateLoading(true);setTemplateLoaded(false);setTemplateDirty(false);
    setTemplateModalOpen(true);
    setTemplatePreview(null);
    setError(null);
    try {
      const template = await rentalBookingsUseCases.getDefaultContractTemplate();
      if(sequence!==templateRequestVersion.current)return;
      if (template.logoFilePath) {
        try {
          const logoBlob = await rentalBookingsUseCases.downloadDefaultContractTemplateLogo();
          if(sequence!==templateRequestVersion.current)return;
          const logoUrl = URL.createObjectURL(logoBlob);
          setTemplateLogoPreviewUrl((current) => {
            if (current) URL.revokeObjectURL(current);
            return logoUrl;
          });
          setTemplateLogoFileName(template.logoFileName ?? "logo-contratto");
        } catch {
          if(sequence!==templateRequestVersion.current)return;
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
      if(sequence!==templateRequestVersion.current)return;setTemplateLoaded(true);
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
      if(sequence===templateRequestVersion.current)setError((e as Error).message);
    }finally{if(sequence===templateRequestVersion.current)setTemplateLoading(false)}
  };

  const runPreviewTemplate = async () => {
    if(!canManageBookings||!templateLoaded||templateSaving||templateLogoUploading)return;
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
    if(!canManageBookings||!templateLoaded||templateSaving||templateLogoUploading)return;
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
      setTemplateDirty(false);
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
    if(!canManageBookings||!templateLoaded||templateSaving||templateLogoUploading)return;
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
    if(!canManageBookings||!templateLoaded||templateSaving||templateLogoUploading)return;
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

  useEffect(()=>{
    if(searchParams.get('template')!=='1'||!canManageBookings)return;
    const next=new URLSearchParams(searchParams);next.delete('template');setSearchParams(next,{replace:true});void openTemplateModal();
  },[searchParams,canManageBookings]);

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
      selectBooking(null, true);
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
    <section className="booking-workspace" aria-label="Gestione prenotazioni">
      <WorkspacePageHeader
        eyebrow="OPERATIVITÀ"
        title="Prenotazioni"
        description="Disponibilità, consegne e rientri. Tutta la flotta, nello stesso posto."
        actions={<>
          <Button variant="outline" onClick={() => {
            setCustomerForm(defaultCustomerForm()); setCustomerScanFiles([]); setCustomerScanInfo(null); setCustomerModalOpen(true);
          }}><UserPlus className="h-4 w-4" aria-hidden="true" />Nuovo cliente</Button>
          <Button onClick={() => openCreateModalFromCell()}><Plus className="h-4 w-4" aria-hidden="true" />Nuova prenotazione</Button>
        </>}
      />
      <WorkspaceMetricStrip collapsible items={bookingMetricCards} loading={monthAvailability.loading} />

      {error && !bookingModalOpen && !customerModalOpen && !templateModalOpen ? <CommerceNotice>{error}</CommerceNotice> : null}
      {success && !customerModalOpen ? <CommerceNotice tone="success">{success}</CommerceNotice> : null}
      <div className="booking-toolbar" role="region" aria-label="Filtri e periodo">
        <div className="booking-toolbar-top">
          <div className="booking-period">
            <Button variant="ghost" size="icon" onClick={goPrevMonth} aria-label="Mese precedente"><ChevronLeft className="h-4 w-4" aria-hidden="true" /></Button>
            <h2 className="booking-month" aria-live="polite">{monthLabel}</h2>
            <Button variant="ghost" size="icon" onClick={goNextMonth} aria-label="Mese successivo"><ChevronRight className="h-4 w-4" aria-hidden="true" /></Button>
            <Button variant="outline" onClick={() => setMonthCursor(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}><span translate="no">{language === "en" ? "Today" : "Oggi"}</span></Button>
          </div>
          <div className="booking-view-switch" role="group" aria-label="Vista prenotazioni">
            <button type="button" aria-pressed={bookingView === "calendar"} onClick={() => setBookingView("calendar")}><LayoutGrid className="h-4 w-4" aria-hidden="true" />Calendario</button>
            <button type="button" aria-pressed={bookingView === "list"} onClick={() => setBookingView("list")}><List className="h-4 w-4" aria-hidden="true" />Elenco</button>
          </div>
        </div>
        <div className="booking-filters">
          <div className="booking-search">
            <label htmlFor="booking-search">Cerca nella flotta</label>
            <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input id="booking-search" className="pl-9 pr-11" value={vehicleSearch} onChange={(e) => setVehicleSearch(e.target.value)} placeholder="Targa, modello o cliente" aria-label="Ricerca booking" />
              {vehicleSearch ? <button type="button" className="absolute inset-y-0 right-0 grid w-10 place-items-center" aria-label="Cancella ricerca" onClick={() => setVehicleSearch("")}><X className="h-4 w-4" aria-hidden="true" /></button> : null}
            </div>
          </div>
          <WorkspaceFilterGroup activeCount={Number(Boolean(siteId)) + Number(Boolean(statusFilter))}>
          <div><label htmlFor="booking-site">Sede</label><Select id="booking-site" value={siteId} onChange={(e) => setSiteId(e.target.value)} aria-label="Filtra sede booking">
            <option value="">Tutte le sedi</option>{sites.map((site) => <option translate="no" key={site.id} value={site.id}>{site.name}{site.city ? ` · ${site.city}` : ""}</option>)}
          </Select></div>
          <div><label htmlFor="booking-status">Stato prenotazione</label><Select id="booking-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as RentalBookingStatus | "")} aria-label="Filtra stato prenotazione">
            <option value="">Tutti gli stati</option>{(Object.keys(BOOKING_STATUS_LABELS) as RentalBookingStatus[]).map((key) => <option key={key} value={key}>{BOOKING_STATUS_LABELS[key]}</option>)}
          </Select></div>
          <Button variant="ghost" disabled={!siteId && !vehicleSearch && !statusFilter} onClick={() => {setSiteId(""); setVehicleSearch(""); setStatusFilter("");}}><RotateCcw className="h-4 w-4" aria-hidden="true" />Azzera filtri</Button>
          </WorkspaceFilterGroup>
        </div>
        <div className="booking-toolbar-foot">
          <p role="status">{monthAvailability.loading ? "Aggiornamento disponibilità…" : `${monthAvailability.data.length} veicoli nel periodo`}</p>
          <details className="booking-legend"><summary>Legenda stati</summary><div>{BOOKING_STATUS_LEGEND.map((item) => <span key={item.status} data-booking-status={item.status} className={toBadgeClass(item.status)}>{BOOKING_STATUS_LABELS[item.status]}</span>)}</div></details>
        </div>
      </div>

      <div className="booking-content-grid" data-has-selection={Boolean(selectedBookingId)}>
        <Card ref={calendarPanelRef} tabIndex={-1} aria-label="Pianificazione prenotazioni" className="saas-surface booking-calendar-card">
          <CardContent className="!p-0">
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
            ) : bookingView === "list" ? (
              <RentalBookingList rows={monthAvailability.data} statusFilter={statusFilter} selectedBookingId={selectedBookingId} getStatusLabel={(status) => BOOKING_STATUS_LABELS[status]} onSelectBooking={(id) => {selectBooking(id); scrollToControlPanel();}} />
            ) : (
              <RentalBookingMonthlyGrid
                className="booking-calendar-scroller"
                monthKey={monthIso}
                monthDays={days}
                rows={monthAvailability.data}
                statusFilter={statusFilter}
                selectedBookingId={selectedBookingId}
                onSelectBooking={(bookingId) => {
                  selectBooking(bookingId);
                  scrollToControlPanel();
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
          tabIndex={-1} aria-labelledby="booking-detail-title"
          className={`booking-detail min-w-0 rounded-xl ${
            controlPanelPulse ? "ring-2 ring-primary/60 shadow-[0_0_0_5px_rgba(109,75,191,0.08)]" : ""
          }`}
        >
        <Card className="saas-surface booking-detail-card">
          <CardHeader className="booking-detail-header">
            <div><h2 id="booking-detail-title" className="font-semibold">Dettaglio prenotazione</h2><p className="text-muted-foreground">Tutte le informazioni e le operazioni, nello stesso posto.</p></div>
            <Button variant="outline" onClick={() => { calendarPanelRef.current?.focus({ preventScroll: true }); calendarPanelRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }); }}><ArrowUp aria-hidden="true" className="h-4 w-4" />{bookingView === "calendar" ? "Torna al calendario" : "Torna all’elenco"}</Button>
          </CardHeader>
          <CardContent className="booking-detail-content">
            {!selectedBooking ? (
              detailLoading ? <FleetumInlineLoader label="Caricamento dettaglio prenotazione" /> : <p className="text-sm text-muted-foreground">{selectedBookingId ? "Dettaglio non disponibile. Seleziona una prenotazione o riprova." : "Seleziona una prenotazione per vedere le operazioni disponibili."}</p>
            ) : (
              <>
                {!canManageBookings ? <p className="booking-detail-readonly" role="status">Modalità sola lettura. Il tuo ruolo può consultare questa prenotazione, ma non modificarla.</p> : null}
                <div className="booking-detail-summary" key={`summary-${selectedBooking.id}`}>
                  <div className="booking-detail-identity">
                    <div className="booking-detail-avatar" aria-hidden="true"><Car /></div>
                    <div className="min-w-0">
                      <p className="booking-detail-eyebrow">{selectedBooking.code} · <span className={`booking-detail-badge ${toBadgeClass(selectedBooking.status)}`}>{BOOKING_STATUS_LABELS[selectedBooking.status]}</span></p>
                      <h3 translate="no">{selectedBooking.customerName}</h3>
                      <p>{selectedBooking.vehicle.brand} {selectedBooking.vehicle.model} · <strong>{selectedBooking.vehicle.plate}</strong></p>
                      <p className="text-muted-foreground">{selectedBooking.vehicle.site?.name || "Sede non indicata"}</p>
                    </div>
                    <Button onClick={openEditModal} disabled={saving || !canManageBookings}>Modifica prenotazione</Button>
                  </div>
                  <dl className="booking-detail-facts" aria-label="Riepilogo prenotazione">
                    <div><dt>Uscita</dt><dd>{new Date(selectedBooking.pickupAt).toLocaleString(language === "en" ? "en-GB" : "it-IT", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</dd><dd className="booking-detail-secondary">{selectedBooking.pickupLocation || "Luogo non indicato"}</dd></div>
                    <div><dt>Rientro</dt><dd>{new Date(selectedBooking.returnAt).toLocaleString(language === "en" ? "en-GB" : "it-IT", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</dd><dd className="booking-detail-secondary">{selectedBooking.returnLocation || "Luogo non indicato"}</dd></div>
                    <div><dt>Totale previsto</dt><dd>{selectedBooking.expectedTotal == null ? "Da definire" : new Intl.NumberFormat(language === "en" ? "en-GB" : "it-IT", { style: "currency", currency: "EUR" }).format(selectedBooking.expectedTotal)}</dd><dt>Totale finale</dt><dd className="booking-detail-secondary">{selectedBooking.finalTotal == null ? "Da definire" : new Intl.NumberFormat(language === "en" ? "en-GB" : "it-IT", { style: "currency", currency: "EUR" }).format(selectedBooking.finalTotal)}</dd></div>
                  </dl>
                  <div className="booking-detail-meta">
                    <span>Km uscita: <strong>{selectedBooking.pickupKm ?? "—"}</strong></span>
                    <span>Km rientro: <strong>{selectedBooking.returnKm ?? "—"}</strong>{selectedBooking.pickupKm != null && selectedBooking.returnKm != null ? ` · Δ ${Math.max(0, selectedBooking.returnKm - selectedBooking.pickupKm)} km` : ""}</span>
                    <span className={`booking-detail-badge ${toBadgeClass(selectedBooking.contractStatus)}`}>Workflow: {CONTRACT_STATUS_LABELS[selectedBooking.contractStatus]}</span>
                    {contract ? <span className={`booking-detail-badge ${toBadgeClass(contract.status)}`}>Documento: {BOOKING_CONTRACT_STATUS_LABELS[contract.status]}</span> : null}
                    <span className={`booking-detail-badge ${toBadgeClass(selectedBooking.cargosStatus==="SENT"?"READY":selectedBooking.cargosStatus)}`}>CARGOS: {CARGOS_STATUS_LABELS[selectedBooking.cargosStatus]}</span>
                  </div>
                </div>

                <div className="booking-detail-sections" key={selectedBooking.id}>
                  <BookingDetailSection title="Operazioni prenotazione" description="Stato del noleggio e operazioni disponibili." icon={<CalendarCheck2 />} initiallyOpen>
                    <div className="space-y-2 rounded-lg border p-3">
                  <Label htmlFor="booking-transition-to">Transizione stato</Label>
                  <div className="flex items-center gap-2">
                    <Select id="booking-transition-to" value={transitionTo} onChange={(e) => setTransitionTo(e.target.value as RentalBookingStatus | "")}>
                      <option value="">Seleziona stato</option>
                      {availableTransitions.map((status) => (
                        <option key={status} value={status}>
                          {BOOKING_STATUS_LABELS[status]}
                        </option>
                      ))}
                    </Select>
                    <Button onClick={() => void runTransition()} disabled={!transitionTo || saving || !canManageBookings}>
                      Applica
                    </Button>
                  </div>
                </div>
                  <details className="booking-detail-danger">
                    <summary>Eliminazione prenotazione</summary>
                    <p>Ti verrà chiesta conferma prima di eliminare questa prenotazione.</p>
                    <Button size="sm" variant="destructive" onClick={() => void runDeleteBooking()} disabled={saving || !canManageBookings}>Elimina</Button>
                  </details>
                  </BookingDetailSection>
                  <BookingInvoiceSection key={`invoice-${selectedBooking.id}`} bookingId={selectedBooking.id} bookingCode={selectedBooking.code} canRead={permissions.includes("vehicles:read") || permissions.includes("*")} />
                  <BookingDetailSection title="Contratto" description="Preparazione, documento, firma e invio." icon={<FileText />}>
                    {contract?<ContractRentalDetailsPanel key={`terms-${selectedBooking.id}`} bookingId={selectedBooking.id} canManage={canManageBookings} freeze={signingFreeze?.id===selectedBooking.id?signingFreeze.locked:true} onSaved={()=>{void loadContract(selectedBooking.id);}}/>:null}
                    {contract?<ContractSigningPanel key={selectedBooking.id} bookingId={selectedBooking.id} canManage={canManageBookings} onFreeze={locked=>setSigningFreeze({id:selectedBooking.id,locked})} onSigned={()=>{void loadContract(selectedBooking.id);setRefreshKey(v=>v+1);}}/>:null}
                    {/* Workflow readiness remains distinct from the document's status. */}
                    <div className="space-y-2 rounded-lg border p-3">
                    <Label htmlFor="booking-field-7">Workflow contratto noleggio</Label>
                    <Select id="booking-field-7" value={contractTo} onChange={(e) => setContractTo(e.target.value as RentalContractStatus)}>
                      {(Object.keys(CONTRACT_STATUS_LABELS) as RentalContractStatus[]).map((status) => (
                        <option key={status} value={status}>
                          {CONTRACT_STATUS_LABELS[status]}
                        </option>
                      ))}
                    </Select>
                    <Button variant="outline" onClick={() => void runContractUpdate()} disabled={saving || !canManageBookings || (signingFreeze?.id===selectedBooking.id&&signingFreeze.locked)}>
                      Salva stato workflow
                    </Button>
                  </div>
                    <div className="space-y-2 rounded-lg border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold">Documento e invio</p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => void openTemplateModal()} disabled={saving || !canManageBookings}>
                        Template default
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => void runGenerateContract()} disabled={saving || !canManageBookings || (signingFreeze?.id===selectedBooking.id&&signingFreeze.locked)}>
                        {contract ? "Rigenera" : "Genera contratto"}
                      </Button>
                    </div>
                  </div>

                  {contractLoading ? (
                    <FleetumInlineLoader label="Caricamento contratto" />
                  ) : contractError ? (
                    <div className="booking-detail-error" role="alert"><p>{contractError}</p><Button variant="outline" onClick={() => void loadContract(selectedBooking.id)}>Riprova caricamento contratto</Button></div>
                  ) : !contract ? (
                    <div className="rounded-md border border-dashed bg-muted/15 p-3 text-xs text-muted-foreground">
                      Contratto non ancora generato per questa prenotazione.
                    </div>
                  ) : (
                    <>
                      <fieldset disabled={(signingFreeze?.id===selectedBooking.id&&signingFreeze.locked)} className="grid gap-2 md:grid-cols-2">
                        <div className="space-y-1">
                          <Label htmlFor="booking-field-1">Stato documento</Label>
                          <Select id="booking-field-1"
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
                          <Label htmlFor="booking-field-2">Email cliente</Label>
                          <Input id="booking-field-2"
                            type="email"
                            value={contractEditor.emailTo}
                            onChange={(e) => setContractEditor((state) => ({ ...state, emailTo: e.target.value }))}
                            placeholder="cliente@email.it"
                          />
                        </div>
                        <div className="space-y-1 md:col-span-2">
                          <Label htmlFor="booking-field-3">Titolo contratto</Label>
                          <Input id="booking-field-3"
                            value={contractEditor.title}
                            onChange={(e) => setContractEditor((state) => ({ ...state, title: e.target.value }))}
                          />
                        </div>
                        <div className="space-y-1 md:col-span-2">
                          <Label htmlFor="booking-field-4">Oggetto email</Label>
                          <Input id="booking-field-4"
                            value={contractEditor.emailSubject}
                            onChange={(e) => setContractEditor((state) => ({ ...state, emailSubject: e.target.value }))}
                          />
                        </div>
                        <div className="space-y-1 md:col-span-2">
                          <Label htmlFor="booking-field-5">Corpo email</Label>
                          <Textarea id="booking-field-5"
                            rows={3}
                            value={contractEditor.emailBody}
                            onChange={(e) => setContractEditor((state) => ({ ...state, emailBody: e.target.value }))}
                          />
                        </div>
                        <div className="space-y-1 md:col-span-2">
                          <Label htmlFor="booking-field-6">Contenuto contratto</Label>
                          <Textarea id="booking-field-6"
                            rows={7}
                            value={contractEditor.content}
                            onChange={(e) => setContractEditor((state) => ({ ...state, content: e.target.value }))}
                          />
                        </div>
                      </fieldset>

                      <div className="flex flex-wrap gap-1.5">
                        <Button size="sm" variant="outline" onClick={() => void runSaveContractDocument()} disabled={saving || !canManageBookings || (signingFreeze?.id===selectedBooking.id&&signingFreeze.locked)}>
                          Salva
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => void runDownloadContractPdf()} disabled={saving}>
                          Scarica PDF
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => void runPrintContractPdf()} disabled={saving}>
                          Stampa
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => void runSendContractEmail()} disabled={saving || !canManageBookings}>
                          Invia email
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => void runSendContractWhatsapp()} disabled={saving || !canManageBookings}>
                          Invia WhatsApp
                        </Button>
                        <Button size="sm" onClick={() => void runMarkContractSigned()} disabled={saving || !canManageBookings || (signingFreeze?.id===selectedBooking.id&&signingFreeze.locked)}>
                          Marca firmato
                        </Button>
                      </div>

                      <div className="grid gap-2 lg:grid-cols-2">
                        <div className="rounded-md border bg-muted/10 p-2">
                          <p className="text-[11px] font-semibold text-muted-foreground">Ultime consegne email</p>
                          <div role="region" aria-label="Ultime consegne email" tabIndex={0} className="mt-1.5 max-h-[110px] space-y-1 overflow-auto rounded-sm pr-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2">
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
                          <div role="region" aria-label="Audit contratto" tabIndex={0} className="mt-1.5 max-h-[110px] space-y-1 overflow-auto rounded-sm pr-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2">
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
                  </BookingDetailSection>
                  <RentalPaymentGuaranteePanel key={selectedBooking.id} booking={selectedBooking} paymentSetupStatus={paymentSetupStatus} />
<BookingDetailSection title="Cliente e documenti" description="Anagrafica associata, allegati e collegamenti al cliente." icon={<UserRound />} >
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
                        disabled={saving || !canManageBookings}
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
                  <Label htmlFor="booking-field-10">Carica documenti cliente (PDF/JPG/PNG)</Label>
                  <Input id="booking-field-10"
                    type="file"
                    multiple
                    accept=".pdf,.jpg,.jpeg,.png,.webp"
                    onChange={(e) => setCustomerUploadFiles(Array.from(e.target.files ?? []))}
                  />
                  <Button
                    variant="outline"
                    onClick={() => void uploadCustomerDocs()}
                    disabled={customerUploadFiles.length === 0 || saving || !canManageBookings}
                  >
                    Salva documenti
                  </Button>
                </div>

                <div className="space-y-1 rounded-md border p-2">
                  <h4 className="font-semibold">Documenti salvati</h4>
                  {(selectedBooking.customer.attachments ?? []).length === 0 ? (
                    <p className="text-xs text-muted-foreground">Nessun documento.</p>
                  ) : (
                    (selectedBooking.customer.attachments ?? []).map((attachment) => (
                      <div key={attachment.id} className="booking-detail-document-row">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{attachment.fileName}</p>
                          <p className="text-[10px] text-muted-foreground">{attachment.mimeType}</p>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button size="sm" variant="outline" onClick={() => void openCustomerAttachment(attachment.id)}>
                            Apri
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => void removeCustomerAttachment(attachment.id)} disabled={saving || !canManageBookings}>
                            Elimina
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
            <details className="booking-detail-customer-search"><summary>Cerca o crea un’altra anagrafica</summary><p className="text-sm text-muted-foreground">Seleziona un risultato per aprire la scheda cliente.</p>            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <Input
                aria-label="Cerca anagrafica cliente"
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
                  onClick={() => navigate(`/anagrafiche/clienti?customerId=${customer.id}`)}
                >
                  <p className="font-medium" translate="no">{customerDisplayName(customer)}</p>
                  <p className="text-[10px] text-muted-foreground">{customerSearchSubtitle(customer)}</p>
                </button>
              ))}
            </div>


            </details>
        </BookingDetailSection>
                  <BookingDetailSection title="CARGOS" description="Trasmetti i dati e verifica l'esito del servizio." icon={<Radio />}>
                    <p className="text-sm">{selectedBooking.cargosStatus==="SENT"?"Trasmissione registrata: consulta l'esito verificato.":"Da trasmettere a CARGOS"}</p>
                    <Button className="mt-3" variant="outline" onClick={()=>setCargosPromptBookingId(selectedBooking.id)} disabled={saving||!canManageBookings}>Trasmetti contratto a CARGOS</Button>
                  </BookingDetailSection>
                  <BookingDetailSection title="Note e attività" description="Aggiornamenti operativi e cronologia della prenotazione." icon={<MessageSquare />}>
                    <div className="space-y-2 rounded-lg border p-3">
                  <Label htmlFor="booking-field-9">Aggiornamento operativo</Label>
                  <Textarea id="booking-field-9"
                    value={noteInput}
                    onChange={(e) => setNoteInput(e.target.value)}
                    rows={2}
                    placeholder="Inserisci nota operativa..."
                  />
                  <Button variant="outline" onClick={() => void runAddNote()} disabled={!noteInput.trim() || saving || !canManageBookings}>
                    Aggiungi nota
                  </Button>
                </div>

                <div className="space-y-2 rounded-lg border p-3">
                  <h4 className="font-semibold">Timeline</h4>
                  <div className="max-h-[180px] space-y-2 overflow-auto pr-1">
                    {(selectedBooking.notes ?? []).length === 0 ? (
                      <p className="text-xs text-muted-foreground">Nessuna nota disponibile.</p>
                    ) : (
                      (selectedBooking.notes ?? []).map((note) => (
                        <div key={note.id} className="rounded-md border bg-muted/20 px-2 py-1.5">
                          <p className="text-[11px] font-medium">{note.type}</p>
                          <p className="text-xs">{note.message}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {new Date(note.createdAt).toLocaleString(language === "en" ? "en-GB" : "it-IT", {
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
                  </BookingDetailSection>
                </div>
              </>
            )}
          </CardContent>
        </Card>
        </aside>
      </div>


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
                <p className="mt-1 truncate text-sm font-semibold" translate="no">{ctxMenu.booking.customerName}</p>
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
                  {new Date(ctxMenu.booking.pickupAt).toLocaleString(language === "en" ? "en-GB" : "it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
              <div className="rounded-xl border bg-card/80 p-2">
                <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Rientro</p>
                <p className="mt-1 font-semibold">
                  {new Date(ctxMenu.booking.returnAt).toLocaleString(language === "en" ? "en-GB" : "it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
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
          <div ref={bookingDialogRef} role="dialog" aria-modal="true" aria-label={bookingForm.mode === "create" ? "Nuova prenotazione" : "Modifica prenotazione"} aria-describedby="booking-editor-description" tabIndex={-1} className="booking-editor-dialog fixed inset-0 z-[101]">
            <Card ref={bookingCardRef} className="booking-editor-card saas-surface" onClick={(event) => event.stopPropagation()}>
              <CardHeader className="booking-editor-header">
                <div>
                  <p className="workspace-eyebrow">Prenotazioni</p>
                  <CardTitle className="booking-editor-title">{bookingForm.mode === "create" ? "Nuova prenotazione" : "Modifica prenotazione"}</CardTitle>
                  <p id="booking-editor-description" className="booking-editor-description">Cliente, veicolo, uscita e rientro sono obbligatori.</p>
                </div>
                <Button type="button" variant="ghost" size="icon" aria-label="Chiudi modulo prenotazione" onClick={requestCloseBookingModal} disabled={saving}><X aria-hidden="true" className="h-5 w-5" /></Button>
              </CardHeader>
              <CardContent className="booking-editor-content">
                <form className="booking-editor-form" onChangeCapture={(event) => {
                  markBookingFormDirty();
                  const name = (event?.target as HTMLInputElement | undefined)?.name;
                  if (name) clearBookingFieldError(name as keyof BookingFormState);
                }} onSubmit={onBookingSubmit}>
                  <div className="booking-editor-scroll">
                    <div className="booking-editor-sections">
                      {error ? <div ref={bookingErrorRef} tabIndex={-1} role="alert" className="booking-editor-error"><AlertTriangle aria-hidden="true" className="h-4 w-4" /><p>{error}</p></div> : null}
                      <fieldset className="booking-editor-section">
                        <legend><span aria-hidden="true">01</span> Cliente e veicolo</legend>
                        <p className="booking-editor-section-help">Cerca e seleziona un risultato per associare il cliente e il veicolo.</p>
                        <div className="booking-editor-grid">
                          <div className="relative space-y-1" ref={customerSuggestRef}>
                            <Label htmlFor="booking-field-12">Cliente</Label>
                            <Input id="booking-field-12" {...bookingFieldProps("customerId", "booking-field-12", true)}
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
                            {bookingFieldError("customerId", "booking-field-12")}
                            {customerSuggestOpen ? (
                              <div className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-card p-1 shadow-lg">
                                {customerSuggestions.length === 0 ? (
                                  <div className="space-y-1 px-2 py-1">
                                    <p className="text-xs text-muted-foreground">Cliente non trovato.</p>
                                    {customerInput.trim().length >= 2 ? (
                                      <Button size="sm" variant="outline" onClick={openInlineNewCustomer} type="button">
                                        <span>Nuovo cliente</span> <span translate="no">“{customerInput.trim()}”</span>
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
                                      <p className="font-semibold" translate="no">{customerDisplayName(customer)}</p>
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
                          <div className="relative space-y-1" ref={vehicleSuggestRef}>
                            <Label htmlFor="booking-field-11">Veicolo (targa/modello/sede)</Label>
                            <Input id="booking-field-11" {...bookingFieldProps("vehicleId", "booking-field-11", true)}
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
                            {bookingFieldError("vehicleId", "booking-field-11")}
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
                        </div>
                      </fieldset>
                      <fieldset className="booking-editor-section">
                        <legend><span aria-hidden="true">02</span> Date e luoghi</legend>
                        <div className="booking-editor-grid">
                          <div className="booking-editor-trip"><h4>Uscita</h4>
                            <div className="space-y-1">
                              <Label htmlFor="booking-field-19">Data/ora uscita</Label>
                              <Input id="booking-field-19" {...bookingFieldProps("pickupAt", "booking-field-19", true)}
                                type="datetime-local"
                                value={bookingForm.pickupAt}
                                onChange={(e) => setBookingForm((s) => ({ ...s, pickupAt: e.target.value }))}
                              />
                              {bookingFieldError("pickupAt", "booking-field-19")}
                            </div>
                            <div className="space-y-1">
                              <Label htmlFor="booking-field-23">Luogo uscita</Label>
                              <Input id="booking-field-23"
                                value={bookingForm.pickupLocation}
                                onChange={(e) => setBookingForm((s) => ({ ...s, pickupLocation: e.target.value }))}
                              />
                            </div>
                            <div className="space-y-1">
                              <Label htmlFor="booking-field-21">Km all'uscita</Label>
                              <Input id="booking-field-21" {...bookingFieldProps("pickupKm", "booking-field-21", false)}
                                type="number"
                                min="0"
                                value={bookingForm.pickupKm}
                                onChange={(e) => setBookingForm((s) => ({ ...s, pickupKm: e.target.value }))}
                                placeholder="Es. 120340"
                              />
                              {bookingFieldError("pickupKm", "booking-field-21")}
                            </div>
                          </div>
                          <div className="booking-editor-trip"><h4>Rientro</h4>
                            <div className="space-y-1">
                              <Label htmlFor="booking-field-20">Data/ora rientro</Label>
                              <Input id="booking-field-20" {...bookingFieldProps("returnAt", "booking-field-20", true)}
                                type="datetime-local"
                                value={bookingForm.returnAt}
                                onChange={(e) => setBookingForm((s) => ({ ...s, returnAt: e.target.value }))}
                              />
                              {bookingFieldError("returnAt", "booking-field-20")}
                            </div>
                            <div className="space-y-1">
                              <Label htmlFor="booking-field-24">Luogo rientro</Label>
                              <Input id="booking-field-24"
                                value={bookingForm.returnLocation}
                                onChange={(e) => setBookingForm((s) => ({ ...s, returnLocation: e.target.value }))}
                              />
                            </div>
                            <div className="space-y-1">
                              <Label htmlFor="booking-field-22">Km al rientro</Label>
                              <Input id="booking-field-22" {...bookingFieldProps("returnKm", "booking-field-22", false)}
                                type="number"
                                min="0"
                                value={bookingForm.returnKm}
                                onChange={(e) => setBookingForm((s) => ({ ...s, returnKm: e.target.value }))}
                                placeholder="Compila in chiusura"
                              />
                              {bookingFieldError("returnKm", "booking-field-22")}
                            </div>
                          </div>
                        </div>
                      </fieldset>
                      <fieldset className="booking-editor-section">
                        <legend><span aria-hidden="true">03</span> Condizioni economiche</legend>
                        <p className="booking-editor-section-help">Km stimati e km reali indicano la percorrenza del noleggio, non il contachilometri del veicolo.</p>
                        <div className="booking-editor-grid">
                          <div className="space-y-1">
                            <Label htmlFor="booking-field-13">Listino noleggio</Label>
                            <Select id="booking-field-13" {...bookingFieldProps("priceListId", "booking-field-13", false)}
                              value={bookingForm.priceListId}
                              onChange={(e) => {
                                setPricingQuote(null);
                                setBookingForm((s) => ({ ...s, priceListId: e.target.value, pricingTermsChanged: true }));
                              }}
                            >
                              <option value="">Seleziona listino...</option>
                              {bookingForm.mode === "edit" && !bookingForm.pricingTermsChanged && bookingForm.priceListId ? (
                                <option value={bookingForm.priceListId}>Listino concordato · condizioni salvate</option>
                              ) : null}
                              {priceLists.filter((list) => bookingForm.mode !== "edit" || bookingForm.pricingTermsChanged || list.id !== bookingForm.priceListId).map((list) => (
                                <option translate="no" key={list.id} value={list.id}>
                                  {list.name} · {list.baseRateAmount.toFixed(2)}€/{({DAILY:language === "en" ? "day" : "giorno",WEEKLY:language === "en" ? "week" : "settimana",MONTHLY:language === "en" ? "month" : "mese"})[list.baseRateUnit]}
                                </option>
                              ))}
                            </Select>
                            {bookingFieldError("priceListId", "booking-field-13")}
                            {bookingForm.mode === "edit" && !bookingForm.pricingTermsChanged ? (
                              <Button type="button" size="sm" variant="outline" onClick={() => {
                                markBookingFormDirty();
                                setBookingForm((s) => ({ ...s, pricingTermsChanged: true }));
                              }}>Modifica condizioni economiche</Button>
                            ) : null}
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor="booking-field-14">Pacchetto km</Label>
                            <Select id="booking-field-14"
                              value={bookingForm.pricePackageId}
                              onChange={(e) => setBookingForm((s) => ({ ...s, pricePackageId: e.target.value, pricingTermsChanged: true }))}
                              disabled={!bookingForm.priceListId || pricePackages.length === 0}
                            >
                              <option value="">Nessun pacchetto</option>
                              {bookingForm.mode === "edit" && !bookingForm.pricingTermsChanged && bookingForm.pricePackageId ? (
                                <option value={bookingForm.pricePackageId}>Pacchetto concordato · condizioni salvate</option>
                              ) : null}
                              {pricePackages.map((pkg) => (
                                <option translate="no" key={pkg.id} value={pkg.id}>
                                  {pkg.name} · {pkg.type === "UNLIMITED" ? (language === "en" ? "unlimited" : "illimitati") : `${pkg.kmIncluded ?? 0}km`}
                                </option>
                              ))}
                            </Select>
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor="booking-field-15">Tariffario km extra</Label>
                            <Select id="booking-field-15"
                              value={bookingForm.extraKmPolicyId}
                              onChange={(e) => setBookingForm((s) => ({ ...s, extraKmPolicyId: e.target.value, pricingTermsChanged: true }))}
                              disabled={!bookingForm.priceListId || compatiblePolicyOptions.length === 0}
                            >
                              <option value="">Nessuna policy</option>
                              {bookingForm.mode === "edit" && !bookingForm.pricingTermsChanged && bookingForm.extraKmPolicyId ? (
                                <option value={bookingForm.extraKmPolicyId}>Tariffario concordato · condizioni salvate</option>
                              ) : null}
                              {compatiblePolicyOptions.map((policy) => (
                                <option translate="no" key={policy.id} value={policy.id}>
                                  {policy.name}
                                  {policy.type === "FLAT"
                                    ? ` · ${policy.flatRatePerKm ?? 0}€/km`
                                    : ` · ${(policy.tiers ?? []).length} scaglioni`}
                                </option>
                              ))}
                            </Select>
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor="booking-field-16">Km stimati</Label>
                            <Input id="booking-field-16" {...bookingFieldProps("estimatedKm", "booking-field-16", false)}
                              type="number"
                              min="0"
                              value={bookingForm.estimatedKm}
                              onChange={(e) => setBookingForm((s) => ({ ...s, estimatedKm: e.target.value,
                                pricingSnapshotChanged: { ...s.pricingSnapshotChanged, estimatedKm: true } }))}
                              placeholder="Es. 320"
                            />
                            {bookingFieldError("estimatedKm", "booking-field-16")}
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor="booking-field-17">Km reali (consuntivo)</Label>
                            <Input id="booking-field-17" {...bookingFieldProps("actualKm", "booking-field-17", false)}
                              type="number"
                              min="0"
                              value={bookingForm.actualKm}
                              onChange={(e) => setBookingForm((s) => ({ ...s, actualKm: e.target.value,
                                pricingSnapshotChanged: { ...s.pricingSnapshotChanged, actualKm: true } }))}
                              placeholder="Compila in chiusura"
                            />
                            {bookingFieldError("actualKm", "booking-field-17")}
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor="booking-field-18">Totale previsto (EUR)</Label>
                            <Input id="booking-field-18" {...bookingFieldProps("expectedTotal", "booking-field-18", false)}
                              type="number"
                              step="0.01"
                              min="0"
                              value={bookingForm.expectedTotal}
                              onChange={(e) => setBookingForm((s) => ({ ...s, expectedTotal: e.target.value, expectedTotalChanged: true }))}
                              readOnly={Boolean(pricingQuote)}
                            />
                            {bookingFieldError("expectedTotal", "booking-field-18")}
                          </div>
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="booking-field-26">Note economiche</Label>
                          <Input id="booking-field-26"
                            value={bookingForm.pricingNotes}
                            onChange={(e) => setBookingForm((s) => ({ ...s, pricingNotes: e.target.value,
                              pricingSnapshotChanged: { ...s.pricingSnapshotChanged, notes: true } }))}
                            placeholder="Annotazioni economiche (sconti manuali, accordi, ecc.)"
                          />
                        </div>
                        <div className="booking-editor-quote">
                          <div className="rounded-lg border bg-muted/20 p-3">
                            <div className="flex items-center justify-between">
                              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                                {bookingForm.mode === "edit" && !bookingForm.pricingTermsChanged ? "Condizioni economiche salvate" : "Preventivo aggiornato"}
                              </p>
                              {pricingLoading ? <FleetumInlineLoader label="Calcolo" /> : null}
                            </div>
                            {!pricingQuote ? (
                              <p className="mt-2 text-xs text-muted-foreground">
                                {bookingForm.mode === "edit" && !bookingForm.pricingTermsChanged
                                  ? "Le modifiche operative mantengono i prezzi concordati. Per applicare il listino corrente, scegli Modifica condizioni economiche."
                                  : "Seleziona listino/pacchetto e inserisci date per vedere il totale previsto e il consuntivo km extra."}
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
                                  <p className="text-base font-semibold text-foreground">{pricingQuote.pricing.expectedTotal.toFixed(2)} €</p>
                                </div>
                                <div className="rounded-md border bg-background/80 p-2">
                                  <p className="text-[11px] text-muted-foreground">Totale finale (se km reali)</p>
                                  <p className="text-base font-semibold">{pricingQuote.pricing.finalTotal.toFixed(2)} €</p>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </fieldset>
                      <fieldset className="booking-editor-section">
                        <legend><span aria-hidden="true">04</span> Note e contratto</legend>
                        <div className="space-y-1">
                          <Label htmlFor="booking-field-25">Motivo noleggio</Label>
                          <Input id="booking-field-25"
                            value={bookingForm.reason}
                            onChange={(e) => setBookingForm((s) => ({ ...s, reason: e.target.value }))}
                            placeholder="Es. sostitutiva, lungo termine..."
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="booking-field-27">Note interne</Label>
                          <Textarea id="booking-field-27"
                            rows={3}
                            value={bookingForm.internalNotes}
                            onChange={(e) => setBookingForm((s) => ({ ...s, internalNotes: e.target.value }))}
                          />
                        </div>
                        <div className="booking-editor-options">
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
                      </fieldset>
                    </div>
                    <aside className="booking-editor-summary" aria-label="Riepilogo prenotazione">
                      <h3>Riepilogo prenotazione</h3>
                      <dl>
                        <div><dt>Cliente</dt><dd translate={bookingForm.customerId ? "no" : "yes"}>{bookingForm.customerId ? customerInput : "Da selezionare"}</dd></div>
                        <div><dt>Veicolo</dt><dd translate={bookingForm.vehicleId ? "no" : "yes"}>{bookingForm.vehicleId ? vehicleInput : "Da selezionare"}</dd></div>
                        <div><dt>Uscita</dt><dd>{formatBookingDate(bookingForm.pickupAt)}</dd></div>
                        <div><dt>Rientro</dt><dd>{formatBookingDate(bookingForm.returnAt)}</dd></div>
                        <div className="booking-editor-summary-total"><dt>Totale previsto</dt><dd>{bookingForm.expectedTotal !== "" && Number.isFinite(Number(bookingForm.expectedTotal)) ? new Intl.NumberFormat(language === "en" ? "en-GB" : "it-IT", { style: "currency", currency: "EUR" }).format(Number(bookingForm.expectedTotal)) : "Da definire"}</dd></div>
                      </dl>
                      <p>{bookingForm.mode === "edit" && !bookingForm.pricingTermsChanged ? "Le modifiche operative mantengono i prezzi concordati." : "Il totale previsto segue le condizioni economiche selezionate."}</p>
                    </aside>
                  </div>
                  <footer className="booking-editor-footer">
                    <span>Controlla i dati prima di salvare.</span>
                    <div>
                      <Button type="button" variant="outline" onClick={requestCloseBookingModal} disabled={saving}>Annulla</Button>
                      <Button type="submit" disabled={saving}>{saving ? "Salvataggio..." : "Salva prenotazione"}</Button>
                    </div>
                  </footer>
                </form>
              </CardContent>
            </Card>
          </div>
          {bookingCloseConfirmOpen ? (
            <>
              <div
                className="fixed inset-0 z-[112] cursor-pointer bg-black/25 backdrop-blur-[2px]"
                onClick={() => setBookingCloseConfirmOpen(false)}
                aria-hidden="true"
              />
              <div ref={closeDialogRef} role="dialog" aria-modal="true" aria-label="Modifiche non salvate" tabIndex={-1} className="fixed inset-0 z-[113] flex items-center justify-center p-4">
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
            onClick={requestCloseCustomer}
          />
          <div ref={customerDialogRef} role="dialog" aria-modal="true" aria-label="Anagrafica cliente" tabIndex={-1} className="fixed inset-0 z-[103] overflow-y-auto p-4">
            <div className="mx-auto flex min-h-full w-full max-w-5xl items-start py-4">
            <Card className="w-full saas-surface">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  {customerForm.mode === "create" ? "Nuova anagrafica cliente" : "Modifica anagrafica cliente"}
                </CardTitle>
              </CardHeader>
              <CardContent className="pr-2">
                <form className="space-y-3" onSubmit={onCustomerSubmit} onChangeCapture={() => setCustomerFormDirty(true)}>
                  {error ? <CommerceNotice>{error}</CommerceNotice> : null}
                  {success ? <CommerceNotice tone="success">{success}</CommerceNotice> : null}
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
                      <Label htmlFor="booking-field-28">Tipo intestatario</Label>
                      <Select id="booking-field-28"
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
                          <Label htmlFor="booking-field-29">Ragione sociale *</Label>
                          <Input id="booking-field-29"
                            value={customerForm.companyName}
                            onChange={(e) => setCustomerForm((s) => ({ ...s, companyName: e.target.value }))}
                            required
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="booking-field-30">Forma giuridica</Label>
                          <Input id="booking-field-30"
                            value={customerForm.companyLegalForm}
                            onChange={(e) => setCustomerForm((s) => ({ ...s, companyLegalForm: e.target.value }))}
                            placeholder="Es. SRL, SPA, SNC"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="booking-field-31">Partita IVA *</Label>
                          <Input id="booking-field-31"
                            value={customerForm.companyVatNumber}
                            onChange={(e) => setCustomerForm((s) => ({ ...s, companyVatNumber: e.target.value }))}
                            required
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="booking-field-32">Codice fiscale società</Label>
                          <Input id="booking-field-32"
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
                          <Label htmlFor="booking-field-33">Email</Label>
                          <Input id="booking-field-33"
                            type="email"
                            value={customerForm.email}
                            onChange={(e) => setCustomerForm((s) => ({ ...s, email: e.target.value }))}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="booking-field-34">Telefono</Label>
                          <Input id="booking-field-34" value={customerForm.phone} onChange={(e) => setCustomerForm((s) => ({ ...s, phone: e.target.value }))} />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="booking-field-35">PEC</Label>
                          <Input id="booking-field-35"
                            type="email"
                            value={customerForm.companyPec}
                            onChange={(e) => setCustomerForm((s) => ({ ...s, companyPec: e.target.value }))}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="booking-field-36">Codice SDI</Label>
                          <Input id="booking-field-36"
                            value={customerForm.companySdi}
                            onChange={(e) => setCustomerForm((s) => ({ ...s, companySdi: e.target.value.toUpperCase() }))}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="booking-field-37">REA</Label>
                          <Input id="booking-field-37"
                            value={customerForm.companyRea}
                            onChange={(e) => setCustomerForm((s) => ({ ...s, companyRea: e.target.value }))}
                          />
                        </div>
                        <div className="space-y-1"><Label htmlFor="booking-field-38">Nome legale rappresentante</Label><Input id="booking-field-38" value={customerForm.legalRepFirstName} onChange={(e) => setCustomerForm((s) => ({ ...s, legalRepFirstName: e.target.value }))} /></div>
                        <div className="space-y-1"><Label htmlFor="booking-field-39">Cognome legale rappresentante</Label><Input id="booking-field-39" value={customerForm.legalRepLastName} onChange={(e) => setCustomerForm((s) => ({ ...s, legalRepLastName: e.target.value }))} /></div>
                        <div className="space-y-1"><Label htmlFor="booking-field-40">CF legale rappresentante</Label><Input id="booking-field-40" value={customerForm.legalRepTaxCode} onChange={(e) => setCustomerForm((s) => ({ ...s, legalRepTaxCode: e.target.value }))} /></div>
                        <div className="space-y-1"><Label htmlFor="booking-field-41">Ruolo legale rappresentante</Label><Input id="booking-field-41" value={customerForm.legalRepRole} onChange={(e) => setCustomerForm((s) => ({ ...s, legalRepRole: e.target.value }))} /></div>
                        <div className="space-y-1"><Label htmlFor="booking-field-42">Email legale rappresentante</Label><Input id="booking-field-42" type="email" value={customerForm.legalRepEmail} onChange={(e) => setCustomerForm((s) => ({ ...s, legalRepEmail: e.target.value }))} /></div>
                        <div className="space-y-1"><Label htmlFor="booking-field-43">Telefono legale rappresentante</Label><Input id="booking-field-43" value={customerForm.legalRepPhone} onChange={(e) => setCustomerForm((s) => ({ ...s, legalRepPhone: e.target.value }))} /></div>
                      </>
                    ) : (
                      <>
                        <div className="space-y-1"><Label htmlFor="booking-field-44">Nome</Label><Input id="booking-field-44" value={customerForm.firstName} onChange={(e) => setCustomerForm((s) => ({ ...s, firstName: e.target.value }))} required /></div>
                        <div className="space-y-1"><Label htmlFor="booking-field-45">Cognome</Label><Input id="booking-field-45" value={customerForm.lastName} onChange={(e) => setCustomerForm((s) => ({ ...s, lastName: e.target.value }))} required /></div>
                        <div className="space-y-1"><Label htmlFor="booking-field-46">Patente numero *</Label><Input id="booking-field-46" value={customerForm.drivingLicenseNumber} onChange={(e) => setCustomerForm((s) => ({ ...s, drivingLicenseNumber: e.target.value }))} required /></div>
                        <div className="space-y-1"><Label htmlFor="booking-field-47">Categoria patente</Label><Input id="booking-field-47" value={customerForm.drivingLicenseCategory} onChange={(e) => setCustomerForm((s) => ({ ...s, drivingLicenseCategory: e.target.value }))} placeholder="Es. B, C, C1E" /></div>
                        <div className="space-y-1"><Label htmlFor="booking-field-48">Rilascio patente</Label><Input id="booking-field-48" type="date" value={customerForm.drivingLicenseIssuedAt} onChange={(e) => setCustomerForm((s) => ({ ...s, drivingLicenseIssuedAt: e.target.value }))} /></div>
                        <div className="space-y-1"><Label htmlFor="booking-field-49">Scadenza patente</Label><Input id="booking-field-49" type="date" value={customerForm.drivingLicenseExpiresAt} onChange={(e) => setCustomerForm((s) => ({ ...s, drivingLicenseExpiresAt: e.target.value }))} /></div>
                        <div className="space-y-1 md:col-span-2"><Label htmlFor="booking-field-50">Autorità patente</Label><Input id="booking-field-50" value={customerForm.drivingLicenseAuthority} onChange={(e) => setCustomerForm((s) => ({ ...s, drivingLicenseAuthority: e.target.value }))} /></div>
                        <div className="space-y-1"><Label htmlFor="booking-field-51">Email</Label><Input id="booking-field-51" type="email" value={customerForm.email} onChange={(e) => setCustomerForm((s) => ({ ...s, email: e.target.value }))} /></div>
                        <div className="space-y-1"><Label htmlFor="booking-field-52">Telefono</Label><Input id="booking-field-52" value={customerForm.phone} onChange={(e) => setCustomerForm((s) => ({ ...s, phone: e.target.value }))} /></div>
                        <div className="space-y-1"><Label htmlFor="booking-field-53">Data nascita</Label><Input id="booking-field-53" type="date" value={customerForm.dateOfBirth} onChange={(e) => setCustomerForm((s) => ({ ...s, dateOfBirth: e.target.value }))} /></div>
                        <div className="space-y-1"><Label htmlFor="booking-field-54">Luogo nascita</Label><Input id="booking-field-54" value={customerForm.placeOfBirth} onChange={(e) => setCustomerForm((s) => ({ ...s, placeOfBirth: e.target.value }))} /></div>
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
                        <div className="space-y-1"><Label htmlFor="booking-field-55">Codice fiscale</Label><Input id="booking-field-55" value={customerForm.taxCode} onChange={(e) => setCustomerForm((s) => ({ ...s, taxCode: e.target.value }))} /></div>
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
                        <div className="space-y-1"><Label htmlFor="booking-field-56">Documento tipo</Label><Input id="booking-field-56" value={customerForm.documentType} onChange={(e) => setCustomerForm((s) => ({ ...s, documentType: e.target.value }))} /></div>
                        <div className="space-y-1"><Label htmlFor="booking-field-57">Documento numero</Label><Input id="booking-field-57" value={customerForm.documentNumber} onChange={(e) => setCustomerForm((s) => ({ ...s, documentNumber: e.target.value }))} /></div>
                        <div className="space-y-1"><Label htmlFor="booking-field-58">Rilascio documento</Label><Input id="booking-field-58" type="date" value={customerForm.documentIssuedAt} onChange={(e) => setCustomerForm((s) => ({ ...s, documentIssuedAt: e.target.value }))} /></div>
                        <div className="space-y-1"><Label htmlFor="booking-field-59">Scadenza documento</Label><Input id="booking-field-59" type="date" value={customerForm.documentExpiresAt} onChange={(e) => setCustomerForm((s) => ({ ...s, documentExpiresAt: e.target.value }))} /></div>
                        <div className="space-y-1 md:col-span-2"><Label htmlFor="booking-field-60">Autorità rilascio</Label><Input id="booking-field-60" value={customerForm.documentAuthority} onChange={(e) => setCustomerForm((s) => ({ ...s, documentAuthority: e.target.value }))} /></div>
                      </>
                    )}

                    <div className="space-y-1 md:col-span-4"><Label htmlFor="booking-field-61">Note</Label><Textarea id="booking-field-61" rows={3} value={customerForm.notes} onChange={(e) => setCustomerForm((s) => ({ ...s, notes: e.target.value }))} /></div>
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={saving}
                      onClick={requestCloseCustomer}
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

      {cargosPromptBookingId&&!bookingModalOpen&&!saving?<ContractCargosDialog bookingId={cargosPromptBookingId} onClose={()=>setCargosPromptBookingId(null)} onUpdated={()=>setRefreshKey(value=>value+1)}/>:null}
      {templateModalOpen?<CommerceDrawer title="Modello contratto aziendale" description="Intestazione, clausole ed email del documento." onClose={requestCloseTemplate} motionRef={templateMotion} busy={templateSaving||templateLogoUploading} level={105} footer={<><Button variant="outline" disabled={templateSaving||templateLogoUploading} onClick={requestCloseTemplate}>Chiudi</Button><Button variant="outline" onClick={()=>void runPreviewTemplate()} disabled={templateLoading||!templateLoaded||!selectedBooking||templateSaving||templateLogoUploading}>Anteprima compilata</Button><Button onClick={()=>void runSaveTemplate()} disabled={templateLoading||!templateLoaded||templateSaving||templateLogoUploading}>{templateSaving?'Salvataggio...':'Salva template'}</Button></>}>
       {error?<CommerceNotice>{error}</CommerceNotice>:null}{templateLoading?<p role="status">Caricamento modello...</p>:null}{!templateLoading&&!templateLoaded?<Button variant="outline" onClick={()=>void openTemplateModal()}>Riprova caricamento modello</Button>:null}
       <ContractTemplateEditor value={templateEditor} onChange={patch=>{setTemplateEditor(current=>({...current,...patch}));setTemplateDirty(true)}} busy={templateLoading||!templateLoaded||templateSaving||templateLogoUploading} logoUrl={templateLogoPreviewUrl} logoName={templateLogoFileName} onUpload={file=>void uploadTemplateLogo(file)} onRemove={()=>void removeTemplateLogo()} preview={templatePreview}/>
      </CommerceDrawer>:null}
      {templateDiscardOpen?<CommerceDrawer compact level={135} title="Modifiche non salvate" onClose={()=>setTemplateDiscardOpen(false)} footer={<><Button variant="outline" onClick={()=>setTemplateDiscardOpen(false)}>Continua modifica</Button><Button onClick={closeTemplateNow}>Esci senza salvare</Button></>}><p>Le modifiche al testo del modello non sono state salvate. Il logo eventualmente caricato resta salvato.</p></CommerceDrawer>:null}
    </section>
  );
};
