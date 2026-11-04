import { type CSSProperties, type ReactNode, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { AtSign, Briefcase, Building2, FileText, Globe, Hash, Lock, Mail, Map, MapPin, Palette, Phone, Scale, Star, User } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuthStore } from "../../../application/stores/auth-store";
import { authUseCases } from "../../../application/usecases/auth-usecases";
import { tenantProfileUseCases } from "../../../application/usecases/tenant-profile-usecases";
import { getApiBaseUrl } from "../../../infrastructure/api/api-base-url";
import { trackPublicEvent } from "../../../application/usecases/public-analytics-usecases";
import { FleetumLogoLoader } from "../../components/brand/fleetum-logo-loader";
import { COUNTRIES } from "../../../shared/geo/countries";
import { loadItalyAdministrativeData, type ItalyAdministrativeData } from "../../../shared/geo/italy-administrative-data";
import {
  normalizeItalianVatNumber,
  normalizePostalCode,
  normalizePostalCodeForCountry,
  normalizeSdiCode,
  normalizeTaxCode,
  normalizeVatNumberForCountry,
  validateCompanyRegistrationDraft
} from "../../../shared/validation/company-registration";
import { AccessShell, AccessNotice } from "../../components/layout/access-shell";
import { getAccessDestination, getActivationPath, getCompanyOnboardingPath } from "./access-flow";

const trackSignupEvent = (...args: Parameters<typeof trackPublicEvent>) => { try { trackPublicEvent(...args); } catch { /* Analytics must not interrupt account creation. */ } };

const SIGNUP_STEPS = [
  {
    title: "Azienda",
    subtitle: "Dati societari"
  },
  {
    title: "Referente",
    subtitle: "Account amministratore"
  },
  {
    title: "Conferma",
    subtitle: "Riepilogo e privacy"
  }
];



const GoogleLogo = () => (
  <svg className="premium-login-social-icon" viewBox="0 0 24 24" aria-hidden>
    <path
      fill="#EA4335"
      d="M12 10.2v3.9h5.5c-.5 2.3-2.4 3.9-5.5 3.9a6 6 0 0 1 0-12c1.7 0 3.2.6 4.3 1.6l2.9-2.8A10 10 0 0 0 12 2a10 10 0 0 0 0 20c5.7 0 9.5-4 9.5-9.7 0-.7-.1-1.4-.2-2.1H12z"
    />
    <path
      fill="#4285F4"
      d="M21.5 12.3c0-.7-.1-1.4-.2-2.1H12v3.9h5.5c-.2 1-.8 1.9-1.6 2.5l2.6 2c1.6-1.5 3-3.8 3-6.3z"
    />
    <path
      fill="#FBBC05"
      d="M6.9 14.2A6 6 0 0 1 6.9 9.8L3.8 7.4a10 10 0 0 0 0 9.2l3.1-2.4z"
    />
    <path
      fill="#34A853"
      d="M12 22a10 10 0 0 0 6.8-2.5l-2.6-2c-.8.6-1.9 1-4.2 1a6 6 0 0 1-5.7-4.3l-3.1 2.4A10 10 0 0 0 12 22z"
    />
  </svg>
);

const FieldIcon = ({ children }: { children: ReactNode }) => (
  <span className="premium-login-field-icon-wrap" aria-hidden="true">{children}</span>
);

const initialForm = {
  tenantName: "",
  legalForm: "",
  vatNumber: "",
  taxCode: "",
  pec: "",
  sdiCode: "",
  legalAddress: "",
  region: "",
  city: "",
  province: "",
  municipalityCode: "",
  postalCode: "",
  country: "IT",
  companyPhone: "",
  companyEmail: "",
  website: "",
  firstName: "",
  lastName: "",
  adminPhone: "",
  adminRole: "",
  email: "",
  password: "",
  primaryColor: "#21375d",
  accentColor: "#5d82c2",
  chamberOfCommerceFile: null as File | null
};

const cleanText = (value: string) => value.trim();
const optionalText = (value: string) => {
  const cleaned = cleanText(value);
  return cleaned.length > 0 ? cleaned : undefined;
};

const isRequiredCompanyStepComplete = (form: typeof initialForm) => validateCompanyRegistrationDraft(form).length === 0;

export const SignupPage = () => {
  const navigate = useNavigate(), location = useLocation();
  const setSession = useAuthStore((state) => state.setSession);

  const [form, setForm] = useState(initialForm);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [italianGeo, setItalianGeo] = useState<ItalyAdministrativeData | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string,string>>({});
  const [passwordVisible, setPasswordVisible] = useState(false);
  const lock = useRef(false), createdAccount = useRef<string | null>(null), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { document.getElementById("signup-step-title")?.focus(); }, [currentStep]);

  const apiBaseUrl = getApiBaseUrl();
  const googleAuthUrl = (import.meta.env.VITE_GOOGLE_AUTH_URL as string | undefined) ?? `${apiBaseUrl}/auth/google`;


  useEffect(() => {
    if (form.country !== "IT" || italianGeo) return;
    let cancelled = false;
    setGeoLoading(true);
    void loadItalyAdministrativeData()
      .then((data) => {
        if (!cancelled) setItalianGeo(data);
      })
      .catch(() => {
        if (!cancelled) setError("Non riesco a caricare comuni e province italiane. Riprova tra qualche secondo.");
      })
      .finally(() => {
        if (!cancelled) setGeoLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [form.country, italianGeo]);

  const openGoogleSignup = () => {
    if (lock.current || createdAccount.current) return;
    trackSignupEvent("SIGNUP_STARTED", { entry: "google" });
    const target = new URL(googleAuthUrl, window.location.origin);
    target.searchParams.set("intent", "signup");
    target.searchParams.set("returnTo", getCompanyOnboardingPath(getAccessDestination(location.search)));
    window.location.href = target.toString();
  };

  const isItalianCompany = form.country === "IT";
  const companyStepErrors = useMemo(() => validateCompanyRegistrationDraft(form), [form]);
  const selectedRegion = form.region;
  const provinceOptions = useMemo(
    () => (italianGeo?.provinces ?? []).filter((province) => Boolean(selectedRegion) && province.region === selectedRegion),
    [italianGeo, selectedRegion]
  );
  const municipalityOptions = useMemo(
    () => (italianGeo?.municipalities ?? []).filter((municipality) => Boolean(form.province) && municipality.province === form.province),
    [italianGeo, form.province]
  );
  const selectedMunicipality = useMemo(
    () => (italianGeo?.municipalities ?? []).find((municipality) => municipality.code === form.municipalityCode),
    [italianGeo, form.municipalityCode]
  );
  const isEmailValid = form.email.trim().includes("@");
  const isPasswordStrong =
    form.password.length >= 8 &&
    /[A-Z]/.test(form.password) &&
    /\d/.test(form.password) &&
    /[^A-Za-z0-9]/.test(form.password);
  const vatFieldLooksComplete = isItalianCompany
    ? normalizeItalianVatNumber(form.vatNumber).length === 11
    : form.vatNumber.replace(/[^a-zA-Z0-9]/g, "").length >= 4;

  const stepIsValid = [
    isRequiredCompanyStepComplete(form),
    form.firstName.trim().length > 1 && form.lastName.trim().length > 1 && isEmailValid && isPasswordStrong,
    privacyAccepted
  ][currentStep];

  const stepErrors = [
    companyStepErrors[0]?.message ?? "Completa i dati societari obbligatori: azienda, P.IVA, PEC, email/telefono aziendale e sede legale.",
    "Completa nome, cognome, email valida e una password sicura.",
    "Per creare l'account devi confermare la presa visione dell'informativa privacy."
  ];
  const handleCountryChange = (country: string) => {
    const normalizedCountry = country.toUpperCase();
    setForm((current) => {
      if (current.country === normalizedCountry) return { ...current, country: normalizedCountry };
      return {
        ...current,
        country: normalizedCountry,
        region: "",
        province: "",
        municipalityCode: "",
        city: "",
        postalCode: ""
      };
    });
  };

  const handleRegionChange = (region: string) => {
    setForm((current) => ({ ...current, region, province: "", municipalityCode: "", city: "", postalCode: "" }));
  };

  const handleProvinceChange = (provinceCode: string) => {
    const province = (italianGeo?.provinces ?? []).find((item) => item.code === provinceCode);
    setForm((current) => ({
      ...current,
      region: province?.region ?? current.region,
      province: provinceCode,
      municipalityCode: "",
      city: "",
      postalCode: ""
    }));
  };

  const handleMunicipalityChange = (municipalityCode: string) => {
    const municipality = (italianGeo?.municipalities ?? []).find((item) => item.code === municipalityCode);
    setForm((current) => ({
      ...current,
      municipalityCode,
      city: municipality?.name ?? "",
      province: municipality?.province ?? current.province,
      region: municipality?.region ?? current.region,
      postalCode: municipality?.postalCodes.length === 1 ? municipality.postalCodes[0] : ""
    }));
  };

  const signupProgress = Math.round(((currentStep + 1) / SIGNUP_STEPS.length) * 100);
  const signupProgressStyle = { "--signup-progress": `${signupProgress}%` } as CSSProperties;

  useEffect(() => {
    trackSignupEvent("SIGNUP_VIEW", { page: "signup" });
  }, []);

  const errorsForStep = (step: number): Record<string,string> => {
    if (step === 0) return Object.fromEntries(companyStepErrors.map(item => [item.field,item.message]));
    if (step === 1) {
      const errors: Record<string,string> = {};
      if (form.firstName.trim().length < 2) errors.firstName = "Inserisci un nome di almeno 2 caratteri.";
      if (form.lastName.trim().length < 2) errors.lastName = "Inserisci un cognome di almeno 2 caratteri.";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.email = "Inserisci un indirizzo email valido.";
      if (!isPasswordStrong) errors.password = "Usa almeno 8 caratteri con una maiuscola, un numero e un simbolo.";
      return errors;
    }
    const errors: Record<string,string> = {};
    if (!privacyAccepted) errors.privacy = "Conferma di aver letto l’informativa privacy.";
    for (const key of ["primaryColor","accentColor"] as const) if (!/^#[0-9a-fA-F]{6}$/.test(form[key])) errors[key] = "Usa un colore nel formato #123456.";
    return errors;
  };
  const goToNextStep = () => {
    if (lock.current || createdAccount.current) return;
    const errors = errorsForStep(currentStep); setFieldErrors(errors); setError(null);
    if (Object.keys(errors).length) { setError("Controlla i campi evidenziati prima di continuare."); return; }
    if (currentStep === 0) trackSignupEvent("SIGNUP_STARTED", { entry: "company_details" });
    setCurrentStep(step => Math.min(step + 1, SIGNUP_STEPS.length - 1));
  };
  const goToPreviousStep = () => {
    if (lock.current) return;
    setError(null); setFieldErrors({}); setCurrentStep(step => Math.max(step - 1, 0));
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (lock.current || createdAccount.current) return;
    if (currentStep < 2) { goToNextStep(); return; }
    for (let step = 0; step < SIGNUP_STEPS.length; step++) {
      const errors = errorsForStep(step);
      if (Object.keys(errors).length) { setCurrentStep(step); setFieldErrors(errors); setError("Controlla i campi evidenziati prima di creare l’account."); return; }
    }
    lock.current = true; setLoading(true); setError(null); setFieldErrors({});

    try {
      const tenantName = cleanText(form.tenantName);
      const firstName = cleanText(form.firstName);
      const lastName = cleanText(form.lastName);
      const email = cleanText(form.email).toLowerCase();
      const companyEmail = optionalText(form.companyEmail)?.toLowerCase() ?? email;
      const country = optionalText(form.country) ?? "IT";
      const verificationDocument = form.chamberOfCommerceFile;
      const result = await authUseCases.signup({
        tenantName,
        firstName,
        lastName,
        email,
        password: form.password,
        phone: optionalText(form.adminPhone),
        adminRole: optionalText(form.adminRole),
        privacyAccepted,
        company: {
          legalName: tenantName,
          tradeName: tenantName,
          legalForm: optionalText(form.legalForm),
          vatNumber: optionalText(normalizeVatNumberForCountry(form.vatNumber, country)),
          taxCode: optionalText(normalizeTaxCode(form.taxCode)),
          pec: optionalText(form.pec)?.toLowerCase(),
          sdiCode: optionalText(normalizeSdiCode(form.sdiCode)),
          legalAddress: optionalText(form.legalAddress),
          city: optionalText(form.city),
          province: optionalText(form.province),
          postalCode: optionalText(normalizePostalCodeForCountry(form.postalCode, country)),
          country,
          phone: optionalText(form.companyPhone),
          email: companyEmail,
          website: optionalText(form.website),
          adminFirstName: firstName,
          adminLastName: lastName,
          adminEmail: email,
          adminPhone: optionalText(form.adminPhone),
          adminRole: optionalText(form.adminRole),
          primaryColor: form.primaryColor,
          accentColor: form.accentColor
        }
      });
      if (!alive.current) return;
      createdAccount.current = result.tenantId;
      setTenantId(result.tenantId);
      setSession(result.user, true);
      setForm(current => ({ ...current, password: "" }));
      trackSignupEvent("SIGNUP_COMPLETED", { source: "email" });
      trackSignupEvent("ONBOARDING_COMPANY_COMPLETED", { source: "email_signup", country });
      if (verificationDocument) {
        try { await tenantProfileUseCases.uploadCompanyVerificationDocument(verificationDocument); }
        catch { if (alive.current) setError("L’account è stato creato, ma il documento non è stato caricato. Puoi riprovare l’allegato oppure continuare alla scelta del piano."); return; }
      }
      if (!alive.current) return;
      setForm(initialForm);
      setPrivacyAccepted(false);
      setCurrentStep(SIGNUP_STEPS.length - 1);
      if (alive.current) navigate(getActivationPath(location.search), { replace: true });
    } catch (err) {
      if (alive.current) setError((err as Error).message);
    } finally {
      lock.current = false; if (alive.current) setLoading(false);
    }
  };

  const startAnotherSignup = () => {
    if (lock.current) return;
    createdAccount.current = null; setFieldErrors({});
    setTenantId(null);
    setError(null);
    setForm(initialForm);
    setPrivacyAccepted(false);
    setCurrentStep(0);
  };

  const goToBillingAfterSignup = () => {
    if (!lock.current && createdAccount.current) navigate(getActivationPath(location.search), { replace: true });
  };

  const retryDocument = async () => {
    if (!createdAccount.current || !form.chamberOfCommerceFile || lock.current) return;
    lock.current = true; setLoading(true); setError(null);
    try { await tenantProfileUseCases.uploadCompanyVerificationDocument(form.chamberOfCommerceFile); if (alive.current) setForm(current => ({ ...current,chamberOfCommerceFile: null })); }
    catch (e) { if (alive.current) setError("Account già creato. Il documento non è stato caricato: puoi riprovare o continuare al piano."); }
    finally { lock.current = false; if (alive.current) setLoading(false); }
  };
  return <AccessShell title="Crea il tuo account Fleetum" description="Tre passaggi per configurare l’azienda e il tuo accesso. Il piano si sceglie dopo la registrazione." wide>
    {tenantId ? <div className="premium-signup-success"><AccessNotice tone="success" focus>Account creato. I dati aziendali sono stati salvati.</AccessNotice>{error ? <AccessNotice>{error}</AccessNotice> : null}<p className="access-hint">Per iniziare scegli un piano e completa l’attivazione. La prova dura 14 giorni e richiede una carta; il primo addebito parte al termine della prova.</p><div className="premium-signup-success__actions"><button className="premium-login-submit" type="button" onClick={goToBillingAfterSignup} disabled={loading}>Continua alla scelta del piano</button>{form.chamberOfCommerceFile ? <button className="premium-login-social-btn" type="button" onClick={() => void retryDocument()} disabled={loading}>Riprova allegato</button> : null}<button className="premium-login-social-btn" type="button" onClick={startAnotherSignup} disabled={loading}>Crea un’altra azienda</button></div></div> : (
            <form onSubmit={onSubmit} className="premium-login-form" onChangeCapture={event => { const input = event.target as HTMLInputElement; const key = input.name === 'municipalityCode' ? 'city' : input.name || input.id.replace('signup-', ''); setFieldErrors(current => { const next = { ...current }; delete next[key]; return next; }); setError(null); }} noValidate aria-busy={loading}><fieldset className="access-fields" disabled={loading}>
              <div className="premium-login-social-grid premium-login-social-grid--single">
                <button
                  type="button"
                  data-cursor="hover"
                  className="premium-login-social-btn premium-login-social-btn--google"
                  onClick={openGoogleSignup}
                  disabled={loading}
                >
                  <GoogleLogo />
                  <span>Continua con Google</span>
                </button>
              </div>

              <div className="premium-login-divider">o continua con registrazione</div>

              <div className="premium-signup-stepper" style={signupProgressStyle} aria-label="Avanzamento registrazione">
                <div className="premium-signup-stepper__meta">
                  <span>Registrazione guidata</span>
                  <strong>{`Passaggio ${currentStep + 1} di ${SIGNUP_STEPS.length}`}</strong>
                </div>
                <div className="premium-signup-stepper__track" aria-hidden>
                  <span />
                </div>
                <div className="premium-signup-stepper__steps">
                  {SIGNUP_STEPS.map((signupStep, index) => {
                    const isActive = currentStep === index;
                    const isDone = currentStep > index;

                    return (
                      <button
                        key={signupStep.title}
                        type="button"
                        className={`premium-signup-stepper__step ${isActive ? "is-active" : ""} ${isDone ? "is-done" : ""}`}
                        aria-current={isActive ? "step" : undefined}
                        disabled={loading || index >= currentStep}
                        onClick={() => {
                          if (!lock.current && index < currentStep) {
                            setFieldErrors({});
                            setError(null);
                            setCurrentStep(index);
                          }
                        }}
                      >
                        <span className="premium-signup-stepper__dot">{isDone ? "✓" : index + 1}</span>
                        <span className="premium-signup-stepper__copy">
                          <span>{signupStep.title}</span>
                          <small>{signupStep.subtitle}</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {currentStep === 0 ? (
                <div className="rounded-2xl border border-white/60 bg-white/45 p-3 shadow-[0_18px_45px_-36px_rgba(15,23,42,0.55)]">
                  <h2 id="signup-step-title" tabIndex={-1} className="mb-4 text-sm font-semibold">Step 1 · Dati aziendali
                  </h2>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="md:col-span-2">
                      <label className="premium-login-field-label" htmlFor="signup-tenantName">Nome azienda *</label>
                      <div className={`premium-login-field ${form.tenantName ? "is-ok" : ""}`}>
                        <FieldIcon><Building2 /></FieldIcon>
                        <input
                          id="signup-tenantName"
                          name="tenantName"
                          value={form.tenantName}
                          onChange={(event) => setForm((current) => ({ ...current, tenantName: event.target.value }))}
                          placeholder="Es. Fleetum Italia"
                          required aria-invalid={Boolean(fieldErrors.tenantName)} aria-describedby={fieldErrors.tenantName ? "signup-tenantName-error" : undefined} autoComplete="organization"
                        />
                      </div>{fieldErrors.tenantName ? <p className="access-field-error" id="signup-tenantName-error">{fieldErrors.tenantName}</p> : null}
                    </div>
                    <div>
                      <label className="premium-login-field-label" htmlFor="signup-vatNumber">{isItalianCompany ? "Partita IVA" : "VAT / Tax ID"} *</label>
                      <div className={`premium-login-field ${vatFieldLooksComplete ? "is-ok" : ""}`}>
                        <FieldIcon><Briefcase /></FieldIcon>
                        <input
                          id="signup-vatNumber"
                          name="vatNumber"
                          value={form.vatNumber}
                          onChange={(event) => setForm((current) => ({ ...current, vatNumber: normalizeVatNumberForCountry(event.target.value, current.country) }))}
                          placeholder={isItalianCompany ? "11 cifre" : "Identificativo fiscale aziendale"}
                          required aria-invalid={Boolean(fieldErrors.vatNumber)} aria-describedby={fieldErrors.vatNumber ? "signup-vatNumber-error" : undefined}
                        />
                      </div>{fieldErrors.vatNumber ? <p className="access-field-error" id="signup-vatNumber-error">{fieldErrors.vatNumber}</p> : null}
                    </div>
                    <div>
                      <label className="premium-login-field-label" htmlFor="signup-legalForm">Forma giuridica</label>
                      <div className={`premium-login-field ${form.legalForm ? "is-ok" : ""}`}>
                        <FieldIcon><Scale /></FieldIcon>
                        <input
                          id="signup-legalForm"
                          name="legalForm"
                          value={form.legalForm}
                          onChange={(event) => setForm((current) => ({ ...current, legalForm: event.target.value }))}
                          placeholder="SRL, SPA, ditta individuale..." aria-invalid={Boolean(fieldErrors.legalForm)} aria-describedby={fieldErrors.legalForm ? "signup-legalForm-error" : undefined}
                        />
                      </div>{fieldErrors.legalForm ? <p className="access-field-error" id="signup-legalForm-error">{fieldErrors.legalForm}</p> : null}
                    </div>
                    <div>
                      <label className="premium-login-field-label" htmlFor="signup-taxCode">Codice fiscale azienda</label>
                      <div className={`premium-login-field ${form.taxCode ? "is-ok" : ""}`}>
                        <FieldIcon><Hash /></FieldIcon>
                        <input
                          id="signup-taxCode"
                          name="taxCode"
                          value={form.taxCode}
                          onChange={(event) => setForm((current) => ({ ...current, taxCode: normalizeTaxCode(event.target.value) }))}
                          placeholder="Opzionale" aria-invalid={Boolean(fieldErrors.taxCode)} aria-describedby={fieldErrors.taxCode ? "signup-taxCode-error" : undefined}
                        />
                      </div>{fieldErrors.taxCode ? <p className="access-field-error" id="signup-taxCode-error">{fieldErrors.taxCode}</p> : null}
                    </div>
                    <div>
                      <label className="premium-login-field-label" htmlFor="signup-companyEmail">Email aziendale *</label>
                      <div className={`premium-login-field ${form.companyEmail.includes("@") ? "is-ok" : ""}`}>
                        <FieldIcon><Mail /></FieldIcon>
                        <input
                          id="signup-companyEmail"
                          name="companyEmail"
                          type="email"
                          value={form.companyEmail}
                          onChange={(event) => setForm((current) => ({ ...current, companyEmail: event.target.value }))}
                          placeholder="info@azienda.com"
                          required aria-invalid={Boolean(fieldErrors.companyEmail)} aria-describedby={fieldErrors.companyEmail ? "signup-companyEmail-error" : undefined}
                        />
                      </div>{fieldErrors.companyEmail ? <p className="access-field-error" id="signup-companyEmail-error">{fieldErrors.companyEmail}</p> : null}
                    </div>
                    <div>
                      <label className="premium-login-field-label" htmlFor="signup-companyPhone">Telefono aziendale *</label>
                      <div className={`premium-login-field ${form.companyPhone ? "is-ok" : ""}`}>
                        <FieldIcon><Phone /></FieldIcon>
                        <input
                          id="signup-companyPhone"
                          name="companyPhone"
                          value={form.companyPhone}
                          onChange={(event) => setForm((current) => ({ ...current, companyPhone: event.target.value }))}
                          placeholder="+39..."
                          required aria-invalid={Boolean(fieldErrors.companyPhone)} aria-describedby={fieldErrors.companyPhone ? "signup-companyPhone-error" : undefined} autoComplete="tel"
                        />
                      </div>{fieldErrors.companyPhone ? <p className="access-field-error" id="signup-companyPhone-error">{fieldErrors.companyPhone}</p> : null}
                    </div>
                    <div>
                      <label className="premium-login-field-label" htmlFor="signup-website">Sito web</label>
                      <div className={`premium-login-field ${form.website ? "is-ok" : ""}`}>
                        <FieldIcon><Globe /></FieldIcon>
                        <input
                          id="signup-website"
                          name="website"
                          value={form.website}
                          onChange={(event) => setForm((current) => ({ ...current, website: event.target.value }))}
                          placeholder="https://azienda.it" aria-invalid={Boolean(fieldErrors.website)} aria-describedby={fieldErrors.website ? "signup-website-error" : undefined}
                        />
                      </div>{fieldErrors.website ? <p className="access-field-error" id="signup-website-error">{fieldErrors.website}</p> : null}
                    </div>
                    <div className="md:col-span-2">
                      <label className="premium-login-field-label" htmlFor="signup-legalAddress">Sede legale *</label>
                      <div className={`premium-login-field ${form.legalAddress ? "is-ok" : ""}`}>
                        <FieldIcon><MapPin /></FieldIcon>
                        <input
                          id="signup-legalAddress"
                          name="legalAddress"
                          value={form.legalAddress}
                          onChange={(event) => setForm((current) => ({ ...current, legalAddress: event.target.value }))}
                          placeholder="Via, numero civico"
                          required aria-invalid={Boolean(fieldErrors.legalAddress)} aria-describedby={fieldErrors.legalAddress ? "signup-legalAddress-error" : undefined} autoComplete="street-address"
                        />
                      </div>{fieldErrors.legalAddress ? <p className="access-field-error" id="signup-legalAddress-error">{fieldErrors.legalAddress}</p> : null}
                    </div>
                    <div className="grid grid-cols-1 gap-3 md:col-span-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                      <div className="min-w-0">
                        <label className="premium-login-field-label" htmlFor="signup-country">Nazione *</label>
                        <div className="premium-login-field is-ok">
                          <FieldIcon><Globe /></FieldIcon>
                          <select
                            id="signup-country"
                            name="country"
                            value={form.country}
                            onChange={(event) => handleCountryChange(event.target.value)}
                            required aria-invalid={Boolean(fieldErrors.country)} aria-describedby={fieldErrors.country ? "signup-country-error" : undefined}
                          >
                            {COUNTRIES.map((country) => (
                              <option key={country.code} value={country.code}>{country.name}</option>
                            ))}
                          </select>
                        </div>{fieldErrors.country ? <p className="access-field-error" id="signup-country-error">{fieldErrors.country}</p> : null}
                      </div>
                      {isItalianCompany ? (
                        <div className="min-w-0">
                          <label className="premium-login-field-label" htmlFor="signup-region">Regione *</label>
                          <div className={`premium-login-field ${form.region ? "is-ok" : ""}`}>
                            <FieldIcon><Map /></FieldIcon>
                            <select
                              id="signup-region"
                              name="region"
                              value={form.region}
                              onChange={(event) => handleRegionChange(event.target.value)}
                              required
                              disabled={geoLoading || !italianGeo} aria-invalid={Boolean(fieldErrors.region)} aria-describedby={fieldErrors.region ? "signup-region-error" : undefined}
                            >
                              <option value="">{geoLoading ? "Caricamento regioni..." : "Seleziona regione"}</option>
                              {(italianGeo?.regions ?? []).map((region) => (
                                <option key={region} value={region}>{region}</option>
                              ))}
                            </select>
                          </div>{fieldErrors.region ? <p className="access-field-error" id="signup-region-error">{fieldErrors.region}</p> : null}
                        </div>
                      ) : null}
                    </div>
                    {isItalianCompany ? (
                      <div className="grid grid-cols-1 gap-3 md:col-span-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,0.65fr)]">
                        <div className="min-w-0">
                          <label className="premium-login-field-label" htmlFor="signup-province">Provincia *</label>
                          <div className={`premium-login-field ${form.province ? "is-ok" : ""}`}>
                            <select
                              id="signup-province"
                              name="province"
                              value={form.province}
                              onChange={(event) => handleProvinceChange(event.target.value)}
                              required
                              disabled={!form.region || !italianGeo} aria-invalid={Boolean(fieldErrors.province)} aria-describedby={fieldErrors.province ? "signup-province-error" : undefined}
                            >
                              <option value="">Seleziona provincia</option>
                              {provinceOptions.map((province) => (
                                <option key={province.code} value={province.code}>{province.name} ({province.code})</option>
                              ))}
                            </select>
                          </div>{fieldErrors.province ? <p className="access-field-error" id="signup-province-error">{fieldErrors.province}</p> : null}
                        </div>
                        <div className="min-w-0">
                          <label className="premium-login-field-label" htmlFor="signup-municipality">Comune *</label>
                          <div className={`premium-login-field ${form.city ? "is-ok" : ""}`}>
                            <FieldIcon><Map /></FieldIcon>
                            <select
                              id="signup-municipality"
                              name="municipalityCode"
                              value={form.municipalityCode}
                              onChange={(event) => handleMunicipalityChange(event.target.value)}
                              required
                              disabled={!form.province || !italianGeo} aria-invalid={Boolean(fieldErrors.city)} aria-describedby={fieldErrors.city ? "signup-municipality-error" : undefined}
                            >
                              <option value="">Seleziona comune</option>
                              {municipalityOptions.map((municipality) => (
                                <option key={municipality.code} value={municipality.code}>{municipality.name}</option>
                              ))}
                            </select>
                          </div>{fieldErrors.city ? <p className="access-field-error" id="signup-municipality-error">{fieldErrors.city}</p> : null}
                          {selectedMunicipality ? (
                            <p className="mt-1 text-[11px] text-slate-500">
                              ISTAT {selectedMunicipality.istatCode} · Catastale {selectedMunicipality.cadastralCode ?? "n.d."}
                            </p>
                          ) : null}
                        </div>
                        <div className="min-w-0">
                          <label className="premium-login-field-label" htmlFor="signup-postalCode">CAP *</label>
                          <div className={`premium-login-field ${form.postalCode ? "is-ok" : ""}`}>
                            <input
                              id="signup-postalCode"
                              name="postalCode"
                              value={form.postalCode}
                              onChange={(event) => setForm((current) => ({ ...current, postalCode: normalizePostalCode(event.target.value) }))}
                              placeholder="80100"
                              required aria-invalid={Boolean(fieldErrors.postalCode)} aria-describedby={fieldErrors.postalCode ? "signup-postalCode-error" : undefined} autoComplete="postal-code"
                            />
                          </div>{fieldErrors.postalCode ? <p className="access-field-error" id="signup-postalCode-error">{fieldErrors.postalCode}</p> : null}
                          {selectedMunicipality && selectedMunicipality.postalCodes.length > 1 ? (
                            <p className="mt-1 text-[11px] text-slate-500">Comune multi-CAP: inserisci il CAP corretto della sede.</p>
                          ) : null}
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-3 md:col-span-2 md:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,0.8fr)]">
                        <div className="min-w-0">
                          <label className="premium-login-field-label" htmlFor="signup-city">Città *</label>
                          <div className={`premium-login-field ${form.city ? "is-ok" : ""}`}>
                            <FieldIcon><Map /></FieldIcon>
                            <input
                              id="signup-city"
                              name="city"
                              value={form.city}
                              onChange={(event) => setForm((current) => ({ ...current, city: event.target.value }))}
                              placeholder="Città"
                              required aria-invalid={Boolean(fieldErrors.city)} aria-describedby={fieldErrors.city ? "signup-city-error" : undefined}
                            />
                          </div>{fieldErrors.city ? <p className="access-field-error" id="signup-city-error">{fieldErrors.city}</p> : null}
                        </div>
                        <div className="min-w-0">
                          <label className="premium-login-field-label" htmlFor="signup-province">Provincia/Area *</label>
                          <div className={`premium-login-field ${form.province ? "is-ok" : ""}`}>
                            <input
                              id="signup-province"
                              name="province"
                              value={form.province}
                              onChange={(event) => setForm((current) => ({ ...current, province: event.target.value.toUpperCase() }))}
                              placeholder="Area"
                              required aria-invalid={Boolean(fieldErrors.province)} aria-describedby={fieldErrors.province ? "signup-province-error" : undefined}
                            />
                          </div>{fieldErrors.province ? <p className="access-field-error" id="signup-province-error">{fieldErrors.province}</p> : null}
                        </div>
                        <div className="min-w-0">
                          <label className="premium-login-field-label" htmlFor="signup-postalCode">Codice postale *</label>
                          <div className={`premium-login-field ${form.postalCode ? "is-ok" : ""}`}>
                            <input
                              id="signup-postalCode"
                              name="postalCode"
                              value={form.postalCode}
                              onChange={(event) => setForm((current) => ({ ...current, postalCode: normalizePostalCodeForCountry(event.target.value, current.country) }))}
                              placeholder="Codice postale"
                              required aria-invalid={Boolean(fieldErrors.postalCode)} aria-describedby={fieldErrors.postalCode ? "signup-postalCode-error" : undefined} autoComplete="postal-code"
                            />
                          </div>{fieldErrors.postalCode ? <p className="access-field-error" id="signup-postalCode-error">{fieldErrors.postalCode}</p> : null}
                        </div>
                      </div>
                    )}
                    <div>
                      <label className="premium-login-field-label" htmlFor="signup-pec">PEC</label>
                      <div className={`premium-login-field ${form.pec.includes("@") ? "is-ok" : ""}`}>
                        <FieldIcon><AtSign /></FieldIcon>
                        <input
                          id="signup-pec"
                          name="pec"
                          type="email"
                          value={form.pec}
                          onChange={(event) => setForm((current) => ({ ...current, pec: event.target.value }))}
                          placeholder="pec@azienda.it" aria-invalid={Boolean(fieldErrors.pec)} aria-describedby={fieldErrors.pec ? "signup-pec-error" : undefined}
                        />
                      </div>{fieldErrors.pec ? <p className="access-field-error" id="signup-pec-error">{fieldErrors.pec}</p> : null}
                    </div>
                    <div>
                      <label className="premium-login-field-label" htmlFor="signup-sdiCode">Codice SDI</label>
                      <div className={`premium-login-field ${form.sdiCode.length === 7 ? "is-ok" : ""}`}>
                        <FieldIcon><Hash /></FieldIcon>
                        <input
                          id="signup-sdiCode"
                          name="sdiCode"
                          value={form.sdiCode}
                          onChange={(event) => setForm((current) => ({ ...current, sdiCode: normalizeSdiCode(event.target.value) }))}
                          placeholder="7 caratteri" aria-invalid={Boolean(fieldErrors.sdiCode)} aria-describedby={fieldErrors.sdiCode ? "signup-sdiCode-error" : undefined}
                        />
                      </div>{fieldErrors.sdiCode ? <p className="access-field-error" id="signup-sdiCode-error">{fieldErrors.sdiCode}</p> : null}
                      <p className="mt-1 text-[11px] text-slate-500">
                        Formato controllato. La verifica effettiva sarà manuale o tramite provider; la PEC resta obbligatoria.
                      </p>
                    </div>
                    <div className="md:col-span-2 rounded-2xl border border-slate-200/70 bg-white/65 p-3">
                      <label className="premium-login-field-label" htmlFor="signup-chamber-doc">Visura camerale per verifica aziendale</label>
                      <div className="premium-login-field mt-1">
                        <FieldIcon><FileText /></FieldIcon>
                        <input
                          id="signup-chamber-doc"
                          name="chamberOfCommerceFile"
                          type="file"
                          accept="application/pdf,image/jpeg,image/png"
                          onChange={(event) => setForm((current) => ({ ...current, chamberOfCommerceFile: event.target.files?.[0] ?? null }))}
                        />
                      </div>
                      <p className="mt-2 text-[11px] leading-5 text-slate-500">
                        Opzionale in questa fase: serve a verificare ragione sociale, P.IVA e sede legale. Non dimostra da sola che lo SDI sia attivo.
                      </p>
                      {form.chamberOfCommerceFile ? (
                        <p className="mt-1 text-xs font-semibold text-slate-700">
                          File selezionato: {form.chamberOfCommerceFile.name}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}

              {currentStep === 1 ? (
                <div className="rounded-2xl border border-white/60 bg-white/45 p-3 shadow-[0_18px_45px_-36px_rgba(15,23,42,0.55)]">
                  <h2 id="signup-step-title" tabIndex={-1} className="mb-4 text-sm font-semibold">Step 2 · Referente e accesso admin
                  </h2>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div>
                      <label className="premium-login-field-label" htmlFor="signup-firstName">Nome</label>
                      <div className={`premium-login-field ${form.firstName ? "is-ok" : ""}`}>
                        <FieldIcon><User /></FieldIcon>
                        <input
                          id="signup-firstName"
                          name="firstName"
                          value={form.firstName}
                          onChange={(event) => setForm((current) => ({ ...current, firstName: event.target.value }))}
                          placeholder="Nome"
                          required aria-invalid={Boolean(fieldErrors.firstName)} aria-describedby={fieldErrors.firstName ? "signup-firstName-error" : undefined} autoComplete="given-name"
                        />
                      </div>{fieldErrors.firstName ? <p className="access-field-error" id="signup-firstName-error">{fieldErrors.firstName}</p> : null}
                    </div>
                    <div>
                      <label className="premium-login-field-label" htmlFor="signup-lastName">Cognome</label>
                      <div className={`premium-login-field ${form.lastName ? "is-ok" : ""}`}>
                        <FieldIcon><User /></FieldIcon>
                        <input
                          id="signup-lastName"
                          name="lastName"
                          value={form.lastName}
                          onChange={(event) => setForm((current) => ({ ...current, lastName: event.target.value }))}
                          placeholder="Cognome"
                          required aria-invalid={Boolean(fieldErrors.lastName)} aria-describedby={fieldErrors.lastName ? "signup-lastName-error" : undefined} autoComplete="family-name"
                        />
                      </div>{fieldErrors.lastName ? <p className="access-field-error" id="signup-lastName-error">{fieldErrors.lastName}</p> : null}
                    </div>
                    <div>
                      <label className="premium-login-field-label" htmlFor="signup-adminPhone">Telefono referente</label>
                      <div className={`premium-login-field ${form.adminPhone ? "is-ok" : ""}`}>
                        <FieldIcon><Phone /></FieldIcon>
                        <input
                          id="signup-adminPhone"
                          name="adminPhone"
                          value={form.adminPhone}
                          onChange={(event) => setForm((current) => ({ ...current, adminPhone: event.target.value }))}
                          placeholder="+39..." aria-invalid={Boolean(fieldErrors.adminPhone)} aria-describedby={fieldErrors.adminPhone ? "signup-adminPhone-error" : undefined} autoComplete="tel"
                        />
                      </div>{fieldErrors.adminPhone ? <p className="access-field-error" id="signup-adminPhone-error">{fieldErrors.adminPhone}</p> : null}
                    </div>
                    <div>
                      <label className="premium-login-field-label" htmlFor="signup-adminRole">Ruolo in azienda</label>
                      <div className={`premium-login-field ${form.adminRole ? "is-ok" : ""}`}>
                        <FieldIcon><Star /></FieldIcon>
                        <input
                          id="signup-adminRole"
                          name="adminRole"
                          value={form.adminRole}
                          onChange={(event) => setForm((current) => ({ ...current, adminRole: event.target.value }))}
                          placeholder="Owner, admin, operations..." aria-invalid={Boolean(fieldErrors.adminRole)} aria-describedby={fieldErrors.adminRole ? "signup-adminRole-error" : undefined}
                        />
                      </div>{fieldErrors.adminRole ? <p className="access-field-error" id="signup-adminRole-error">{fieldErrors.adminRole}</p> : null}
                    </div>
                    <div className="md:col-span-2">
                      <label className="premium-login-field-label" htmlFor="signup-email">Email login</label>
                      <div className={`premium-login-field ${isEmailValid ? "is-ok" : ""}`}>
                        <FieldIcon><Mail /></FieldIcon>
                        <input
                          id="signup-email"
                          name="email"
                          type="email"
                          value={form.email}
                          onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                          placeholder="admin@azienda.com"
                          autoComplete="email"
                          required aria-invalid={Boolean(fieldErrors.email)} aria-describedby={fieldErrors.email ? "signup-email-error" : undefined}
                        />
                      </div>{fieldErrors.email ? <p className="access-field-error" id="signup-email-error">{fieldErrors.email}</p> : null}
                    </div>
                    <div className="md:col-span-2">
                      <label className="premium-login-field-label" htmlFor="signup-password">Password</label>
                      <div className={`premium-login-field ${isPasswordStrong ? "is-ok" : ""}`}>
                        <FieldIcon><Lock /></FieldIcon>
                        <input
                          id="signup-password"
                          name="password"
                          type={passwordVisible ? "text" : "password"}
                          value={form.password}
                          onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                          placeholder="Min. 8 caratteri, maiuscola, numero e simbolo"
                          autoComplete="new-password"
                          required aria-invalid={Boolean(fieldErrors.password)} aria-describedby={fieldErrors.password ? "signup-password-error" : undefined}
                        />
                        <button type="button" className="access-signup-password-toggle" aria-label={passwordVisible ? "Nascondi password" : "Mostra password"} aria-pressed={passwordVisible} onClick={() => setPasswordVisible(value => !value)}>{passwordVisible ? "Nascondi" : "Mostra"}</button>
                      </div>{fieldErrors.password ? <p className="access-field-error" id="signup-password-error">{fieldErrors.password}</p> : null}
                      <p className="mt-2 text-xs text-slate-500">
                        Usa almeno 8 caratteri con una maiuscola, un numero e un simbolo.
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}

              {currentStep === 2 ? (
                <div className="rounded-2xl border border-white/60 bg-white/45 p-3 shadow-[0_18px_45px_-36px_rgba(15,23,42,0.55)]">
                  <h2 id="signup-step-title" tabIndex={-1} className="mb-4 text-sm font-semibold">Step 3 · Conferma workspace
                  </h2>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="access-summary rounded-2xl border border-slate-200/70 bg-white/70 p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Azienda</p>
                      <p className="mt-2 text-base font-semibold text-slate-900">{form.tenantName || "Non indicata"}</p>
                      <p className="mt-1 text-sm text-slate-500">{form.companyEmail || form.email || "Email non indicata"}</p>
                    </div>
                    <div className="access-summary rounded-2xl border border-slate-200/70 bg-white/70 p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Admin</p>
                      <p className="mt-2 text-base font-semibold text-slate-900">
                        {[form.firstName, form.lastName].filter(Boolean).join(" ") || "Non indicato"}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">{form.email || "Email login non indicata"}</p>
                    </div>
                    <div>
                      <label className="premium-login-field-label" htmlFor="signup-primaryColor">Colore primario</label>
                      <div className={`premium-login-field ${form.primaryColor ? "is-ok" : ""}`}>
                        <FieldIcon><Palette style={{ color: form.primaryColor }} /></FieldIcon>
                        <input
                          id="signup-primaryColor"
                          name="primaryColor"
                          type="text"
                          value={form.primaryColor}
                          onChange={(event) => setForm((current) => ({ ...current, primaryColor: event.target.value }))}
                          placeholder="#21375d" aria-invalid={Boolean(fieldErrors.primaryColor)} aria-describedby={fieldErrors.primaryColor ? "signup-primaryColor-error" : undefined}
                        />
                      </div>{fieldErrors.primaryColor ? <p className="access-field-error" id="signup-primaryColor-error">{fieldErrors.primaryColor}</p> : null}
                    </div>
                    <div>
                      <label className="premium-login-field-label" htmlFor="signup-accentColor">Colore accento</label>
                      <div className={`premium-login-field ${form.accentColor ? "is-ok" : ""}`}>
                        <FieldIcon><Palette style={{ color: form.accentColor }} /></FieldIcon>
                        <input
                          id="signup-accentColor"
                          name="accentColor"
                          type="text"
                          value={form.accentColor}
                          onChange={(event) => setForm((current) => ({ ...current, accentColor: event.target.value }))}
                          placeholder="#5d82c2" aria-invalid={Boolean(fieldErrors.accentColor)} aria-describedby={fieldErrors.accentColor ? "signup-accentColor-error" : undefined}
                        />
                      </div>{fieldErrors.accentColor ? <p className="access-field-error" id="signup-accentColor-error">{fieldErrors.accentColor}</p> : null}
                    </div>
                  </div>

                  <label className="premium-login-check mt-4 items-start" htmlFor="signup-privacy">
                    <input
                      id="signup-privacy"
                      type="checkbox"
                      checked={privacyAccepted}
                      onChange={(event) => setPrivacyAccepted(event.target.checked)}
                      required aria-invalid={Boolean(fieldErrors.privacy)} aria-describedby={fieldErrors.privacy ? "signup-privacy-error" : undefined}
                    />
                    <span className="leading-5">
                      Ho letto l'{" "}
                      <Link className="premium-login-link" to="/privacy" target="_blank" rel="noreferrer">
                        informativa privacy
                      </Link>{" "}
                      e confermo la presa visione.
                    </span>
                  </label>{fieldErrors.privacy ? <p className="access-field-error" id="signup-privacy-error">{fieldErrors.privacy}</p> : null}
                </div>
              ) : null}

              {tenantId ? (
                <p className="premium-login-error premium-login-error--block" style={{ color: "#065f46", background: "rgba(209,250,229,0.8)", borderColor: "rgba(16,185,129,0.45)" }}>
                  Tenant creato con successo: {tenantId}
                </p>
              ) : null}

              {error ? <AccessNotice focus>{error}</AccessNotice> : null}

              <div className="flex flex-col gap-3 sm:flex-row">
                {currentStep > 0 ? (
                  <button
                    type="button"
                    className="premium-login-social-btn justify-center"
                    onClick={goToPreviousStep}
                    disabled={loading}
                  >
                    Indietro
                  </button>
                ) : null}

                {currentStep < SIGNUP_STEPS.length - 1 ? (
                  <button type="button" className="premium-login-submit" onClick={event => { event.preventDefault(); goToNextStep(); }} disabled={loading}>
                    <span className="premium-login-submit-shimmer" aria-hidden />
                    {currentStep === 0 ? "Continua con referente" : "Continua alla conferma"}
                  </button>
                ) : (
                  <button type="submit" className="premium-login-submit" disabled={loading}>
                    <span className="premium-login-submit-shimmer" aria-hidden />
                    {loading ? (
                      <span className="premium-login-loading">
                        <FleetumLogoLoader size="sm" variant="dark" decorative className="fleetum-loader--button" />
                        Creazione account...
                      </span>
                    ) : (
                      "Crea account"
                    )}
                  </button>
                )}
              </div>

              <p className="premium-login-signup-text">
                Hai già un account?
                <button type="button" className="premium-login-link" onClick={() => navigate("/login")}>Vai al login →</button>
              </p>
            </fieldset></form>
    )}
  </AccessShell>;
};
