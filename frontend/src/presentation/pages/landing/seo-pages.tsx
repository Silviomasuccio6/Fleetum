import { useEffect, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BarChart3,
  Building2,
  CalendarDays,
  Car,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleGauge,
  ClipboardSignature,
  FileCheck2,
  KeyRound,
  MapPin,
  Route,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  WalletCards,
  Wrench
} from "lucide-react";
import { trackPublicEvent } from "../../../application/usecases/public-analytics-usecases";
import {
  ANNUAL_DISCOUNT_PERCENT,
  COMMERCIAL_PLAN_CATALOG,
  PLAN_MONTHLY_PRICING_EUR,
  PLAN_YEARLY_PRICING_EUR,
  SAAS_PLANS,
  type SaasPlan
} from "../../../domain/constants/entitlements";
import { PublicFooter } from "../../components/public-site/public-footer";
import { PublicHeader, PUBLIC_PRODUCT_NAVIGATION } from "../../components/public-site/public-header";
import { ResponsiveMedia } from "../../components/public-site/responsive-media";
import { SeoHead } from "../../components/seo/seo-head";

type SeoPageKey =
  | "software-autonoleggio"
  | "software-rent-a-car"
  | "gestionale-flotta"
  | "booking-noleggi"
  | "contratti-noleggio-digitali"
  | "report-redditivita-veicolo"
  | "prezzi";

type ProductVisual = "control" | "dispatch" | "fleet" | "booking" | "contracts" | "roi" | "pricing";

type SeoPageConfig = {
  slug: SeoPageKey;
  title: string;
  description: string;
  eyebrow: string;
  chapter: string;
  h1: string;
  intro: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  visual: ProductVisual;
  proof: Array<{ title: string; text: string }>;
  benefits: Array<{ title: string; text: string }>;
  sections: Array<{ title: string; text: string }>;
  steps: Array<{ number: string; title: string; text: string }>;
  faqs: Array<{ question: string; answer: string }>;
};

const pages: Record<SeoPageKey, SeoPageConfig> = {
  "software-autonoleggio": {
    slug: "software-autonoleggio",
    title: "Software autonoleggio | Booking, contratti e flotta con Fleetum",
    description:
      "Fleetum è il software per autonoleggi che centralizza booking, contratti digitali, clienti, veicoli, manutenzioni, scadenze e KPI operativi.",
    eyebrow: "Software autonoleggio",
    chapter: "La control room del noleggio",
    h1: "Booking, contratti e flotta. Finalmente nello stesso sistema.",
    intro:
      "Fleetum sostituisce fogli, chat e cartelle sparse con una piattaforma SaaS costruita intorno al lavoro reale di un autonoleggio.",
    primaryKeyword: "software autonoleggio",
    secondaryKeywords: ["gestionale autonoleggio", "programma noleggio auto", "software rent a car"],
    visual: "control",
    proof: [
      { title: "Un solo flusso", text: "Dalla richiesta al rientro." },
      { title: "Dati collegati", text: "Cliente, mezzo e contratto." },
      { title: "Priorità visibili", text: "Oggi, non a fine giornata." },
      { title: "Controllo economico", text: "KPI per mezzo e periodo." }
    ],
    benefits: [
      { title: "Una vista operativa unica", text: "Prenotazioni, clienti, veicoli e contratti condividono lo stesso contesto." },
      { title: "Meno copia-incolla", text: "I dati già acquisiti accompagnano il noleggio nei passaggi successivi." },
      { title: "Flotta sotto controllo", text: "Scadenze, manutenzioni e indisponibilità restano distinguibili dal booking." },
      { title: "Decisioni misurabili", text: "Dashboard e report aiutano a leggere utilizzo, ricavi e criticità." }
    ],
    sections: [
      {
        title: "Dal banco noleggio alla dashboard manageriale",
        text: "Fleetum organizza le attività che partono da una richiesta cliente e arrivano a consegna, rientro, manutenzione e report. Ogni passaggio resta collegato al veicolo e al contratto."
      },
      {
        title: "Pensato per chi deve decidere in pochi secondi",
        text: "L'interfaccia mette in evidenza disponibilità, prossime uscite, rientri, contratti mancanti e veicoli che richiedono attenzione."
      }
    ],
    steps: [
      { number: "01", title: "Acquisisci", text: "Cliente, periodo, sede e richiesta entrano una volta." },
      { number: "02", title: "Pianifica", text: "Il booking rende visibili disponibilità e conflitti." },
      { number: "03", title: "Formalizza", text: "Il contratto resta collegato a mezzo e prenotazione." },
      { number: "04", title: "Misura", text: "Utilizzo e redditività tornano nella dashboard." }
    ],
    faqs: [
      { question: "Fleetum sostituisce Excel per un autonoleggio?", answer: "Fleetum nasce per centralizzare prenotazioni, veicoli, clienti, contratti e report in un unico gestionale SaaS." },
      { question: "Fleetum è adatto a piccoli rent a car?", answer: "Sì. Può partire da una singola sede e scalare verso più sedi, più utenti e processi più strutturati." }
    ]
  },
  "software-rent-a-car": {
    slug: "software-rent-a-car",
    title: "Software rent a car | Gestionale SaaS per noleggio auto",
    description:
      "Fleetum è un software rent a car per gestire calendario booking, contratti, clienti, veicoli, listini, scadenze e performance della flotta.",
    eyebrow: "Software rent a car",
    chapter: "Operatività senza punti ciechi",
    h1: "La giornata del rent a car, ordinata prima che inizi.",
    intro:
      "Disponibilità mezzi, consegne, rientri, contratti e criticità diventano parte di una sola regia operativa.",
    primaryKeyword: "software rent a car",
    secondaryKeywords: ["gestionale rent a car", "software noleggio auto", "calendario noleggio auto"],
    visual: "dispatch",
    proof: [
      { title: "Consegne", text: "Orari e mezzi in evidenza." },
      { title: "Rientri", text: "Priorità leggibili oggi." },
      { title: "Contratti", text: "Stato e documenti collegati." },
      { title: "Sedi", text: "Contesto operativo sempre chiaro." }
    ],
    benefits: [
      { title: "Turno operativo leggibile", text: "Il team vede subito cosa esce, cosa rientra e cosa richiede un intervento." },
      { title: "Disponibilità attendibile", text: "Booking e indisponibilità aiutano a evitare assegnazioni incompatibili." },
      { title: "Passaggi collegati", text: "La prenotazione alimenta contratto, consegna e storico del noleggio." },
      { title: "Contesto multi-sede", text: "Filtri e perimetri aiutano ogni filiale a lavorare sulla propria operatività." }
    ],
    sections: [
      { title: "Meno passaggi manuali", text: "Ogni prenotazione può alimentare un contratto mantenendo cliente, veicolo, periodo e condizioni economiche allineati." },
      { title: "Controllo operativo nel momento giusto", text: "Il team legge la giornata prima di aprire ogni singola scheda e interviene sulle eccezioni, non sui dati già corretti." }
    ],
    steps: [
      { number: "08:30", title: "Prepara le uscite", text: "Veicoli, contratti e clienti della mattina." },
      { number: "12:00", title: "Controlla i rientri", text: "Orari, ritardi e prossime assegnazioni." },
      { number: "16:00", title: "Gestisci le eccezioni", text: "Fermi, manutenzioni e documenti mancanti." },
      { number: "18:30", title: "Chiudi la giornata", text: "Stato flotta e priorità del turno successivo." }
    ],
    faqs: [
      { question: "Fleetum gestisce prenotazioni multi-giorno?", answer: "Sì, il booking è progettato per prenotazioni multi-giorno collegate a veicolo, cliente e contratto." },
      { question: "Posso inviare contratti ai clienti?", answer: "Il modulo contratti supporta PDF, email, WhatsApp e storico degli invii quando i relativi canali sono configurati." }
    ]
  },
  "gestionale-flotta": {
    slug: "gestionale-flotta",
    title: "Gestionale flotta | Veicoli, scadenze, manutenzioni e KPI",
    description:
      "Fleetum centralizza la gestione flotta per autonoleggi: veicoli, sedi, manutenzioni, revisioni, scadenze, fermi tecnici e redditività.",
    eyebrow: "Gestionale flotta",
    chapter: "Ogni veicolo è un asset",
    h1: "La flotta non è un elenco. È un portafoglio da governare.",
    intro:
      "Ogni auto ha stato, sede, scadenze, interventi, utilizzo e performance. Fleetum li riunisce in una lettura operativa unica.",
    primaryKeyword: "gestionale flotta",
    secondaryKeywords: ["gestione flotta autonoleggio", "software gestione veicoli", "scadenziario flotta"],
    visual: "fleet",
    proof: [
      { title: "Stato mezzo", text: "Disponibile, occupato o fermo." },
      { title: "Scadenze", text: "Assicurazione, bollo e revisione." },
      { title: "Manutenzione", text: "Interventi e costi collegati." },
      { title: "Sede", text: "Posizione operativa del veicolo." }
    ],
    benefits: [
      { title: "Scheda veicolo completa", text: "Identità, stato, sede e dati operativi restano nello stesso profilo." },
      { title: "Scadenziario utilizzabile", text: "Le prossime scadenze diventano priorità da gestire, non note sparse." },
      { title: "Fermi distinguibili", text: "Manutenzioni e indisponibilità non vengono confuse con un noleggio." },
      { title: "Performance per mezzo", text: "Utilizzo e dati economici disponibili aiutano a confrontare gli asset." }
    ],
    sections: [
      { title: "Flotta sempre leggibile", text: "Fleetum collega veicolo, targa, sede, prenotazioni, manutenzioni e contratti per ridurre decisioni basate su dati incompleti." },
      { title: "Dalla scadenza alla decisione economica", text: "Il mezzo non viene osservato solo quando si rompe: storico operativo e report aiutano a pianificare interventi e rinnovi." }
    ],
    steps: [
      { number: "01", title: "Registra l'asset", text: "Dati tecnici, sede e stato operativo." },
      { number: "02", title: "Pianifica", text: "Scadenze, manutenzioni e indisponibilità." },
      { number: "03", title: "Utilizza", text: "Booking e contratti alimentano lo storico." },
      { number: "04", title: "Valuta", text: "Occupazione, costi e redditività disponibili." }
    ],
    faqs: [
      { question: "Fleetum mostra i veicoli meno utilizzati?", answer: "Le statistiche aiutano a leggere utilizzo, occupazione e performance dei mezzi in base ai dati disponibili." },
      { question: "Le scadenze veicolo sono gestibili?", answer: "Sì, Fleetum prevede scadenziario, manutenzioni e controllo operativo dei fermi." }
    ]
  },
  "booking-noleggi": {
    slug: "booking-noleggi",
    title: "Booking noleggi | Calendario prenotazioni auto e flotta",
    description:
      "Il booking noleggi Fleetum mostra disponibilità, uscite, rientri, veicoli, clienti e contratti in una vista operativa per autonoleggi.",
    eyebrow: "Booking noleggi",
    chapter: "Il cuore operativo di Fleetum",
    h1: "Capisci quali auto sono libere, occupate o bloccate. In tre secondi.",
    intro:
      "La timeline mette veicolo, sede, cliente, stato e durata nello stesso campo visivo, senza trasformare il calendario in un muro di informazioni.",
    primaryKeyword: "booking noleggi",
    secondaryKeywords: ["calendario prenotazioni auto", "gestione booking autonoleggio", "planner noleggio auto"],
    visual: "booking",
    proof: [
      { title: "Timeline", text: "Una riga per ogni veicolo." },
      { title: "Stati", text: "Colori soft e leggibili." },
      { title: "Sede", text: "Contesto sempre visibile." },
      { title: "Oggi", text: "Consegne e rientri prioritari." }
    ],
    benefits: [
      { title: "Disponibilità a colpo d'occhio", text: "Le barre mostrano durata e occupazione senza aprire ogni prenotazione." },
      { title: "Entrate e uscite leggibili", text: "Il team individua le priorità del giorno prima di entrare nel dettaglio." },
      { title: "Blocchi separati dai noleggi", text: "Manutenzioni e indisponibilità usano un linguaggio visivo distinto." },
      { title: "Multi-sede senza rumore", text: "Badge e filtri mantengono chiaro il perimetro operativo del mezzo." }
    ],
    sections: [
      { title: "Prenotazioni ordinate per veicolo", text: "Il booking riduce doppie assegnazioni, errori di calendario e verifiche manuali sulla disponibilità." },
      { title: "Dal calendario al contratto", text: "La prenotazione resta collegata a cliente, tariffa, veicolo e contratto per evitare informazioni duplicate." }
    ],
    steps: [
      { number: "01", title: "Filtra", text: "Periodo, sede, mezzo e stato del noleggio." },
      { number: "02", title: "Leggi", text: "Occupazione, durata, cliente e priorità." },
      { number: "03", title: "Apri", text: "Vai al dettaglio solo quando serve agire." },
      { number: "04", title: "Conferma", text: "Contratto e operatività restano allineati." }
    ],
    faqs: [
      { question: "Il booking mostra uscite e rientri?", answer: "Sì, Fleetum è pensato per evidenziare consegne, riconsegne e stato operativo della prenotazione." },
      { question: "Posso filtrare per sede o veicolo?", answer: "I filtri aiutano il team a leggere disponibilità e operatività per sede e mezzo." }
    ]
  },
  "contratti-noleggio-digitali": {
    slug: "contratti-noleggio-digitali",
    title: "Contratti noleggio digitali | PDF, firma e invio email/WhatsApp",
    description:
      "Fleetum genera contratti di noleggio professionali collegati a cliente, veicolo e prenotazione, con PDF, firma, email e WhatsApp.",
    eyebrow: "Contratti noleggio digitali",
    chapter: "Dal booking alla firma",
    h1: "Il contratto non è un file isolato. È parte del noleggio.",
    intro:
      "Cliente, veicolo, date e condizioni economiche accompagnano il documento dalla generazione alla firma e all'archivio.",
    primaryKeyword: "contratti noleggio digitali",
    secondaryKeywords: ["contratto noleggio auto pdf", "firma contratto noleggio", "software contratti rent a car"],
    visual: "contracts",
    proof: [
      { title: "PDF", text: "Documento professionale e brandizzato." },
      { title: "Firma", text: "Stato del contratto tracciato." },
      { title: "Invio", text: "Email e WhatsApp se configurati." },
      { title: "Archivio", text: "Collegato a booking e cliente." }
    ],
    benefits: [
      { title: "Dati già collegati", text: "Cliente, veicolo e periodo arrivano dal flusso operativo senza reinserimenti inutili." },
      { title: "Documento coerente", text: "Template e branding mantengono uniforme l'output prodotto dal gestionale." },
      { title: "Stato verificabile", text: "Preparazione, invio e firma restano leggibili nello storico del contratto." },
      { title: "Archivio consultabile", text: "Il documento conserva il collegamento con prenotazione, cliente e mezzo." }
    ],
    sections: [
      { title: "Meno errori tra prenotazione e firma", text: "I dati del booking alimentano il contratto, riducendo copia-incolla, versioni duplicate e documenti scollegati." },
      { title: "Una consegna più ordinata", text: "Prima di affidare le chiavi, il team può verificare documento, firma e informazioni operative nello stesso percorso." }
    ],
    steps: [
      { number: "01", title: "Genera", text: "Il contratto parte dai dati del booking." },
      { number: "02", title: "Verifica", text: "Condizioni, cliente, mezzo e periodo." },
      { number: "03", title: "Firma e invia", text: "Canali configurati e stato tracciato." },
      { number: "04", title: "Archivia", text: "Documento collegato allo storico operativo." }
    ],
    faqs: [
      { question: "Fleetum genera contratti PDF?", answer: "Sì, Fleetum prevede contratti PDF professionali collegati al noleggio." },
      { question: "Il contratto può essere inviato via email?", answer: "Il flusso supporta email e WhatsApp quando i relativi provider sono configurati, mantenendo lo storico operativo." }
    ]
  },
  "report-redditivita-veicolo": {
    slug: "report-redditivita-veicolo",
    title: "Report redditività veicolo | ROI auto a noleggio e break-even",
    description:
      "Fleetum calcola fatturato, giorni noleggiati, costi, margine stimato, investimento recuperato e break-even per ogni veicolo della flotta.",
    eyebrow: "Report redditività veicolo",
    chapter: "La performance di ogni asset",
    h1: "Quanto ha reso quell'auto? La risposta non deve richiedere un foglio Excel.",
    intro:
      "Fleetum riunisce ricavi, utilizzo e costi disponibili per mostrare quanto ogni mezzo contribuisce al risultato della flotta.",
    primaryKeyword: "report redditività veicolo",
    secondaryKeywords: ["ROI auto noleggio", "redditività flotta", "break-even auto noleggio"],
    visual: "roi",
    proof: [
      { title: "Fatturato", text: "Per veicolo e periodo." },
      { title: "Occupazione", text: "Giorni noleggiati e disponibili." },
      { title: "Costi", text: "Inclusi quando configurati." },
      { title: "Break-even", text: "Stimato sui dati disponibili." }
    ],
    benefits: [
      { title: "Ricavi separati per sorgente", text: "Il report distingue i dati disponibili senza confondere previsto, contrattualizzato e incassato." },
      { title: "Utilizzo misurabile", text: "Giorni noleggiati, disponibilità e occupazione aiutano a leggere la domanda reale." },
      { title: "Costi contestualizzati", text: "Manutenzioni e altri costi configurati contribuiscono alla stima del margine." },
      { title: "Decisioni sull'investimento", text: "Recupero e break-even aiutano a valutare se spingere, riposizionare o dismettere il mezzo." }
    ],
    sections: [
      { title: "Decisioni migliori sulla flotta", text: "Sapere quali veicoli generano margine e quali restano sotto break-even aiuta a decidere dove intervenire." },
      { title: "Un report condivisibile", text: "PDF, Excel e CSV rendono l'analisi utilizzabile anche fuori dalla dashboard, nel rispetto dei permessi configurati." }
    ],
    steps: [
      { number: "01", title: "Seleziona", text: "Veicolo, sede e intervallo temporale." },
      { number: "02", title: "Confronta", text: "Ricavi, costi, utilizzo e margine stimato." },
      { number: "03", title: "Valuta", text: "Recupero investimento e residuo a break-even." },
      { number: "04", title: "Esporta", text: "PDF, Excel o CSV per analisi e archivio." }
    ],
    faqs: [
      { question: "Fleetum calcola il break-even del veicolo?", answer: "Se e configurato il prezzo di acquisto e sono disponibili i dati economici, Fleetum stima investimento recuperato e residuo a break-even." },
      { question: "Il report è esportabile?", answer: "Il report redditività veicolo supporta PDF, Excel e CSV in base alle funzioni e ai permessi disponibili." }
    ]
  },
  prezzi: {
    slug: "prezzi",
    title: "Prezzi Fleetum | Piani SaaS per autonoleggi e flotte",
    description:
      "Scopri i piani Fleetum Starter, Pro ed Enterprise per autonoleggi, rent a car e flotte aziendali. Booking, contratti, dashboard e moduli operativi.",
    eyebrow: "Prezzi Fleetum",
    chapter: "Un catalogo commerciale, una sola verita",
    h1: "Il piano giusto per il livello di controllo che ti serve oggi.",
    intro:
      "Tre configurazioni chiare, prezzi IVA inclusa e la stessa sorgente dati usata dal flusso di attivazione Fleetum.",
    primaryKeyword: "prezzi software autonoleggio",
    secondaryKeywords: ["costo gestionale autonoleggio", "piani software rent a car", "abbonamento gestionale flotta"],
    visual: "pricing",
    proof: [
      { title: "Starter", text: "Per partire in modo ordinato." },
      { title: "Pro", text: "Per operatività quotidiana evoluta." },
      { title: "Enterprise", text: "Per governance multi-sede." },
      { title: "IVA inclusa", text: "Prezzi commerciali trasparenti." }
    ],
    benefits: [
      { title: "Prezzi allineati", text: "La pagina usa lo stesso catalogo condiviso tra frontend, backend e configurazione Stripe." },
      { title: "Mensile o annuale", text: `Il ciclo annuale applica lo sconto commerciale del ${ANNUAL_DISCOUNT_PERCENT}%.` },
      { title: "Carta prima del trial", text: "Il metodo di pagamento viene raccolto nel checkout prima dell'attivazione della prova." },
      { title: "Attivazione verificata", text: "L'accesso al gestionale dipende dallo stato di licenza aggiornato dal flusso billing." }
    ],
    sections: [
      { title: "Starter, Pro, Enterprise", text: "I piani accompagnano la crescita: dalla gestione essenziale fino a reportistica, automazioni e governance avanzata." },
      { title: "Demo prima dell'attivazione", text: "La demo aiuta a capire processi, numero veicoli, sedi e moduli necessari prima di scegliere il piano." }
    ],
    steps: [
      { number: "01", title: "Confronta", text: "Livello operativo e funzioni necessarie." },
      { number: "02", title: "Scegli", text: "Piano e ciclo mensile o annuale." },
      { number: "03", title: "Configura", text: "Dati aziendali e metodo di pagamento." },
      { number: "04", title: "Attiva", text: "Stripe conferma trial o abbonamento al backend." }
    ],
    faqs: [
      { question: "Quanto costa Fleetum?", answer: "Fleetum prevede piani mensili Starter, Pro ed Enterprise. I prezzi mostrati derivano dal catalogo commerciale condiviso e includono IVA." },
      { question: "Posso provare Fleetum prima di abbonarmi?", answer: "Il flusso prevede 14 giorni di prova con metodo di pagamento raccolto tramite Stripe prima dell'attivazione." }
    ]
  }
};

const pageIcons = [CalendarDays, ClipboardSignature, Car, Wrench];
const timelineDays = ["Lun 14", "Mar 15", "Mer 16", "Gio 17", "Ven 18", "Sab 19", "Dom 20"];
const timelineRows = [
  { vehicle: "Fiat 500", meta: "FT100AA · Roma Centro", label: "Rossi · consegna 09:00", start: 1, span: 3, tone: "blue" },
  { vehicle: "Toyota Yaris", meta: "FT101AB · Roma Centro", label: "Bianchi · in noleggio", start: 3, span: 4, tone: "teal" },
  { vehicle: "Jeep Renegade", meta: "FT102AC · Fiumicino", label: "Rientro 17:30", start: 2, span: 2, tone: "amber" },
  { vehicle: "Fiat Ducato", meta: "FT104AE · Fiumicino", label: "Manutenzione", start: 1, span: 2, tone: "slate" }
];

const formatCurrency = (value: number, maximumFractionDigits = 0) =>
  new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits
  }).format(value);

const ProductImage = ({ type, priority = false }: { type: "fleet" | "handover" | "hub"; priority?: boolean }) => {
  const media = {
    fleet: {
      src: "/media/fleetum-hero-fleet-1600.webp",
      srcSet: "/media/fleetum-hero-fleet-640.webp 640w, /media/fleetum-hero-fleet-1024.webp 1024w, /media/fleetum-hero-fleet-1600.webp 1600w",
      width: 1600,
      height: 900,
      alt: "Flotta di veicoli pronta davanti a un terminal aeroportuale"
    },
    handover: {
      src: "/media/fleetum-handover-1440.webp",
      srcSet: "/media/fleetum-handover-640.webp 640w, /media/fleetum-handover-768.webp 768w, /media/fleetum-handover-1024.webp 1024w, /media/fleetum-handover-1440.webp 1440w",
      width: 1440,
      height: 960,
      alt: "Consegna delle chiavi di un veicolo con controllo digitale su tablet"
    },
    hub: {
      src: "/media/fleetum-multisite-hub-1600.webp",
      srcSet: "/media/fleetum-multisite-hub-640.webp 640w, /media/fleetum-multisite-hub-1024.webp 1024w, /media/fleetum-multisite-hub-1600.webp 1600w",
      width: 1600,
      height: 900,
      alt: "Vista aerea di un hub aeroportuale organizzato per la flotta"
    }
  }[type];

  return (
    <ResponsiveMedia
      src={media.src}
      webpSrcSet={media.srcSet}
      sizes="(max-width: 920px) 100vw, 52vw"
      width={media.width}
      height={media.height}
      alt={media.alt}
      priority={priority}
    />
  );
};

const BookingTimeline = ({ large = false }: { large?: boolean }) => (
  <div className={`fleetum-vertical-timeline ${large ? "is-large" : ""}`}>
    <div className="fleetum-vertical-timeline__toolbar">
      <div><span>Dati dimostrativi</span><strong>Booking Noleggi</strong></div>
      <p><MapPin size={14} aria-hidden="true" /> Tutte le sedi <i /> Oggi</p>
    </div>
    <div className="fleetum-vertical-timeline__hint" aria-hidden="true">
      Scorri la timeline <ArrowRight size={14} />
    </div>
    <div className="fleetum-vertical-timeline__scroll" tabIndex={0} aria-label="Anteprima booking Fleetum, scorribile orizzontalmente">
      <div className="fleetum-vertical-timeline__table">
        <div className="fleetum-vertical-timeline__head">
          <span>Veicolo</span>
          {timelineDays.map((day) => <span key={day}>{day}</span>)}
        </div>
        {timelineRows.map((row) => (
          <div className="fleetum-vertical-timeline__row" key={row.meta}>
            <div><strong>{row.vehicle}</strong><small>{row.meta}</small></div>
            <div className="fleetum-vertical-timeline__track">
              {timelineDays.map((day) => <span key={`${row.meta}-${day}`} aria-hidden="true" />)}
              <p
                className={`is-${row.tone}`}
                style={{ "--start": row.start, "--span": row.span } as CSSProperties}
              >
                {row.label}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
);

const ControlVisual = ({ dispatch = false }: { dispatch?: boolean }) => (
  <div className="fleetum-vertical-photo-visual">
    <ProductImage type="fleet" priority />
    <span className="fleetum-vertical-photo-visual__label"><MapPin size={14} aria-hidden="true" /> Hub operativo · dati dimostrativi</span>
    <div className="fleetum-vertical-control-card">
      <div><span>{dispatch ? "Turno di oggi" : "Control room"}</span><strong>{dispatch ? "18 operazioni" : "Flotta operativa"}</strong></div>
      <ul>
        <li><i className="is-blue" /><span>{dispatch ? "Consegne" : "Disponibili"}</span><strong>{dispatch ? "7" : "24"}</strong></li>
        <li><i className="is-teal" /><span>{dispatch ? "Rientri" : "In noleggio"}</span><strong>{dispatch ? "6" : "31"}</strong></li>
        <li><i className="is-amber" /><span>{dispatch ? "Da verificare" : "In attenzione"}</span><strong>{dispatch ? "2" : "3"}</strong></li>
      </ul>
    </div>
  </div>
);

const FleetVisual = () => (
  <div className="fleetum-vertical-photo-visual is-fleet">
    <ProductImage type="hub" priority />
    <span className="fleetum-vertical-photo-visual__label"><Building2 size={14} aria-hidden="true" /> Controllo multi-sede</span>
    <div className="fleetum-vertical-fleet-card">
      <span>Sede attiva</span>
      <strong><MapPin size={16} aria-hidden="true" /> Fiumicino Aeroporto</strong>
      <ul>
        <li><Car size={15} aria-hidden="true" /> 31 veicoli</li>
        <li><Wrench size={15} aria-hidden="true" /> 2 in manutenzione</li>
        <li><CheckCircle2 size={15} aria-hidden="true" /> 9 disponibili</li>
      </ul>
    </div>
  </div>
);

const ContractVisual = () => (
  <div className="fleetum-vertical-photo-visual is-contract">
    <ProductImage type="handover" priority />
    <span className="fleetum-vertical-photo-visual__label"><KeyRound size={14} aria-hidden="true" /> Consegna collegata al contratto</span>
    <div className="fleetum-vertical-contract-card">
      <div><FileCheck2 size={19} aria-hidden="true" /><span>CN-2026-184</span><em>Firmato</em></div>
      <strong>Contratto di noleggio</strong>
      <p>Cliente, veicolo, condizioni e firma nello stesso storico.</p>
      <ul><li><Check size={14} /> Dati verificati</li><li><Check size={14} /> PDF generato</li><li><Check size={14} /> Firma acquisita</li></ul>
    </div>
  </div>
);

const RoiVisual = () => (
  <div className="fleetum-vertical-roi-card">
    <div className="fleetum-vertical-roi-card__head">
      <div><span>Dati dimostrativi</span><strong>Toyota Yaris · FT101AB</strong></div>
      <p><TrendingUp size={14} aria-hidden="true" /> Trend positivo</p>
    </div>
    <div className="fleetum-vertical-roi-card__metrics">
      <article><span>Fatturato</span><strong>€ 18.420</strong><small>Periodo selezionato</small></article>
      <article><span>Recuperato</span><strong>74%</strong><small>Stima disponibile</small></article>
      <article><span>Occupazione</span><strong>81%</strong><small>Giorni disponibili</small></article>
    </div>
    <svg viewBox="0 0 720 300" role="img" aria-label="Esempio di andamento ricavi e soglia break-even">
      <defs><linearGradient id="verticalRoiArea" x1="0" x2="0" y1="0" y2="1"><stop stopColor="#36d8c6" stopOpacity=".32" /><stop offset="1" stopColor="#36d8c6" stopOpacity="0" /></linearGradient></defs>
      {[66, 126, 186, 246].map((y) => <line key={y} x1="24" x2="696" y1={y} y2={y} className="is-grid" />)}
      <path className="is-area" d="M24 248 C96 230 128 205 190 212 C258 218 286 166 352 180 C420 194 446 126 516 140 C590 154 612 94 696 70 L696 274 L24 274 Z" />
      <path className="is-line" d="M24 248 C96 230 128 205 190 212 C258 218 286 166 352 180 C420 194 446 126 516 140 C590 154 612 94 696 70" />
      <line x1="24" x2="696" y1="154" y2="154" className="is-break-even" />
      <text x="518" y="142">Break-even</text>
    </svg>
    <div className="fleetum-vertical-roi-card__foot"><span><i /> Ricavi cumulati</span><strong>Residuo stimato € 6.480</strong></div>
  </div>
);

const PricingVisual = () => (
  <div className="fleetum-vertical-price-pulse">
    <div className="fleetum-vertical-price-pulse__head"><span>Catalogo Fleetum</span><strong>Prezzi mensili · IVA inclusa</strong></div>
    {SAAS_PLANS.map((code) => (
      <article key={code} className={code === "PRO" ? "is-highlight" : ""}>
        <div><span>{COMMERCIAL_PLAN_CATALOG[code].label}</span><small>{code === "PRO" ? "Consigliato" : "Piano"}</small></div>
        <strong>{formatCurrency(PLAN_MONTHLY_PRICING_EUR[code])}<em>/mese</em></strong>
      </article>
    ))}
    <p><ShieldCheck size={15} aria-hidden="true" /> Carta richiesta prima del trial di 14 giorni</p>
  </div>
);

const ProductHeroVisual = ({ visual }: { visual: ProductVisual }) => {
  if (visual === "booking") return <BookingTimeline large />;
  if (visual === "contracts") return <ContractVisual />;
  if (visual === "fleet") return <FleetVisual />;
  if (visual === "roi") return <RoiVisual />;
  if (visual === "pricing") return <PricingVisual />;
  return <ControlVisual dispatch={visual === "dispatch"} />;
};

const planCopy: Record<SaasPlan, { target: string; features: string[]; highlighted?: boolean }> = {
  STARTER: {
    target: "Per piccoli autonoleggi che vogliono uscire da fogli e chat.",
    features: ["Booking e flotta", "Clienti e contratti", "Dashboard operativa", "Scadenze principali"]
  },
  PRO: {
    target: "Per team che gestiscono noleggi e contratti ogni giorno.",
    features: ["Flussi contrattuali evoluti", "Manutenzioni e listini", "Statistiche e alert", "Operatività avanzata"],
    highlighted: true
  },
  ENTERPRISE: {
    target: "Per aziende multi-sede con governance e processi complessi.",
    features: ["Controllo multi-sede", "Governance avanzata", "Automazioni e integrazioni", "Supporto prioritario"]
  }
};

const PricingMatrix = () => {
  const [cycle, setCycle] = useState<"monthly" | "yearly">("monthly");

  return (
    <section className="fleetum-vertical-pricing" aria-labelledby="fleetum-pricing-title">
      <div className="fleetum-vertical-section-head is-center">
        <p>Catalogo commerciale condiviso</p>
        <h2 id="fleetum-pricing-title">Tre piani. Nessun prezzo duplicato nel codice.</h2>
        <span>Il valore mostrato arriva dalla stessa sorgente usata dal flusso di attivazione e dalla configurazione billing.</span>
      </div>
      <div className="fleetum-vertical-cycle" role="group" aria-label="Seleziona ciclo di fatturazione">
        <button type="button" className={cycle === "monthly" ? "is-active" : ""} onClick={() => setCycle("monthly")}>Mensile</button>
        <button type="button" className={cycle === "yearly" ? "is-active" : ""} onClick={() => setCycle("yearly")}>Annuale <span>-{ANNUAL_DISCOUNT_PERCENT}%</span></button>
      </div>
      <div className="fleetum-vertical-pricing__grid">
        {SAAS_PLANS.map((code) => {
          const copy = planCopy[code];
          const fullYear = PLAN_YEARLY_PRICING_EUR[code];
          const displayedPrice = cycle === "monthly" ? PLAN_MONTHLY_PRICING_EUR[code] : fullYear / 12;
          return (
            <article key={code} className={copy.highlighted ? "is-highlight" : ""}>
              <div className="fleetum-vertical-pricing__plan-head">
                <span>{copy.highlighted ? "Consigliato" : "Piano"}</span>
                <h3>{COMMERCIAL_PLAN_CATALOG[code].label}</h3>
              </div>
              <p className="fleetum-vertical-pricing__price"><strong key={`${code}-${cycle}`}>{formatCurrency(displayedPrice, cycle === "yearly" ? 2 : 0)}</strong><span>/mese<br />IVA inclusa</span></p>
              {cycle === "yearly" ? <p className="fleetum-vertical-pricing__billing">Addebito annuale: {formatCurrency(fullYear, 2)}</p> : <p className="fleetum-vertical-pricing__billing">Fatturazione mensile</p>}
              <p className="fleetum-vertical-pricing__target">{copy.target}</p>
              <ul>{copy.features.map((feature) => <li key={feature}><Check size={15} aria-hidden="true" /> {feature}</li>)}</ul>
              <Link
                to={code === "ENTERPRISE" ? "/demo" : "/signup"}
                className="fleetum-v3-button is-primary"
                onClick={() => trackPublicEvent("CTA_CLICK", { placement: "pricing_matrix", destination: code === "ENTERPRISE" ? "demo" : "signup", plan: code.toLowerCase(), billingCycle: cycle })}
              >
                {code === "ENTERPRISE" ? "Parla con noi" : "Inizia con Fleetum"} <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </article>
          );
        })}
      </div>
      <p className="fleetum-vertical-pricing__note"><WalletCards size={16} aria-hidden="true" /> Il trial di 14 giorni richiede un metodo di pagamento valido prima dell'attivazione.</p>
    </section>
  );
};

const benefitIcons = [CircleGauge, Route, ShieldCheck, BarChart3];

const trackSeoCta = (placement: string, destination: "demo" | "login", page: string) => {
  trackPublicEvent(destination === "login" ? "LOGIN_CLICK" : "CTA_CLICK", { placement, destination, page });
};

export const PublicSeoPage = ({ slug }: { slug: SeoPageKey }) => {
  const page = pages[slug];

  useEffect(() => {
    trackPublicEvent("PAGE_VIEW", { page: slug, version: "vertical-v3" });
    if (slug === "prezzi") trackPublicEvent("PRICING_VIEW", { placement: "seo_page_v3" });
  }, [slug]);

  return (
    <main id="main-content" className={`fleetum-landing fleetum-home-v3 fleetum-vertical-page fleetum-vertical-page--${page.visual} fleetum-public-theme fleetum-public-theme--light`}>
      <SeoHead title={page.title} description={page.description} canonicalPath={`/${page.slug}`}>
        <script type="application/ld+json">
          {JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Organization",
            name: "Fleetum",
            url: "https://fleetum.it",
            logo: "https://fleetum.it/brand/fleetum-logo-on-light.webp"
          })}
        </script>
        <script type="application/ld+json">
          {JSON.stringify({
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: "Fleetum",
            applicationCategory: "BusinessApplication",
            operatingSystem: "Web",
            description: page.description,
            url: `https://fleetum.it/${page.slug}`,
            offers: SAAS_PLANS.map((code) => ({
              "@type": "Offer",
              name: COMMERCIAL_PLAN_CATALOG[code].label,
              price: PLAN_MONTHLY_PRICING_EUR[code],
              priceCurrency: "EUR",
              availability: "https://schema.org/InStock"
            }))
          })}
        </script>
        <script type="application/ld+json">
          {JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: page.faqs.map((faq) => ({
              "@type": "Question",
              name: faq.question,
              acceptedAnswer: { "@type": "Answer", text: faq.answer }
            }))
          })}
        </script>
        <script type="application/ld+json">
          {JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Fleetum", item: "https://fleetum.it/" },
              { "@type": "ListItem", position: 2, name: page.eyebrow, item: `https://fleetum.it/${page.slug}` }
            ]
          })}
        </script>
      </SeoHead>

      <section className="fleetum-vertical-hero">
        <PublicHeader tone="light" items={PUBLIC_PRODUCT_NAVIGATION} analyticsPlacement={`seo_${slug}_v3`} />
        <div className="fleetum-vertical-hero__grid">
          <div className="fleetum-vertical-hero__copy">
            <p className="fleetum-vertical-kicker"><Sparkles size={15} aria-hidden="true" /> {page.eyebrow}</p>
            <h1>{page.h1}</h1>
            <span>{page.intro}</span>
            <div className="fleetum-vertical-actions">
              <Link className="fleetum-v3-button is-primary" to="/demo" onClick={() => trackSeoCta("vertical_hero", "demo", slug)}>
                Vedi Fleetum in azione <ArrowRight size={17} aria-hidden="true" />
              </Link>
              <Link className="fleetum-v3-button is-secondary" to="/login" onClick={() => trackSeoCta("vertical_hero", "login", slug)}>
                Accedi
              </Link>
            </div>
            <div className="fleetum-vertical-hero__signals">
              {page.proof.slice(0, 3).map((item) => <span key={item.title}><Check size={14} aria-hidden="true" /> {item.title}</span>)}
            </div>
          </div>
          <div className="fleetum-vertical-hero__visual">
            <ProductHeroVisual visual={page.visual} />
          </div>
        </div>
        <a className="fleetum-vertical-scroll" href="#vertical-story" aria-label="Vai al dettaglio della pagina">
          <span>Esplora il flusso</span><ChevronRight size={16} aria-hidden="true" />
        </a>
      </section>

      <section className="fleetum-vertical-proof" aria-label="Punti chiave Fleetum">
        {page.proof.map((item, index) => {
          const Icon = pageIcons[index % pageIcons.length];
          return <article key={item.title}><Icon size={20} aria-hidden="true" /><div><strong>{item.title}</strong><span>{item.text}</span></div></article>;
        })}
      </section>

      <section className="fleetum-vertical-story" id="vertical-story">
        <div className="fleetum-vertical-story__copy">
          <p>{page.chapter}</p>
          <h2>{page.sections[0].title}</h2>
          <span>{page.sections[0].text}</span>
          <div className="fleetum-vertical-story__secondary">
            <strong>{page.sections[1].title}</strong>
            <p>{page.sections[1].text}</p>
          </div>
        </div>
        <div className="fleetum-vertical-journey">
          <div className="fleetum-vertical-journey__head"><span>Flusso operativo</span><strong>{page.eyebrow}</strong></div>
          {page.steps.map((step) => (
            <article key={`${step.number}-${step.title}`}>
              <span>{step.number}</span>
              <div><strong>{step.title}</strong><p>{step.text}</p></div>
              <ChevronRight size={17} aria-hidden="true" />
            </article>
          ))}
        </div>
      </section>

      <section className="fleetum-vertical-benefits">
        <div className="fleetum-vertical-section-head">
          <p>Progettato intorno alle decisioni</p>
          <h2>Ogni elemento deve aiutare il team a capire o ad agire.</h2>
          <span>Non una raccolta di moduli scollegati, ma informazioni organizzate intorno al veicolo e al noleggio.</span>
        </div>
        <div className="fleetum-vertical-benefits__grid">
          {page.benefits.map((benefit, index) => {
            const Icon = benefitIcons[index % benefitIcons.length];
            return <article key={benefit.title}><span><Icon size={21} aria-hidden="true" /></span><h3>{benefit.title}</h3><p>{benefit.text}</p><em>0{index + 1}</em></article>;
          })}
        </div>
      </section>

      {page.visual === "booking" ? <section className="fleetum-vertical-showcase"><div className="fleetum-vertical-section-head"><p>Anteprima operativa</p><h2>La timeline resta leggibile anche quando la flotta cresce.</h2><span>Dati dimostrativi: la struttura visuale riproduce il principio del booking Fleetum senza esporre informazioni reali.</span></div><BookingTimeline large /></section> : null}
      {page.visual === "pricing" ? <PricingMatrix /> : null}

      <section className="fleetum-vertical-faq">
        <div className="fleetum-vertical-faq__intro">
          <p>Domande frequenti</p>
          <h2>Prima di vedere Fleetum in azione.</h2>
          <span>Risposte essenziali sulla funzione e sul modo in cui entra nel flusso operativo.</span>
          <div className="fleetum-vertical-keywords" aria-label="Argomenti della pagina">
            {[page.primaryKeyword, ...page.secondaryKeywords].map((keyword) => <span key={keyword}>{keyword}</span>)}
          </div>
        </div>
        <div className="fleetum-vertical-faq__list">
          {page.faqs.map((faq, index) => <article key={faq.question}><span>0{index + 1}</span><div><h3>{faq.question}</h3><p>{faq.answer}</p></div></article>)}
        </div>
      </section>

      <section className="fleetum-vertical-final">
        <div><span>Fleetum sul tuo flusso reale</span><h2>La prossima prenotazione può partire meglio.</h2><p>Raccontaci sedi, flotta e modo di lavorare. Prepariamo una demo mirata, non una presentazione generica.</p></div>
        <div className="fleetum-vertical-final__actions">
          <Link className="fleetum-v3-button is-light" to="/demo" onClick={() => trackSeoCta("vertical_final", "demo", slug)}>Richiedi una demo <ArrowRight size={17} aria-hidden="true" /></Link>
          <Link className="fleetum-v3-button is-outline" to="/login" onClick={() => trackSeoCta("vertical_final", "login", slug)}>Accedi</Link>
        </div>
      </section>

      <PublicFooter tone="light" />
    </main>
  );
};
