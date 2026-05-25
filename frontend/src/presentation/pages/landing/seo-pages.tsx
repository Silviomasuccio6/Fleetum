import { useEffect } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  Car,
  CheckCircle2,
  ClipboardSignature,
  Gauge,
  ShieldCheck,
  Wrench
} from "lucide-react";
import { trackPublicEvent } from "../../../application/usecases/public-analytics-usecases";
import "./landing.css";

type SeoPageKey =
  | "software-autonoleggio"
  | "software-rent-a-car"
  | "gestionale-flotta"
  | "booking-noleggi"
  | "contratti-noleggio-digitali"
  | "report-redditivita-veicolo"
  | "prezzi";

type SeoPageConfig = {
  slug: SeoPageKey;
  title: string;
  description: string;
  eyebrow: string;
  h1: string;
  intro: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  benefits: string[];
  sections: Array<{ title: string; text: string }>;
  faqs: Array<{ question: string; answer: string }>;
};

const pages: Record<SeoPageKey, SeoPageConfig> = {
  "software-autonoleggio": {
    slug: "software-autonoleggio",
    title: "Software autonoleggio | Booking, contratti e flotta con Fleetum",
    description:
      "Fleetum e il software per autonoleggi che centralizza booking, contratti digitali, clienti, veicoli, manutenzioni, scadenze e KPI operativi.",
    eyebrow: "Software autonoleggio",
    h1: "Il software per autonoleggi che collega booking, contratti e flotta.",
    intro:
      "Fleetum aiuta rent a car e aziende di noleggio a sostituire fogli Excel, chat e cartelle sparse con una piattaforma SaaS pensata per operativita quotidiana, controllo flotta e crescita commerciale.",
    primaryKeyword: "software autonoleggio",
    secondaryKeywords: ["gestionale autonoleggio", "programma noleggio auto", "software rent a car"],
    benefits: [
      "Vista unica su prenotazioni, clienti, veicoli e contratti.",
      "Contratti digitali collegati a booking e anagrafiche.",
      "Controllo di scadenze, manutenzioni e fermi tecnici.",
      "Dashboard operative per decisioni rapide su flotta e ricavi."
    ],
    sections: [
      {
        title: "Dal banco noleggio alla dashboard manageriale",
        text: "Fleetum organizza le attivita che partono da una richiesta cliente e arrivano a consegna, rientro, manutenzione e report. Ogni passaggio resta collegato al veicolo e al contratto."
      },
      {
        title: "Pensato per team operativi",
        text: "L'interfaccia e costruita per operatori che devono capire subito quali auto sono disponibili, quali rientrano oggi, quali contratti mancano e quali veicoli richiedono attenzione."
      }
    ],
    faqs: [
      {
        question: "Fleetum sostituisce Excel per un autonoleggio?",
        answer: "Si, Fleetum nasce per centralizzare prenotazioni, veicoli, clienti, contratti e report in un unico gestionale SaaS."
      },
      {
        question: "Fleetum e adatto a piccoli rent a car?",
        answer: "Si. Puo partire da una singola sede e scalare verso piu sedi, piu utenti e processi piu strutturati."
      }
    ]
  },
  "software-rent-a-car": {
    slug: "software-rent-a-car",
    title: "Software rent a car | Gestionale SaaS per noleggio auto",
    description:
      "Fleetum e un software rent a car per gestire calendario booking, contratti, clienti, veicoli, listini, scadenze e performance della flotta.",
    eyebrow: "Software rent a car",
    h1: "Una control room digitale per rent a car moderni.",
    intro:
      "Fleetum mette ordine nei processi di noleggio auto: disponibilita mezzi, prenotazioni, contratti, uscite, rientri, manutenzioni e statistiche diventano parte dello stesso flusso operativo.",
    primaryKeyword: "software rent a car",
    secondaryKeywords: ["gestionale rent a car", "software noleggio auto", "calendario noleggio auto"],
    benefits: [
      "Calendario booking per macchina e periodo.",
      "Contratti professionali con storico invii.",
      "Anagrafiche clienti e documenti sempre collegati.",
      "KPI su occupazione, rientri, ricavi e criticita."
    ],
    sections: [
      {
        title: "Meno passaggi manuali",
        text: "Ogni prenotazione puo generare un contratto, mantenendo dati cliente, veicolo, periodo e condizioni economiche allineati."
      },
      {
        title: "Controllo operativo in tempo reale",
        text: "Il team vede cosa succede oggi, cosa rientra, cosa esce e quali veicoli non devono essere assegnati per manutenzione o scadenze."
      }
    ],
    faqs: [
      {
        question: "Fleetum gestisce sia noleggi brevi sia operativita multi-giorno?",
        answer: "Si, il booking e progettato per prenotazioni multi-giorno con collegamento a veicolo, cliente e contratto."
      },
      {
        question: "Posso inviare contratti ai clienti?",
        answer: "Si, il modulo contratti supporta PDF, email, WhatsApp e storico degli invii."
      }
    ]
  },
  "gestionale-flotta": {
    slug: "gestionale-flotta",
    title: "Gestionale flotta | Veicoli, scadenze, manutenzioni e KPI",
    description:
      "Fleetum centralizza la gestione flotta per autonoleggi: veicoli, sedi, manutenzioni, revisioni, scadenze, fermi tecnici e redditivita.",
    eyebrow: "Gestionale flotta",
    h1: "Gestisci ogni veicolo come un asset, non come una riga su Excel.",
    intro:
      "Con Fleetum la flotta diventa misurabile: ogni auto ha stato, sede, scadenze, interventi, utilizzo, ricavi e report di performance economica.",
    primaryKeyword: "gestionale flotta",
    secondaryKeywords: ["gestione flotta autonoleggio", "software gestione veicoli", "scadenziario flotta"],
    benefits: [
      "Scheda veicolo con dati operativi ed economici.",
      "Scadenze e revisioni sotto controllo.",
      "Manutenzioni e fermi tecnici tracciati.",
      "Report per capire quali auto rendono di piu."
    ],
    sections: [
      {
        title: "Flotta sempre leggibile",
        text: "Fleetum collega veicolo, targa, sede, prenotazioni, manutenzioni e contratti per ridurre errori e decisioni basate su dati incompleti."
      },
      {
        title: "Performance economica per veicolo",
        text: "Il report redditivita permette di misurare fatturato, utilizzo, costi, margine stimato e recupero investimento."
      }
    ],
    faqs: [
      {
        question: "Fleetum puo mostrare quali veicoli sono meno utilizzati?",
        answer: "Si, le statistiche aiutano a leggere utilizzo, occupazione e performance dei mezzi."
      },
      {
        question: "Le scadenze veicolo sono gestibili?",
        answer: "Si, Fleetum prevede scadenziario, manutenzioni e controllo operativo dei fermi."
      }
    ]
  },
  "booking-noleggi": {
    slug: "booking-noleggi",
    title: "Booking noleggi | Calendario prenotazioni auto e flotta",
    description:
      "Il booking noleggi Fleetum mostra disponibilita, uscite, rientri, veicoli, clienti e contratti in una vista operativa per autonoleggi.",
    eyebrow: "Booking noleggi",
    h1: "Il calendario booking diventa il centro operativo del noleggio.",
    intro:
      "Fleetum porta prenotazioni, veicoli, clienti e contratti nello stesso calendario, cosi l'operatore capisce subito disponibilita, conflitti e prossime consegne.",
    primaryKeyword: "booking noleggi",
    secondaryKeywords: ["calendario prenotazioni auto", "gestione booking autonoleggio", "planner noleggio auto"],
    benefits: [
      "Vista mensile per veicolo.",
      "Prenotazioni multi-giorno leggibili.",
      "Collegamento a cliente e contratto.",
      "Uscite e rientri sempre in evidenza."
    ],
    sections: [
      {
        title: "Prenotazioni ordinate per veicolo",
        text: "Il booking consente di leggere la disponibilita per macchina, riducendo doppie assegnazioni, errori di calendario e passaggi manuali."
      },
      {
        title: "Dal booking al contratto",
        text: "La prenotazione non resta isolata: puo essere collegata al contratto, al cliente, alla tariffa e allo storico operativo."
      }
    ],
    faqs: [
      {
        question: "Il booking mostra uscite e rientri?",
        answer: "Si, Fleetum e pensato per evidenziare consegne, riconsegne e stato operativo della prenotazione."
      },
      {
        question: "Posso filtrare per sede o veicolo?",
        answer: "Si, l'obiettivo del booking e aiutare il team a leggere disponibilita e operativita per sede e mezzo."
      }
    ]
  },
  "contratti-noleggio-digitali": {
    slug: "contratti-noleggio-digitali",
    title: "Contratti noleggio digitali | PDF, firma e invio email/WhatsApp",
    description:
      "Fleetum genera contratti di noleggio professionali collegati a cliente, veicolo e prenotazione, con PDF, firma, email e WhatsApp.",
    eyebrow: "Contratti noleggio digitali",
    h1: "Contratti professionali collegati al flusso operativo.",
    intro:
      "Fleetum aiuta il team a generare, firmare, inviare e archiviare contratti noleggio senza perdere il collegamento con booking, cliente, veicolo e condizioni economiche.",
    primaryKeyword: "contratti noleggio digitali",
    secondaryKeywords: ["contratto noleggio auto pdf", "firma contratto noleggio", "software contratti rent a car"],
    benefits: [
      "PDF professionali e brandizzati.",
      "Dati cliente e veicolo precompilati.",
      "Firma e storico eventi contratto.",
      "Invio email e WhatsApp."
    ],
    sections: [
      {
        title: "Meno errori tra prenotazione e firma",
        text: "I dati del booking alimentano il contratto, riducendo copia-incolla, versioni duplicate e documenti scollegati."
      },
      {
        title: "Archivio contratti sempre consultabile",
        text: "Ogni contratto resta associato a cliente, veicolo e prenotazione, rendendo piu semplice recuperare documenti e storico."
      }
    ],
    faqs: [
      {
        question: "Fleetum genera contratti PDF?",
        answer: "Si, Fleetum prevede contratti PDF professionali collegati al noleggio."
      },
      {
        question: "Il contratto puo essere inviato via email?",
        answer: "Si, il flusso supporta invio email e WhatsApp, con tracciamento operativo."
      }
    ]
  },
  "report-redditivita-veicolo": {
    slug: "report-redditivita-veicolo",
    title: "Report redditivita veicolo | ROI auto a noleggio e break-even",
    description:
      "Fleetum calcola fatturato, giorni noleggiati, costi, margine stimato, investimento recuperato e break-even per ogni veicolo della flotta.",
    eyebrow: "Report redditivita veicolo",
    h1: "Capisci quali auto stanno davvero ripagando l'investimento.",
    intro:
      "Il report redditivita veicolo aiuta titolari e manager a leggere quanto ha generato ogni macchina, quanto e stata noleggiata e quanto manca al recupero dell'investimento.",
    primaryKeyword: "report redditivita veicolo",
    secondaryKeywords: ["ROI auto noleggio", "redditivita flotta", "break-even auto noleggio"],
    benefits: [
      "Fatturato per veicolo e periodo.",
      "Giorni noleggiati e occupazione.",
      "Costi e margine stimato.",
      "Break-even e investimento recuperato."
    ],
    sections: [
      {
        title: "Decisioni migliori sulla flotta",
        text: "Sapere quali veicoli generano margine e quali restano sotto break-even aiuta a decidere se spingerli, riposizionarli o venderli."
      },
      {
        title: "Export professionali",
        text: "Il report puo essere esportato in PDF, Excel o CSV per condivisione interna, analisi contabile o archiviazione."
      }
    ],
    faqs: [
      {
        question: "Fleetum calcola il break-even del veicolo?",
        answer: "Si, se e configurato il prezzo di acquisto, Fleetum stima investimento recuperato e residuo a break-even."
      },
      {
        question: "Il report e esportabile?",
        answer: "Si, il report redditivita veicolo supporta PDF, Excel e CSV."
      }
    ]
  },
  prezzi: {
    slug: "prezzi",
    title: "Prezzi Fleetum | Piani SaaS per autonoleggi e flotte",
    description:
      "Scopri i piani Fleetum Starter, Pro ed Enterprise per autonoleggi, rent a car e flotte aziendali. Booking, contratti, dashboard e moduli operativi.",
    eyebrow: "Prezzi Fleetum",
    h1: "Piani chiari per portare il tuo autonoleggio su Fleetum.",
    intro:
      "Fleetum offre piani pensati per aziende di noleggio che vogliono partire in modo ordinato e scalare con moduli avanzati, dashboard e controllo operativo.",
    primaryKeyword: "prezzi software autonoleggio",
    secondaryKeywords: ["costo gestionale autonoleggio", "piani software rent a car", "abbonamento gestionale flotta"],
    benefits: [
      "Starter per piccoli autonoleggi.",
      "Pro per team operativi strutturati.",
      "Enterprise per piu sedi e controllo avanzato.",
      "Richiesta demo per valutare il piano corretto."
    ],
    sections: [
      {
        title: "Starter, Pro, Enterprise",
        text: "I piani sono progettati per accompagnare la crescita: dalla gestione base di booking e clienti fino a reportistica, automazioni e governance."
      },
      {
        title: "Demo prima dell'attivazione",
        text: "La demo aiuta a capire processi, numero veicoli, sedi e moduli necessari prima di scegliere il piano."
      }
    ],
    faqs: [
      {
        question: "Quanto costa Fleetum?",
        answer: "Fleetum prevede piani mensili Starter, Pro ed Enterprise. La pagina demo aiuta a scegliere il piano piu adatto."
      },
      {
        question: "Posso provare Fleetum prima di abbonarmi?",
        answer: "Si, puoi richiedere una demo o creare un account per valutare il gestionale."
      }
    ]
  }
};

const icons = [CalendarDays, ClipboardSignature, Car, Wrench, BarChart3, ShieldCheck, Gauge];

const setMetaTag = (selector: string, attr: "name" | "property", key: string, content: string) => {
  let meta = document.head.querySelector<HTMLMetaElement>(selector);
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute(attr, key);
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", content);
};

const setJsonLd = (id: string, payload: Record<string, unknown>) => {
  let script = document.head.querySelector<HTMLScriptElement>(`script#${id}`);
  if (!script) {
    script = document.createElement("script");
    script.type = "application/ld+json";
    script.id = id;
    document.head.appendChild(script);
  }
  script.textContent = JSON.stringify(payload);
};

const SeoHead = ({ page }: { page: SeoPageConfig }) => {
  useEffect(() => {
    const canonical = `https://fleetum.it/${page.slug}`;
    document.title = page.title;
    setMetaTag('meta[name="description"]', "name", "description", page.description);
    setMetaTag('meta[property="og:title"]', "property", "og:title", page.title);
    setMetaTag('meta[property="og:description"]', "property", "og:description", page.description);
    setMetaTag('meta[property="og:type"]', "property", "og:type", "website");
    setMetaTag('meta[property="og:url"]', "property", "og:url", canonical);
    setMetaTag('meta[name="twitter:card"]', "name", "twitter:card", "summary_large_image");

    let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "canonical";
      document.head.appendChild(link);
    }
    link.href = canonical;

    setJsonLd("fleetum-organization-schema", {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "Fleetum",
      url: "https://fleetum.it",
      logo: "https://fleetum.it/brand/fleetum-logo-full-light.svg"
    });

    setJsonLd("fleetum-software-schema", {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "Fleetum",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description: page.description,
      url: canonical,
      offers: {
        "@type": "Offer",
        priceCurrency: "EUR",
        availability: "https://schema.org/InStock"
      }
    });

    setJsonLd("fleetum-faq-schema", {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: page.faqs.map((faq) => ({
        "@type": "Question",
        name: faq.question,
        acceptedAnswer: {
          "@type": "Answer",
          text: faq.answer
        }
      }))
    });

    setJsonLd("fleetum-breadcrumb-schema", {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Fleetum", item: "https://fleetum.it/" },
        { "@type": "ListItem", position: 2, name: page.eyebrow, item: canonical }
      ]
    });
  }, [page]);

  return null;
};

const SeoHeader = () => (
  <header className="fleetum-seo-header">
    <Link className="fleetum-site-logo" to="/" aria-label="Fleetum homepage">
      <img src="/brand/fleetum-logo-full-light.svg" alt="Fleetum" />
    </Link>
    <nav aria-label="Pagine prodotto Fleetum">
      <Link to="/software-autonoleggio">Software autonoleggio</Link>
      <Link to="/booking-noleggi">Booking</Link>
      <Link to="/contratti-noleggio-digitali">Contratti</Link>
      <Link to="/prezzi">Prezzi</Link>
    </nav>
    <Link className="fleetum-btn fleetum-btn--primary" to="/demo">
      Richiedi demo <ArrowRight size={16} />
    </Link>
  </header>
);

export const PublicSeoPage = ({ slug }: { slug: SeoPageKey }) => {
  const page = pages[slug];

  useEffect(() => {
    trackPublicEvent("PAGE_VIEW", { page: slug });
  }, [slug]);

  return (
    <main className="fleetum-landing fleetum-seo-page">
      <SeoHead page={page} />
      <SeoHeader />

      <section className="fleetum-seo-hero">
        <div>
          <span className="fleetum-kicker">{page.eyebrow}</span>
          <h1>{page.h1}</h1>
          <p>{page.intro}</p>
          <div className="fleetum-seo-actions">
            <Link className="fleetum-btn fleetum-btn--primary" to="/demo">
              Richiedi demo <ArrowRight size={16} />
            </Link>
            <Link className="fleetum-btn fleetum-btn--ghost" to="/login">
              Accedi
            </Link>
          </div>
        </div>
        <aside className="fleetum-seo-panel" aria-label="Riepilogo Fleetum">
          <p className="fleetum-seo-panel__label">Fleetum control room</p>
          <strong>{page.primaryKeyword}</strong>
          <ul>
            {page.benefits.slice(0, 4).map((benefit) => (
              <li key={benefit}><CheckCircle2 size={16} /> {benefit}</li>
            ))}
          </ul>
        </aside>
      </section>

      <section className="fleetum-seo-section">
        <div className="fleetum-seo-section__head">
          <span className="fleetum-kicker">Perche Fleetum</span>
          <h2>Un gestionale costruito sui processi reali del noleggio.</h2>
          <p>Ogni pagina Fleetum e pensata per rispondere a una domanda operativa: cosa succede oggi, quali mezzi sono disponibili, quali contratti mancano e quali veicoli rendono.</p>
        </div>
        <div className="fleetum-seo-grid">
          {page.benefits.map((benefit, index) => {
            const Icon = icons[index % icons.length];
            return (
              <article className="fleetum-seo-card" key={benefit}>
                <Icon size={22} />
                <h3>{benefit}</h3>
                <p>Funzione pensata per ridurre lavoro manuale, errori di comunicazione e decisioni basate su dati incompleti.</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="fleetum-seo-split">
        {page.sections.map((section) => (
          <article key={section.title}>
            <h2>{section.title}</h2>
            <p>{section.text}</p>
          </article>
        ))}
      </section>

      <section className="fleetum-seo-section">
        <div className="fleetum-seo-section__head">
          <span className="fleetum-kicker">Keyword correlate</span>
          <h2>Ricerche che Fleetum intercetta.</h2>
        </div>
        <div className="fleetum-seo-keywords">
          {[page.primaryKeyword, ...page.secondaryKeywords].map((keyword) => (
            <span key={keyword}>{keyword}</span>
          ))}
        </div>
      </section>

      <section className="fleetum-seo-section">
        <div className="fleetum-seo-section__head">
          <span className="fleetum-kicker">FAQ</span>
          <h2>Domande frequenti.</h2>
        </div>
        <div className="fleetum-seo-faq">
          {page.faqs.map((faq) => (
            <article key={faq.question}>
              <h3>{faq.question}</h3>
              <p>{faq.answer}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="fleetum-seo-cta">
        <h2>Vuoi vedere Fleetum applicato al tuo autonoleggio?</h2>
        <p>Raccontaci flotta, sedi e flusso operativo: ti mostriamo come impostare booking, contratti e report.</p>
        <Link className="fleetum-btn fleetum-btn--primary" to="/demo">
          Richiedi demo <ArrowRight size={16} />
        </Link>
      </section>
    </main>
  );
};
