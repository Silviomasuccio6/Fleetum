import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { Building2, CheckCircle2, FileText, Globe2, ImagePlus, Map, ShieldCheck, UploadCloud, Wand2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  tenantProfileUseCases,
  TenantCompanyProfilePayload,
  TenantCompanyProfileResponse
} from "../../../application/usecases/tenant-profile-usecases";
import { useAuthStore } from "../../../application/stores/auth-store";
import { FleetumInlineLoader } from "../../components/brand/fleetum-logo-loader";
import { PageHeader } from "../../components/layout/page-header";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Textarea } from "../../components/ui/textarea";
import { COUNTRIES } from "../../../shared/geo/countries";
import { loadItalyAdministrativeData, type ItalyAdministrativeData } from "../../../shared/geo/italy-administrative-data";
import {
  normalizeItalianVatNumber,
  normalizePostalCode,
  normalizeSdiCode,
  normalizeTaxCode,
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
  if (percentage >= 90) return "text-emerald-700 bg-emerald-50 border-emerald-200";
  if (percentage >= 65) return "text-amber-700 bg-amber-50 border-amber-200";
  return "text-rose-700 bg-rose-50 border-rose-200";
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
    setLoading(true);
    setError(null);
    try {
      const result = await tenantProfileUseCases.getProfile();
      setProfileState(result);
      const nextForm = normalizeForm(result);
      if (!result.profile && currentUser) {
        nextForm.adminFirstName = currentUser.firstName;
        nextForm.adminLastName = currentUser.lastName;
        nextForm.adminEmail = currentUser.email;
      }
      setForm(nextForm);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadProfile();
  }, []);

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
    setForm((current) => ({
      ...current,
      country: normalizedCountry,
      region: normalizedCountry === "IT" ? current.region : "",
      city: normalizedCountry === "IT" ? current.city : "",
      province: normalizedCountry === "IT" ? current.province : "",
      postalCode: normalizedCountry === "IT" ? current.postalCode : ""
    }));
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
    event.preventDefault();
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
          setSaving(false);
          return;
        }
      }

      const validationErrors = validateCompanyRegistrationDraft(companyValidationPayload(form));
      if (validationErrors.length > 0) {
        setError(validationErrors[0].message);
        setSaving(false);
        return;
      }

      const result = await tenantProfileUseCases.updateProfile({
        ...form,
        vatNumber: normalizeItalianVatNumber(form.vatNumber),
        taxCode: normalizeTaxCode(form.taxCode),
        sdiCode: normalizeSdiCode(form.sdiCode),
        postalCode: isItalianCompany ? normalizePostalCode(form.postalCode) : form.postalCode,
        province: form.province?.toUpperCase(),
        country: form.country?.toUpperCase() || "IT"
      });
      if (verificationDocumentFile) {
        setUploadingVerificationDocument(true);
        await tenantProfileUseCases.uploadCompanyVerificationDocument(verificationDocumentFile);
        setVerificationDocumentFile(null);
      }
      setProfileState(result);
      setForm(normalizeForm(result));
      setSuccess(
        onboarding
          ? "Dati aziendali salvati. Ora puoi scegliere il piano e attivare il trial con carta."
          : "Profilo azienda salvato. I prossimi contratti useranno questi dati."
      );
      if (onboarding && nextPath) {
        navigate(nextPath, { replace: true });
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploadingVerificationDocument(false);
      setSaving(false);
    }
  };

  const onLogoChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploadingLogo(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await tenantProfileUseCases.uploadLogo(file);
      setProfileState(result);
      setForm(normalizeForm(result));
      setSuccess("Logo aziendale aggiornato.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploadingLogo(false);
    }
  };

  const removeLogo = async () => {
    setUploadingLogo(true);
    setError(null);
    setSuccess(null);
    try {
      await tenantProfileUseCases.removeLogo();
      await loadProfile();
      setSuccess("Logo aziendale rimosso.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploadingLogo(false);
    }
  };

  return (
    <section className="space-y-4">
      <PageHeader
        title={onboarding ? "Completa dati azienda" : "Profilo Azienda"}
        subtitle={
          onboarding
            ? "Google ha velocizzato l'accesso. Prima di scegliere il piano servono i dati societari per contratti, fatture e compliance."
            : "Dati societari, branding e impostazioni usate da contratti, email, WhatsApp, export e report."
        }
      />

      {error ? <Alert className="border-rose-200 bg-rose-50 text-rose-700">{error}</Alert> : null}
      {success ? <Alert className="border-emerald-200 bg-emerald-50 text-emerald-700">{success}</Alert> : null}
      {companyValidationErrors.length > 0 && !loading ? (
        <Alert className="border-amber-200 bg-amber-50 text-amber-800">
          Primo controllo dati: {companyValidationErrors[0].message}
        </Alert>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="text-base">Completezza profilo</CardTitle>
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
                className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-cyan-400 transition-all duration-500"
                style={{ width: `${completeness.percentage}%` }}
              />
            </div>
            {missingLabels.length ? (
              <div className="flex flex-wrap gap-2">
                {missingLabels.map((label) => (
                  <Badge key={label} variant="secondary" className="rounded-full">
                    Mancante: {label}
                  </Badge>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                <CheckCircle2 className="h-4 w-4" />
                Profilo completo: il tenant è pronto per documenti ufficiali.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ImagePlus className="h-4 w-4" />
              Branding contratti
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-2xl border bg-background/70 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Logo</p>
              <p className="mt-2 text-sm font-medium">
                {logoFileName ? `Configurato: ${logoFileName}` : "Nessun logo caricato"}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Label className="inline-flex h-10 cursor-pointer items-center justify-center rounded-xl border px-4 text-sm font-medium hover:bg-muted">
                  {uploadingLogo ? <FleetumInlineLoader label="Caricamento" /> : "Carica logo"}
                  <input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={onLogoChange} />
                </Label>
                {logoFileName ? (
                  <Button type="button" variant="outline" onClick={removeLogo} disabled={uploadingLogo}>
                    Rimuovi
                  </Button>
                ) : null}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Colore primario</Label>
                <Input type="color" value={form.primaryColor ?? "#21375d"} onChange={(e) => updateField("primaryColor", e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label>Colore accento</Label>
                <Input type="color" value={form.accentColor ?? "#5d82c2"} onChange={(e) => updateField("accentColor", e.target.value)} />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="h-4 w-4" />
              Dati azienda e fiscali
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <div className="grid gap-1.5">
              <Label>Ragione sociale *</Label>
              <Input value={form.legalName ?? ""} onChange={(e) => updateField("legalName", e.target.value)} required />
            </div>
            <div className="grid gap-1.5">
              <Label>Nome commerciale</Label>
              <Input value={form.tradeName ?? ""} onChange={(e) => updateField("tradeName", e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Forma giuridica</Label>
              <Input placeholder="SRL, SPA, SNC..." value={form.legalForm ?? ""} onChange={(e) => updateField("legalForm", e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Partita IVA</Label>
              <Input value={form.vatNumber ?? ""} onChange={(e) => updateField("vatNumber", normalizeItalianVatNumber(e.target.value))} />
            </div>
            <div className="grid gap-1.5">
              <Label>Codice fiscale azienda</Label>
              <Input value={form.taxCode ?? ""} onChange={(e) => updateField("taxCode", normalizeTaxCode(e.target.value))} />
            </div>
            <div className="grid gap-1.5">
              <Label>REA</Label>
              <Input value={form.rea ?? ""} onChange={(e) => updateField("rea", e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>PEC</Label>
              <Input type="email" value={form.pec ?? ""} onChange={(e) => updateField("pec", e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Codice SDI</Label>
              <Input value={form.sdiCode ?? ""} onChange={(e) => updateField("sdiCode", normalizeSdiCode(e.target.value))} />
            </div>
            <div className="grid gap-1.5 xl:col-span-3">
              <Label className="flex items-center gap-2"><UploadCloud className="h-3.5 w-3.5" /> Visura camerale per verifica aziendale</Label>
              <Input
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
            <CardTitle className="text-base">Sede legale e contatti</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <div className="grid gap-1.5 md:col-span-2">
              <Label>Indirizzo sede legale</Label>
              <Input value={form.legalAddress ?? ""} onChange={(e) => updateField("legalAddress", e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label className="flex items-center gap-2"><Globe2 className="h-3.5 w-3.5" /> Paese</Label>
              <select className={selectClassName} value={form.country ?? "IT"} onChange={(e) => handleCountryChange(e.target.value)}>
                {COUNTRIES.map((country) => (
                  <option key={country.code} value={country.code}>{country.name}</option>
                ))}
              </select>
            </div>
            {isItalianCompany ? (
              <>
                <div className="grid gap-1.5">
                  <Label className="flex items-center gap-2"><Map className="h-3.5 w-3.5" /> Regione</Label>
                  <select className={selectClassName} value={form.region ?? ""} onChange={(e) => handleRegionChange(e.target.value)} disabled={geoLoading || !italianGeo}>
                    <option value="">{geoLoading ? "Caricamento regioni..." : "Seleziona regione"}</option>
                    {(italianGeo?.regions ?? []).map((region) => (
                      <option key={region} value={region}>{region}</option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-1.5">
                  <Label>Provincia</Label>
                  <select className={selectClassName} value={form.province ?? ""} onChange={(e) => handleProvinceChange(e.target.value)} disabled={!form.region || !italianGeo}>
                    <option value="">Seleziona provincia</option>
                    {provinceOptions.map((province) => (
                      <option key={province.code} value={province.code}>{province.name} ({province.code})</option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-1.5">
                  <Label>Comune</Label>
                  <select
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
                  <Label>CAP</Label>
                  <Input value={form.postalCode ?? ""} onChange={(e) => updateField("postalCode", normalizePostalCode(e.target.value))} />
                  {selectedMunicipality && selectedMunicipality.postalCodes.length > 1 ? (
                    <p className="text-xs text-muted-foreground">Comune multi-CAP: inserisci il CAP corretto della sede.</p>
                  ) : null}
                </div>
              </>
            ) : (
              <>
                <div className="grid gap-1.5">
                  <Label>Comune/Città</Label>
                  <Input value={form.city ?? ""} onChange={(e) => updateField("city", e.target.value)} />
                </div>
                <div className="grid gap-1.5">
                  <Label>Provincia/Area</Label>
                  <Input value={form.province ?? ""} onChange={(e) => updateField("province", e.target.value.toUpperCase())} />
                </div>
                <div className="grid gap-1.5">
                  <Label>Codice postale</Label>
                  <Input value={form.postalCode ?? ""} onChange={(e) => updateField("postalCode", e.target.value)} />
                </div>
              </>
            )}
            <div className="grid gap-1.5">
              <Label>Email aziendale</Label>
              <Input type="email" value={form.email ?? ""} onChange={(e) => updateField("email", e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Telefono aziendale</Label>
              <Input value={form.phone ?? ""} onChange={(e) => updateField("phone", e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Sito web</Label>
              <Input value={form.website ?? ""} onChange={(e) => updateField("website", e.target.value)} placeholder="https://..." />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4" />
              Referente admin e compliance
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <div className="grid gap-1.5">
              <Label>Nome referente</Label>
              <Input value={form.adminFirstName ?? ""} onChange={(e) => updateField("adminFirstName", e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Cognome referente</Label>
              <Input value={form.adminLastName ?? ""} onChange={(e) => updateField("adminLastName", e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Email referente</Label>
              <Input type="email" value={form.adminEmail ?? ""} onChange={(e) => updateField("adminEmail", e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Telefono referente</Label>
              <Input value={form.adminPhone ?? ""} onChange={(e) => updateField("adminPhone", e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Ruolo referente</Label>
              <Input value={form.adminRole ?? ""} onChange={(e) => updateField("adminRole", e.target.value)} placeholder="Owner, Operations manager..." />
            </div>
            <div className="grid gap-1.5">
              <Label>Versione DPA</Label>
              <Input value={form.dpaVersion ?? ""} onChange={(e) => updateField("dpaVersion", e.target.value)} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4" />
              Contratti e documenti
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 xl:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Testo footer contratto</Label>
              <Textarea
                rows={4}
                value={form.contractFooterText ?? ""}
                onChange={(e) => updateField("contractFooterText", e.target.value)}
                placeholder="Dati fiscali, note legali, recapiti o informazioni di cortesia..."
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Condizioni contrattuali default</Label>
              <Textarea
                rows={4}
                value={form.defaultContractTerms ?? ""}
                onChange={(e) => updateField("defaultContractTerms", e.target.value)}
                placeholder="Condizioni standard da proporre nei template contratto..."
              />
            </div>
          </CardContent>
        </Card>

        <div className="sticky bottom-4 z-20 flex justify-end">
          <div className="flex items-center gap-2 rounded-2xl border bg-card/95 p-2 shadow-xl backdrop-blur">
            <Button type="button" variant="outline" onClick={() => void loadProfile()} disabled={loading || saving}>
              Ripristina
            </Button>
            <Button type="submit" disabled={loading || saving} className="gap-2">
              <Wand2 className="h-4 w-4" />
              {saving || uploadingVerificationDocument ? "Salvataggio..." : onboarding ? "Salva e continua ai piani" : "Salva Profilo Azienda"}
            </Button>
          </div>
        </div>
      </form>
    </section>
  );
};
