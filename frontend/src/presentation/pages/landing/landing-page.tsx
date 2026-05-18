import { useEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties, type PointerEvent, type ReactNode, type SVGProps } from "react";
import {
  ArrowRight,
  BarChart3,
  Building2,
  CalendarDays,
  Car,
  Check,
  ChevronRight,
  ClipboardSignature,
  Clock3,
  FileCheck2,
  Gauge,
  KeyRound,
  LockKeyhole,
  MailCheck,
  MapPin,
  Menu,
  Route,
  ServerCog,
  ShieldCheck,
  Sparkles,
  UsersRound,
  WalletCards,
  Wrench,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import "./landing.css";

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

type RevealProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
};

const useScrollReveal = <T extends HTMLElement>() => {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.16, rootMargin: "0px 0px -90px 0px" }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return { ref, visible };
};

const Reveal = ({ children, className = "", delay = 0 }: RevealProps) => {
  const { ref, visible } = useScrollReveal<HTMLDivElement>();

  return (
    <div
      ref={ref}
      className={`fleetum-reveal ${visible ? "is-visible" : ""} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
};

const CountUp = ({ value, suffix = "" }: { value: number; suffix?: string }) => {
  const { ref, visible } = useScrollReveal<HTMLSpanElement>();
  const [current, setCurrent] = useState(value);

  useEffect(() => {
    if (!visible) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      setCurrent(value);
      return;
    }

    const duration = 950;
    const start = performance.now();
    const startValue = Math.max(1, Math.round(value * 0.72));
    let frame = 0;

    const tick = (time: number) => {
      const progress = Math.min(1, (time - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCurrent(Math.round(startValue + (value - startValue) * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, visible]);

  return <span ref={ref}>{current}{suffix}</span>;
};

const usePremiumTilt = <T extends HTMLElement>() => {
  const ref = useRef<T | null>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
  }, []);

  const setNeutral = () => {
    const node = ref.current;
    if (!node) return;
    node.style.setProperty("--tilt-x", "0deg");
    node.style.setProperty("--tilt-y", "0deg");
    node.style.setProperty("--tilt-z", "0px");
    node.style.setProperty("--glow-x", "50%");
    node.style.setProperty("--glow-y", "18%");
  };

  const onPointerMove = (event: PointerEvent<T>) => {
    if (event.pointerType !== "mouse") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const node = ref.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;

    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      node.style.setProperty("--tilt-x", `${(0.5 - y) * 7.5}deg`);
      node.style.setProperty("--tilt-y", `${(x - 0.5) * 9}deg`);
      node.style.setProperty("--tilt-z", "10px");
      node.style.setProperty("--glow-x", `${x * 100}%`);
      node.style.setProperty("--glow-y", `${y * 100}%`);
    });
  };

  return { ref, onPointerMove, onPointerLeave: setNeutral };
};

const LandingSeo = () => {
  useEffect(() => {
    const title = "Fleetum | Il sistema operativo per autonoleggi moderni";
    const description =
      "Fleetum centralizza booking noleggi, contratti digitali, clienti, flotta, manutenzioni, scadenze e KPI in una control room SaaS per autonoleggi.";
    document.title = title;

    const setMeta = (selector: string, attr: "name" | "property", key: string, content: string) => {
      let meta = document.head.querySelector<HTMLMetaElement>(selector);
      if (!meta) {
        meta = document.createElement("meta");
        meta.setAttribute(attr, key);
        document.head.appendChild(meta);
      }
      meta.setAttribute("content", content);
    };

    setMeta('meta[name="description"]', "name", "description", description);
    setMeta('meta[property="og:title"]', "property", "og:title", title);
    setMeta('meta[property="og:description"]', "property", "og:description", description);
    setMeta('meta[property="og:type"]', "property", "og:type", "website");
    setMeta('meta[property="og:url"]', "property", "og:url", "https://fleetum.it/");

    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = "https://fleetum.it/";
  }, []);

  return null;
};

const navItems = [
  { label: "Prodotto", href: "#prodotto" },
  { label: "Moduli", href: "#moduli" },
  { label: "Prezzi", href: "#prezzi" },
  { label: "Sicurezza", href: "#sicurezza" },
  { label: "Demo", href: "#demo" },
];

const painPoints = [
  { icon: CalendarDays, title: "Prenotazioni sparse", text: "Telefonate, chat e fogli separati rendono difficile capire subito disponibilita, uscite e rientri." },
  { icon: FileCheck2, title: "Contratti da rincorrere", text: "PDF, firme, invii e versioni restano scollegati da cliente, veicolo e prenotazione." },
  { icon: UsersRound, title: "Documenti dispersi", text: "Patenti, documenti e storico noleggi finiscono in cartelle diverse e rallentano il banco." },
  { icon: Wrench, title: "Scadenze dimenticate", text: "Revisioni, manutenzioni e chilometri emergono troppo tardi, spesso quando il mezzo e gia prenotato." },
  { icon: Car, title: "Fermi non prioritizzati", text: "Le auto ferme non mostrano sempre costo, owner, urgenza e impatto sulle prossime prenotazioni." },
  { icon: BarChart3, title: "Numeri poco leggibili", text: "Occupazione, ricavi, contratti e criticita sono difficili da leggere quando l'operativita accelera." },
];

const modules = [
  { icon: CalendarDays, title: "Booking Noleggi", text: "Planner mensile per macchina, sede e stato operativo." },
  { icon: ClipboardSignature, title: "Contratti Noleggio", text: "PDF brandizzati, firma cliente e invio email o WhatsApp." },
  { icon: UsersRound, title: "Clienti", text: "Persone fisiche e societa con documenti, patente e storico." },
  { icon: Car, title: "Veicoli", text: "Targhe, sedi, disponibilita, revisione e manutenzione." },
  { icon: Wrench, title: "Manutenzioni", text: "Interventi, fatture, allegati e costi per veicolo." },
  { icon: Clock3, title: "Scadenziario", text: "Avvisi su revisioni, km residui e scadenze operative." },
  { icon: Route, title: "Fermi Tecnici", text: "Aperture, priorita, tempi, costi e trend dei fermi." },
  { icon: Gauge, title: "Listini Noleggi", text: "Pacchetti km, extra chilometrici e snapshot prezzi." },
  { icon: BarChart3, title: "Dashboard KPI", text: "Ricavi, occupazione, contratti, rientri e criticita." },
];

const workflow = ["Cliente", "Prenotazione", "Contratto", "Uscita", "Rientro", "Manutenzione", "Report"];

const proofStats = [
  { label: "Processi collegati", value: "7", text: "cliente, booking, contratto, uscita, rientro, manutenzione e report" },
  { label: "Vista operativa", value: "1", text: "calendario mensile per veicolo, sede e stato" },
  { label: "Canali contratto", value: "2", text: "email e WhatsApp con storico invii" },
];

const personas = [
  { icon: Building2, title: "Rent a car locali", text: "Per team che vogliono sostituire fogli, chat e cartelle con un flusso unico." },
  { icon: MapPin, title: "Aziende multi-sede", text: "Per chi deve controllare disponibilita, uscite e rientri su piu filiali." },
  { icon: ServerCog, title: "Direzione operativa", text: "Per leggere ricavi, occupazione, contratti e criticita senza inseguire dati." },
];

const operationalChecks = [
  { label: "Uscite oggi", value: "12", tone: "blue" },
  { label: "Rientri in ritardo", value: "2", tone: "warn" },
  { label: "Contratti da firmare", value: "8", tone: "teal" },
  { label: "Veicoli con revisione critica", value: "3", tone: "danger" },
];


const securityItems = [
  { icon: ShieldCheck, title: "Workspace separati", text: "Architettura multi-tenant progettata per isolare aziende, dati e operativita." },
  { icon: LockKeyhole, title: "Ruoli e permessi", text: "Accessi controllati per admin, manager, operatori e utenti in sola lettura." },
  { icon: FileCheck2, title: "Audit operativo", text: "Azioni sensibili, documenti, contratti e invii producono evidenze tracciabili." },
  { icon: Building2, title: "Brand aziendale", text: "Logo, dati societari e impostazioni legali alimentano contratti, email ed export." },
  { icon: ServerCog, title: "CI/CD controllato", text: "Deploy tracciati tramite GitHub Actions, health check e workflow ripetibili." },
  { icon: WalletCards, title: "SaaS monetizzabile", text: "Piani, upgrade e processi commerciali pensati per una piattaforma B2B." },
];

const plans = [
  {
    name: "Starter",
    price: "129€",
    target: "Per piccoli autonoleggi che vogliono uscire da Excel.",
    features: ["Booking mensile per veicolo", "Clienti e contratti base", "Dashboard operativa", "Scadenze principali"],
  },
  {
    name: "Pro",
    price: "199€",
    target: "Per team che gestiscono flotta e contratti ogni giorno.",
    features: ["Contratti evoluti e invii", "Scadenze e manutenzioni", "Statistiche, alert e listini", "Priorita operative giornaliere"],
    highlight: true,
  },
  {
    name: "Enterprise",
    price: "249€",
    target: "Per aziende con piu sedi, processi e governance.",
    features: ["Multi-sede e governance", "Workflow completi", "Supporto scalabilita", "Controllo avanzato contratti"],
  },
];

const LandingHeader = () => {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 18);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={`fleetum-site-header ${scrolled ? "is-scrolled" : ""}`}>
      <Link to="/" className="fleetum-site-logo" aria-label="Fleetum home">
        <img src="/brand/fleetum-logo-for-dark-bg.svg" alt="Fleetum" />
      </Link>
      <nav className="fleetum-site-nav" aria-label="Navigazione sito Fleetum">
        {navItems.map((item) => <a key={item.href} href={item.href}>{item.label}</a>)}
      </nav>
      <div className="fleetum-site-actions">
        <Link to="/login" className="fleetum-btn fleetum-btn--ghost">Accedi</Link>
        <Link to="/demo" className="fleetum-btn fleetum-btn--primary">Richiedi demo <ArrowRight className="h-4 w-4" /></Link>
        <button className="fleetum-mobile-toggle" type="button" aria-label="Apri menu" onClick={() => setOpen((value) => !value)}>
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
      {open ? (
        <div className="fleetum-mobile-menu">
          {navItems.map((item) => <a key={item.href} href={item.href} onClick={() => setOpen(false)}>{item.label}</a>)}
          <Link to="/login" onClick={() => setOpen(false)}>Accedi</Link>
          <Link to="/demo" onClick={() => setOpen(false)}>Richiedi demo</Link>
        </div>
      ) : null}
    </header>
  );
};

const TrustPill = ({ children }: { children: ReactNode }) => (
  <span className="fleetum-trust-pill"><Check className="h-4 w-4" />{children}</span>
);

const ProductMockup = () => {
  const rows = ["GF100AA", "GF101AB", "GF102AC", "GF103AD", "GF104AE"];
  const days = [12, 13, 14, 15, 16, 17, 18];
  const tilt = usePremiumTilt<HTMLDivElement>();

  return (
    <div
      ref={tilt.ref}
      className="fleetum-product-orbit"
      aria-label="Anteprima control room Fleetum"
      onPointerMove={tilt.onPointerMove}
      onPointerLeave={tilt.onPointerLeave}
    >
      <div className="fleetum-product-shell">
        <div className="fleetum-product-chrome">
          <span />
          <span />
          <span />
          <strong>Fleetum control room · demo operativa</strong>
        </div>
        <div className="fleetum-product-grid">
          <div className="fleetum-product-panel fleetum-product-panel--kpis">
            <div>
              <p>Disponibili oggi</p>
              <strong><CountUp value={68} suffix="%" /></strong>
              <small>veicoli liberi per sede e fascia oraria</small>
            </div>
            <div>
              <p>Ricavi mese</p>
              <strong>€ <CountUp value={42} suffix=".8k" /></strong>
              <small>stima booking + consuntivo rientri</small>
            </div>
          </div>
          <div className="fleetum-product-panel fleetum-product-panel--alerts">
            <span><FileCheck2 className="h-4 w-4" /> 4 contratti da firmare</span>
            <span><Clock3 className="h-4 w-4" /> 7 rientri oggi · 2 da presidiare</span>
            <span><Wrench className="h-4 w-4" /> 2 manutenzioni critiche</span>
          </div>
          <div className="fleetum-booking-preview">
            <div className="fleetum-booking-preview__head">
              <div>
                <p>Booking mensile</p>
                <h3>Vista flotta per sede</h3>
              </div>
              <Gauge className="h-7 w-7" />
            </div>
            <div className="fleetum-booking-grid">
              <span className="fleetum-booking-cell fleetum-booking-cell--vehicle">Veicolo</span>
              {days.map((day) => <span key={day} className="fleetum-booking-cell fleetum-booking-cell--day">{day}</span>)}
              {rows.map((plate, row) => (
                <div className="fleetum-booking-row" key={plate}>
                  <span className="fleetum-booking-plate"><i className={row % 3 === 0 ? "is-ok" : row % 3 === 1 ? "is-warn" : "is-danger"} />{plate}</span>
                  {days.map((day) => <span key={`${plate}-${day}`} className="fleetum-booking-slot" />)}
                  {row === 0 ? <span className="fleetum-booking-bar fleetum-booking-bar--one">BK-2026</span> : null}
                  {row === 2 ? <span className="fleetum-booking-bar fleetum-booking-bar--two">Rientro</span> : null}
                  {row === 4 ? <span className="fleetum-booking-bar fleetum-booking-bar--three">Firmato</span> : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="fleetum-floating-chip fleetum-floating-chip--one"><FileCheck2 className="h-4 w-4" /> Contratto firmato</div>
      <div className="fleetum-floating-chip fleetum-floating-chip--two"><Wrench className="h-4 w-4" /> Revisione ok</div>
    </div>
  );
};

const HeroSection = () => (
  <section className="fleetum-hero" id="prodotto">
    <div className="fleetum-ambient fleetum-ambient--one" aria-hidden />
    <div className="fleetum-ambient fleetum-ambient--two" aria-hidden />
    <div className="fleetum-starfield" aria-hidden />
    <LandingHeader />
    <div className="fleetum-hero__content">
      <Reveal className="fleetum-hero__copy">
        <div className="fleetum-eyebrow"><Sparkles className="h-4 w-4" /> SaaS per autonoleggi e flotte</div>
        <h1>Il sistema operativo per autonoleggi moderni.</h1>
        <p>
          Fleetum collega prenotazioni, contratti digitali, clienti, veicoli, manutenzioni, scadenze e KPI in una control room progettata per rent a car e flotte aziendali.
        </p>
        <div className="fleetum-hero__actions">
          <Link to="/demo" className="fleetum-btn fleetum-btn--hero">Vedi Fleetum in azione <ChevronRight className="h-5 w-5" /></Link>
          <Link to="/login" className="fleetum-btn fleetum-btn--secondary">Accedi al gestionale</Link>
        </div>
        <div className="fleetum-trust-row">
          <TrustPill>Booking mensile</TrustPill>
          <TrustPill>Contratti digitali</TrustPill>
          <TrustPill>Scadenze automatiche</TrustPill>
          <TrustPill>Dashboard live</TrustPill>
        </div>
      </Reveal>
      <Reveal className="fleetum-hero__mockup" delay={120}>
        <ProductMockup />
      </Reveal>
    </div>
  </section>
);

const SectionHeading = ({ eyebrow, title, text, center = false }: { eyebrow: string; title: string; text: string; center?: boolean }) => (
  <Reveal className={`fleetum-section-heading ${center ? "fleetum-section-heading--center" : ""}`}>
    <p>{eyebrow}</p>
    <h2>{title}</h2>
    <span>{text}</span>
  </Reveal>
);


const ProofBarSection = () => (
  <section className="fleetum-proof-strip" aria-label="Sintesi valore Fleetum">
    {proofStats.map((item, index) => (
      <Reveal key={item.label} delay={index * 70}>
        <article className="fleetum-proof-card">
          <strong>{item.value}</strong>
          <div>
            <p>{item.label}</p>
            <span>{item.text}</span>
          </div>
        </article>
      </Reveal>
    ))}
  </section>
);

const PersonaSection = () => (
  <section className="fleetum-section fleetum-persona-section">
    <SectionHeading
      eyebrow="Per chi e pensato"
      title="Costruito per chi gestisce flotta, banco e contratti ogni giorno."
      text="Fleetum parla il linguaggio operativo del noleggio: disponibilita, uscite, rientri, documenti, firme, km e scadenze."
      center
    />
    <div className="fleetum-persona-grid">
      {personas.map((item, index) => {
        const Icon = item.icon;
        return (
          <Reveal key={item.title} delay={index * 80}>
            <article className="fleetum-glass-card fleetum-persona-card">
              <Icon className="h-6 w-6" />
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          </Reveal>
        );
      })}
    </div>
  </section>
);

const OperationalControlSection = () => (
  <section className="fleetum-section fleetum-ops-section">
    <Reveal className="fleetum-ops-panel">
      <div className="fleetum-ops-copy">
        <p>Controllo giornaliero</p>
        <h2>Cosa devi sapere prima che apra il banco.</h2>
        <span>Una vista sintetica ti mostra cosa puo uscire, cosa deve rientrare, quali contratti mancano e quali mezzi richiedono attenzione.</span>
      </div>
      <div className="fleetum-ops-grid">
        {operationalChecks.map((item) => (
          <div key={item.label} className={`fleetum-ops-card is-${item.tone}`}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>
    </Reveal>
  </section>
);

const ProblemSection = () => (
  <section className="fleetum-section" id="problemi">
    <SectionHeading
      eyebrow="Problema operativo"
      title="Quando il noleggio cresce, Excel non basta piu."
      text="Fleetum elimina attrito dai processi quotidiani: meno passaggi manuali, piu controllo su flotta, clienti e contratti."
    />
    <div className="fleetum-problem-grid">
      {painPoints.map((item, index) => {
        const Icon = item.icon;
        return (
          <Reveal key={item.title} delay={index * 60}>
            <article className="fleetum-glass-card fleetum-problem-card">
              <Icon className="h-6 w-6" />
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          </Reveal>
        );
      })}
    </div>
  </section>
);

const WorkflowSection = () => (
  <section className="fleetum-section fleetum-workflow-section">
    <SectionHeading
      eyebrow="Flusso operativo"
      title="Ogni processo, collegato."
      text="Cliente, prenotazione, contratto e veicolo restano nello stesso percorso, dal primo contatto al report finale."
      center
    />
    <Reveal>
      <div className="fleetum-workflow">
        {workflow.map((step, index) => (
          <div className="fleetum-workflow-node" key={step} style={{ "--delay": `${index * 120}ms` } as CSSProperties}>
            <span>{index + 1}</span>
            <strong>{step}</strong>
          </div>
        ))}
      </div>
    </Reveal>
  </section>
);

const BookingControlRoomSection = () => (
  <section className="fleetum-section fleetum-split-section fleetum-split-section--booking">
    <Reveal className="fleetum-showcase-copy">
      <p>Booking control room</p>
      <h2>Il calendario booking diventa il centro operativo.</h2>
      <span>Vedi disponibilita, uscite, rientri e criticita in un'unica vista mensile per veicolo, prima che diventino problemi al banco.</span>
      <ul>
        <li><Check className="h-4 w-4" /> Barre multi-giorno leggibili</li>
        <li><Check className="h-4 w-4" /> Stato manutenzione e revisione vicino alla targa</li>
        <li><Check className="h-4 w-4" /> Cliente e contratto collegati alla prenotazione</li>
      </ul>
      <Link to="/login" className="fleetum-link-cta">Apri una demo operativa <ArrowRight className="h-4 w-4" /></Link>
    </Reveal>
    <Reveal className="fleetum-calendar-showcase" delay={120}>
      <div className="fleetum-calendar-toolbar">
        <span>Aprile 2026</span>
        <strong>Sede Roma Centro</strong>
        <em>Occupazione 78%</em>
      </div>
      <div className="fleetum-calendar-table">
        <div className="fleetum-calendar-head">
          <span>Veicolo / targa</span>
          {[4, 5, 6, 7, 8, 9, 10, 11].map((day) => <span key={day}>{day}</span>)}
        </div>
        {["GF100AA", "GF101AB", "GF102AC", "GF103AD", "GF104AE", "GF105AF"].map((plate, row) => (
          <div className="fleetum-calendar-row" key={plate}>
            <strong><i className={row % 3 === 0 ? "is-ok" : row % 3 === 1 ? "is-warn" : "is-danger"} />{plate}</strong>
            <div className="fleetum-calendar-line">
              {Array.from({ length: 8 }, (_, index) => <span key={`${plate}-${index}`} />)}
              {row === 0 ? <em className="bar a">Mario Rossi · uscita 09:00</em> : null}
              {row === 2 ? <em className="bar b">Azienda Demo · rientro</em> : null}
              {row === 4 ? <em className="bar c">Contratto firmato</em> : null}
            </div>
          </div>
        ))}
      </div>
    </Reveal>
  </section>
);

const ContractsShowcaseSection = () => (
  <section className="fleetum-section fleetum-split-section fleetum-split-section--contracts">
    <Reveal className="fleetum-contract-paper">
      <div className="fleetum-contract-watermark">F</div>
      <div className="fleetum-contract-paper__head">
        <div className="fleetum-contract-brand">
          <img src="/brand/fleetum-symbol-for-dark-bg.svg" alt="" />
          <div>
            <strong>Autonoleggio Aurora</strong>
            <span>P.IVA 01234567890 · Roma · Noleggio senza conducente</span>
          </div>
        </div>
        <div className="fleetum-contract-code"><p>Contratto noleggio</p><strong>RA-2026-1048</strong></div>
      </div>
      <div className="fleetum-contract-title">
        <p>Locazione veicolo senza conducente</p>
        <span>Template dimostrativo: dati cliente, mezzo, condizioni, firma e invio collegati al booking.</span>
      </div>
      <div className="fleetum-contract-summary">
        <div>
          <p>Cliente</p>
          <strong>Marco Conti</strong>
          <span>Persona fisica · patente e documento verificati</span>
        </div>
        <div>
          <p>Veicolo</p>
          <strong>Ford Transit</strong>
          <span>GF204RT · km uscita 42.180</span>
        </div>
      </div>
      <div className="fleetum-contract-details">
        <span><small>Uscita</small><strong>18 Apr 2026 · 09:00</strong></span>
        <span><small>Rientro</small><strong>21 Apr 2026 · 18:30</strong></span>
        <span><small>Pacchetto</small><strong>100 km/giorno</strong></span>
        <span><small>Totale previsto</small><strong>€ 420,00</strong></span>
      </div>
      <div className="fleetum-contract-terms">
        <p>Condizioni principali</p>
        <span>Franchigia, cauzione, responsabilita conducente, chilometri extra e riconsegna sono organizzati in clausole leggibili e firmabili.</span>
      </div>
      <div className="fleetum-signature-row">
        <span><small>Data</small>18/04/2026</span>
        <span><small>Firma cliente</small><em /></span>
      </div>
      <div className="fleetum-contract-status"><MailCheck className="h-4 w-4" /> Inviato via email · WhatsApp pronto · firmato</div>
    </Reveal>
    <Reveal className="fleetum-showcase-copy" delay={120}>
      <p>Contratti digitali</p>
      <h2>Contratti professionali, firmati e inviati in pochi click.</h2>
      <span>Template brandizzati con dati azienda, intestatario persona fisica o giuridica, guidatori opzionali, firma cliente e invio multicanale.</span>
      <div className="fleetum-channel-grid">
        <span><MailCheck className="h-4 w-4" /> Email</span>
        <span><FileCheck2 className="h-4 w-4" /> PDF</span>
        <span><KeyRound className="h-4 w-4" /> Firma</span>
      </div>
    </Reveal>
  </section>
);

const ModulesSection = () => (
  <section className="fleetum-section" id="moduli">
    <SectionHeading
      eyebrow="Moduli Fleetum"
      title="Tutto quello che serve al banco e in direzione."
      text="Ogni modulo alimenta gli altri: la prenotazione aggiorna il contratto, il cliente resta collegato allo storico, la flotta mostra criticita prima dell'uscita."
    />
    <div className="fleetum-modules-grid">
      {modules.map((item, index) => {
        const Icon: IconType = item.icon;
        return (
          <Reveal key={item.title} delay={index * 45}>
            <article className="fleetum-glass-card fleetum-module-card">
              <div className="fleetum-card-icon"><Icon className="h-6 w-6" /></div>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
              <span className="fleetum-mini-indicator" />
            </article>
          </Reveal>
        );
      })}
    </div>
  </section>
);

const DashboardIntelligenceSection = () => (
  <section className="fleetum-section fleetum-dashboard-section">
    <SectionHeading
      eyebrow="Dashboard intelligence"
      title="Non solo gestione: controllo decisionale."
      text="Fleetum evidenzia cio che richiede attenzione oggi: ricavi, rientri, contratti, manutenzioni, scadenze e disponibilita reale della flotta."
      center
    />
    <div className="fleetum-decision-grid">
      {[{ label: "Occupazione flotta", value: 82, suffix: "%" }, { label: "Ricavi mese", value: 38, suffix: "k" }, { label: "Contratti da firmare", value: 8 }, { label: "Rientri oggi", value: 12 }].map((item, index) => (
        <Reveal key={item.label} delay={index * 70}>
          <div className="fleetum-decision-card">
            <p>{item.label}</p>
            <strong><CountUp value={item.value} suffix={item.suffix} /></strong>
          </div>
        </Reveal>
      ))}
      <Reveal className="fleetum-chart-card" delay={180}>
        <svg viewBox="0 0 720 220" role="img" aria-label="Trend prenotazioni e ricavi">
          <defs>
            <linearGradient id="fleetumChartFill" x1="0" x2="0" y1="0" y2="1">
              <stop stopColor="#2563ff" stopOpacity="0.34" />
              <stop offset="1" stopColor="#00b8a9" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path className="fleetum-chart-area" d="M10 176 C90 122, 126 132, 180 112 C250 86, 278 148, 342 112 C426 66, 456 88, 522 72 C610 48, 650 74, 710 42 L710 220 L10 220 Z" />
          <path className="fleetum-chart-line" d="M10 176 C90 122, 126 132, 180 112 C250 86, 278 148, 342 112 C426 66, 456 88, 522 72 C610 48, 650 74, 710 42" />
        </svg>
      </Reveal>
    </div>
  </section>
);

const SecuritySection = () => (
  <section className="fleetum-section fleetum-security" id="sicurezza">
    <SectionHeading
      eyebrow="SaaS e sicurezza"
      title="Progettato per aziende, dati e processi reali."
      text="Fleetum supporta workspace separati, ruoli, permessi, audit operativo, backup e una Platform Console separata per il controllo della piattaforma."
    />
    <div className="fleetum-security-grid">
      {securityItems.map((item, index) => {
        const Icon = item.icon;
        return (
          <Reveal key={item.title} delay={index * 80}>
            <article className="fleetum-glass-card fleetum-security-card">
              <Icon className="h-6 w-6" />
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          </Reveal>
        );
      })}
    </div>
  </section>
);

const PricingSection = () => (
  <section className="fleetum-section fleetum-pricing" id="prezzi">
    <SectionHeading
      eyebrow="Prezzi"
      title="Piani chiari per crescere con controllo."
      text="Scegli il piano in base alla complessita operativa del tuo autonoleggio. Upgrade sempre possibile."
      center
    />
    <div className="fleetum-pricing-grid">
      {plans.map((plan, index) => (
        <Reveal key={plan.name} delay={index * 90}>
          <article className={`fleetum-price-card ${plan.highlight ? "is-highlight" : ""}`}>
            {plan.highlight ? <span className="fleetum-price-badge">Consigliato</span> : null}
            <h3>{plan.name}</h3>
            <p className="fleetum-price"><strong>{plan.price}</strong><span>/mese</span></p>
            <p className="fleetum-price-target">{plan.target}</p>
            <ul>
              {plan.features.map((feature) => <li key={feature}><Check className="h-4 w-4" />{feature}</li>)}
            </ul>
            <Link to={plan.name === "Enterprise" ? "/demo" : "/signup"} className={plan.highlight ? "fleetum-btn fleetum-btn--primary" : "fleetum-btn fleetum-btn--dark"}>{plan.name === "Enterprise" ? "Parla con noi" : "Inizia ora"}</Link>
          </article>
        </Reveal>
      ))}
    </div>
  </section>
);

const FinalCtaSection = () => (
  <section className="fleetum-final-cta">
    <Reveal>
      <div className="fleetum-final-cta__box">
        <p>Pronto a partire</p>
        <h2>Porta il tuo autonoleggio in una control room digitale.</h2>
        <span>Crea il workspace, configura azienda e flotta, poi gestisci prenotazioni e contratti con un flusso professionale.</span>
        <div>
          <Link to="/demo" className="fleetum-btn fleetum-btn--light">Richiedi demo</Link>
          <Link to="/signup" className="fleetum-btn fleetum-btn--outline-light">Crea account</Link>
        </div>
      </div>
    </Reveal>
  </section>
);

const LandingFooter = () => {
  const year = useMemo(() => new Date().getFullYear(), []);
  return (
    <footer className="fleetum-footer">
      <img src="/brand/fleetum-logo-for-dark-bg.svg" alt="Fleetum" />
      <nav aria-label="Footer Fleetum">
        <a href="#prodotto">Prodotto</a>
        <a href="#moduli">Moduli</a>
        <a href="#prezzi">Prezzi</a>
        <Link to="/privacy">Privacy</Link>
        <Link to="/cookie">Cookie</Link>
        <Link to="/termini">Termini</Link>
        <Link to="/dpa">DPA</Link>
        <Link to="/login">Login</Link>
      </nav>
      <p>© {year} Fleetum. Gestionale SaaS per flotte e noleggi.</p>
    </footer>
  );
};

export const LandingPage = () => (
  <main className="fleetum-landing">
    <LandingSeo />
    <HeroSection />
    <ProofBarSection />
    <ProblemSection />
    <PersonaSection />
    <WorkflowSection />
    <BookingControlRoomSection />
    <ContractsShowcaseSection />
    <ModulesSection />
    <OperationalControlSection />
    <DashboardIntelligenceSection />
    <SecuritySection />
    <PricingSection />
    <FinalCtaSection />
    <LandingFooter />
  </main>
);
