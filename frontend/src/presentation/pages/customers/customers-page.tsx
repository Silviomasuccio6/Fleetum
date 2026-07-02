import { FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  BookingContractStatus,
  RentalCustomer,
  RentalCustomerType,
  RentalCustomerContractTimelineItem,
  RentalCustomerProfile,
  RentalCustomerRegistryItem,
  rentalBookingsUseCases
} from "../../../application/usecases/rental-bookings-usecases";
import { FleetumInlineLoader } from "../../components/brand/fleetum-logo-loader";
import { PageHeader } from "../../components/layout/page-header";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Select } from "../../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { Textarea } from "../../components/ui/textarea";
import { CustomerContractsTimeline } from "../../components/customers/customer-contracts-timeline";
import { CustomerDocumentsPanel } from "../../components/customers/customer-documents-panel";
import {
  CountrySelect,
  CustomerAddressFields,
  StructuredAddressValue,
  countryNameFromCode
} from "../../components/customers/customer-geography-fields";

type CustomerFormState = {
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

const PAGE_SIZE = 20;
const TIMELINE_PAGE_SIZE = 10;

const toDateInput = (value?: string | Date | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
};

const defaultCustomerForm = (): CustomerFormState => ({
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

const toForm = (customer: RentalCustomerProfile): CustomerFormState => ({
  customerType: (customer.customerType as RentalCustomerType) || "PERSONA_FISICA",
  firstName: customer.firstName ?? "",
  lastName: customer.lastName ?? "",
  drivingLicenseNumber: customer.drivingLicenseNumber ?? "",
  drivingLicenseIssuedAt: toDateInput(customer.drivingLicenseIssuedAt),
  drivingLicenseExpiresAt: toDateInput(customer.drivingLicenseExpiresAt),
  drivingLicenseAuthority: customer.drivingLicenseAuthority ?? "",
  drivingLicenseCategory: customer.drivingLicenseCategory ?? "",
  email: customer.email ?? "",
  phone: customer.phone ?? "",
  dateOfBirth: toDateInput(customer.dateOfBirth),
  placeOfBirth: customer.placeOfBirth ?? "",
  birthCountry: customer.birthCountry ?? "IT",
  birthProvince: customer.birthProvince ?? "",
  birthMunicipalityCode: customer.birthMunicipalityCode ?? "",
  birthCity: customer.birthCity ?? "",
  nationality: customer.nationality ?? countryNameFromCode(customer.nationalityCountry),
  nationalityCountry: customer.nationalityCountry ?? "IT",
  residenceAddress: customer.residenceAddress ?? "",
  residenceCountry: customer.residenceCountry ?? "IT",
  residenceRegion: customer.residenceRegion ?? "",
  residenceProvince: customer.residenceProvince ?? "",
  residenceMunicipalityCode: customer.residenceMunicipalityCode ?? "",
  residenceCity: customer.residenceCity ?? "",
  residencePostalCode: customer.residencePostalCode ?? "",
  residenceStreetAddress: customer.residenceStreetAddress ?? customer.residenceAddress ?? "",
  taxCode: customer.taxCode ?? "",
  documentType: customer.documentType ?? "",
  documentNumber: customer.documentNumber ?? "",
  documentIssuedAt: toDateInput(customer.documentIssuedAt),
  documentExpiresAt: toDateInput(customer.documentExpiresAt),
  documentAuthority: customer.documentAuthority ?? "",
  companyName: customer.companyName ?? "",
  companyLegalForm: customer.companyLegalForm ?? "",
  companyVatNumber: customer.companyVatNumber ?? "",
  companyTaxCode: customer.companyTaxCode ?? "",
  companyLegalAddress: customer.companyLegalAddress ?? "",
  companyCountry: customer.companyCountry ?? "IT",
  companyRegion: customer.companyRegion ?? "",
  companyProvince: customer.companyProvince ?? "",
  companyMunicipalityCode: customer.companyMunicipalityCode ?? "",
  companyCity: customer.companyCity ?? "",
  companyPostalCode: customer.companyPostalCode ?? "",
  companyStreetAddress: customer.companyStreetAddress ?? customer.companyLegalAddress ?? "",
  companyPec: customer.companyPec ?? "",
  companySdi: customer.companySdi ?? "",
  companyRea: customer.companyRea ?? "",
  legalRepFirstName: customer.legalRepFirstName ?? "",
  legalRepLastName: customer.legalRepLastName ?? "",
  legalRepTaxCode: customer.legalRepTaxCode ?? "",
  legalRepRole: customer.legalRepRole ?? "",
  legalRepEmail: customer.legalRepEmail ?? "",
  legalRepPhone: customer.legalRepPhone ?? "",
  notes: customer.notes ?? ""
});

const residenceAddressValueFromForm = (form: CustomerFormState): StructuredAddressValue => ({
  country: form.residenceCountry,
  region: form.residenceRegion,
  province: form.residenceProvince,
  municipalityCode: form.residenceMunicipalityCode,
  city: form.residenceCity,
  postalCode: form.residencePostalCode,
  streetAddress: form.residenceStreetAddress
});

const companyAddressValueFromForm = (form: CustomerFormState): StructuredAddressValue => ({
  country: form.companyCountry,
  region: form.companyRegion,
  province: form.companyProvince,
  municipalityCode: form.companyMunicipalityCode,
  city: form.companyCity,
  postalCode: form.companyPostalCode,
  streetAddress: form.companyStreetAddress
});

const customerDisplayName = (customer?: { customerType?: string | null; firstName?: string | null; lastName?: string | null; companyName?: string | null } | null) => {
  if (!customer) return "-";
  if (customer.customerType === "PERSONA_GIURIDICA") {
    return customer.companyName?.trim() || `${customer.firstName || ""} ${customer.lastName || ""}`.trim() || "Societa";
  }
  return `${customer.firstName || ""} ${customer.lastName || ""}`.trim() || customer.companyName?.trim() || "Cliente";
};

const bookingStatusLabel: Record<string, string> = {
  DRAFT: "Bozza",
  QUOTED: "Preventivo",
  HOLD: "Opzione",
  CONFIRMED: "Confermata",
  CONTRACT_SIGNED: "Firmato",
  READY_FOR_HANDOVER: "Consegna",
  IN_RENT: "In noleggio",
  CLOSED: "Chiusa",
  CANCELED: "Annullata",
  NO_SHOW: "No-show"
};

const contractStatusLabel: Record<string, string> = {
  NOT_READY: "Da preparare",
  READY: "Pronto",
  SIGNED: "Firmato",
  DRAFT: "Bozza",
  SENT: "Inviato",
  ERROR: "Errore"
};

export const CustomersPage = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [customerTypeFilter, setCustomerTypeFilter] = useState<"" | RentalCustomerType>("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<RentalCustomerRegistryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(searchParams.get("customerId"));
  const [selectedCustomer, setSelectedCustomer] = useState<RentalCustomerProfile | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailSaving, setDetailSaving] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [form, setForm] = useState<CustomerFormState>(() => defaultCustomerForm());

  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [scanFiles, setScanFiles] = useState<File[]>([]);
  const [scanRunning, setScanRunning] = useState(false);
  const [scanInfo, setScanInfo] = useState<string | null>(null);

  const [timelineItems, setTimelineItems] = useState<RentalCustomerContractTimelineItem[]>([]);
  const [timelinePage, setTimelinePage] = useState(1);
  const [timelineTotal, setTimelineTotal] = useState(0);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [timelinePeriod, setTimelinePeriod] = useState<"all" | "7d" | "30d" | "90d" | "custom">("all");
  const [timelineStatus, setTimelineStatus] = useState<"" | BookingContractStatus>("");
  const [timelineDateFrom, setTimelineDateFrom] = useState("");
  const [timelineDateTo, setTimelineDateTo] = useState("");

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total]);
  const timelinePages = useMemo(() => Math.max(1, Math.ceil(timelineTotal / TIMELINE_PAGE_SIZE)), [timelineTotal]);

  const loadCustomers = async (targetPage: number, targetSearch: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await rentalBookingsUseCases.listCustomerRegistry({
        page: targetPage,
        pageSize: PAGE_SIZE,
        search: targetSearch || undefined,
        customerType: customerTypeFilter || undefined
      });
      setRows(response.data ?? []);
      setTotal(response.total ?? 0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const loadCustomerProfile = async (customerId: string) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const profile = await rentalBookingsUseCases.getCustomerProfile(customerId);
      setSelectedCustomer(profile);
      setForm(toForm(profile));
    } catch (e) {
      setDetailError((e as Error).message);
    } finally {
      setDetailLoading(false);
    }
  };

  const loadTimeline = async (customerId: string, targetPage: number) => {
    setTimelineLoading(true);
    setTimelineError(null);
    try {
      const response = await rentalBookingsUseCases.listCustomerContracts(customerId, {
        page: targetPage,
        pageSize: TIMELINE_PAGE_SIZE,
        period: timelinePeriod,
        status: timelineStatus || undefined,
        dateFrom: timelinePeriod === "custom" && timelineDateFrom ? new Date(`${timelineDateFrom}T00:00:00`).toISOString() : undefined,
        dateTo: timelinePeriod === "custom" && timelineDateTo ? new Date(`${timelineDateTo}T23:59:59`).toISOString() : undefined
      });
      setTimelineItems(response.data ?? []);
      setTimelineTotal(response.total ?? 0);
    } catch (e) {
      setTimelineError((e as Error).message);
    } finally {
      setTimelineLoading(false);
    }
  };

  const reloadSelected = async () => {
    if (!selectedCustomerId) return;
    await Promise.all([loadCustomerProfile(selectedCustomerId), loadTimeline(selectedCustomerId, timelinePage)]);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1);
      setSearch(searchInput.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    void loadCustomers(page, search);
  }, [page, search, customerTypeFilter]);

  useEffect(() => {
    const fromQuery = searchParams.get("customerId");
    if (fromQuery && fromQuery !== selectedCustomerId) {
      setSelectedCustomerId(fromQuery);
    }
  }, [searchParams, selectedCustomerId]);

  useEffect(() => {
    if (!selectedCustomerId) {
      setSelectedCustomer(null);
      setForm(defaultCustomerForm());
      setTimelineItems([]);
      return;
    }
    setTimelinePage(1);
    void Promise.all([loadCustomerProfile(selectedCustomerId), loadTimeline(selectedCustomerId, 1)]);
  }, [selectedCustomerId]);

  useEffect(() => {
    if (!selectedCustomerId) return;
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePanel();
    };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [selectedCustomerId]);

  useEffect(() => {
    if (!selectedCustomerId) return;
    void loadTimeline(selectedCustomerId, timelinePage);
  }, [timelinePage]);

  const openCustomer = (customerId: string) => {
    setSelectedCustomerId(customerId);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("customerId", customerId);
      return next;
    });
  };

  const closePanel = () => {
    setSelectedCustomerId(null);
    setSelectedCustomer(null);
    setForm(defaultCustomerForm());
    setUploadFiles([]);
    setScanFiles([]);
    setScanInfo(null);
    setDetailError(null);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("customerId");
      return next;
    });
  };

  const saveCustomerProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedCustomer?.id || detailSaving) return;
    setDetailSaving(true);
    setDetailError(null);
    setSuccess(null);
    try {
      const payload: Partial<RentalCustomer> = {
        customerType: form.customerType,
        firstName: form.firstName.trim() || undefined,
        lastName: form.lastName.trim() || undefined,
        drivingLicenseNumber: form.drivingLicenseNumber.trim().toUpperCase() || undefined,
        drivingLicenseIssuedAt: form.drivingLicenseIssuedAt ? new Date(`${form.drivingLicenseIssuedAt}T00:00:00`).toISOString() : undefined,
        drivingLicenseExpiresAt: form.drivingLicenseExpiresAt ? new Date(`${form.drivingLicenseExpiresAt}T00:00:00`).toISOString() : undefined,
        drivingLicenseAuthority: form.drivingLicenseAuthority.trim() || undefined,
        drivingLicenseCategory: form.drivingLicenseCategory.trim() || undefined,
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        dateOfBirth: form.dateOfBirth ? new Date(`${form.dateOfBirth}T00:00:00`).toISOString() : undefined,
        placeOfBirth: form.placeOfBirth.trim() || undefined,
        birthCountry: form.birthCountry || undefined,
        birthProvince: form.birthProvince.trim().toUpperCase() || undefined,
        birthMunicipalityCode: form.birthMunicipalityCode.trim() || undefined,
        birthCity: form.birthCity.trim() || undefined,
        nationality: form.nationality.trim() || undefined,
        nationalityCountry: form.nationalityCountry || undefined,
        residenceAddress: form.residenceAddress.trim() || undefined,
        residenceCountry: form.residenceCountry || undefined,
        residenceRegion: form.residenceRegion.trim() || undefined,
        residenceProvince: form.residenceProvince.trim().toUpperCase() || undefined,
        residenceMunicipalityCode: form.residenceMunicipalityCode.trim() || undefined,
        residenceCity: form.residenceCity.trim() || undefined,
        residencePostalCode: form.residencePostalCode.trim() || undefined,
        residenceStreetAddress: form.residenceStreetAddress.trim() || undefined,
        taxCode: form.taxCode.trim() || undefined,
        documentType: form.documentType.trim() || undefined,
        documentNumber: form.documentNumber.trim() || undefined,
        documentIssuedAt: form.documentIssuedAt ? new Date(`${form.documentIssuedAt}T00:00:00`).toISOString() : undefined,
        documentExpiresAt: form.documentExpiresAt ? new Date(`${form.documentExpiresAt}T00:00:00`).toISOString() : undefined,
        documentAuthority: form.documentAuthority.trim() || undefined,
        companyName: form.companyName.trim() || undefined,
        companyLegalForm: form.companyLegalForm.trim() || undefined,
        companyVatNumber: form.companyVatNumber.replace(/\s+/g, "") || undefined,
        companyTaxCode: form.companyTaxCode.trim() || undefined,
        companyLegalAddress: form.companyLegalAddress.trim() || undefined,
        companyCountry: form.companyCountry || undefined,
        companyRegion: form.companyRegion.trim() || undefined,
        companyProvince: form.companyProvince.trim().toUpperCase() || undefined,
        companyMunicipalityCode: form.companyMunicipalityCode.trim() || undefined,
        companyCity: form.companyCity.trim() || undefined,
        companyPostalCode: form.companyPostalCode.trim() || undefined,
        companyStreetAddress: form.companyStreetAddress.trim() || undefined,
        companyPec: form.companyPec.trim() || undefined,
        companySdi: form.companySdi.trim().toUpperCase() || undefined,
        companyRea: form.companyRea.trim() || undefined,
        legalRepFirstName: form.legalRepFirstName.trim() || undefined,
        legalRepLastName: form.legalRepLastName.trim() || undefined,
        legalRepTaxCode: form.legalRepTaxCode.trim() || undefined,
        legalRepRole: form.legalRepRole.trim() || undefined,
        legalRepEmail: form.legalRepEmail.trim() || undefined,
        legalRepPhone: form.legalRepPhone.trim() || undefined,
        notes: form.notes.trim() || undefined
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

      await rentalBookingsUseCases.updateCustomerProfile(selectedCustomer.id, payload);
      setSuccess("Anagrafica cliente aggiornata.");
      await reloadSelected();
      await loadCustomers(page, search);
    } catch (e) {
      setDetailError((e as Error).message);
    } finally {
      setDetailSaving(false);
    }
  };

  const uploadDocuments = async () => {
    if (!selectedCustomer?.id || uploadFiles.length === 0) return;
    setDetailSaving(true);
    setDetailError(null);
    setSuccess(null);
    try {
      await rentalBookingsUseCases.uploadCustomerAttachments(selectedCustomer.id, uploadFiles);
      setUploadFiles([]);
      setSuccess("Documenti cliente caricati.");
      await loadCustomerProfile(selectedCustomer.id);
      await loadCustomers(page, search);
    } catch (e) {
      setDetailError((e as Error).message);
    } finally {
      setDetailSaving(false);
    }
  };

  const openAttachment = async (attachmentId: string) => {
    try {
      const blob = await rentalBookingsUseCases.downloadCustomerAttachment(attachmentId);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 120000);
    } catch (e) {
      setDetailError((e as Error).message);
    }
  };

  const removeAttachment = async (attachmentId: string) => {
    if (!selectedCustomer?.id) return;
    setDetailSaving(true);
    setDetailError(null);
    try {
      await rentalBookingsUseCases.deleteCustomerAttachment(attachmentId);
      await loadCustomerProfile(selectedCustomer.id);
      await loadCustomers(page, search);
      setSuccess("Documento eliminato.");
    } catch (e) {
      setDetailError((e as Error).message);
    } finally {
      setDetailSaving(false);
    }
  };

  const applyScanDraft = (draft: Partial<RentalCustomer>) => {
    setForm((current) => ({
      ...current,
      customerType: (draft.customerType as RentalCustomerType) ?? current.customerType,
      firstName: draft.firstName ?? current.firstName,
      lastName: draft.lastName ?? current.lastName,
      drivingLicenseNumber: draft.drivingLicenseNumber ?? current.drivingLicenseNumber,
      drivingLicenseIssuedAt: toDateInput(draft.drivingLicenseIssuedAt) || current.drivingLicenseIssuedAt,
      drivingLicenseExpiresAt: toDateInput(draft.drivingLicenseExpiresAt) || current.drivingLicenseExpiresAt,
      drivingLicenseAuthority: draft.drivingLicenseAuthority ?? current.drivingLicenseAuthority,
      drivingLicenseCategory: draft.drivingLicenseCategory ?? current.drivingLicenseCategory,
      email: draft.email ?? current.email,
      phone: draft.phone ?? current.phone,
      dateOfBirth: toDateInput(draft.dateOfBirth) || current.dateOfBirth,
      placeOfBirth: draft.placeOfBirth ?? current.placeOfBirth,
      nationality: draft.nationality ?? current.nationality,
      residenceAddress: draft.residenceAddress ?? current.residenceAddress,
      taxCode: draft.taxCode ?? current.taxCode,
      documentType: draft.documentType ?? current.documentType,
      documentNumber: draft.documentNumber ?? current.documentNumber,
      documentIssuedAt: toDateInput(draft.documentIssuedAt) || current.documentIssuedAt,
      documentExpiresAt: toDateInput(draft.documentExpiresAt) || current.documentExpiresAt,
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

  const runScanAutofill = async () => {
    if (scanFiles.length === 0) {
      setDetailError("Seleziona almeno un documento da analizzare.");
      return;
    }
    setScanRunning(true);
    setDetailError(null);
    setSuccess(null);
    setScanInfo(null);
    try {
      const result = await rentalBookingsUseCases.parseCustomerDocumentDraft(scanFiles);
      applyScanDraft(result.fields ?? {});
      const recognized = (result.files ?? [])
        .map((file) => `${file.fileName} → ${file.documentType || "generico"}`)
        .join(" · ");
      setScanInfo(`Analisi completata (${result.score}%)${recognized ? ` · ${recognized}` : ""}`);
      const inferredType = (result.fields?.customerType as RentalCustomerType | undefined) ?? form.customerType;
      if (inferredType !== "PERSONA_GIURIDICA" && !result.fields?.drivingLicenseNumber) {
        setDetailError("Numero patente non rilevato automaticamente. Inseriscilo manualmente.");
      } else {
        setSuccess("Dati precompilati dai documenti.");
      }
    } catch (e) {
      setDetailError((e as Error).message);
    } finally {
      setScanRunning(false);
    }
  };

  const openBookingDetail = (bookingId: string) => {
    navigate(`/booking?bookingId=${bookingId}`);
  };

  const downloadContractPdf = async (bookingId: string) => {
    try {
      const blob = await rentalBookingsUseCases.downloadContractPdf(bookingId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `Contratto_${bookingId}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 120000);
      setSuccess("PDF contratto scaricato.");
    } catch (e) {
      setDetailError((e as Error).message);
    }
  };

  const sendContractEmail = async (bookingId: string) => {
    try {
      await rentalBookingsUseCases.sendContractEmail(bookingId);
      setSuccess("Contratto inviato via email.");
      if (selectedCustomerId) await loadTimeline(selectedCustomerId, timelinePage);
    } catch (e) {
      setDetailError((e as Error).message);
    }
  };

  const markContractSigned = async (bookingId: string) => {
    try {
      await rentalBookingsUseCases.markContractSigned(bookingId);
      setSuccess("Contratto marcato come firmato.");
      if (selectedCustomerId) await loadTimeline(selectedCustomerId, timelinePage);
    } catch (e) {
      setDetailError((e as Error).message);
    }
  };

  return (
    <section className="space-y-3">
      <PageHeader
        title="Anagrafica Clienti"
        subtitle="Gestione clienti centralizzata con storico noleggi e contratti in ordine cronologico."
      />

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {success ? <p className="text-sm text-emerald-700">{success}</p> : null}

      <Card className="saas-surface">
        <CardContent className="space-y-3 py-4">
          <div className="grid gap-2 md:grid-cols-[1fr_220px_auto]">
            <Input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Cerca per nome, ragione sociale, P.IVA, email, telefono..."
            />
            <Select
              value={customerTypeFilter}
              onChange={(event) => {
                setCustomerTypeFilter(event.target.value as "" | RentalCustomerType);
                setPage(1);
              }}
            >
              <option value="">Tutti i tipi</option>
              <option value="PERSONA_FISICA">Persona fisica</option>
              <option value="PERSONA_GIURIDICA">Persona giuridica</option>
            </Select>
            <Button variant="outline" onClick={() => void loadCustomers(page, search)}>
              Aggiorna
            </Button>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Telefono</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Patente</TableHead>
                <TableHead>Documento</TableHead>
                <TableHead>Ultimo noleggio</TableHead>
                <TableHead>Contratti</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center">
                    <FleetumInlineLoader label="Caricamento clienti" />
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-xs text-muted-foreground">
                    Nessun cliente trovato.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <button
                        type="button"
                        className="text-left font-medium transition-colors hover:text-primary hover:underline"
                        onClick={() => openCustomer(row.id)}
                        aria-label={`Apri anagrafica cliente ${customerDisplayName(row)}`}
                      >
                        {customerDisplayName(row)}
                      </button>
                      <p className="text-[11px] text-muted-foreground">Aggiornato: {row.updatedAt ? new Date(row.updatedAt).toLocaleDateString("it-IT") : "-"}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{row.customerType === "PERSONA_GIURIDICA" ? "Societa" : "Persona"}</Badge>
                    </TableCell>
                    <TableCell>{row.phone || "-"}</TableCell>
                    <TableCell>{row.email || "-"}</TableCell>
                    <TableCell>{row.customerType === "PERSONA_GIURIDICA" ? "-" : row.drivingLicenseNumber || "-"}</TableCell>
                    <TableCell>
                      {row.customerType === "PERSONA_GIURIDICA"
                        ? `P.IVA ${row.companyVatNumber || "-"}`
                        : (row.documentType || row.documentNumber)
                          ? `${row.documentType || ""} ${row.documentNumber || ""}`.trim()
                          : "-"}
                    </TableCell>
                    <TableCell>
                      {row.lastRentalAt ? (
                        <div className="space-y-0.5">
                          <p>{new Date(row.lastRentalAt).toLocaleDateString("it-IT")}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {row.lastRentalCode || "-"} · {row.lastRentalStatus ? (bookingStatusLabel[row.lastRentalStatus] ?? row.lastRentalStatus) : "-"}
                          </p>
                        </div>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                    <TableCell>{row.contractsTotal}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Pagina {page} / {totalPages} · Totale clienti: {total}
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((prev) => prev - 1)}>
                Precedente
              </Button>
              <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((prev) => prev + 1)}>
                Successiva
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {selectedCustomerId ? (
        <>
          <div className="fixed inset-0 z-[110] bg-black/55 backdrop-blur-sm" onClick={closePanel} />
          <aside className="fixed right-0 top-0 z-[111] h-screen w-full max-w-[920px] overflow-y-auto border-l bg-background p-4 shadow-2xl">
            <div className="sticky top-0 z-10 -mx-4 mb-3 border-b bg-background px-4 pb-3 pt-1">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Anagrafica Cliente</p>
                  <h2 className="text-lg font-semibold">
                    {selectedCustomer ? customerDisplayName(selectedCustomer) : "Dettaglio cliente"}
                  </h2>
                </div>
                <Button variant="outline" onClick={closePanel} aria-label="Chiudi pannello cliente">
                  Chiudi
                </Button>
              </div>
            </div>

            {detailLoading ? <FleetumInlineLoader label="Caricamento profilo cliente" /> : null}
            {detailError ? <p className="mb-2 text-sm text-destructive">{detailError}</p> : null}

            <div className="space-y-3">
              <Card className="saas-surface">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Dati Cliente</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="rounded-lg border bg-muted/15 p-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                      OCR / Precompilazione documenti
                    </p>
                    <div className="mt-2 grid gap-2 md:grid-cols-[1fr_auto]">
                      <Input
                        type="file"
                        multiple
                        accept=".pdf,.jpg,.jpeg,.png,.webp"
                        onChange={(event) => setScanFiles(Array.from(event.target.files ?? []))}
                      />
                      <Button type="button" variant="outline" disabled={scanFiles.length === 0 || scanRunning} onClick={() => void runScanAutofill()}>
                        {scanRunning ? "Analisi..." : "Analizza documenti"}
                      </Button>
                    </div>
                    {scanFiles.length > 0 ? (
                      <p className="mt-2 text-xs text-muted-foreground">File: {scanFiles.map((file) => file.name).join(", ")}</p>
                    ) : null}
                    {scanInfo ? <p className="mt-1 text-xs text-muted-foreground">{scanInfo}</p> : null}
                  </div>

                  <form className="space-y-3" onSubmit={saveCustomerProfile}>
                    <div className="grid gap-3 md:grid-cols-4">
                      <div className="space-y-1 md:col-span-2">
                        <Label>Tipo intestatario</Label>
                        <Select
                          value={form.customerType}
                          onChange={(event) =>
                            setForm((state) => ({ ...state, customerType: event.target.value as RentalCustomerType }))
                          }
                        >
                          <option value="PERSONA_FISICA">Persona fisica</option>
                          <option value="PERSONA_GIURIDICA">Persona giuridica</option>
                        </Select>
                      </div>

                      {form.customerType === "PERSONA_GIURIDICA" ? (
                        <>
                          <div className="space-y-1 md:col-span-2"><Label>Ragione sociale *</Label><Input value={form.companyName} onChange={(event) => setForm((state) => ({ ...state, companyName: event.target.value }))} required /></div>
                          <div className="space-y-1"><Label>Forma giuridica</Label><Input value={form.companyLegalForm} onChange={(event) => setForm((state) => ({ ...state, companyLegalForm: event.target.value }))} /></div>
                          <div className="space-y-1"><Label>Partita IVA *</Label><Input value={form.companyVatNumber} onChange={(event) => setForm((state) => ({ ...state, companyVatNumber: event.target.value }))} required /></div>
                          <div className="space-y-1"><Label>CF società</Label><Input value={form.companyTaxCode} onChange={(event) => setForm((state) => ({ ...state, companyTaxCode: event.target.value }))} /></div>
                          <CustomerAddressFields
                            idPrefix="customer-company-address"
                            title="Sede legale"
                            streetLabel="Via e numero civico"
                            value={companyAddressValueFromForm(form)}
                            onChange={(address) =>
                              setForm((state) => ({
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
                          <div className="space-y-1"><Label>Email</Label><Input type="email" value={form.email} onChange={(event) => setForm((state) => ({ ...state, email: event.target.value }))} /></div>
                          <div className="space-y-1"><Label>Telefono</Label><Input value={form.phone} onChange={(event) => setForm((state) => ({ ...state, phone: event.target.value }))} /></div>
                          <div className="space-y-1"><Label>PEC</Label><Input type="email" value={form.companyPec} onChange={(event) => setForm((state) => ({ ...state, companyPec: event.target.value }))} /></div>
                          <div className="space-y-1"><Label>Codice SDI</Label><Input value={form.companySdi} onChange={(event) => setForm((state) => ({ ...state, companySdi: event.target.value.toUpperCase() }))} /></div>
                          <div className="space-y-1"><Label>REA</Label><Input value={form.companyRea} onChange={(event) => setForm((state) => ({ ...state, companyRea: event.target.value }))} /></div>
                          <div className="space-y-1"><Label>Nome legale rappr.</Label><Input value={form.legalRepFirstName} onChange={(event) => setForm((state) => ({ ...state, legalRepFirstName: event.target.value }))} /></div>
                          <div className="space-y-1"><Label>Cognome legale rappr.</Label><Input value={form.legalRepLastName} onChange={(event) => setForm((state) => ({ ...state, legalRepLastName: event.target.value }))} /></div>
                          <div className="space-y-1"><Label>CF legale rappr.</Label><Input value={form.legalRepTaxCode} onChange={(event) => setForm((state) => ({ ...state, legalRepTaxCode: event.target.value }))} /></div>
                          <div className="space-y-1"><Label>Ruolo</Label><Input value={form.legalRepRole} onChange={(event) => setForm((state) => ({ ...state, legalRepRole: event.target.value }))} /></div>
                          <div className="space-y-1"><Label>Email legale rappr.</Label><Input type="email" value={form.legalRepEmail} onChange={(event) => setForm((state) => ({ ...state, legalRepEmail: event.target.value }))} /></div>
                          <div className="space-y-1"><Label>Telefono legale rappr.</Label><Input value={form.legalRepPhone} onChange={(event) => setForm((state) => ({ ...state, legalRepPhone: event.target.value }))} /></div>
                        </>
                      ) : (
                        <>
                          <div className="space-y-1"><Label>Nome</Label><Input value={form.firstName} onChange={(event) => setForm((state) => ({ ...state, firstName: event.target.value }))} required /></div>
                          <div className="space-y-1"><Label>Cognome</Label><Input value={form.lastName} onChange={(event) => setForm((state) => ({ ...state, lastName: event.target.value }))} required /></div>
                          <div className="space-y-1"><Label>Patente *</Label><Input value={form.drivingLicenseNumber} onChange={(event) => setForm((state) => ({ ...state, drivingLicenseNumber: event.target.value }))} required /></div>
                          <div className="space-y-1"><Label>Categoria patente</Label><Input value={form.drivingLicenseCategory} onChange={(event) => setForm((state) => ({ ...state, drivingLicenseCategory: event.target.value }))} /></div>
                          <div className="space-y-1"><Label>Rilascio patente</Label><Input type="date" value={form.drivingLicenseIssuedAt} onChange={(event) => setForm((state) => ({ ...state, drivingLicenseIssuedAt: event.target.value }))} /></div>
                          <div className="space-y-1"><Label>Scadenza patente</Label><Input type="date" value={form.drivingLicenseExpiresAt} onChange={(event) => setForm((state) => ({ ...state, drivingLicenseExpiresAt: event.target.value }))} /></div>
                          <div className="space-y-1 md:col-span-2"><Label>Autorità patente</Label><Input value={form.drivingLicenseAuthority} onChange={(event) => setForm((state) => ({ ...state, drivingLicenseAuthority: event.target.value }))} /></div>
                          <div className="space-y-1"><Label>Email</Label><Input type="email" value={form.email} onChange={(event) => setForm((state) => ({ ...state, email: event.target.value }))} /></div>
                          <div className="space-y-1"><Label>Telefono</Label><Input value={form.phone} onChange={(event) => setForm((state) => ({ ...state, phone: event.target.value }))} /></div>
                          <div className="space-y-1"><Label>Data nascita</Label><Input type="date" value={form.dateOfBirth} onChange={(event) => setForm((state) => ({ ...state, dateOfBirth: event.target.value }))} /></div>
                          <div className="space-y-1"><Label>Luogo nascita</Label><Input value={form.placeOfBirth} onChange={(event) => setForm((state) => ({ ...state, placeOfBirth: event.target.value }))} /></div>
                          <div className="space-y-1">
                            <Label>Nazionalità</Label>
                            <CountrySelect
                              value={form.nationalityCountry}
                              onChange={(countryCode) =>
                                setForm((state) => ({
                                  ...state,
                                  nationalityCountry: countryCode,
                                  nationality: countryNameFromCode(countryCode)
                                }))
                              }
                            />
                          </div>
                          <div className="space-y-1"><Label>Codice fiscale</Label><Input value={form.taxCode} onChange={(event) => setForm((state) => ({ ...state, taxCode: event.target.value }))} /></div>
                          <CustomerAddressFields
                            idPrefix="customer-residence-address"
                            title="Residenza"
                            streetLabel="Via e numero civico"
                            value={residenceAddressValueFromForm(form)}
                            onChange={(address) =>
                              setForm((state) => ({
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
                          <div className="space-y-1"><Label>Documento tipo</Label><Input value={form.documentType} onChange={(event) => setForm((state) => ({ ...state, documentType: event.target.value }))} /></div>
                          <div className="space-y-1"><Label>Documento numero</Label><Input value={form.documentNumber} onChange={(event) => setForm((state) => ({ ...state, documentNumber: event.target.value }))} /></div>
                          <div className="space-y-1"><Label>Rilascio documento</Label><Input type="date" value={form.documentIssuedAt} onChange={(event) => setForm((state) => ({ ...state, documentIssuedAt: event.target.value }))} /></div>
                          <div className="space-y-1"><Label>Scadenza documento</Label><Input type="date" value={form.documentExpiresAt} onChange={(event) => setForm((state) => ({ ...state, documentExpiresAt: event.target.value }))} /></div>
                          <div className="space-y-1 md:col-span-2"><Label>Autorità documento</Label><Input value={form.documentAuthority} onChange={(event) => setForm((state) => ({ ...state, documentAuthority: event.target.value }))} /></div>
                        </>
                      )}
                      <div className="space-y-1 md:col-span-4"><Label>Note</Label><Textarea rows={3} value={form.notes} onChange={(event) => setForm((state) => ({ ...state, notes: event.target.value }))} /></div>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline">Noleggi: {selectedCustomer?.stats?.bookingsTotal ?? selectedCustomer?._count?.bookings ?? 0}</Badge>
                        <Badge variant="outline">Contratti: {selectedCustomer?.stats?.contractsTotal ?? 0}</Badge>
                        <Badge variant="outline">Allegati: {selectedCustomer?.stats?.attachmentsTotal ?? selectedCustomer?._count?.attachments ?? 0}</Badge>
                      </div>
                      <Button type="submit" disabled={detailSaving}>
                        {detailSaving ? "Salvataggio..." : "Salva anagrafica"}
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>

              <CustomerContractsTimeline
                items={timelineItems}
                loading={timelineLoading}
                error={timelineError}
                period={timelinePeriod}
                status={timelineStatus}
                dateFrom={timelineDateFrom}
                dateTo={timelineDateTo}
                onPeriodChange={(value) => {
                  setTimelinePeriod(value);
                  if (value !== "custom") {
                    setTimelineDateFrom("");
                    setTimelineDateTo("");
                    setTimelinePage(1);
                    if (selectedCustomerId) void loadTimeline(selectedCustomerId, 1);
                  }
                }}
                onStatusChange={(value) => {
                  setTimelineStatus(value);
                  setTimelinePage(1);
                }}
                onDateFromChange={setTimelineDateFrom}
                onDateToChange={setTimelineDateTo}
                onApplyFilters={() => {
                  if (!selectedCustomerId) return;
                  setTimelinePage(1);
                  void loadTimeline(selectedCustomerId, 1);
                }}
                onOpenBooking={openBookingDetail}
                onDownloadPdf={(bookingId) => void downloadContractPdf(bookingId)}
                onSendEmail={(bookingId) => void sendContractEmail(bookingId)}
                onMarkSigned={(bookingId) => void markContractSigned(bookingId)}
              />

              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  Timeline pagina {timelinePage}/{timelinePages} · Record {timelineTotal}
                </span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={timelinePage <= 1} onClick={() => setTimelinePage((prev) => prev - 1)}>
                    Precedente
                  </Button>
                  <Button size="sm" variant="outline" disabled={timelinePage >= timelinePages} onClick={() => setTimelinePage((prev) => prev + 1)}>
                    Successiva
                  </Button>
                </div>
              </div>

              <CustomerDocumentsPanel
                customer={selectedCustomer}
                files={uploadFiles}
                saving={detailSaving}
                onFilesChange={setUploadFiles}
                onUpload={() => void uploadDocuments()}
                onOpenAttachment={(attachmentId) => void openAttachment(attachmentId)}
                onRemoveAttachment={(attachmentId) => void removeAttachment(attachmentId)}
              />
            </div>
          </aside>
        </>
      ) : null}
    </section>
  );
};
