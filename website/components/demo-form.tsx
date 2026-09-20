"use client";

import {
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  getConsentedPublicAnalyticsContext,
  getPublicApiBaseUrl,
} from "../lib/public-api";
import { trackPublicEvent } from "../lib/public-analytics";
import { plans } from "../lib/site-data";

type FormErrors = Partial<
  Record<
    | "name"
    | "email"
    | "vehicles"
    | "company"
    | "preferredDate"
    | "preferredTime"
    | "privacy",
    string
  >
>;

type SubmittedDemoRequest = {
  company: string;
  vehicles: string;
  plan: string;
  preferredDate: string;
  preferredTime: string;
};

function fieldValue(form: FormData, name: string) {
  return String(form.get(name) ?? "").trim();
}

function subscribeToLocationChange(onStoreChange: () => void) {
  window.addEventListener("popstate", onStoreChange);
  return () => window.removeEventListener("popstate", onStoreChange);
}

function requestedPlanFromLocation() {
  return new URLSearchParams(window.location.search).get("plan") ?? "";
}

export function DemoForm({ initialPlan }: { initialPlan?: string }) {
  const normalizedInitialPlan = useMemo(
    () =>
      plans.find(
        (plan) => plan.name.toLowerCase() === initialPlan?.toLowerCase(),
      )?.name ?? "",
    [initialPlan],
  );
  const requestedPlan = useSyncExternalStore(
    subscribeToLocationChange,
    requestedPlanFromLocation,
    () => "",
  );
  const normalizedRequestedPlan = useMemo(
    () =>
      plans.find(
        (plan) => plan.name.toLowerCase() === requestedPlan.toLowerCase(),
      )?.name ?? "",
    [requestedPlan],
  );
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const activePlan =
    selectedPlan !== null
      ? selectedPlan
      : normalizedInitialPlan || normalizedRequestedPlan;
  const [step, setStep] = useState<1 | 2>(1);
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [submittedRequest, setSubmittedRequest] =
    useState<SubmittedDemoRequest | null>(null);
  const hasStarted = useRef(false);
  const stepTwoRef = useRef<HTMLDivElement>(null);
  const successRef = useRef<HTMLDivElement>(null);
  const today = useMemo(() => new Date().toISOString().split("T")[0], []);

  useEffect(() => {
    if (submitted) {
      successRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [submitted]);

  function trackStart() {
    if (hasStarted.current) return;
    hasStarted.current = true;
    trackPublicEvent("form_start", { form: "demo_progressive" });
  }

  function validateFirstStep(form: FormData) {
    const nextErrors: FormErrors = {};
    const email = fieldValue(form, "email");

    if (!fieldValue(form, "name")) {
      nextErrors.name = "Inserisci nome e cognome.";
    }
    if (!email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
      nextErrors.email = "Inserisci un indirizzo email valido.";
    }
    if (!fieldValue(form, "vehicles")) {
      nextErrors.vehicles = "Seleziona una fascia di veicoli.";
    }

    return nextErrors;
  }

  function validateSecondStep(form: FormData) {
    const nextErrors: FormErrors = {};
    if (!fieldValue(form, "company")) {
      nextErrors.company = "Inserisci il nome dell’azienda.";
    }
    if (!fieldValue(form, "preferredDate")) {
      nextErrors.preferredDate = "Scegli un giorno indicativo.";
    }
    if (!fieldValue(form, "preferredTime")) {
      nextErrors.preferredTime = "Scegli una fascia oraria.";
    }
    if (form.get("privacy") !== "accepted") {
      nextErrors.privacy = "Devi accettare l’informativa privacy.";
    }
    return nextErrors;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const currentForm = event.currentTarget;
    const form = new FormData(currentForm);

    if (step === 1) {
      const nextErrors = validateFirstStep(form);
      setErrors(nextErrors);
      if (Object.keys(nextErrors).length > 0) return;

      setStep(2);
      trackPublicEvent("form_step_complete", {
        form: "demo_progressive",
        step: 1,
        vehicles: fieldValue(form, "vehicles"),
      });
      window.setTimeout(() => {
        stepTwoRef.current?.focus({ preventScroll: true });
        stepTwoRef.current
          ?.closest("form")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 0);
      return;
    }

    const nextErrors = {
      ...validateFirstStep(form),
      ...validateSecondStep(form),
    };
    setErrors(nextErrors);
    setSaveError("");
    if (Object.keys(nextErrors).length > 0) return;

    const submittedSummary: SubmittedDemoRequest = {
      company: fieldValue(form, "company"),
      vehicles: fieldValue(form, "vehicles"),
      plan: fieldValue(form, "plan"),
      preferredDate: fieldValue(form, "preferredDate"),
      preferredTime: fieldValue(form, "preferredTime"),
    };
    const goals = fieldValue(form, "goals");
    const message = [
      `Piano di interesse: ${submittedSummary.plan || "Da valutare insieme"}.`,
      `Preferenza demo: ${submittedSummary.preferredDate} alle ${submittedSummary.preferredTime}.`,
      goals ? `Priorità operative: ${goals}` : "",
    ]
      .filter(Boolean)
      .join(" ")
      .slice(0, 1200);
    const analyticsContext = getConsentedPublicAnalyticsContext();
    const request = {
      companyName: submittedSummary.company,
      fullName: fieldValue(form, "name"),
      email: fieldValue(form, "email"),
      phone: fieldValue(form, "phone") || undefined,
      fleetSize: submittedSummary.vehicles,
      message,
      source: window.location.hostname || "fleetum.it",
      websiteUrl: fieldValue(form, "websiteUrl"),
      consentAnalytics: Boolean(analyticsContext),
      ...(analyticsContext ?? {}),
    };

    setIsSubmitting(true);

    try {
      const response = await fetch(
        `${getPublicApiBaseUrl()}/public/demo-request`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        },
      );

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error(
            "Hai effettuato troppe richieste. Attendi qualche minuto e riprova.",
          );
        }
        if (response.status === 502) {
          throw new Error(
            "La richiesta è stata registrata, ma la notifica automatica non è riuscita. Non inviarla di nuovo: il team Fleetum può già visualizzarla.",
          );
        }
        throw new Error(
          "Non è stato possibile inviare la richiesta. Riprova tra poco.",
        );
      }

      setSubmittedRequest(submittedSummary);
      setSubmitted(true);
      currentForm.reset();
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : "Connessione temporaneamente non disponibile. Riprova tra poco.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div
        className="form-success"
        ref={successRef}
        role="status"
        aria-live="polite"
      >
        <span>Richiesta ricevuta</span>
        <h2>La demo è stata richiesta.</h2>
        <p>
          Hai scelto il {submittedRequest?.preferredDate} alle{" "}
          {submittedRequest?.preferredTime}. Il team Fleetum riceverà la
          richiesta e ti contatterà per confermare l’appuntamento.
        </p>
        <div className="success-summary">
          <div>
            <span>Flotta</span>
            <strong>{submittedRequest?.vehicles} veicoli</strong>
          </div>
          <div>
            <span>Piano</span>
            <strong>{submittedRequest?.plan || "Da valutare"}</strong>
          </div>
        </div>
        <button
          className="button button-ghost"
          type="button"
          onClick={() => {
            setSubmitted(false);
            setSubmittedRequest(null);
            setStep(1);
            setErrors({});
            hasStarted.current = false;
          }}
        >
          Prepara un’altra richiesta
        </button>
      </div>
    );
  }

  return (
    <form
      className="demo-form demo-form-progressive"
      noValidate
      onSubmit={submit}
      onFocus={trackStart}
    >
      <div className="form-progress" aria-label="Avanzamento richiesta demo">
        <div className={step === 1 ? "is-active" : "is-complete"}>
          <span>01</span>
          <strong>Contesto</strong>
        </div>
        <i />
        <div className={step === 2 ? "is-active" : ""}>
          <span>02</span>
          <strong>Agenda</strong>
        </div>
      </div>

      <div className="form-heading">
        <span>Richiesta demo · passaggio {step} di 2</span>
        <h2>
          {step === 1
            ? "Tre informazioni per iniziare."
            : "Scegli quando approfondire."}
        </h2>
        <p>
          {step === 1
            ? "Nessun telefono richiesto. Useremo questi dati solo per preparare il contesto."
            : "Completa l’azienda e salva una preferenza di giorno e orario."}
        </p>
      </div>

      <div className="form-step" hidden={step !== 1}>
        <div className="field-grid">
          <div className="field">
            <label htmlFor="name">Nome e cognome *</label>
            <input
              id="name"
              name="name"
              type="text"
              autoComplete="name"
              aria-describedby={errors.name ? "name-error" : undefined}
              aria-invalid={Boolean(errors.name)}
            />
            {errors.name && (
              <span className="field-error" id="name-error">
                {errors.name}
              </span>
            )}
          </div>

          <div className="field">
            <label htmlFor="email">Email di lavoro *</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              aria-describedby={errors.email ? "email-error" : undefined}
              aria-invalid={Boolean(errors.email)}
            />
            {errors.email && (
              <span className="field-error" id="email-error">
                {errors.email}
              </span>
            )}
          </div>

          <div className="field field-full">
            <label htmlFor="vehicles">Dimensione flotta *</label>
            <select
              id="vehicles"
              name="vehicles"
              defaultValue=""
              aria-describedby={errors.vehicles ? "vehicles-error" : undefined}
              aria-invalid={Boolean(errors.vehicles)}
            >
              <option value="" disabled>
                Seleziona una fascia
              </option>
              <option value="1-10">1–10 veicoli</option>
              <option value="11-30">11–30 veicoli</option>
              <option value="31-80">31–80 veicoli</option>
              <option value="80+">Più di 80 veicoli</option>
            </select>
            {errors.vehicles && (
              <span className="field-error" id="vehicles-error">
                {errors.vehicles}
              </span>
            )}
          </div>
        </div>
      </div>

      <div
        className="form-step"
        hidden={step !== 2}
        ref={stepTwoRef}
        tabIndex={-1}
      >
        <div className="field-grid">
          <div className="field">
            <label htmlFor="company">Azienda *</label>
            <input
              id="company"
              name="company"
              type="text"
              autoComplete="organization"
              aria-describedby={errors.company ? "company-error" : undefined}
              aria-invalid={Boolean(errors.company)}
            />
            {errors.company && (
              <span className="field-error" id="company-error">
                {errors.company}
              </span>
            )}
          </div>

          <div className="field">
            <label htmlFor="plan">Percorso di interesse</label>
            <select
              id="plan"
              name="plan"
              value={activePlan}
              onChange={(event) => setSelectedPlan(event.target.value)}
            >
              <option value="">Da valutare insieme</option>
              {plans.map((plan) => (
                <option key={plan.name} value={plan.name}>
                  {plan.name} — {plan.price} €/mese
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="preferredDate">Giorno preferito *</label>
            <input
              id="preferredDate"
              name="preferredDate"
              type="date"
              min={today}
              aria-describedby={
                errors.preferredDate ? "preferred-date-error" : undefined
              }
              aria-invalid={Boolean(errors.preferredDate)}
            />
            {errors.preferredDate && (
              <span className="field-error" id="preferred-date-error">
                {errors.preferredDate}
              </span>
            )}
          </div>

          <div className="field">
            <label htmlFor="preferredTime">Orario preferito *</label>
            <select
              id="preferredTime"
              name="preferredTime"
              defaultValue=""
              aria-describedby={
                errors.preferredTime ? "preferred-time-error" : undefined
              }
              aria-invalid={Boolean(errors.preferredTime)}
            >
              <option value="" disabled>
                Seleziona un orario
              </option>
              <option value="09:00">09:00</option>
              <option value="11:30">11:30</option>
              <option value="15:00">15:00</option>
              <option value="17:30">17:30</option>
            </select>
            {errors.preferredTime && (
              <span className="field-error" id="preferred-time-error">
                {errors.preferredTime}
              </span>
            )}
          </div>
        </div>

        <details className="form-optional">
          <summary>Aggiungi telefono o priorità operative (facoltativo)</summary>
          <div className="field-grid">
            <div className="field">
              <label htmlFor="phone">Telefono</label>
              <input
                id="phone"
                name="phone"
                type="tel"
                autoComplete="tel"
                inputMode="tel"
              />
            </div>
            <div className="field">
              <label htmlFor="goals">Cosa vuoi migliorare?</label>
              <textarea
                id="goals"
                name="goals"
                rows={3}
                placeholder="Booking, contratti, scadenze, multi-sede…"
              />
            </div>
          </div>
        </details>

        <div className="privacy-field">
          <label>
            <input
              type="checkbox"
              name="privacy"
              value="accepted"
              aria-describedby={errors.privacy ? "privacy-error" : undefined}
              aria-invalid={Boolean(errors.privacy)}
            />
            <span>
              Ho letto e accetto l’<a href="/privacy">informativa privacy</a>. *
            </span>
          </label>
          {errors.privacy && (
            <span className="field-error" id="privacy-error">
              {errors.privacy}
            </span>
          )}
        </div>
      </div>

      {saveError && (
        <p className="form-error-summary" role="alert">
          {saveError}
        </p>
      )}

      <div
        aria-hidden="true"
        hidden
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          overflow: "hidden",
          clipPath: "inset(50%)",
        }}
      >
        <label htmlFor="websiteUrl">Sito web</label>
        <input
          id="websiteUrl"
          name="websiteUrl"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <div className="form-actions">
        {step === 2 && (
          <button
            className="button button-ghost"
            type="button"
            onClick={() => {
              setStep(1);
              setErrors({});
            }}
          >
            Indietro
          </button>
        )}
        <button
          className="button button-primary submit-button"
          type="submit"
          disabled={isSubmitting}
          aria-busy={isSubmitting}
        >
          {isSubmitting
            ? "Invio in corso…"
            : step === 1
              ? "Scegli giorno e percorso"
              : "Invia richiesta demo"}
        </button>
      </div>
      <p className="local-form-note">
        I dati vengono utilizzati esclusivamente per gestire la richiesta,
        secondo l’informativa privacy Fleetum.
      </p>
    </form>
  );
}
