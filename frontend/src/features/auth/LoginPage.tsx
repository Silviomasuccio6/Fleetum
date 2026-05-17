import { CSSProperties, useEffect, useMemo } from "react";
import { LoginCard } from "./components/LoginCard";
import { LoginHero } from "./components/LoginHero";
import { LoginStats } from "./components/LoginStats";
import { MagneticOrbs } from "./components/MagneticOrbs";
import { ParticleCanvas } from "./components/ParticleCanvas";
import { useMouseParallax } from "./hooks/useMouseParallax";
import { FleetumLanguageSwitcher } from "../../presentation/components/i18n/fleetum-language-switcher";
import "./premium-login.css";

const FLOATING_PARTICLES = Array.from({ length: 14 }, (_, index) => ({
  id: index,
  left: `${Math.round((index * 7.13) % 100)}%`,
  delay: `${(index % 7) * 0.6}s`,
  duration: `${6 + (index % 5) * 1.2}s`
}));

export const LoginPage = () => {
  const { nx, ny } = useMouseParallax();

  const backgroundTransform = useMemo(
    () => ({
      transform: `translate(${nx * 24}px, ${ny * 18}px)`
    }),
    [nx, ny]
  );

  const spotlightStyle = useMemo(
    () => ({
      "--spotlight-x": `${50 + nx * 18}%`,
      "--spotlight-y": `${50 + ny * 14}%`
    }) as CSSProperties,
    [nx, ny]
  );


  useEffect(() => {
    const previousTheme = document.documentElement.getAttribute("data-theme");
    document.documentElement.setAttribute("data-theme", "light");

    return () => {
      if (previousTheme) {
        document.documentElement.setAttribute("data-theme", previousTheme);
      } else {
        document.documentElement.removeAttribute("data-theme");
      }
    };
  }, []);

  return (
    <div className="premium-login-root">
      <div className="premium-login-bg-gradient" style={backgroundTransform} aria-hidden />
      <FleetumLanguageSwitcher />
      <div className="premium-login-aurora" aria-hidden>
        <span className="premium-login-aurora__beam premium-login-aurora__beam--one" />
        <span className="premium-login-aurora__beam premium-login-aurora__beam--two" />
        <span className="premium-login-aurora__beam premium-login-aurora__beam--three" />
      </div>
      <div className="premium-login-spotlight" style={spotlightStyle} aria-hidden />

      <ParticleCanvas />
      <MagneticOrbs />

      <div className="premium-login-grid-overlay" aria-hidden />
      <div className="premium-login-noise-overlay" aria-hidden />

      <div className="premium-login-floating-layer" aria-hidden>
        {FLOATING_PARTICLES.map((particle) => (
          <span
            key={particle.id}
            className="premium-login-floating-dot"
            style={{
              left: particle.left,
              animationDelay: particle.delay,
              animationDuration: particle.duration
            }}
          />
        ))}
      </div>

      <main className="premium-login-grid">
        <LoginHero />
        <LoginCard />
        <LoginStats />
      </main>
    </div>
  );
};
