import { FormEvent, useEffect, useMemo, useState } from "react";
import { CircleCheck, ShieldCheck, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useMouseParallax } from "../../../features/auth/hooks/useMouseParallax";
import { ParticleCanvas } from "../../../features/auth/components/ParticleCanvas";
import { MagneticOrbs } from "../../../features/auth/components/MagneticOrbs";
import { platformAdminUseCases } from "../../../application/usecases/platform/platform-admin-usecases";
import { FleetumLogoLoader } from "../../components/brand/fleetum-logo-loader";
import "../../../features/auth/premium-login.css";

const TRUST_ITEMS = [
  "127.0.0.1 only + IP allowlist",
  "JWT separato + lock anti brute-force",
  "Alert email su accessi anomali e cambi licenza"
];

const STATS = [
  { label: "Tenant monitorati", value: "1.240+", delta: "in tempo reale" },
  { label: "Eventi audit/giorno", value: "86.5K", delta: "immutabili" },
  { label: "Disponibilità", value: "99.99%", delta: "ultimi 90 giorni" }
];

const FLOATING_PARTICLES = Array.from({ length: 30 }, (_, index) => ({
  id: index,
  left: `${Math.round((index * 7.13) % 100)}%`,
  delay: `${(index % 7) * 0.6}s`,
  duration: `${6 + (index % 5) * 1.2}s`
}));

export const PlatformAdminLoginPage = () => {
  const navigate = useNavigate();
  const { nx, ny } = useMouseParallax();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);

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

  const backgroundTransform = useMemo(
    () => ({
      transform: `translate(${nx * 24}px, ${ny * 18}px)`
    }),
    [nx, ny]
  );

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!email.trim() || !password.trim()) {
      setError("Inserisci email e password.");
      setShake(true);
      window.setTimeout(() => setShake(false), 420);
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const normalizedOtp = otp.trim();
      await platformAdminUseCases.login({ email, password, otp: normalizedOtp ? normalizedOtp : undefined });
      navigate("/console");
    } catch (e) {
      setError((e as Error).message);
      setShake(true);
      window.setTimeout(() => setShake(false), 420);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="premium-login-root">
      <div className="premium-login-bg-gradient" style={backgroundTransform} aria-hidden />

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
        <aside className="premium-login-side premium-login-side--left">
          <div className="premium-login-logo-row">
            <img className="premium-login-logo-mark" src="/brand/fleetum-symbol-color.svg" alt="" />
            <span className="premium-login-logo-text">
              Fleetum<span> Platform</span>
            </span>
          </div>

          <div className="premium-login-hero-copy">
            <p className="premium-login-pill">
              <span className="premium-login-pill-dot" />
              Secure Platform Access
            </p>
            <h1 className="premium-login-hero-title">
              Control Tower privata<br />
              <span>per licenze SaaS multi-tenant.</span>
            </h1>
            <p className="premium-login-hero-subtitle">
              Accesso limitato a host/IP autorizzati, sessioni brevi, audit immutabile e alert automatici.
            </p>

            <div className="premium-login-chip-list">
              <span className="premium-login-chip"><span style={{ background: "#34d399" }} />99.9% Uptime</span>
              <span className="premium-login-chip"><span style={{ background: "#818cf8" }} />IP restricted</span>
              <span className="premium-login-chip"><span style={{ background: "#22d3ee" }} />Local-only</span>
            </div>
          </div>

          <ul className="space-y-2 text-sm text-slate-600">
            {TRUST_ITEMS.map((item) => (
              <li key={item} className="premium-login-list-item flex items-center gap-2.5">
                <CircleCheck className="h-4 w-4 text-indigo-600" />
                {item}
              </li>
            ))}
          </ul>
        </aside>

        <div className="premium-login-card-wrap">
          <section className={`premium-login-card ${shake ? "animate-shake" : ""}`}>
            <header className="premium-login-card-head">
              <img className="premium-login-card-logo premium-login-card-logo--image" src="/brand/fleetum-symbol-color.svg" alt="Fleetum" />
              <h2>Login Console Platform</h2>
              <p>Accedi all'area riservata amministrativa</p>
            </header>

            <form className="premium-login-form" onSubmit={onSubmit}>
              <label className="premium-login-field-label" htmlFor="platform-email">
                Email admin
              </label>
              <div className={`premium-login-field ${email && email.includes("@") ? "is-ok" : ""}`}>
                <span>✉</span>
                <input
                  id="platform-email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@platform.local"
                  required
                />
              </div>

              <label className="premium-login-field-label" htmlFor="platform-password">
                Password
              </label>
              <div className={`premium-login-field ${error ? "is-error" : ""}`}>
                <span>🔒</span>
                <input
                  id="platform-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••"
                  required
                />
              </div>

              <label className="premium-login-field-label" htmlFor="platform-otp">
                OTP (se abilitato)
              </label>
              <div className="premium-login-field">
                <span>🔢</span>
                <input
                  id="platform-otp"
                  name="otp"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="123456"
                  autoComplete="one-time-code"
                />
              </div>

              {error ? <p className="premium-login-error premium-login-error--block">{error}</p> : null}

              <button className="premium-login-submit" type="submit" disabled={loading}>
                <span className="premium-login-submit-shimmer" />
                {loading ? (
                  <span className="premium-login-loading">
                    <FleetumLogoLoader size="sm" variant="dark" decorative className="fleetum-loader--button" />
                    Verifica credenziali...
                  </span>
                ) : (
                  "Accedi alla Console"
                )}
              </button>
            </form>
          </section>
        </div>

        <aside className="premium-login-side premium-login-side--right">
          {STATS.map((stat, index) => (
            <article
              key={stat.label}
              className={`premium-login-stat-card ${
                index === 0
                  ? "premium-login-stat-card--violet"
                  : index === 1
                    ? "premium-login-stat-card--cyan"
                    : "premium-login-stat-card--emerald"
              }`}
            >
              <p className="premium-login-stat-label">{stat.label}</p>
              <p className="premium-login-stat-value">{stat.value}</p>
              <p className="premium-login-stat-delta">{stat.delta}</p>
            </article>
          ))}

          <article className="premium-login-feature-callout">
            <p className="premium-login-stat-label">NUOVO · FEATURE</p>
            <p className="premium-login-feature-title">
              <Sparkles className="mr-1 inline h-4 w-4" /> Policy Anomaly Detection
            </p>
            <p className="premium-login-feature-subtitle">
              Rilevamento comportamenti anomali su login e cambi licenza.
            </p>
            <div className="premium-login-chip mt-2 w-fit">
              <ShieldCheck className="h-4 w-4" /> Security posture elevata
            </div>
          </article>
        </aside>
      </main>
    </div>
  );
};
