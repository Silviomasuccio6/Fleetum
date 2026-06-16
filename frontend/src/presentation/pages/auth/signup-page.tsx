import { type CSSProperties, type ReactNode, FormEvent, useEffect, useState } from "react";
import { AtSign, Briefcase, Building2, Globe, Hash, Lock, Mail, Map, MapPin, Palette, Phone, Scale, Star, User } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { authUseCases } from "../../../application/usecases/auth-usecases";
import { getApiBaseUrl } from "../../../infrastructure/api/api-base-url";
import { FleetumLogoLoader } from "../../components/brand/fleetum-logo-loader";
import { MagneticOrbs } from "../../../features/auth/components/MagneticOrbs";
import { ParticleCanvas } from "../../../features/auth/components/ParticleCanvas";
import "../../../features/auth/premium-login.css";

const SIGNUP_STEPS = [
  {
    title: "Azienda",
    subtitle: "Dati tenant e fiscali"
  },
  {
    title: "Referente",
    subtitle: "Admin iniziale"
  },
  {
    title: "Conferma",
    subtitle: "Branding e privacy"
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

const AppleLogo = () => (
  <svg className="premium-login-social-icon" viewBox="0 0 24 24" aria-hidden>
    <path
      fill="currentColor"
      d="M16.37 12.6c.03 3.12 2.74 4.16 2.77 4.18-.02.08-.43 1.5-1.42 2.97-.86 1.26-1.75 2.5-3.16 2.53-1.38.03-1.82-.82-3.4-.82-1.58 0-2.07.8-3.37.85-1.36.05-2.4-1.36-3.27-2.61-1.77-2.56-3.12-7.23-1.31-10.37.9-1.56 2.52-2.55 4.28-2.58 1.33-.03 2.58.9 3.4.9.82 0 2.37-1.11 3.98-.95.67.03 2.54.27 3.75 2.03-.1.06-2.24 1.31-2.25 3.87Zm-2.1-8.76c.72-.87 1.2-2.08 1.06-3.28-1.04.04-2.3.69-3.05 1.56-.67.77-1.26 2.01-1.1 3.2 1.16.09 2.36-.59 3.08-1.48Z"
    />
  </svg>
);


const FieldIcon = ({ children }: { children: ReactNode }) => (
  <span className="premium-login-field-icon-wrap">{children}</span>
);

const initialForm = {
  tenantName: "",
  legalForm: "",
  vatNumber: "",
  taxCode: "",
  pec: "",
  sdiCode: "",
  legalAddress: "",
  city: "",
  province: "",
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
  accentColor: "#5d82c2"
};

export const SignupPage = () => {
  const navigate = useNavigate();

  const [form, setForm] = useState(initialForm);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  const apiBaseUrl = getApiBaseUrl();
  const googleAuthUrl = (import.meta.env.VITE_GOOGLE_AUTH_URL as string | undefined) ?? `${apiBaseUrl}/auth/google`;
  const appleAuthUrl = (import.meta.env.VITE_APPLE_AUTH_URL as string | undefined) ?? `${apiBaseUrl}/auth/apple`;


  useEffect(() => {
    const previousTheme = document.documentElement.getAttribute("data-theme");
    document.documentElement.setAttribute("data-theme", "light");

    return () => {
      if (previousTheme) {
        document.documentElement.setAttribute("data-theme", previousTheme);
      } else {
        document.documentElement.removeAttribute("data-theme");
      }
    };
  }, []);

  const openSocialAuth = (provider: "google" | "apple") => {
    const providerUrl = provider === "google" ? googleAuthUrl : appleAuthUrl;
    const target = new URL(providerUrl, window.location.origin);
    target.searchParams.set("intent", "signup");
    target.searchParams.set("returnTo", "/activate?welcome=billing");
    window.location.href = target.toString();
  };

  const isEmailValid = form.email.trim().includes("@");
  const isPasswordStrong =
    form.password.length >= 8 &&
    /[A-Z]/.test(form.password) &&
    /\d/.test(form.password) &&
    /[^A-Za-z0-9]/.test(form.password);

  const stepIsValid = [
    form.tenantName.trim().length >= 2,
    form.firstName.trim().length > 1 && form.lastName.trim().length > 1 && isEmailValid && isPasswordStrong,
    privacyAccepted
  ][currentStep];

  const stepErrors = [
    "Inserisci almeno il nome azienda per continuare.",
    "Completa nome, cognome, email valida e una password sicura.",
    "Per creare l'account devi confermare la presa visione dell'informativa privacy."
  ];
  const signupProgress = Math.round(((currentStep + 1) / SIGNUP_STEPS.length) * 100);
  const signupProgressStyle = { "--signup-progress": `${signupProgress}%` } as CSSProperties;

  const goToNextStep = () => {
    setError(null);
    setTenantId(null);

    if (!stepIsValid) {
      setError(stepErrors[currentStep]);
      return;
    }

    setCurrentStep((step) => Math.min(step + 1, SIGNUP_STEPS.length - 1));
  };

  const goToPreviousStep = () => {
    setError(null);
    setCurrentStep((step) => Math.max(step - 1, 0));
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setTenantId(null);

    if (!privacyAccepted) {
      setError("Per creare l'account devi confermare la presa visione dell'informativa privacy.");
      return;
    }

    setLoading(true);

    try {
      const result = await authUseCases.signup({
        tenantName: form.tenantName,
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        password: form.password,
        phone: form.adminPhone,
        adminRole: form.adminRole,
        privacyAccepted,
        company: {
          legalName: form.tenantName,
          tradeName: form.tenantName,
          legalForm: form.legalForm,
          vatNumber: form.vatNumber,
          taxCode: form.taxCode,
          pec: form.pec,
          sdiCode: form.sdiCode,
          legalAddress: form.legalAddress,
          city: form.city,
          province: form.province,
          postalCode: form.postalCode,
          country: form.country,
          phone: form.companyPhone,
          email: form.companyEmail || form.email,
          website: form.website,
          adminFirstName: form.firstName,
          adminLastName: form.lastName,
          adminEmail: form.email,
          adminPhone: form.adminPhone,
          adminRole: form.adminRole,
          primaryColor: form.primaryColor,
          accentColor: form.accentColor
        }
      });
      setTenantId(result.tenantId);
      setRegisteredEmail(form.email);
      setForm(initialForm);
      setPrivacyAccepted(false);
      setCurrentStep(SIGNUP_STEPS.length - 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const startAnotherSignup = () => {
    setTenantId(null);
    setRegisteredEmail(null);
    setError(null);
    setForm(initialForm);
    setPrivacyAccepted(false);
    setCurrentStep(0);
  };

  const goToBillingAfterSignup = () => {
    const params = new URLSearchParams();
    if (registeredEmail) params.set("email", registeredEmail);
    params.set("next", "/activate?welcome=billing");
    params.set("welcome", "billing");
    navigate(`/login?${params.toString()}`);
  };

  return (
    <div className="premium-login-root premium-login-root--clean">
      <div className="premium-login-bg-gradient" aria-hidden />
      <div className="premium-login-aurora" aria-hidden>
        <span className="premium-login-aurora__beam premium-login-aurora__beam--one" />
        <span className="premium-login-aurora__beam premium-login-aurora__beam--two" />
        <span className="premium-login-aurora__beam premium-login-aurora__beam--three" />
      </div>
      <ParticleCanvas />
      <MagneticOrbs />
      <div className="premium-login-grid-overlay" aria-hidden />
      <div className="premium-login-noise-overlay" aria-hidden />
      <div className="premium-login-floating-layer" aria-hidden>
        {Array.from({ length: 18 }, (_, index) => (
          <span
            key={index}
            className="premium-login-floating-dot"
            style={{
              left: `${8 + ((index * 17) % 86)}%`,
              top: `${10 + ((index * 23) % 78)}%`,
              animationDuration: `${7 + (index % 5)}s`,
              animationDelay: `${index * 0.42}s`
            }}
          />
        ))}
      </div>
      <div className="premium-login-spotlight" aria-hidden />
      <main className="premium-login-auth-shell">
        <section className="premium-login-card-wrap premium-login-card-wrap--signup">
          <div className="premium-login-card premium-login-card--signup">
            <div className="premium-login-card-head">
              <img className="premium-login-card-logo premium-login-card-logo--image" src="/brand/fleetum-symbol-color.svg" alt="Fleetum" />
              <h2>Crea account</h2>
              <p>Avvia il tuo ambiente con credenziali admin iniziali</p>
            </div>

            {tenantId ? (
              <div className="premium-signup-success">
                <div className="premium-signup-success__icon">✓</div>
                <p className="premium-signup-success__eyebrow">Tenant creato correttamente</p>
                <h3>Workspace pronto</h3>
                <p>
                  Il tenant <strong>{tenantId}</strong> è stato creato. Prima di entrare nel gestionale devi scegliere un piano
                  e completare Stripe Checkout con carta valida. La prova dura 14 giorni e il primo addebito parte alla fine del trial.
                </p>
                <div className="premium-signup-success__actions">
                  <button type="button" className="premium-login-submit" onClick={goToBillingAfterSignup}>
                    <span className="premium-login-submit-shimmer" aria-hidden />
                    Scegli piano e attiva con Stripe
                  </button>
                  <button type="button" className="premium-login-social-btn justify-center" onClick={startAnotherSignup}>
                    Crea un altro tenant
                  </button>
                </div>
                <p className="mt-3 text-xs leading-5 text-slate-500">
                  Il gestionale resta bloccato finché Stripe non conferma una subscription attiva o in trial con metodo di pagamento raccolto.
                  Non abilitiamo licenze dal redirect di successo: aspettiamo sempre il webhook verificato.
                </p>
              </div>
            ) : (
            <form onSubmit={onSubmit} className="premium-login-form" noValidate>
              <div className="premium-login-social-grid">
                <button
                  type="button"
                  data-cursor="hover"
                  className="premium-login-social-btn"
                  onClick={() => openSocialAuth("google")}
                >
                  <GoogleLogo />
                  <span>Continua con Google</span>
                </button>
                <button
                  type="button"
                  data-cursor="hover"
                  className="premium-login-social-btn"
                  onClick={() => openSocialAuth("apple")}
                >
                  <AppleLogo />
                  <span>Continua con Apple</span>
                </button>
              </div>

              <div className="premium-login-divider">o continua con registrazione</div>

              <div className="premium-signup-stepper" style={signupProgressStyle} aria-label="Avanzamento registrazione">
                <div className="premium-signup-stepper__meta">
                  <span>Registrazione guidata</span>
                  <strong>{signupProgress}% completato</strong>
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
                        onClick={() => {
                          if (index < currentStep) {
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
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Step 1 · Dati aziendali
                  </p>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="md:col-span-2">
                      <label className="premium-login-field-label" htmlFor="signup-tenantName">Nome azienda</label>
                      <div className={`premium-login-field ${form.tenantName ? "is-ok" : ""}`}>
                        <FieldIcon><Building2 /></FieldIcon>
                        <input
                          id="signup-tenantName"
                          name="tenantName"
                          value={form.tenantName}
                          onChange={(event) => setForm((current) => ({ ...current, tenantName: event.target.value }))}
                          placeholder="Es. Fleetum Italia"
                          required
                        />
                      </div>
                    </div>
                    <div>
                      <label className="premium-login-field-label" htmlFor="signup-vatNumber">Partita IVA</label>
                      <div className={`premium-login-field ${form.vatNumber.length === 11 ? "is-ok" : ""}`}>
                        <FieldIcon><Briefcase /></FieldIcon>
                        <input
                          id="signup-vatNumber"
                          name="vatNumber"
                          value={form.vatNumber}
                          onChange={(event) => setForm((current) => ({ ...current, vatNumber: event.target.value.replace(/\s+/g, "") }))}
                          placeholder="11 cifre"
                        />
                      </div>
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
                          placeholder="SRL, SPA, ditta individuale..."
                        />
                      </div>
                    </div>
                    <div>
                      <label className="premium-login-field-label" htmlFor="signup-taxCode">Codice fiscale azienda</label>
                      <div className={`premium-login-field ${form.taxCode ? "is-ok" : ""}`}>
                        <FieldIcon><Hash /></FieldIcon>
                        <input
                          id="signup-taxCode"
                          name="taxCode"
                          value={form.taxCode}
                          onChange={(event) => setForm((current) => ({ ...current, taxCode: event.target.value.toUpperCase() }))}
                          placeholder="Opzionale"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="premium-login-field-label" htmlFor="signup-companyEmail">Email aziendale</label>
                      <div className={`premium-login-field ${form.companyEmail.includes("@") ? "is-ok" : ""}`}>
                        <FieldIcon><Mail /></FieldIcon>
                        <input
                          id="signup-companyEmail"
                          name="companyEmail"
                          type="email"
                          value={form.companyEmail}
                          onChange={(event) => setForm((current) => ({ ...current, companyEmail: event.target.value }))}
                          placeholder="info@azienda.com"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="premium-login-field-label" htmlFor="signup-companyPhone">Telefono aziendale</label>
                      <div className={`premium-login-field ${form.companyPhone ? "is-ok" : ""}`}>
                        <FieldIcon><Phone /></FieldIcon>
                        <input
                          id="signup-companyPhone"
                          name="companyPhone"
                          value={form.companyPhone}
                          onChange={(event) => setForm((current) => ({ ...current, companyPhone: event.target.value }))}
                          placeholder="+39..."
                        />
                      </div>
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
                          placeholder="https://azienda.it"
                        />
                      </div>
                    </div>
                    <div className="md:col-span-2">
                      <label className="premium-login-field-label" htmlFor="signup-legalAddress">Sede legale</label>
                      <div className={`premium-login-field ${form.legalAddress ? "is-ok" : ""}`}>
                        <FieldIcon><MapPin /></FieldIcon>
                        <input
                          id="signup-legalAddress"
                          name="legalAddress"
                          value={form.legalAddress}
                          onChange={(event) => setForm((current) => ({ ...current, legalAddress: event.target.value }))}
                          placeholder="Via, numero civico"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-3 md:col-span-2 md:grid-cols-[minmax(0,1.55fr)_minmax(0,0.7fr)_minmax(0,0.9fr)_minmax(0,0.65fr)]">
                      <div className="min-w-0">
                        <label className="premium-login-field-label" htmlFor="signup-city">Comune</label>
                        <div className={`premium-login-field ${form.city ? "is-ok" : ""}`}>
                          <FieldIcon><Map /></FieldIcon>
                          <input
                            id="signup-city"
                            name="city"
                            value={form.city}
                            onChange={(event) => setForm((current) => ({ ...current, city: event.target.value }))}
                            placeholder="Comune"
                          />
                        </div>
                      </div>
                      <div className="min-w-0">
                        <label className="premium-login-field-label" htmlFor="signup-province">Prov.</label>
                        <div className={`premium-login-field ${form.province ? "is-ok" : ""}`}>
                          <input
                            id="signup-province"
                            name="province"
                            value={form.province}
                            onChange={(event) => setForm((current) => ({ ...current, province: event.target.value.toUpperCase() }))}
                            placeholder="NA"
                          />
                        </div>
                      </div>
                      <div className="min-w-0">
                        <label className="premium-login-field-label" htmlFor="signup-postalCode">CAP</label>
                        <div className={`premium-login-field ${form.postalCode ? "is-ok" : ""}`}>
                          <input
                            id="signup-postalCode"
                            name="postalCode"
                            value={form.postalCode}
                            onChange={(event) => setForm((current) => ({ ...current, postalCode: event.target.value }))}
                            placeholder="80100"
                          />
                        </div>
                      </div>
                      <div className="min-w-0">
                        <label className="premium-login-field-label" htmlFor="signup-country">Paese</label>
                        <div className="premium-login-field">
                          <input
                            id="signup-country"
                            name="country"
                            value={form.country}
                            onChange={(event) => setForm((current) => ({ ...current, country: event.target.value.toUpperCase() }))}
                            placeholder="IT"
                          />
                        </div>
                      </div>
                    </div>
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
                          placeholder="pec@azienda.it"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="premium-login-field-label" htmlFor="signup-sdiCode">Codice SDI</label>
                      <div className={`premium-login-field ${form.sdiCode.length === 7 ? "is-ok" : ""}`}>
                        <FieldIcon><Hash /></FieldIcon>
                        <input
                          id="signup-sdiCode"
                          name="sdiCode"
                          value={form.sdiCode}
                          onChange={(event) => setForm((current) => ({ ...current, sdiCode: event.target.value.toUpperCase() }))}
                          placeholder="7 caratteri"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {currentStep === 1 ? (
                <div className="rounded-2xl border border-white/60 bg-white/45 p-3 shadow-[0_18px_45px_-36px_rgba(15,23,42,0.55)]">
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Step 2 · Referente e accesso admin
                  </p>
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
                          required
                        />
                      </div>
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
                          required
                        />
                      </div>
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
                          placeholder="+39..."
                        />
                      </div>
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
                          placeholder="Owner, admin, operations..."
                        />
                      </div>
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
                          required
                        />
                      </div>
                    </div>
                    <div className="md:col-span-2">
                      <label className="premium-login-field-label" htmlFor="signup-password">Password</label>
                      <div className={`premium-login-field ${isPasswordStrong ? "is-ok" : ""}`}>
                        <FieldIcon><Lock /></FieldIcon>
                        <input
                          id="signup-password"
                          name="password"
                          type="password"
                          value={form.password}
                          onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                          placeholder="Min. 8 caratteri, maiuscola, numero e simbolo"
                          autoComplete="new-password"
                          required
                        />
                      </div>
                      <p className="mt-2 text-xs text-slate-500">
                        Usa almeno 8 caratteri con una maiuscola, un numero e un simbolo.
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}

              {currentStep === 2 ? (
                <div className="rounded-2xl border border-white/60 bg-white/45 p-3 shadow-[0_18px_45px_-36px_rgba(15,23,42,0.55)]">
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Step 3 · Conferma workspace
                  </p>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="rounded-2xl border border-slate-200/70 bg-white/70 p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Azienda</p>
                      <p className="mt-2 text-base font-semibold text-slate-900">{form.tenantName || "Non indicata"}</p>
                      <p className="mt-1 text-sm text-slate-500">{form.companyEmail || form.email || "Email non indicata"}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200/70 bg-white/70 p-4">
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
                          placeholder="#21375d"
                        />
                      </div>
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
                          placeholder="#5d82c2"
                        />
                      </div>
                    </div>
                  </div>

                  <label className="premium-login-check mt-4 items-start" htmlFor="signup-privacy">
                    <input
                      id="signup-privacy"
                      type="checkbox"
                      checked={privacyAccepted}
                      onChange={(event) => setPrivacyAccepted(event.target.checked)}
                      required
                    />
                    <span className="leading-5">
                      Ho letto l'{" "}
                      <Link className="premium-login-link" to="/privacy" target="_blank" rel="noreferrer">
                        informativa privacy
                      </Link>{" "}
                      e confermo la presa visione.
                    </span>
                  </label>
                </div>
              ) : null}

              {tenantId ? (
                <p className="premium-login-error premium-login-error--block" style={{ color: "#065f46", background: "rgba(209,250,229,0.8)", borderColor: "rgba(16,185,129,0.45)" }}>
                  Tenant creato con successo: {tenantId}
                </p>
              ) : null}

              {error ? <p className="premium-login-error premium-login-error--block">{error}</p> : null}

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
                  <button type="button" className="premium-login-submit" onClick={goToNextStep}>
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
            </form>
            )}
          </div>
        </section>
      </main>
    </div>
  );
};
