import {captureOperationContext,publishOperationFeedback} from "../../../application/stores/operation-feedback";
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { CargosConnectionPanel } from "../../components/contracts/cargos-connection-panel";
import { Building2, CheckCircle2, FileText, Globe2, ImagePlus, Map, ShieldCheck, UploadCloud, Save } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  tenantProfileUseCases,
  TenantCompanyProfilePayload,
  TenantCompanyProfileResponse
} from "../../../application/usecases/tenant-profile-usecases";
import { useAuthStore } from "../../../application/stores/auth-store";
import { trackPublicEvent } from "../../../application/usecases/public-analytics-usecases";
import { FleetumInlineLoader } from "../../components/brand/fleetum-logo-loader";
import { WorkspacePageHeader } from "../../components/ui/workspace-ui";
import { CommerceDrawer, CommerceNotice } from "../../components/ui/commerce-workspace";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Textarea } from "../../components/ui/textarea";
import { COUNTRIES } from "../../../shared/geo/countries";
import { loadItalyAdministrativeData, type ItalyAdministrativeData } from "../../../shared/geo/italy-administrative-data";
import {
  normalizePostalCode,
  normalizePostalCodeForCountry,
  normalizeSdiCode,
  normalizeTaxCode,
  normalizeVatNumberForCountry,
  validateCompanyRegistrationDraft
} from "../../../shared/validation/company-registration";

const initialForm: TenantCompanyProfilePayload = {
  legalName: "",
  tradeName: "",
  legalForm: "",
  vatNumber: "",
  taxCode: "",
  pec: "",
  sdiCode: "",
  rea: "",
  legalAddress: "",
  city: "",
  province: "",
  postalCode: "",
  country: "IT",
  region: "",
  phone: "",
  email: "",
  website: "",
  adminFirstName: "",
  adminLastName: "",
  adminEmail: "",
  adminPhone: "",
  adminRole: "",
  primaryColor: "#21375d",
  accentColor: "#5d82c2",
  fontFamily: "helvetica",
  contractFooterText: "",
  defaultContractTerms: "",
  termsVersion: "",
  dpaVersion: ""
};

const fieldLabels: Record<string, string> = {
  legalName: "Ragione sociale",
  vatNumber: "Partita IVA",
  legalAddress: "Sede legale",
  city: "Comune",
  province: "Provincia",
  postalCode: "CAP",
  email: "Email aziendale",
  phone: "Telefono aziendale",
  adminFirstName: "Nome referente",
  adminLastName: "Cognome referente",
  adminEmail: "Email referente",
  logo: "Logo aziendale",
  pec: "PEC",
  sdiCode: "Codice SDI"
};

const normalizeForm = (data: TenantCompanyProfileResponse): TenantCompanyProfilePayload => ({
  ...initialForm,
  ...(data.profile ?? {}),
  primaryColor: data.branding?.primaryColor ?? initialForm.primaryColor,
  accentColor: data.branding?.accentColor ?? initialForm.accentColor,
  fontFamily: data.branding?.fontFamily ?? initialForm.fontFamily,
  contractFooterText: data.legalSettings?.contractFooterText ?? "",
  defaultContractTerms: data.legalSettings?.defaultContractTerms ?? "",
  termsVersion: data.legalSettings?.termsVersion ?? "",
  dpaVersion: data.legalSettings?.dpaVersion ?? ""
});

const requiredScoreTone = (percentage: number) => {
  if (percentage >= 90) return "admin-score admin-score-complete";
  if (percentage >= 65) return "admin-score";
  return "admin-score";
};

type CompanyProfilePageProps = {
  onboarding?: boolean;
  nextPath?: string;
};

const onboardingRequiredFields: Array<keyof TenantCompanyProfilePayload> = [
  "legalName",
  "vatNumber",
  "legalAddress",
  "city",
  "province",
  "postalCode",
  "email",
  "phone",
  "adminFirstName",
  "adminLastName",
  "adminEmail"
];

const missingRequiredOnboardingFields = (form: TenantCompanyProfilePayload) =>
  onboardingRequiredFields.filter((field) => !String(form[field] ?? "").trim());

const selectClassName =
  "flex h-10 w-full rounded-xl border border-input bg-gradient-to-b from-background to-background/85 px-3 py-2 text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_10px_24px_-22px_rgba(15,23,42,0.45)] ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

const companyValidationPayload = (form: TenantCompanyProfilePayload) => ({
  country: form.country,
  tenantName: form.legalName,
  vatNumber: form.vatNumber,
  taxCode: form.taxCode,
  pec: form.pec,
  sdiCode: form.sdiCode,
  legalAddress: form.legalAddress,
  city: form.city,
  province: form.province,
  postalCode: form.postalCode,
  companyEmail: form.email,
  companyPhone: form.phone
});

export const CompanyProfilePage = ({ onboarding = false, nextPath }: CompanyProfilePageProps) => {
  const navigate = useNavigate();
  const currentUser = useAuthStore((state) => state.user);
  const canRead = Boolean(currentUser?.permissions.some(p => p === "*" || p === "users:read"));
  const canWrite = Boolean(currentUser?.permissions.some(p => p === "*" || p === "users:write"));
  const identity = `${currentUser?.tenantId}:${currentUser?.id}`;
  const [dataOwner, setDataOwner] = useState(identity);
  const [baseline, setBaseline] = useState<TenantCompanyProfilePayload | null>(null);
  const [confirmation, setConfirmation] = useState<"logo" | "restore" | null>(null);
  const lock = useRef(false), request = useRef(0), activeIdentity = useRef(identity);
  activeIdentity.current = identity;
  const [form, setForm] = useState<TenantCompanyProfilePayload>(initialForm);
  const [profileState, setProfileState] = useState<TenantCompanyProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingVerificationDocument, setUploadingVerificationDocument] = useState(false);
  const [verificationDocumentFile, setVerificationDocumentFile] = useState<File | null>(null);
  const [italianGeo, setItalianGeo] = useState<ItalyAdministrativeData | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const completeness = profileState?.completeness ?? { percentage: 0, completed: false, missing: [] };
  const logoFileName = profileState?.branding?.logoFileName ?? null;

  const missingLabels = useMemo(
    () => completeness.missing.map((key) => fieldLabels[key] ?? key),
    [completeness.missing]
  );
  const isItalianCompany = (form.country ?? "IT").toUpperCase() === "IT";
  const companyValidationErrors = useMemo(() => validateCompanyRegistrationDraft(companyValidationPayload(form)), [form]);
  const provinceOptions = useMemo(
    () => (italianGeo?.provinces ?? []).filter((province) => !form.region || province.region === form.region),
    [italianGeo, form.region]
  );
  const municipalityOptions = useMemo(
    () => (italianGeo?.municipalities ?? []).filter((municipality) => !form.province || municipality.province === form.province),
    [italianGeo, form.province]
  );
  const selectedMunicipality = useMemo(
    () => (italianGeo?.municipalities ?? []).find((municipality) => municipality.name === form.city && municipality.province === form.province),
    [italianGeo, form.city, form.province]
  );

  const loadProfile = async () => {
    if (!canRead || lock.current) return;
    const sequence = ++request.current;
    setLoading(true);
    setError(null);
    try {
      const result = await tenantProfileUseCases.getProfile();
      if (sequence !== request.current || activeIdentity.current !== identity) return;
      setDataOwner(identity); setProfileState(result);
      const nextForm = normalizeForm(result);
      if (!result.profile && currentUser) {
        nextForm.adminFirstName = currentUser.firstName;
        nextForm.adminLastName = currentUser.lastName;
        nextForm.adminEmail = currentUser.email;
      }
      setForm(nextForm); setBaseline(nextForm);
    } catch (err) {
      if (sequence === request.current && activeIdentity.current === identity) setError((err as Error).message);
    } finally {
      if (sequence === request.current && activeIdentity.current === identity) setLoading(false);
    }
  };

  useEffect(() => {
    setProfileState(null); setForm(initialForm); setBaseline(null); setVerificationDocumentFile(null); setConfirmation(null); setSuccess(null);
    void loadProfile();
    return () => { ++request.current; };
  }, [identity, canRead]);

  useEffect(() => {
    if (!isItalianCompany || italianGeo) return;
    let cancelled = false;
    setGeoLoading(true);
    loadItalyAdministrativeData()
      .then((data) => {
        if (!cancelled) setItalianGeo(data);
      })
      .catch(() => {
        if (!cancelled) setError("Non riesco a caricare regioni, province e comuni italiani. Riprova tra qualche secondo.");
      })
      .finally(() => {
        if (!cancelled) setGeoLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isItalianCompany, italianGeo]);

  useEffect(() => {
    if (!isItalianCompany || !italianGeo || form.region || !form.province) return;
    const matchingProvince = italianGeo.provinces.find(
      (province) => province.code === form.province?.toUpperCase()
    );
    if (!matchingProvince) return;

    setForm((current) =>
      current.region ? current : { ...current, region: matchingProvince.region }
    );
  }, [form.province, form.region, isItalianCompany, italianGeo]);

  const updateField = (field: keyof TenantCompanyProfilePayload, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleCountryChange = (country: string) => {
    const normalizedCountry = country.toUpperCase();
    setForm((current) => {
      const currentCountry = (current.country ?? "IT").toUpperCase();
      if (currentCountry === normalizedCountry) return { ...current, country: normalizedCountry };
      return {
        ...current,
        country: normalizedCountry,
        region: "",
        city: "",
        province: "",
        postalCode: ""
      };
    });
  };

  const handleRegionChange = (region: string) => {
    setForm((current) => ({ ...current, region, province: "", city: "", postalCode: "" }));
  };

  const handleProvinceChange = (provinceCode: string) => {
    const province = (italianGeo?.provinces ?? []).find((item) => item.code === provinceCode);
    setForm((current) => ({
      ...current,
      region: province?.region ?? current.region,
      province: provinceCode,
      city: "",
      postalCode: ""
    }));
  };

  const handleMunicipalityChange = (municipalityCode: string) => {
    const municipality = (italianGeo?.municipalities ?? []).find((item) => item.code === municipalityCode);
    setForm((current) => ({
      ...current,
      city: municipality?.name ?? "",
      province: municipality?.province ?? current.province,
      region: municipality?.region ?? current.region,
      postalCode: municipality?.postalCodes.length === 1 ? municipality.postalCodes[0] : ""
    }));
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    const notificationScope=captureOperationContext();
    event.preventDefault();
    if (!canWrite || lock.current || loading || !baseline || dataOwner !== identity) return;
    lock.current = true;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      if (onboarding) {
        const missingRequiredFields = missingRequiredOnboardingFields(form);
        if (missingRequiredFields.length > 0) {
          setError(
            `Completa i dati obbligatori prima di scegliere il piano: ${missingRequiredFields
              .map((field) => fieldLabels[field] ?? field)
              .join(", ")}.`
          );
          return;
        }
      }

      const validationErrors = validateCompanyRegistrationDraft(companyValidationPayload(form));
      if (validationErrors.length > 0) {
        setError(validationErrors[0].message);
        return;
      }

      const result = await tenantProfileUseCases.updateProfile({
        ...form,
        vatNumber: normalizeVatNumberForCountry(form.vatNumber, form.country),
        taxCode: normalizeTaxCode(form.taxCode),
        sdiCode: normalizeSdiCode(form.sdiCode),
        postalCode: normalizePostalCodeForCountry(form.postalCode, form.country),
        province: form.province?.toUpperCase(),
        country: form.country?.toUpperCase() || "IT"
      });
      if (activeIdentity.current !== identity) return;
      setProfileState(result);
      const savedForm = normalizeForm(result); setForm(savedForm); setBaseline(savedForm);
      if (verificationDocumentFile) {
        setUploadingVerificationDocument(true);
        try { await tenantProfileUseCases.uploadCompanyVerificationDocument(verificationDocumentFile); }
        catch { throw Error("Dati aziendali salvati. Il documento di verifica non è stato caricato: riprova allegando nuovamente il file."); }
        setVerificationDocumentFile(null);
      }
      publishOperationFeedback(setSuccess, onboarding
          ? "Dati aziendali salvati. Ora puoi scegliere il piano e attivare il trial con carta."
          : "Profilo azienda salvato. I prossimi contratti useranno questi dati.", notificationScope);
      if (onboarding) {
        trackPublicEvent("ONBOARDING_COMPANY_COMPLETED", {
          source: "company_onboarding",
          country: form.country ?? "IT"
        });
      }
      if (onboarding && nextPath) {
        navigate(nextPath, { replace: true });
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      lock.current = false;
      setUploadingVerificationDocument(false);
      setSaving(false);
    }
  };

  const onLogoChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const notificationScope=captureOperationContext();
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !canWrite || lock.current || loading || !baseline || dataOwner !== identity) return;
    lock.current = true;
    setUploadingLogo(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await tenantProfileUseCases.uploadLogo(file);
      if (activeIdentity.current !== identity) return;
      setProfileState(result);
      publishOperationFeedback(setSuccess, "Logo aziendale aggiornato.", notificationScope);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      lock.current = false;
      setUploadingLogo(false);
    }
  };

  const removeLogo = async () => {
    const notificationScope=captureOperationContext();
    if (!canWrite || lock.current || loading || !baseline || dataOwner !== identity) return;
    lock.current = true;
    setUploadingLogo(true);
    setError(null);
    setSuccess(null);
    try {
      await tenantProfileUseCases.removeLogo();
      if (activeIdentity.current !== identity) return;
      try {
        const refreshed = await tenantProfileUseCases.getProfile();
        if (activeIdentity.current === identity) setProfileState(refreshed);
      } catch {
        setProfileState(current => current ? { ...current, branding: current.branding ? { ...current.branding, logoUrl: null, logoFileName: null } : null } : current);
        throw Error("Logo rimosso. Non è stato possibile aggiornare la completezza del profilo: ricarica i dati dopo aver salvato la bozza.");
      }
      setConfirmation(null);
      publishOperationFeedback(setSuccess, "Logo aziendale rimosso.", notificationScope);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      lock.current = false;
      setUploadingLogo(false);
    }
  };

  return (
    <section className="administration-workspace company-workspace" key={identity}>
      <WorkspacePageHeader eyebrow="AMMINISTRAZIONE"
        title={onboarding ? "Completa dati azienda" : "Profilo Azienda"}
        description={
          onboarding
            ? "Prima di scegliere il piano completa i dati societari per contratti, fatture e documenti."
            : "Dati societari, branding e impostazioni usate da contratti, email, WhatsApp, export e report."
        }
      />

      {!canRead ? <CommerceNotice>Il tuo ruolo non consente di consultare il profilo aziendale.</CommerceNotice> : null}
      {error ? <CommerceNotice>{error}{!baseline && canRead ? <Button variant="outline" onClick={() => void loadProfile()}>Riprova</Button> : null}</CommerceNotice> : null}
      {success ? <CommerceNotice tone="success">{success}</CommerceNotice> : null}
      {!canWrite && canRead ? <p className="admin-context">Accesso in sola lettura al profilo aziendale.</p> : null}
      {canRead && baseline ? <nav className="admin-section-nav" aria-label="Sezioni aziendali">{[["identity","Dati societari"],["address","Sede e contatti"],["reference","Referente"],["contracts","Contratti"]].map(([key,label]) => <a key={key} href={`#company-${key}`}>{label}</a>)}</nav> : null}
      <fieldset disabled={!canRead || !canWrite || loading || saving || uploadingLogo || !baseline} className="admin-company-content" hidden={!canRead || dataOwner !== identity || (!baseline && !loading)}>
      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
            <div>
              <h2 className="text-base">Completezza profilo</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Più è completo, più contratti e comunicazioni risultano pronti per uso ufficiale.
              </p>
            </div>
            <div className={`rounded-2xl border px-4 py-3 text-center ${requiredScoreTone(completeness.percentage)}`}>
              <p className="text-2xl font-semibold">{loading ? "..." : `${completeness.percentage}%`}</p>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em]">Setup</p>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="h-2 rounded-full bg-muted">
              <div
                className="h-full rounded-full admin-completeness-progress"
                style={{ width: `${completeness.percentage}%` }}
              />
            </div>
            {loading ? <p role="status">Caricamento del profilo aziendale…</p> : missingLabels.length ? (
              <div className="flex flex-wrap gap-2">
                {missingLabels.map((label) => (
                  <Badge key={label} variant="secondary" className="rounded-full">
                    Mancante: {label}
                  </Badge>
                ))}
              </div>
            ) : (
              <div className="admin-company-complete flex items-center gap-2 rounded-xl border px-3 py-2 text-sm">
                <CheckCircle2 className="h-4 w-4" />
                Profilo completo per la preparazione dei documenti.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="flex items-center gap-2 text-base">
              <ImagePlus className="h-4 w-4" />
              Branding contratti
            </h2>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-2xl border bg-background/70 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Logo</p>
              <p className="mt-2 text-sm font-medium">
                {logoFileName ? `Configurato: ${logoFileName}` : "Nessun logo caricato"}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Label className="admin-logo-upload inline-flex h-10 cursor-pointer items-center justify-center rounded-xl border px-4 text-sm font-medium hover:bg-muted">
                  {uploadingLogo ? <FleetumInlineLoader label="Caricamento" /> : "Carica logo"}
                  <input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={onLogoChange} />
                </Label>
                {logoFileName ? (
                  <Button type="button" variant="outline" onClick={() => setConfirmation("logo")} disabled={uploadingLogo}>
                    Rimuovi
                  </Button>
                ) : null}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="company-field-1">Colore primario</Label>
                <Input id="company-field-1" type="color" value={form.primaryColor ?? "#21375d"} onChange={(e) => updateField("primaryColor", e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="company-field-2">Colore accento</Label>
                <Input id="company-field-2" type="color" value={form.accentColor ?? "#5d82c2"} onChange={(e) => updateField("accentColor", e.target.value)} />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <Card>
          <CardHeader>
            <h2 className="flex items-center gap-2 text-base" id="company-identity">
              <Building2 className="h-4 w-4" />
              Dati azienda e fiscali
            </h2>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor="company-field-3">Ragione sociale *</Label>
              <Input id="company-field-3" value={form.legalName ?? ""} onChange={(e) => updateField("legalName", e.target.value)} required />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="company-field-4">Nome commerciale</Label>
              <Input id="company-field-4" value={form.tradeName ?? ""} onChange={(e) => updateField("tradeName", e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="company-field-5">Forma giuridica</Label>
              <Input id="company-field-5" placeholder="SRL, SPA, SNC..." value={form.legalForm ?? ""} onChange={(e) => updateField("legalForm", e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="company-field-6">{isItalianCompany ? "Partita IVA" : "VAT / Tax ID"} *</Label>
              <Input id="company-field-6"
                value={form.vatNumber ?? ""}
                onChange={(e) => updateField("vatNumber", normalizeVatNumberForCountry(e.target.value, form.country))}
                placeholder={isItalianCompany ? "11 cifre" : "Identificativo fiscale aziendale"}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="company-field-7">Codice fiscale azienda</Label>
              <Input id="company-field-7" value={form.taxCode ?? ""} onChange={(e) => updateField("taxCode", normalizeTaxCode(e.target.value))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="company-field-8">REA</Label>
              <Input id="company-field-8" value={form.rea ?? ""} onChange={(e) => updateField("rea", e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="company-field-9">PEC</Label>
              <Input id="company-field-9" type="email" value={form.pec ?? ""} onChange={(e) => updateField("pec", e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="company-field-10">Codice SDI</Label>
              <Input id="company-field-10" value={form.sdiCode ?? ""} onChange={(e) => updateField("sdiCode", normalizeSdiCode(e.target.value))} />
            </div>
            <div className="grid gap-1.5 xl:col-span-3">
              <Label className="flex items-center gap-2" htmlFor="company-verification-file"><UploadCloud className="h-3.5 w-3.5" /> Visura camerale per verifica aziendale</Label>
              <Input id="company-verification-file"
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                onChange={(event) => setVerificationDocumentFile(event.target.files?.[0] ?? null)}
              />
              <p className="text-xs text-muted-foreground">
                Opzionale: aiuta a verificare ragione sociale, P.IVA e sede legale. Non dimostra da sola che lo SDI sia attivo.
              </p>
              {verificationDocumentFile ? <p className="text-xs font-semibold text-slate-700">File selezionato: {verificationDocumentFile.name}</p> : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-base" id="company-address">Sede legale e contatti</h2>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <div className="grid gap-1.5 md:col-span-2">
              <Label htmlFor="company-field-11">Indirizzo sede legale</Label>
              <Input id="company-field-11" value={form.legalAddress ?? ""} onChange={(e) => updateField("legalAddress", e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label className="flex items-center gap-2" htmlFor="company-country"><Globe2 className="h-3.5 w-3.5" /> Paese</Label>
              <select id="company-country" className={selectClassName} value={form.country ?? "IT"} onChange={(e) => handleCountryChange(e.target.value)}>
                {COUNTRIES.map((country) => (
                  <option key={country.code} value={country.code}>{country.name}</option>
                ))}
              </select>
            </div>
            {isItalianCompany ? (
              <>
                <div className="grid gap-1.5">
                  <Label className="flex items-center gap-2" htmlFor="company-region"><Map className="h-3.5 w-3.5" /> Regione</Label>
                  <select id="company-region" className={selectClassName} value={form.region ?? ""} onChange={(e) => handleRegionChange(e.target.value)} disabled={geoLoading || !italianGeo}>
                    <option value="">{geoLoading ? "Caricamento regioni..." : "Seleziona regione"}</option>
                    {(italianGeo?.regions ?? []).map((region) => (
                      <option key={region} value={region}>{region}</option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="company-field-12">Provincia</Label>
                  <select id="company-field-12" className={selectClassName} value={form.province ?? ""} onChange={(e) => handleProvinceChange(e.target.value)} disabled={!form.region || !italianGeo}>
                    <option value="">Seleziona provincia</option>
                    {provinceOptions.map((province) => (
                      <option key={province.code} value={province.code}>{province.name} ({province.code})</option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="company-field-13">Comune</Label>
                  <select id="company-field-13"
                    className={selectClassName}
                    value={selectedMunicipality?.code ?? ""}
                    onChange={(e) => handleMunicipalityChange(e.target.value)}
                    disabled={!form.province || !italianGeo}
                  >
                    <option value="">Seleziona comune</option>
                    {municipalityOptions.map((municipality) => (
                      <option key={municipality.code} value={municipality.code}>{municipality.name}</option>
                    ))}
                  </select>
                  {selectedMunicipality ? (
                    <p className="text-xs text-muted-foreground">ISTAT {selectedMunicipality.istatCode} · Catastale {selectedMunicipality.cadastralCode ?? "n.d."}</p>
                  ) : null}
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="company-field-14">CAP</Label>
                  <Input id="company-field-14" value={form.postalCode ?? ""} onChange={(e) => updateField("postalCode", normalizePostalCode(e.target.value))} />
                  {selectedMunicipality && selectedMunicipality.postalCodes.length > 1 ? (
                    <p className="text-xs text-muted-foreground">Comune multi-CAP: inserisci il CAP corretto della sede.</p>
                  ) : null}
                </div>
              </>
            ) : (
              <>
                <div className="grid gap-1.5">
                  <Label htmlFor="company-field-15">Comune/Città</Label>
                  <Input id="company-field-15" value={form.city ?? ""} onChange={(e) => updateField("city", e.target.value)} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="company-field-16">Provincia/Area *</Label>
                  <Input id="company-field-16" value={form.province ?? ""} onChange={(e) => updateField("province", e.target.value.toUpperCase())} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="company-field-17">Codice postale *</Label>
                  <Input id="company-field-17" value={form.postalCode ?? ""} onChange={(e) => updateField("postalCode", normalizePostalCodeForCountry(e.target.value, form.country))} />
                </div>
              </>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="company-field-18">Email aziendale</Label>
              <Input id="company-field-18" type="email" value={form.email ?? ""} onChange={(e) => updateField("email", e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="company-field-19">Telefono aziendale</Label>
              <Input id="company-field-19" value={form.phone ?? ""} onChange={(e) => updateField("phone", e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="company-field-20">Sito web</Label>
              <Input id="company-field-20" value={form.website ?? ""} onChange={(e) => updateField("website", e.target.value)} placeholder="https://..." />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="flex items-center gap-2 text-base" id="company-reference">
              <ShieldCheck className="h-4 w-4" />
              Referente admin e compliance
            </h2>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor="company-field-21">Nome referente</Label>
              <Input id="company-field-21" value={form.adminFirstName ?? ""} onChange={(e) => updateField("adminFirstName", e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="company-field-22">Cognome referente</Label>
              <Input id="company-field-22" value={form.adminLastName ?? ""} onChange={(e) => updateField("adminLastName", e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="company-field-23">Email referente</Label>
              <Input id="company-field-23" type="email" value={form.adminEmail ?? ""} onChange={(e) => updateField("adminEmail", e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="company-field-24">Telefono referente</Label>
              <Input id="company-field-24" value={form.adminPhone ?? ""} onChange={(e) => updateField("adminPhone", e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="company-field-25">Ruolo referente</Label>
              <Input id="company-field-25" value={form.adminRole ?? ""} onChange={(e) => updateField("adminRole", e.target.value)} placeholder="Owner, Operations manager..." />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="company-field-26">Versione DPA</Label>
              <Input id="company-field-26" value={form.dpaVersion ?? ""} onChange={(e) => updateField("dpaVersion", e.target.value)} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="flex items-center gap-2 text-base" id="company-contracts">
              <FileText className="h-4 w-4" />
              Contratti e documenti
            </h2>
          </CardHeader>
          <CardContent className="grid gap-3 xl:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="company-field-27">Testo footer contratto</Label>
              <Textarea id="company-field-27"
                rows={4}
                value={form.contractFooterText ?? ""}
                onChange={(e) => updateField("contractFooterText", e.target.value)}
                placeholder="Dati fiscali, note legali, recapiti o informazioni di cortesia..."
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="company-field-28">Condizioni contrattuali default</Label>
              <Textarea id="company-field-28"
                rows={4}
                value={form.defaultContractTerms ?? ""}
                onChange={(e) => updateField("defaultContractTerms", e.target.value)}
                placeholder="Condizioni standard da proporre nei template contratto..."
              />
            </div>
          </CardContent>
        </Card>

        <div className="admin-save-bar">
          <div className="admin-save-actions"><p className="admin-context">{baseline && (JSON.stringify(form) !== JSON.stringify(baseline) || verificationDocumentFile) ? "Modifiche da salvare" : "Dati caricati dal server"}</p>
            <Button type="button" variant="outline" onClick={() => setConfirmation("restore")} disabled={loading || saving}>
              Ripristina
            </Button>
            <Button type="submit" disabled={loading || saving} className="gap-2">
              <Save className="h-4 w-4" aria-hidden="true" />
              {saving || uploadingVerificationDocument ? "Salvataggio..." : onboarding ? "Salva e continua ai piani" : "Salva Profilo Azienda"}
            </Button>
          </div>
        </div>
      </form>
      </fieldset>
      <CargosConnectionPanel />
      {confirmation ? <CommerceDrawer compact title={confirmation === "logo" ? "Rimuovere il logo aziendale?" : "Ripristinare i dati salvati?"} busy={saving || uploadingLogo} onClose={() => setConfirmation(null)} footer={<><Button variant="outline" onClick={() => setConfirmation(null)} disabled={saving || uploadingLogo}>Annulla</Button><Button disabled={saving || uploadingLogo} onClick={() => { if (confirmation === "logo") void removeLogo(); else { setConfirmation(null); setVerificationDocumentFile(null); void loadProfile(); } }}>Conferma</Button></>}>{error ? <CommerceNotice>{error}</CommerceNotice> : null}<p>{confirmation === "logo" ? "Il logo verrà rimosso. Le modifiche non salvate ai dati aziendali resteranno disponibili." : "Le modifiche non salvate e il documento selezionato verranno scartati."}</p></CommerceDrawer> : null}
    </section>
  );
};
