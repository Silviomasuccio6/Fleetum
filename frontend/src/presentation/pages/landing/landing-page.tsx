import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
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
  MapPin,
  Pause,
  Play,
  Route,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  UsersRound,
  WalletCards,
  Wrench
} from "lucide-react";
import { Link } from "react-router-dom";
import { trackPublicEvent } from "../../../application/usecases/public-analytics-usecases";
import {
  COMMERCIAL_PLAN_CATALOG,
  PLAN_MONTHLY_PRICING_EUR,
  SAAS_PLANS,
  type SaasPlan
} from "../../../domain/constants/entitlements";
import { PublicFooter } from "../../components/public-site/public-footer";
import { PublicHeader } from "../../components/public-site/public-header";
import { ResponsiveMedia } from "../../components/public-site/responsive-media";
import { SeoHead } from "../../components/seo/seo-head";

type RevealProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
  eager?: boolean;
};

const useScrollReveal = <T extends HTMLElement>(eager = false) => {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(eager);

  useEffect(() => {
    if (eager) return;
    const node = ref.current;
    if (!node) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
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
      { threshold: 0.12, rootMargin: "0px 0px -64px 0px" }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [eager]);

  return { ref, visible };
};

const Reveal = ({ children, className = "", delay = 0, eager = false }: RevealProps) => {
  const { ref, visible } = useScrollReveal<HTMLDivElement>(eager);

  return (
    <div
      ref={ref}
      className={`fleetum-reveal ${visible ? "is-visible" : ""} ${className}`.trim()}
      style={{ animationDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
};

const trackCta = (
  placement: string,
  destination: "demo" | "signup" | "login",
  extra?: Record<string, string>
) => {
  trackPublicEvent("CTA_CLICK", { placement, destination, ...extra });
};

const proofItems = [
  { icon: CalendarDays, title: "Booking operativo", text: "Disponibilità, uscite e rientri nella stessa timeline." },
  { icon: ClipboardSignature, title: "Contratti collegati", text: "Cliente, veicolo, firma e documenti restano nello stesso flusso." },
  { icon: TrendingUp, title: "ROI per veicolo", text: "Ricavi, utilizzo e recupero investimento leggibili per mezzo." },
  { icon: Building2, title: "Controllo multi-sede", text: "Una regia comune, con operatività separata per ogni filiale." }
];

const PROOF_CAROUSEL_MEDIA = "(max-width: 1080px)";
const PROOF_AUTOPLAY_DELAY_MS = 4600;

type BookingTone = "blue" | "teal" | "amber" | "slate";

type BookingRow = {
  vehicle: string;
  plate: string;
  site: string;
  label: string;
  start: number;
  span: number;
  tone: BookingTone;
  status: string;
};

const bookingRows: BookingRow[] = [
  { vehicle: "Fiat 500", plate: "FT100AA", site: "Roma Centro", label: "Rossi · consegna 09:00", start: 1, span: 3, tone: "blue", status: "Confermato" },
  { vehicle: "Toyota Yaris", plate: "FT101AB", site: "Roma Centro", label: "Bianchi · in noleggio", start: 3, span: 4, tone: "teal", status: "In corso" },
  { vehicle: "Jeep Renegade", plate: "FT102AC", site: "Fiumicino", label: "Azienda Demo · rientro", start: 2, span: 2, tone: "amber", status: "Rientro" },
  { vehicle: "BMW X1", plate: "FT103AD", site: "Roma Eur", label: "Verdi · contratto firmato", start: 5, span: 3, tone: "blue", status: "Firmato" },
  { vehicle: "Fiat Ducato", plate: "FT104AE", site: "Fiumicino", label: "Manutenzione programmata", start: 1, span: 2, tone: "slate", status: "Officina" },
  { vehicle: "Tesla Model 3", plate: "FT105AF", site: "Roma Eur", label: "Neri · riconsegna 17:30", start: 4, span: 4, tone: "teal", status: "In corso" }
];

const plannerDays = ["Lun 14", "Mar 15", "Mer 16", "Gio 17", "Ven 18", "Sab 19", "Dom 20", "Lun 21"];

const BookingPlanner = ({ compact = false }: { compact?: boolean }) => {
  const visibleRows = compact ? bookingRows.slice(0, 4) : bookingRows;

  return (
    <div className={`fleetum-v3-planner ${compact ? "is-compact" : ""}`}>
      <div className="fleetum-v3-planner__topbar">
        <div>
          <span className="fleetum-v3-data-label">Dati dimostrativi</span>
          <strong>Booking Noleggi</strong>
        </div>
        <div className="fleetum-v3-planner__filters" aria-label="Filtri dimostrativi planner">
          <span><MapPin size={14} aria-hidden="true" /> Tutte le sedi</span>
          <span><CalendarDays size={14} aria-hidden="true" /> Settimana</span>
          <span className="is-live"><i /> Oggi</span>
        </div>
      </div>
      <div className="fleetum-v3-planner__scroller" tabIndex={0} aria-label="Anteprima calendario booking, scorribile orizzontalmente">
        <div className="fleetum-v3-planner__table">
          <div className="fleetum-v3-planner__head">
            <span>Veicolo</span>
            {plannerDays.map((day) => <span key={day}>{day}</span>)}
          </div>
          {visibleRows.map((row) => (
            <div className="fleetum-v3-planner__row" key={row.plate}>
              <div className="fleetum-v3-planner__vehicle">
                <span className={`fleetum-v3-vehicle-dot is-${row.tone}`}><Car size={15} aria-hidden="true" /></span>
                <div>
                  <strong>{row.vehicle}</strong>
                  <small>{row.plate} · {row.site}</small>
                </div>
              </div>
              <div className="fleetum-v3-planner__timeline">
                {plannerDays.map((day) => <span key={`${row.plate}-${day}`} aria-hidden="true" />)}
                <div
                  className={`fleetum-v3-booking-bar is-${row.tone}`}
                  style={{ "--booking-start": row.start, "--booking-span": row.span } as CSSProperties}
                  title={`${row.label} · ${row.status}`}
                >
                  <strong>{row.label}</strong>
                  <small>{row.status}</small>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const SectionIntro = ({ eyebrow, title, text, align = "left" }: {
  eyebrow: string;
  title: string;
  text: string;
  align?: "left" | "center";
}) => (
  <Reveal className={`fleetum-v3-section-intro is-${align}`}>
    <p>{eyebrow}</p>
    <h2>{title}</h2>
    <span>{text}</span>
  </Reveal>
);

const HeroSection = () => (
  <section className="fleetum-v3-hero" id="prodotto">
    <PublicHeader tone="light" analyticsPlacement="landing-v3" />
    <div className="fleetum-v3-hero__glow" aria-hidden="true" />
    <div className="fleetum-v3-hero__content">
      <Reveal className="fleetum-v3-hero__copy" eager>
        <div className="fleetum-v3-kicker"><Sparkles size={15} aria-hidden="true" /> Il sistema operativo per autonoleggi</div>
        <h1>Ogni noleggio.<br /><em>Sotto controllo.</em></h1>
        <p>
          Fleetum unisce booking, contratti, clienti, flotta e redditività in una regia progettata per chi deve decidere in pochi secondi.
        </p>
        <div className="fleetum-v3-actions">
          <Link to="/demo" className="fleetum-v3-button is-primary" onClick={() => trackCta("hero", "demo")}>
            Vedi Fleetum in azione <ArrowRight size={18} aria-hidden="true" />
          </Link>
          <Link to="/booking-noleggi" className="fleetum-v3-button is-secondary">
            Esplora il booking
          </Link>
        </div>
        <div className="fleetum-v3-hero__trust" aria-label="Funzioni principali">
          <span><Check size={15} aria-hidden="true" /> Booking leggibile</span>
          <span><Check size={15} aria-hidden="true" /> Contratti digitali</span>
          <span><Check size={15} aria-hidden="true" /> Report per veicolo</span>
        </div>
      </Reveal>

      <Reveal className="fleetum-v3-hero__visual" delay={100} eager>
        <div className="fleetum-v3-hero__image">
          <ResponsiveMedia
            src="/media/fleetum-hero-fleet-1600.webp"
            webpSrcSet="/media/fleetum-hero-fleet-640.webp 640w, /media/fleetum-hero-fleet-1024.webp 1024w, /media/fleetum-hero-fleet-1600.webp 1600w"
            sizes="(max-width: 900px) 100vw, 58vw"
            width={1600}
            height={900}
            alt="Flotta di veicoli pronta davanti a un terminal aeroportuale"
            priority
          />
          <span className="fleetum-v3-hero__caption"><MapPin size={14} aria-hidden="true" /> La flotta reale, coordinata da un'unica regia.</span>
        </div>
        <div className="fleetum-v3-hero__planner">
          <BookingPlanner compact />
        </div>
      </Reveal>
    </div>
    <a className="fleetum-v3-scroll-cue" href="#booking" aria-label="Vai alla sezione booking">
      <span>Scopri il flusso</span><ChevronRight size={16} aria-hidden="true" />
    </a>
  </section>
);

const ProofSection = () => {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [carouselEnabled, setCarouselEnabled] = useState(false);
  const [autoplayPaused, setAutoplayPaused] = useState(false);
  const [autoplayStopped, setAutoplayStopped] = useState(false);
  const [proofVisible, setProofVisible] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  const scrollToProof = useCallback((index: number, behavior: ScrollBehavior = "smooth") => {
    const track = trackRef.current;
    const item = track?.querySelector<HTMLElement>(`[data-proof-index="${index}"]`);
    if (!track || !item) return;

    const trackRect = track.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    const paddingLeft = Number.parseFloat(window.getComputedStyle(track).paddingLeft) || 0;
    const left = track.scrollLeft + itemRect.left - trackRect.left - paddingLeft;

    track.scrollTo({ left, behavior });
    setActiveIndex(index);
  }, []);

  useEffect(() => {
    const carouselQuery = window.matchMedia(PROOF_CAROUSEL_MEDIA);
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    const updatePreferences = () => {
      setCarouselEnabled(carouselQuery.matches);
      setReducedMotion(motionQuery.matches);

      if (!carouselQuery.matches) {
        setActiveIndex(0);
        trackRef.current?.scrollTo({ left: 0, behavior: "auto" });
      }
    };

    updatePreferences();
    carouselQuery.addEventListener("change", updatePreferences);
    motionQuery.addEventListener("change", updatePreferences);

    return () => {
      carouselQuery.removeEventListener("change", updatePreferences);
      motionQuery.removeEventListener("change", updatePreferences);
    };
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    if (!track || typeof IntersectionObserver === "undefined") {
      setProofVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => setProofVisible(entry.isIntersecting),
      { threshold: 0.35 }
    );

    observer.observe(track);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!carouselEnabled || reducedMotion || autoplayPaused || autoplayStopped || !proofVisible) return;

    const interval = window.setInterval(() => {
      if (document.hidden) return;
      scrollToProof((activeIndex + 1) % proofItems.length);
    }, PROOF_AUTOPLAY_DELAY_MS);

    return () => window.clearInterval(interval);
  }, [activeIndex, autoplayPaused, autoplayStopped, carouselEnabled, proofVisible, reducedMotion, scrollToProof]);

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
  }, []);

  const syncActiveIndex = () => {
    if (!carouselEnabled || !trackRef.current) return;
    if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);

    scrollFrameRef.current = window.requestAnimationFrame(() => {
      const track = trackRef.current;
      if (!track) return;

      const trackRect = track.getBoundingClientRect();
      const paddingLeft = Number.parseFloat(window.getComputedStyle(track).paddingLeft) || 0;
      const snapLine = trackRect.left + paddingLeft;
      const items = Array.from(track.querySelectorAll<HTMLElement>("[data-proof-index]"));
      let nearestIndex = 0;
      let nearestDistance = Number.POSITIVE_INFINITY;

      items.forEach((item, index) => {
        const distance = Math.abs(item.getBoundingClientRect().left - snapLine);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = index;
        }
      });

      setActiveIndex((current) => current === nearestIndex ? current : nearestIndex);
      scrollFrameRef.current = null;
    });
  };

  return (
    <section className="fleetum-v3-proof-shell" aria-label="Pilastri del prodotto Fleetum">
      <div
        ref={trackRef}
        className="fleetum-v3-proof"
        role="list"
        tabIndex={carouselEnabled ? 0 : -1}
        aria-label="Funzioni principali Fleetum"
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setAutoplayPaused(false);
        }}
        onFocusCapture={() => setAutoplayPaused(true)}
        onKeyDown={(event) => {
          if (!carouselEnabled) return;
          if (event.key === "ArrowRight") {
            event.preventDefault();
            scrollToProof((activeIndex + 1) % proofItems.length);
          }
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            scrollToProof((activeIndex - 1 + proofItems.length) % proofItems.length);
          }
        }}
        onMouseEnter={() => setAutoplayPaused(true)}
        onMouseLeave={() => setAutoplayPaused(false)}
        onPointerCancel={() => setAutoplayPaused(false)}
        onPointerDown={() => setAutoplayPaused(true)}
        onPointerUp={() => setAutoplayPaused(false)}
        onScroll={syncActiveIndex}
      >
        {proofItems.map((item, index) => {
          const Icon = item.icon;
          return (
            <div className="fleetum-v3-proof__item" data-proof-index={index} key={item.title} role="listitem">
              <Reveal delay={index * 60}>
                <article>
                  <Icon size={21} aria-hidden="true" />
                  <div><strong>{item.title}</strong><span>{item.text}</span></div>
                </article>
              </Reveal>
            </div>
          );
        })}
      </div>
      <div className="fleetum-v3-proof__controls" aria-label="Seleziona una funzione Fleetum">
        <button
          type="button"
          className="fleetum-v3-proof__autoplay"
          aria-label={autoplayStopped ? "Riprendi scorrimento automatico" : "Metti in pausa lo scorrimento automatico"}
          aria-pressed={autoplayStopped}
          onClick={() => setAutoplayStopped((current) => !current)}
        >
          {autoplayStopped ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
        </button>
        {proofItems.map((item, index) => (
          <button
            type="button"
            className={activeIndex === index ? "is-active" : ""}
            aria-current={activeIndex === index ? "true" : undefined}
            aria-label={`Mostra ${item.title}`}
            key={item.title}
            onClick={() => scrollToProof(index)}
          />
        ))}
      </div>
    </section>
  );
};

const BookingSection = () => (
  <section className="fleetum-v3-chapter fleetum-v3-booking" id="booking">
    <div className="fleetum-v3-chapter__inner">
      <SectionIntro
        eyebrow="01 · Il cuore operativo"
        title="Capisci quali auto entrano, escono o restano ferme. In tre secondi."
        text="La timeline mette veicolo, sede, cliente, stato e durata nello stesso campo visivo. Meno finestre da aprire, meno sovrapposizioni da scoprire tardi."
      />
      <Reveal className="fleetum-v3-booking__planner" delay={80}>
        <BookingPlanner />
      </Reveal>
      <div className="fleetum-v3-booking__decisions">
        <Reveal><span><Clock3 size={18} aria-hidden="true" /></span><div><strong>Entrate e uscite</strong><p>Le priorità del giorno restano visibili senza aprire ogni prenotazione.</p></div></Reveal>
        <Reveal delay={60}><span><Wrench size={18} aria-hidden="true" /></span><div><strong>Indisponibilità reali</strong><p>Manutenzioni e blocchi sono distinguibili dai noleggi.</p></div></Reveal>
        <Reveal delay={120}><span><MapPin size={18} aria-hidden="true" /></span><div><strong>Sede sempre chiara</strong><p>Filtri e badge mantengono leggibile anche una flotta distribuita.</p></div></Reveal>
      </div>
      <Reveal className="fleetum-v3-inline-cta">
        <Link to="/booking-noleggi">Scopri il booking Fleetum <ArrowRight size={17} aria-hidden="true" /></Link>
      </Reveal>
    </div>
  </section>
);

const WorkflowSection = () => (
  <section className="fleetum-v3-chapter fleetum-v3-workflow">
    <div className="fleetum-v3-chapter__inner fleetum-v3-workflow__grid">
      <Reveal className="fleetum-v3-workflow__media">
        <ResponsiveMedia
          src="/media/fleetum-handover-1440.webp"
          webpSrcSet="/media/fleetum-handover-640.webp 640w, /media/fleetum-handover-768.webp 768w, /media/fleetum-handover-1024.webp 1024w, /media/fleetum-handover-1440.webp 1440w"
          sizes="(max-width: 900px) 100vw, 48vw"
          width={1440}
          height={960}
          alt="Consegna delle chiavi di un veicolo con controllo digitale su tablet"
        />
        <div className="fleetum-v3-contract-card">
          <span><FileCheck2 size={16} aria-hidden="true" /> Contratto CN-2026-184</span>
          <strong>Firma completata</strong>
          <small>Cliente, veicolo e condizioni archiviati nello stesso flusso.</small>
        </div>
      </Reveal>
      <div className="fleetum-v3-workflow__copy">
        <SectionIntro
          eyebrow="02 · Dal booking alla riconsegna"
          title="Un solo percorso. Nessun dato da rincorrere."
          text="La prenotazione alimenta contratto, consegna e storico. Ogni passaggio mantiene il contesto operativo e riduce la duplicazione manuale."
        />
        <div className="fleetum-v3-steps">
          {[
            ["01", "Prenotazione", "Date, sede, cliente, tariffa e veicolo."],
            ["02", "Contratto", "Documento brandizzato, condizioni e firma."],
            ["03", "Consegna", "Stato mezzo, foto, chilometri e cauzione."],
            ["04", "Rientro", "Consuntivo, danni, extra e disponibilità aggiornata."]
          ].map(([number, title, text], index) => (
            <Reveal key={number} delay={index * 55} className="fleetum-v3-step">
              <span>{number}</span><div><strong>{title}</strong><p>{text}</p></div>
            </Reveal>
          ))}
        </div>
        <Link className="fleetum-v3-text-link" to="/contratti-noleggio-digitali">Esplora i contratti digitali <ArrowRight size={16} aria-hidden="true" /></Link>
      </div>
    </div>
  </section>
);

const RoiSection = () => (
  <section className="fleetum-v3-chapter fleetum-v3-roi">
    <div className="fleetum-v3-chapter__inner">
      <SectionIntro
        eyebrow="03 · Redditività della flotta"
        title="Ogni veicolo deve raccontare quanto rende."
        text="Fleetum collega utilizzo, ricavi e costi disponibili per aiutarti a leggere recupero investimento e performance economica per mezzo."
      />
      <div className="fleetum-v3-roi__grid">
        <Reveal className="fleetum-v3-roi__chart">
          <div className="fleetum-v3-roi__chart-head">
            <div><span>Esempio di lettura economica</span><strong>Toyota Yaris · FT101AB</strong></div>
            <span className="fleetum-v3-positive"><TrendingUp size={15} aria-hidden="true" /> Trend positivo</span>
          </div>
          <svg viewBox="0 0 760 300" role="img" aria-label="Esempio grafico ricavi, costi e break-even veicolo">
            <defs>
              <linearGradient id="fleetumV3Area" x1="0" x2="0" y1="0" y2="1">
                <stop stopColor="#155eef" stopOpacity=".2" />
                <stop offset="1" stopColor="#155eef" stopOpacity="0" />
              </linearGradient>
            </defs>
            {[62, 122, 182, 242].map((y) => <line key={y} x1="24" x2="736" y1={y} y2={y} className="fleetum-v3-chart-grid" />)}
            <path className="fleetum-v3-chart-area" d="M24 248 C104 226 112 208 180 212 C252 218 272 174 338 180 C410 186 428 128 500 140 C568 150 606 92 736 72 L736 276 L24 276 Z" />
            <path className="fleetum-v3-chart-line" d="M24 248 C104 226 112 208 180 212 C252 218 272 174 338 180 C410 186 428 128 500 140 C568 150 606 92 736 72" />
            <line x1="24" x2="736" y1="156" y2="156" className="fleetum-v3-break-even" />
            <text x="575" y="146">Soglia break-even</text>
          </svg>
          <div className="fleetum-v3-roi__legend"><span><i className="is-teal" /> Ricavi cumulati</span><span><i className="is-dashed" /> Break-even</span></div>
        </Reveal>
        <div className="fleetum-v3-roi__metrics">
          <Reveal><span>Fatturato generato</span><strong>€ 18.420</strong><small>Nel periodo selezionato</small></Reveal>
          <Reveal delay={60}><span>Investimento recuperato</span><strong>74%</strong><small>Stima sui dati disponibili</small></Reveal>
          <Reveal delay={120}><span>Tasso occupazione</span><strong>81%</strong><small>Giorni noleggiati / disponibili</small></Reveal>
          <Reveal delay={180}><span>Residuo a break-even</span><strong>€ 6.480</strong><small>Valore dimostrativo</small></Reveal>
        </div>
      </div>
      <Reveal className="fleetum-v3-inline-cta">
        <Link to="/report-redditivita-veicolo">Scopri il report redditività veicolo <ArrowRight size={17} aria-hidden="true" /></Link>
      </Reveal>
    </div>
  </section>
);

const MultiSiteSection = () => (
  <section className="fleetum-v3-chapter fleetum-v3-multisite">
    <div className="fleetum-v3-chapter__inner fleetum-v3-multisite__grid">
      <div className="fleetum-v3-multisite__copy">
        <SectionIntro
          eyebrow="04 · Una regia, più sedi"
          title="La sede cambia. Il controllo resta unico."
          text="Ogni filiale lavora sul proprio perimetro, mentre direzione e manager mantengono una vista coerente su flotta, disponibilità e priorità."
        />
        <div className="fleetum-v3-site-list">
          {["Roma Centro", "Roma Eur", "Fiumicino Aeroporto"].map((site, index) => (
            <Reveal key={site} delay={index * 70}>
              <span><MapPin size={17} aria-hidden="true" /></span>
              <div><strong>{site}</strong><small>{index === 2 ? "Hub aeroportuale" : "Sede operativa"}</small></div>
              <em>{index === 0 ? "24 veicoli" : index === 1 ? "18 veicoli" : "31 veicoli"}</em>
            </Reveal>
          ))}
        </div>
        <Link className="fleetum-v3-text-link" to="/gestionale-flotta">Esplora la gestione flotta <ArrowRight size={16} aria-hidden="true" /></Link>
      </div>
      <Reveal className="fleetum-v3-multisite__visual" delay={90}>
        <ResponsiveMedia
          src="/media/fleetum-multisite-hub-1600.webp"
          webpSrcSet="/media/fleetum-multisite-hub-640.webp 640w, /media/fleetum-multisite-hub-1024.webp 1024w, /media/fleetum-multisite-hub-1600.webp 1600w"
          sizes="(max-width: 900px) 100vw, 52vw"
          width={1600}
          height={900}
          alt="Vista aerea di un hub aeroportuale con aree organizzate per la flotta"
        />
        <div className="fleetum-v3-site-switcher">
          <span>Sede attiva</span>
          <strong><MapPin size={16} aria-hidden="true" /> Fiumicino Aeroporto</strong>
          <small>Flotta e booking filtrati sul contesto operativo.</small>
        </div>
      </Reveal>
    </div>
  </section>
);

const TrustSection = () => (
  <section className="fleetum-v3-chapter fleetum-v3-trust" id="sicurezza">
    <div className="fleetum-v3-chapter__inner">
      <SectionIntro
        eyebrow="05 · Fiducia operativa"
        title="Progettato per dati, ruoli e processi aziendali."
        text="Fleetum integra controlli applicativi e tracciabilità senza trasformare la sicurezza in rumore per chi lavora al banco."
        align="center"
      />
      <div className="fleetum-v3-trust__grid">
        {[
          { icon: ShieldCheck, title: "Workspace separati", text: "Architettura multi-tenant con controlli di appartenenza sulle risorse." },
          { icon: LockKeyhole, title: "Ruoli e permessi", text: "Accesso alle funzioni in base al profilo operativo autorizzato." },
          { icon: FileCheck2, title: "Audit delle azioni", text: "Le operazioni sensibili producono evidenze utili alla verifica." },
          { icon: KeyRound, title: "Documenti protetti", text: "Accesso autenticato e gestione privata dei file applicativi." }
        ].map((item, index) => {
          const Icon = item.icon;
          return (
            <Reveal key={item.title} delay={index * 70}>
              <article><span><Icon size={21} aria-hidden="true" /></span><h3>{item.title}</h3><p>{item.text}</p></article>
            </Reveal>
          );
        })}
      </div>
      <Reveal className="fleetum-v3-trust__note">
        <ShieldCheck size={20} aria-hidden="true" />
        <p>Privacy, sicurezza e continuità operativa sono processi da mantenere e verificare, non semplici badge da esporre.</p>
      </Reveal>
    </div>
  </section>
);

const landingPlanCopy: Record<SaasPlan, { target: string; features: string[]; highlight?: boolean }> = {
  STARTER: {
    target: "Per piccoli autonoleggi che vogliono uscire da fogli e chat.",
    features: ["Booking e flotta", "Clienti e contratti", "Dashboard operativa", "Scadenze principali"]
  },
  PRO: {
    target: "Per team che gestiscono noleggi e contratti ogni giorno.",
    features: ["Flussi contrattuali evoluti", "Manutenzioni e listini", "Statistiche e alert", "Operatività avanzata"],
    highlight: true
  },
  ENTERPRISE: {
    target: "Per aziende multi-sede con governance e processi complessi.",
    features: ["Controllo multi-sede", "Governance avanzata", "Automazioni e integrazioni", "Supporto prioritario"]
  }
};

const plans = SAAS_PLANS.map((code) => ({
  code,
  name: COMMERCIAL_PLAN_CATALOG[code].label,
  price: new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: COMMERCIAL_PLAN_CATALOG[code].currency,
    maximumFractionDigits: 0
  }).format(PLAN_MONTHLY_PRICING_EUR[code]),
  ...landingPlanCopy[code]
}));

const PricingSection = () => {
  useEffect(() => {
    trackPublicEvent("PRICING_VIEW", { placement: "landing-v3" });
  }, []);

  return (
    <section className="fleetum-v3-chapter fleetum-v3-pricing" id="prezzi">
      <div className="fleetum-v3-chapter__inner">
        <SectionIntro
          eyebrow="06 · Piani Fleetum"
          title="Parti con il controllo che ti serve oggi."
          text="Il catalogo commerciale è condiviso con il flusso di attivazione, così prezzi e piano scelto restano coerenti."
          align="center"
        />
        <div className="fleetum-v3-pricing__grid">
          {plans.map((plan, index) => (
            <Reveal key={plan.code} delay={index * 80}>
              <article className={plan.highlight ? "is-highlight" : ""}>
                <div className="fleetum-v3-pricing__head">
                  <div><span>{plan.highlight ? "Consigliato" : "Piano"}</span><h3>{plan.name}</h3></div>
                  {plan.highlight ? <Sparkles size={20} aria-hidden="true" /> : null}
                </div>
                <p className="fleetum-v3-pricing__price"><strong>{plan.price}</strong><span>/mese<br />IVA inclusa</span></p>
                <p className="fleetum-v3-pricing__target">{plan.target}</p>
                <ul>{plan.features.map((feature) => <li key={feature}><Check size={16} aria-hidden="true" />{feature}</li>)}</ul>
                <Link
                  to={plan.code === "ENTERPRISE" ? "/demo" : "/signup"}
                  className="fleetum-v3-button is-plan"
                  onClick={() => trackCta("pricing", plan.code === "ENTERPRISE" ? "demo" : "signup", { plan: plan.code.toLowerCase() })}
                >
                  {plan.code === "ENTERPRISE" ? "Parla con noi" : "Inizia con Fleetum"} <ArrowRight size={17} aria-hidden="true" />
                </Link>
              </article>
            </Reveal>
          ))}
        </div>
        <Reveal className="fleetum-v3-pricing__more">
          <Link to="/prezzi">Confronta piani mensili e annuali <ArrowRight size={16} aria-hidden="true" /></Link>
        </Reveal>
        <Reveal className="fleetum-v3-final-cta">
          <div>
            <span>La prossima prenotazione può partire meglio.</span>
            <h2>Guarda Fleetum sul tuo flusso operativo.</h2>
            <p>Raccontaci sedi, flotta e modo di lavorare. Ti mostriamo booking, contratti e controllo economico senza una demo generica.</p>
          </div>
          <div className="fleetum-v3-final-cta__actions">
            <Link to="/demo" className="fleetum-v3-button is-light" onClick={() => trackCta("final", "demo")}>Richiedi una demo <ArrowRight size={18} aria-hidden="true" /></Link>
            <Link to="/login" className="fleetum-v3-button is-outline" onClick={() => trackPublicEvent("LOGIN_CLICK", { placement: "landing-v3-final" })}>Accedi</Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
};

export const LandingPage = () => {
  useEffect(() => {
    trackPublicEvent("PAGE_VIEW", { page: "landing", version: "cinematic-v3" });
  }, []);

  return (
    <main id="main-content" className="fleetum-landing fleetum-home-v3 fleetum-public-theme fleetum-public-theme--light">
      <SeoHead
        title="Fleetum | Gestionale per autonoleggi, booking e flotta"
        description="Fleetum centralizza booking noleggi, contratti digitali, clienti, flotta, manutenzioni e redditività in un gestionale SaaS per autonoleggi."
        canonicalPath="/"
      >
        <script type="application/ld+json">
          {JSON.stringify({
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: "Fleetum",
            applicationCategory: "BusinessApplication",
            operatingSystem: "Web",
            url: "https://fleetum.it/",
            description: "Gestionale SaaS per autonoleggi con booking, contratti digitali, flotta, clienti, manutenzioni e report di redditività."
          })}
        </script>
      </SeoHead>
      <HeroSection />
      <ProofSection />
      <BookingSection />
      <WorkflowSection />
      <RoiSection />
      <MultiSiteSection />
      <TrustSection />
      <PricingSection />
      <PublicFooter tone="light" />
    </main>
  );
};
