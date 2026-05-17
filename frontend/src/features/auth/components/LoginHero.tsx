const CHIPS = [
  { color: "#2563ff", label: "Booking live" },
  { color: "#00b8a9", label: "Contratti smart" },
  { color: "#4b8cff", label: "Fleet control" }
];

const AVATARS = [
  { initials: "MT", from: "#2563ff", to: "#4b8cff" },
  { initials: "SL", from: "#00b8a9", to: "#32ddd1" },
  { initials: "AP", from: "#07111f", to: "#2563ff" },
  { initials: "NV", from: "#0b1220", to: "#00b8a9" }
];

const PREVIEW_ROWS = [
  { plate: "GF100AA", status: "Prenotata", tone: "blue" },
  { plate: "GF101AB", status: "Rientro 18:30", tone: "teal" },
  { plate: "GF102AC", status: "Revisione OK", tone: "navy" }
];

export const LoginHero = () => (
  <aside className="premium-login-side premium-login-side--left">
    <div className="premium-login-logo-row">
      <img className="premium-login-logo-wordmark" src="/brand/fleetum-logo-full-light.svg" alt="Fleetum" />
    </div>

    <div className="premium-login-hero-copy">
      <div className="premium-login-pill premium-login-pill--live">
        <span className="premium-login-pill-dot" /> SaaS operativo per autonoleggi
      </div>
      <h1 className="premium-login-hero-title">
        La control room<br />
        <span>per noleggi e flotta.</span>
      </h1>
      <p className="premium-login-hero-subtitle">
        Booking mensile per macchina, contratti digitali, clienti, manutenzioni e scadenze in un unico workspace enterprise.
      </p>

      <div className="premium-login-chip-list">
        {CHIPS.map((chip) => (
          <div key={chip.label} className="premium-login-chip">
            <span style={{ background: chip.color }} />
            {chip.label}
          </div>
        ))}
      </div>

      <section className="premium-login-preview-card" aria-label="Anteprima operativa Fleetum">
        <div className="premium-login-preview-card__head">
          <div>
            <p>Live planner</p>
            <strong>Oggi · 27 veicoli monitorati</strong>
          </div>
          <span>98%</span>
        </div>
        <div className="premium-login-preview-chart" aria-hidden>
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
        <div className="premium-login-preview-list">
          {PREVIEW_ROWS.map((row) => (
            <div key={row.plate} className={`premium-login-preview-row premium-login-preview-row--${row.tone}`}>
              <span>{row.plate}</span>
              <em>{row.status}</em>
            </div>
          ))}
        </div>
      </section>
    </div>

    <div className="premium-login-social-proof">
      <div className="premium-login-avatar-stack">
        {AVATARS.map((avatar, index) => (
          <div
            key={avatar.initials}
            className="premium-login-avatar"
            style={{
              background: `linear-gradient(135deg,${avatar.from},${avatar.to})`,
              marginLeft: index === 0 ? 0 : -8,
              zIndex: AVATARS.length - index
            }}
          >
            {avatar.initials}
          </div>
        ))}
      </div>
      <div>
        <div className="premium-login-stars">★★★★★</div>
        <p>
          <strong>Fleetum</strong> workspace cloud-ready
        </p>
      </div>
    </div>
  </aside>
);
