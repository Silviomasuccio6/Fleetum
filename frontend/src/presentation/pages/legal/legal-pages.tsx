import { useEffect, useMemo, useState } from "react";
import { Check, Mail, ShieldCheck } from "lucide-react";
import { getApiBaseUrl } from "../../../infrastructure/api/api-base-url";
import { getConsentedPublicAnalyticsContext, trackPublicEvent } from "../../../application/usecases/public-analytics-usecases";
import { PublicFooter } from "../../components/public-site/public-footer";
import { PublicHeader } from "../../components/public-site/public-header";
import { ResponsiveMedia } from "../../components/public-site/responsive-media";
import { SeoHead } from "../../components/seo/seo-head";

type LegalDocument = {
  badge: string;
  title: string;
  version: string;
  intro: string;
  sections: Array<{ title: string; body: string }>;
};

type LegalDocumentType = "privacy" | "cookie" | "terms" | "dpa";

const privacyDocument: LegalDocument = {
  badge: "Privacy",
  title: "Informativa privacy Fleetum",
  version: "2026-05-17",
  intro:
    "Questa informativa descrive in modo operativo come Fleetum supporta i clienti SaaS nella gestione di dati, documenti, contratti e processi di flotta. Il testo finale deve essere validato dal titolare e dal consulente privacy prima dell'uso definitivo.",
  sections: [
    { title: "Dati trattati", body: "Dati anagrafici, contatti, dati aziendali, documenti, patente, prenotazioni, contratti, firme, veicoli, manutenzioni, scadenze, log tecnici e audit applicativi." },
    { title: "Finalità", body: "Erogazione del gestionale, gestione noleggi, contratti, comunicazioni operative, sicurezza, assistenza, obblighi amministrativi e miglioramento del servizio." },
    { title: "Ruoli privacy", body: "Il cliente SaaS opera normalmente come titolare del trattamento sui dati dei propri clienti. Fleetum opera come fornitore/responsabile tecnico secondo accordi contrattuali e DPA da finalizzare." },
    { title: "Conservazione", body: "I dati sono conservati per il tempo necessario a finalità contrattuali, fiscali, operative e di sicurezza. Le policy di retention devono essere configurate e validate per ogni contesto produttivo." },
    { title: "Diritti", body: "Accesso, rettifica, cancellazione, limitazione, opposizione e portabilità possono essere esercitati tramite i canali privacy indicati dal titolare del trattamento." }
  ]
};

const cookieDocument: LegalDocument = {
  badge: "Cookie",
  title: "Cookie Policy",
  version: "2026-05-17",
  intro: "Fleetum usa cookie tecnici necessari al funzionamento e può usare strumenti analytics solo dopo consenso esplicito.",
  sections: [
    { title: "Cookie necessari", body: "Servono per sicurezza, sessione, preferenze essenziali e navigazione. Non possono essere disattivati senza compromettere il servizio." },
    { title: "Analytics", body: "Eventuali analytics vengono caricati solo dopo consenso. In assenza di consenso restano bloccati." },
    { title: "Marketing", body: "Eventuali strumenti marketing o remarketing richiedono consenso separato e revocabile." },
    { title: "Revoca", body: "Puoi modificare le preferenze cancellando il consenso nel browser o usando il banner preferenze quando disponibile." }
  ]
};

const termsDocument: LegalDocument = {
  badge: "Termini",
  title: "Termini e condizioni del servizio",
  version: "2026-05-17",
  intro: "Documento operativo preliminare per l'utilizzo di Fleetum come SaaS B2B. La versione contrattuale finale deve essere approvata legalmente prima della vendita definitiva.",
  sections: [
    { title: "Oggetto", body: "Fleetum fornisce strumenti software per booking noleggi, contratti, clienti, flotta, manutenzioni, scadenze e dashboard operative." },
    { title: "Account aziendale", body: "Ogni azienda cliente opera nel proprio workspace tenant. Gli utenti devono mantenere credenziali sicure e usare ruoli coerenti con le responsabilità interne." },
    { title: "Piani e pagamenti", body: "L'accesso alle funzionalità dipende dal piano attivo. Mancati pagamenti o uso non conforme possono comportare limitazioni o sospensione del servizio." },
    { title: "Dati e contenuti", body: "Il cliente resta responsabile della correttezza dei dati inseriti, dei documenti caricati e dell'utilizzo dei contratti generati." },
    { title: "Disponibilità", body: "Fleetum è progettato per uso professionale, con backup, monitoraggio e procedure operative da completare in ambiente di produzione." }
  ]
};

const dpaDocument: LegalDocument = {
  badge: "DPA",
  title: "Data Processing Agreement - schema operativo",
  version: "2026-05-17",
  intro: "Schema tecnico-organizzativo per disciplinare il trattamento dati tra cliente SaaS e Fleetum. Non sostituisce il DPA legale definitivo.",
  sections: [
    { title: "Categorie dati", body: "Clienti noleggio, referenti aziendali, utenti tenant, documenti, contratti, log applicativi e dati relativi a veicoli e operazioni." },
    { title: "Misure tecniche", body: "Tenant isolation, ruoli, audit log, HTTPS, controlli upload, backup e monitoraggio sono le misure applicative previste o in completamento." },
    { title: "Subfornitori", body: "Provider cloud, email, pagamento, storage, monitoraggio e servizi infrastrutturali devono essere elencati e mantenuti aggiornati." },
    { title: "Incidenti", body: "Eventuali incidenti devono essere gestiti con processo di escalation, analisi impatto, mitigazione e comunicazione secondo normativa applicabile." }
  ]
};

const documents: Record<LegalDocumentType, LegalDocument> = {
  privacy: privacyDocument,
  cookie: cookieDocument,
  terms: termsDocument,
  dpa: dpaDocument
};

const documentSeo = {
  privacy: {
    title: "Privacy Policy Fleetum | Gestione dati per autonoleggi",
    description: "Informativa privacy Fleetum per il SaaS dedicato a booking, contratti, flotte e aziende di autonoleggio.",
    canonicalPath: "/privacy"
  },
  cookie: {
    title: "Cookie Policy Fleetum | Preferenze e strumenti di misurazione",
    description: "Cookie Policy Fleetum: cookie tecnici, analytics e preferenze di consenso per il sito e il SaaS.",
    canonicalPath: "/cookie"
  },
  terms: {
    title: "Termini e condizioni Fleetum | SaaS per autonoleggi",
    description: "Termini e condizioni operative per utilizzare Fleetum, il gestionale SaaS per autonoleggi e flotte.",
    canonicalPath: "/termini"
  },
  dpa: {
    title: "DPA Fleetum | Accordo sul trattamento dei dati",
    description: "Schema tecnico-organizzativo del Data Processing Agreement Fleetum per i clienti SaaS.",
    canonicalPath: "/dpa"
  }
} satisfies Record<LegalDocumentType, { title: string; description: string; canonicalPath: string }>;

export const LegalDocumentPage = ({ type }: { type: LegalDocumentType }) => {
  const document = documents[type];
  const seo = documentSeo[type];

  return (
    <main id="main-content" className="fleetum-legal-page fleetum-public-theme">
      <SeoHead title={seo.title} description={seo.description} canonicalPath={seo.canonicalPath}>
        <script type="application/ld+json">
          {JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebPage",
            name: document.title,
            url: `https://fleetum.it${seo.canonicalPath}`,
            description: seo.description
          })}
        </script>
      </SeoHead>
      <PublicHeader tone="light" analyticsPlacement={`legal_${type}`} />
      <div className="fleetum-legal-shell">
        <article className="fleetum-legal-card">
          <div className="fleetum-legal-hero">
            <span>{document.badge}</span>
            <h1>{document.title}</h1>
            <p>{document.intro}</p>
            <strong>Versione {document.version}</strong>
          </div>
          <div className="fleetum-legal-grid">
            {document.sections.map((section) => (
              <section key={section.title}>
                <ShieldCheck size={18} />
                <h2>{section.title}</h2>
                <p>{section.body}</p>
              </section>
            ))}
          </div>
          <div className="fleetum-legal-note">
            <strong>Nota importante</strong>
            <p>Questi documenti sono predisposizioni operative. Per pieno valore legale servono revisione professionale, dati societari definitivi, elenco subfornitori e versionamento approvato.</p>
          </div>
        </article>
      </div>
      <PublicFooter tone="light" />
    </main>
  );
};

const fleetSizes = ["1-10", "11-30", "31-80", "80+"] as const;

export const DemoRequestPage = () => {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState("");
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), []);

  useEffect(() => {
    trackPublicEvent("PAGE_VIEW", { page: "demo" });
    trackPublicEvent("DEMO_FORM_VIEW", { placement: "demo_page" });
  }, []);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    setStatus("loading");
    setError("");
    const form = new FormData(formElement);
    const fleetSize = form.get("fleetSize");
    const payload = {
      ...Object.fromEntries(
        Array.from(form.entries()).filter(([, value]) => typeof value !== "string" || value.trim() !== "")
      ),
      ...(getConsentedPublicAnalyticsContext() ?? {})
    };

    try {
      const response = await fetch(`${apiBaseUrl}/public/demo-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        const problem = await response.json().catch(() => null);
        throw new Error(
          problem?.message || problem?.error || "Richiesta non inviata. Riprova tra poco."
        );
      }
      trackPublicEvent("DEMO_FORM_SUBMIT", {
        placement: "demo_page",
        fleetSize: typeof fleetSize === "string" && fleetSize ? fleetSize : "not_provided"
      });
      setStatus("success");
      formElement.reset();
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Errore durante l'invio.");
    }
  };

  return (
    <main id="main-content" className="fleetum-legal-page fleetum-demo-page fleetum-public-theme">
      <SeoHead
        title="Richiedi una demo Fleetum | Gestionale per autonoleggi"
        description="Richiedi una demo Fleetum per vedere booking, contratti digitali, flotta, clienti e KPI nel tuo autonoleggio."
        canonicalPath="/demo"
      >
        <script type="application/ld+json">
          {JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebPage",
            name: "Richiedi una demo Fleetum",
            url: "https://fleetum.it/demo",
            description: "Richiedi una demo del gestionale SaaS Fleetum per autonoleggi e flotte."
          })}
        </script>
      </SeoHead>
      <PublicHeader tone="light" analyticsPlacement="demo" />
      <div className="fleetum-legal-shell fleetum-demo-shell">
        <section className="fleetum-demo-card">
          <div className="fleetum-demo-copy">
            <ResponsiveMedia
              pictureClassName="fleetum-demo-copy__media"
              className="fleetum-demo-copy__image"
              src="/media/fleetum-handover-1440.webp"
              webpSrcSet="/media/fleetum-handover-640.webp 640w, /media/fleetum-handover-768.webp 768w, /media/fleetum-handover-1024.webp 1024w, /media/fleetum-handover-1440.webp 1440w"
              sizes="(max-width: 820px) 100vw, 58vw"
              alt="Consegna professionale di un veicolo in una sede di autonoleggio"
              priority
            />
            <div className="fleetum-demo-copy__content">
              <div className="fleetum-demo-eyebrow">
                <span>Demo operativa guidata</span>
                <strong>Nessuna demo generica</strong>
              </div>
              <h1>Guarda Fleetum lavorare sulla tua flotta.</h1>
              <p>
                Partiamo dai tuoi processi per mostrarti come booking, contratti, clienti e veicoli
                possono vivere dentro un'unica regia operativa.
              </p>
            </div>
            <div className="fleetum-demo-preview" aria-label="Anteprima dimostrativa del booking Fleetum">
              <div className="fleetum-demo-preview__head">
                <div>
                  <small>Dati dimostrativi</small>
                  <strong>Booking Noleggi</strong>
                </div>
                <span>Oggi</span>
              </div>
              <div className="fleetum-demo-preview__grid" aria-hidden="true">
                <article>
                  <div><strong>Fiat 500</strong><small>Roma Centro</small></div>
                  <span className="is-blue">Consegna 09:00</span>
                </article>
                <article>
                  <div><strong>Toyota Yaris</strong><small>Roma Eur</small></div>
                  <span className="is-green">In noleggio</span>
                </article>
                <article>
                  <div><strong>Jeep Renegade</strong><small>Fiumicino</small></div>
                  <span className="is-amber">Rientro 17:30</span>
                </article>
              </div>
            </div>
            <div className="fleetum-demo-proof-grid" aria-label="Vantaggi della demo Fleetum">
              <article><Check size={15} /><span><strong>Sui tuoi processi</strong><small>Booking, sedi e ruoli reali</small></span></article>
              <article><Check size={15} /><span><strong>Senza impegno</strong><small>Nessuna attivazione automatica</small></span></article>
              <article><Check size={15} /><span><strong>Con un referente</strong><small>Risposta via email o telefono</small></span></article>
            </div>
          </div>
          <form
            className="fleetum-demo-form"
            onSubmit={submit}
            onChange={() => {
              if (status === "error" || status === "success") {
                setStatus("idle");
                setError("");
              }
            }}
            aria-busy={status === "loading"}
          >
            <div className="fleetum-demo-form-head">
              <span>Richiedi una demo</span>
              <h2>Costruiamola intorno al tuo autonoleggio.</h2>
              <p>Condividi le informazioni essenziali: prepareremo una sessione focalizzata sulle tue priorità.</p>
            </div>
            <label className="fleetum-demo-field">
              <span>Azienda</span>
              <input name="companyName" required maxLength={120} autoComplete="organization" placeholder="Es. Autonoleggio Demo" />
            </label>
            <label className="fleetum-demo-field">
              <span>Nome e cognome</span>
              <input name="fullName" required maxLength={100} autoComplete="name" placeholder="Mario Rossi" />
            </label>
            <label className="fleetum-demo-field">
              <span>Email aziendale</span>
              <input name="email" type="email" required maxLength={160} autoComplete="email" placeholder="nome@azienda.it" />
            </label>
            <label className="fleetum-demo-field">
              <span>Telefono</span>
              <input name="phone" type="tel" inputMode="tel" maxLength={40} autoComplete="tel" placeholder="+39 ..." />
            </label>
            <label className="fleetum-demo-field">
              <span>Dimensione flotta</span>
              <select name="fleetSize" defaultValue="" aria-describedby="fleetum-demo-fit-note">
                <option value="" disabled>Seleziona</option>
                {fleetSizes.map((size) => <option key={size} value={size}>{size} veicoli</option>)}
              </select>
            </label>
            <div className="fleetum-demo-fit-note" id="fleetum-demo-fit-note">
              <ShieldCheck size={18} aria-hidden="true" />
              <span><strong>Demo dedicata</strong> Nessuna presentazione standard.</span>
            </div>
            <label className="fleetum-demo-field fleetum-demo-field--message">
              <span>Cosa vuoi gestire meglio?</span>
              <textarea name="message" maxLength={1200} placeholder="Booking, contratti, scadenze, più sedi..." />
            </label>
            <input type="hidden" name="source" value="fleetum.it/demo" />
            <input className="fleetum-demo-honeypot" type="text" name="websiteUrl" tabIndex={-1} autoComplete="off" aria-hidden="true" />
            <button type="submit" disabled={status === "loading"}>
              {status === "loading" ? "Invio in corso..." : "Prepara la mia demo"} <Mail size={16} aria-hidden="true" />
            </button>
            <p className="fleetum-demo-privacy-note">
              Usiamo i dati solo per gestire questa richiesta. Nessuna newsletter automatica. Consulta la <a href="/privacy">privacy policy</a>.
            </p>
            <div className="fleetum-demo-feedback" aria-live="polite" aria-atomic="true">
              {status === "success" ? (
                <p className="fleetum-demo-success" role="status">
                  <Check size={17} aria-hidden="true" /> Richiesta ricevuta. Ti ricontatteremo per preparare la sessione.
                </p>
              ) : null}
              {status === "error" ? <p className="fleetum-demo-error" role="alert">{error}</p> : null}
            </div>
          </form>
        </section>
      </div>
      <PublicFooter tone="light" />
    </main>
  );
};
