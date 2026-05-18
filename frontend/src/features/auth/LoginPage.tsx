import { useEffect } from "react";
import { LoginCard } from "./components/LoginCard";
import { MagneticOrbs } from "./components/MagneticOrbs";
import { ParticleCanvas } from "./components/ParticleCanvas";
import "./premium-login.css";

export const LoginPage = () => {
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
    <div className="premium-login-root premium-login-root--clean">
      <div className="premium-login-bg-gradient" aria-hidden />
      <div className="premium-login-aurora" aria-hidden>
        <span className="premium-login-aurora__beam premium-login-aurora__beam--one" />
        <span className="premium-login-aurora__beam premium-login-aurora__beam--two" />
        <span className="premium-login-aurora__beam premium-login-aurora__beam--three" />
      </div>
      <ParticleCanvas />
      <MagneticOrbs />
      <div className="premium-login-grid-overlay" aria-hidden />
      <div className="premium-login-noise-overlay" aria-hidden />
      <div className="premium-login-floating-layer" aria-hidden>
        {Array.from({ length: 18 }, (_, index) => (
          <span
            key={index}
            className="premium-login-floating-dot"
            style={{
              left: `${8 + ((index * 17) % 86)}%`,
              top: `${10 + ((index * 23) % 78)}%`,
              animationDuration: `${7 + (index % 5)}s`,
              animationDelay: `${index * 0.42}s`
            }}
          />
        ))}
      </div>
      <div className="premium-login-spotlight" aria-hidden />
      <main className="premium-login-auth-shell">
        <LoginCard />
      </main>
    </div>
  );
};
