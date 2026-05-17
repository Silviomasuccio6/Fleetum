import { cn } from "../../../lib/utils";
import "./fleetum-logo-loader.css";

export type FleetumLogoLoaderProps = {
  size?: "sm" | "md" | "lg";
  variant?: "dark" | "light";
  decorative?: boolean;
  className?: string;
};

export function FleetumLogoLoader({
  size = "md",
  variant = "dark",
  decorative = false,
  className = ""
}: FleetumLogoLoaderProps) {
  const logoSrc = variant === "dark" ? "/brand/fleetum-symbol-for-dark-bg.svg" : "/brand/fleetum-symbol-for-light-bg.svg";

  return (
    <div
      className={cn("fleetum-loader", `fleetum-loader--${size}`, `fleetum-loader--${variant}`, className)}
      aria-hidden={decorative ? "true" : undefined}
    >
      <img
        className="fleetum-loader__mark"
        src={logoSrc}
        alt={decorative ? "" : "Fleetum loading"}
        role={decorative ? undefined : "img"}
        aria-label={decorative ? undefined : "Fleetum loading"}
      />
    </div>
  );
}

export function FleetumFullScreenLoader({ label = "Verifica sessione..." }: { label?: string }) {
  return (
    <main className="fleetum-fullscreen-loader" aria-live="polite">
      <FleetumLogoLoader size="lg" variant="light" />
      <span>{label}</span>
    </main>
  );
}

export function FleetumInlineLoader({ label, className = "" }: { label?: string; className?: string }) {
  return (
    <span className={cn("fleetum-inline-loader", className)} aria-live="polite">
      <FleetumLogoLoader size="sm" variant="light" decorative className="fleetum-loader--inline" />
      {label ? <span>{label}</span> : null}
    </span>
  );
}

export function FleetumBlockLoader({ label = "Caricamento", className = "" }: { label?: string; className?: string }) {
  return (
    <div className={cn("fleetum-block-loader", className)} aria-live="polite">
      <FleetumLogoLoader size="md" variant="light" />
      <span>{label}</span>
    </div>
  );
}
