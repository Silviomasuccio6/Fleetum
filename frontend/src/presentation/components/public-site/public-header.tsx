import { useEffect, useState } from "react";
import { ArrowRight, Menu, X } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { trackPublicEvent } from "../../../application/usecases/public-analytics-usecases";
import { PublicBrand } from "./public-brand";

export type PublicNavigationItem = {
  label: string;
  href: string;
};

type PublicHeaderProps = {
  tone?: "light" | "dark";
  items?: PublicNavigationItem[];
  analyticsPlacement?: string;
};

export const PUBLIC_PRODUCT_NAVIGATION: PublicNavigationItem[] = [
  { label: "Software", href: "/software-autonoleggio" },
  { label: "Booking", href: "/booking-noleggi" },
  { label: "Contratti", href: "/contratti-noleggio-digitali" },
  { label: "Flotta", href: "/gestionale-flotta" },
  { label: "Prezzi", href: "/prezzi" }
];

const PublicNavigationLink = ({ item, onNavigate }: { item: PublicNavigationItem; onNavigate?: () => void }) => {
  if (item.href.startsWith("#")) {
    return <a href={item.href} onClick={onNavigate}>{item.label}</a>;
  }

  return <Link to={item.href} onClick={onNavigate}>{item.label}</Link>;
};

export const PublicHeader = ({
  tone = "light",
  items = PUBLIC_PRODUCT_NAVIGATION,
  analyticsPlacement = "public"
}: PublicHeaderProps) => {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const menuId = "fleetum-public-mobile-menu";
  const location = useLocation();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 18);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname, location.hash]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const trackLogin = (placement: string) => {
    trackPublicEvent("LOGIN_CLICK", { placement, source: analyticsPlacement });
  };

  const trackDemo = (placement: string) => {
    trackPublicEvent("CTA_CLICK", { placement, destination: "demo", source: analyticsPlacement });
  };

  return (
    <>
      <a className="fleetum-public-skip-link" href="#main-content">Vai al contenuto</a>
      <header
        className={`fleetum-public-header fleetum-public-header--${tone} ${scrolled ? "is-scrolled" : ""}`}
      >
        <Link className="fleetum-public-header__brand" to="/" aria-label="Fleetum, torna alla home">
          <PublicBrand tone={tone} priority />
        </Link>

        <nav className="fleetum-public-header__nav" aria-label="Navigazione principale Fleetum">
          {items.map((item) => <PublicNavigationLink key={item.href} item={item} />)}
        </nav>

        <div className="fleetum-public-header__actions">
          <Link
            className="fleetum-public-action fleetum-public-action--quiet"
            to="/login"
            onClick={() => trackLogin("header")}
          >
            Accedi
          </Link>
          <Link
            className="fleetum-public-action fleetum-public-action--primary"
            to="/demo"
            onClick={() => trackDemo("header")}
          >
            Richiedi demo <ArrowRight size={16} aria-hidden="true" />
          </Link>
          <button
            className="fleetum-public-header__toggle"
            type="button"
            aria-label={open ? "Chiudi menu" : "Apri menu"}
            aria-expanded={open}
            aria-controls={menuId}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          </button>
        </div>

        <nav
          id={menuId}
          className={`fleetum-public-header__mobile ${open ? "is-open" : ""}`}
          aria-label="Navigazione mobile Fleetum"
          hidden={!open}
        >
          {items.map((item) => (
            <PublicNavigationLink key={item.href} item={item} onNavigate={() => setOpen(false)} />
          ))}
          <div className="fleetum-public-header__mobile-actions">
            <Link to="/login" onClick={() => trackLogin("mobile_header")}>Accedi</Link>
            <Link to="/demo" onClick={() => trackDemo("mobile_header")}>Richiedi demo</Link>
          </div>
        </nav>
      </header>
    </>
  );
};
