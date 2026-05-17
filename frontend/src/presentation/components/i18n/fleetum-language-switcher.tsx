import { useFleetumLanguage } from "../../i18n/fleetum-language";
import "./fleetum-language-switcher.css";

export function FleetumLanguageSwitcher({ className = "" }: { className?: string }) {
  const { language, setLanguage } = useFleetumLanguage();

  return (
    <div className={`premium-language-switcher ${className}`} aria-label="Selezione lingua">
      <button type="button" className={language === "it" ? "is-active" : ""} onClick={() => setLanguage("it")}>IT</button>
      <button type="button" className={language === "en" ? "is-active" : ""} onClick={() => setLanguage("en")}>EN</button>
    </div>
  );
}
