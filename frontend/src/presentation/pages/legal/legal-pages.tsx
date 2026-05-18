import { useMemo, useState } from "react";
import { ArrowLeft, Check, Mail, ShieldCheck } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { getApiBaseUrl } from "../../../infrastructure/api/api-base-url";
import "./legal-pages.css";

type LegalDocument = {
  badge: string;
  title: string;
  version: string;
  intro: string;
  sections: Array<{ title: string; body: string }>;
};

const privacyDocument: LegalDocument = {
  badge: "Privacy",
  title: "Informativa privacy Fleetum",
  version: "2026-05-17",
  intro:
    "Questa informativa descrive in modo operativo come Fleetum supporta i clienti SaaS nella gestione di dati, documenti, contratti e processi di flotta. Il testo finale deve essere validato dal titolare e dal consulente privacy prima dell'uso definitivo.",
  sections: [
    { title: "Dati trattati", body: "Dati anagrafici, contatti, dati aziendali, documenti, patente, prenotazioni, contratti, firme, veicoli, manutenzioni, scadenze, log tecnici e audit applicativi." },
    { title: "Finalita", body: "Erogazione del gestionale, gestione noleggi, contratti, comunicazioni operative, sicurezza, assistenza, obblighi amministrativi e miglioramento del servizio." },
    { title: "Ruoli privacy", body: "Il cliente SaaS opera normalmente come titolare del trattamento sui dati dei propri clienti. Fleetum opera come fornitore/responsabile tecnico secondo accordi contrattuali e DPA da finalizzare." },
    { title: "Conservazione", body: "I dati sono conservati per il tempo necessario a finalita contrattuali, fiscali, operative e di sicurezza. Le policy di retention devono essere configurate e validate per ogni contesto produttivo." },
    { title: "Diritti", body: "Accesso, rettifica, cancellazione, limitazione, opposizione e portabilita possono essere esercitati tramite i canali privacy indicati dal titolare del trattamento." }
  ]
};

const cookieDocument: LegalDocument = {
  badge: "Cookie",
  title: "Cookie Policy",
  version: "2026-05-17",
  intro: "Fleetum usa cookie tecnici necessari al funzionamento e puo usare strumenti analytics solo dopo consenso esplicito.",
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
    { title: "Account aziendale", body: "Ogni azienda cliente opera nel proprio workspace tenant. Gli utenti devono mantenere credenziali sicure e usare ruoli coerenti con le responsabilita interne." },
    { title: "Piani e pagamenti", body: "L'accesso alle funzionalita dipende dal piano attivo. Mancati pagamenti o uso non conforme possono comportare limitazioni o sospensione del servizio." },
    { title: "Dati e contenuti", body: "Il cliente resta responsabile della correttezza dei dati inseriti, dei documenti caricati e dell'utilizzo dei contratti generati." },
    { title: "Disponibilita", body: "Fleetum e progettato per uso professionale, con backup, monitoraggio e procedure operative da completare in ambiente di produzione." }
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

const documents: Record<string, LegalDocument> = {
  privacy: privacyDocument,
  cookie: cookieDocument,
  terms: termsDocument,
  dpa: dpaDocument
};

export const LegalDocumentPage = ({ type }: { type: keyof typeof documents }) => {
  const navigate = useNavigate();
  const document = documents[type];

  return (
    <main className="fleetum-legal-page">
      <div className="fleetum-legal-shell">
        <div className="fleetum-legal-topbar">
          <button type="button" onClick={() => navigate(-1)}><ArrowLeft size={17} /> Indietro</button>
          <Link to="/">Fleetum.it</Link>
        </div>
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
    </main>
  );
};

const fleetSizes = ["1-10", "11-30", "31-80", "80+"] as const;

export const DemoRequestPage = () => {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState("");
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), []);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("loading");
    setError("");
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());

    try {
      const response = await fetch(`${apiBaseUrl}/public/demo-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error("Richiesta non inviata. Riprova tra poco.");
      setStatus("success");
      event.currentTarget.reset();
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Errore durante l'invio.");
    }
  };

  return (
    <main className="fleetum-legal-page fleetum-demo-page">
      <div className="fleetum-legal-shell fleetum-demo-shell">
        <div className="fleetum-legal-topbar">
          <Link to="/">← Torna al sito</Link>
          <Link to="/login">Accedi</Link>
        </div>
        <section className="fleetum-demo-card">
          <div className="fleetum-demo-copy">
            <div className="fleetum-demo-brand">
              <img src="/brand/fleetum-logo-horizontal-dark.svg" alt="Fleetum" />
              <strong>Demo operativa</strong>
            </div>
            <span>Control room per autonoleggi</span>
            <h1>Scopri se Fleetum e adatto alla tua flotta.</h1>
            <p>
              Una sessione mirata per capire come centralizzare booking, contratti digitali, clienti,
              veicoli, manutenzioni e scadenze dentro un flusso operativo unico.
            </p>
            <div className="fleetum-demo-proof-grid" aria-label="Aree coperte dalla demo Fleetum">
              <article>
                <strong>Booking</strong>
                <small>Vista mensile per veicolo, sedi, stati e disponibilita.</small>
              </article>
              <article>
                <strong>Contratti</strong>
                <small>PDF, firma, invio email e storico collegato al cliente.</small>
              </article>
              <article>
                <strong>Flotta</strong>
                <small>Scadenze, manutenzioni, rientri e criticita operative.</small>
              </article>
            </div>
            <ul>
              <li><Check size={16} /> Demo costruita sui tuoi processi reali</li>
              <li><Check size={16} /> Nessun impegno commerciale automatico</li>
              <li><Check size={16} /> Risposta da Fleetum via email o telefono</li>
            </ul>
          </div>
          <form className="fleetum-demo-form" onSubmit={submit}>
            <div className="fleetum-demo-form-head">
              <span>Richiedi una demo</span>
              <h2>Parliamo del tuo autonoleggio</h2>
              <p>Lasciaci i dati principali: ti ricontattiamo per preparare una demo utile, non generica.</p>
            </div>
            <label>Azienda<input name="companyName" required maxLength={120} placeholder="Es. Autonoleggio Demo" /></label>
            <label>Nome e cognome<input name="fullName" required maxLength={100} placeholder="Mario Rossi" /></label>
            <label>Email<input name="email" type="email" required maxLength={160} placeholder="nome@azienda.it" /></label>
            <label>Telefono<input name="phone" maxLength={40} placeholder="+39 ..." /></label>
            <label>Dimensione flotta<select name="fleetSize" defaultValue=""><option value="" disabled>Seleziona</option>{fleetSizes.map((size) => <option key={size} value={size}>{size} veicoli</option>)}</select></label>
            <label>Messaggio<textarea name="message" maxLength={1200} placeholder="Raccontaci cosa vuoi gestire meglio: booking, contratti, scadenze, sedi..." /></label>
            <input type="hidden" name="source" value="fleetum.it/demo" />
            <input className="fleetum-demo-honeypot" type="text" name="websiteUrl" tabIndex={-1} autoComplete="off" aria-hidden="true" />
            <button type="submit" disabled={status === "loading"}>{status === "loading" ? "Invio in corso..." : "Richiedi demo"} <Mail size={16} /></button>
            <p className="fleetum-demo-privacy-note">
              Usiamo questi dati solo per ricontattarti sulla richiesta demo. Nessuna iscrizione automatica a newsletter.
            </p>
            {status === "success" ? <p className="fleetum-demo-success">Richiesta ricevuta. Ti ricontatteremo a breve.</p> : null}
            {status === "error" ? <p className="fleetum-demo-error">{error}</p> : null}
          </form>
        </section>
      </div>
    </main>
  );
};
