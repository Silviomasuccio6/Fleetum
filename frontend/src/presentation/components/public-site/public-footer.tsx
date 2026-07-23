import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import { trackPublicEvent } from "../../../application/usecases/public-analytics-usecases";
import { PublicBrand } from "./public-brand";

type PublicFooterProps = {
  tone?: "light" | "dark";
};

const productLinks = [
  ["Software autonoleggio", "/software-autonoleggio"],
  ["Booking noleggi", "/booking-noleggi"],
  ["Contratti digitali", "/contratti-noleggio-digitali"],
  ["Gestionale flotta", "/gestionale-flotta"],
  ["ROI veicolo", "/report-redditivita-veicolo"]
] as const;

const companyLinks = [
  ["Prezzi", "/prezzi"],
  ["Richiedi demo", "/demo"],
  ["Accedi", "/login"]
] as const;

const legalLinks = [
  ["Privacy", "/privacy"],
  ["Cookie", "/cookie"],
  ["Termini", "/termini"],
  ["DPA", "/dpa"]
] as const;

export const PublicFooter = ({ tone = "light" }: PublicFooterProps) => (
  <footer className={`fleetum-public-footer fleetum-public-footer--${tone}`}>
    <div className="fleetum-public-footer__lead">
      <Link to="/" aria-label="Fleetum, torna alla home">
        <PublicBrand tone={tone} />
      </Link>
      <p>Il sistema operativo per booking, contratti, flotta e redditività degli autonoleggi moderni.</p>
      <Link
        className="fleetum-public-footer__demo"
        to="/demo"
        onClick={() => trackPublicEvent("CTA_CLICK", { placement: "footer", destination: "demo" })}
      >
        Vedi Fleetum in azione <ArrowUpRight size={16} aria-hidden="true" />
      </Link>
    </div>
    <div className="fleetum-public-footer__column">
      <strong>Prodotto</strong>
      {productLinks.map(([label, href]) => <Link key={href} to={href}>{label}</Link>)}
    </div>
    <div className="fleetum-public-footer__column">
      <strong>Fleetum</strong>
      {companyLinks.map(([label, href]) => <Link key={href} to={href}>{label}</Link>)}
    </div>
    <div className="fleetum-public-footer__column">
      <strong>Legale</strong>
      {legalLinks.map(([label, href]) => <Link key={href} to={href}>{label}</Link>)}
    </div>
    <div className="fleetum-public-footer__bottom">
      <p>© {new Date().getFullYear()} Fleetum. SaaS B2B per autonoleggi e fleet management.</p>
      <span>Progettato e operato in Italia.</span>
    </div>
  </footer>
);
