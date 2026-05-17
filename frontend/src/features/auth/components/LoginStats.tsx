import { useEffect, useRef } from "react";

function useCountUp(target: number, duration = 2000, startDelay = 500) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const start = performance.now();
      const frame = (time: number) => {
        const progress = Math.min((time - start) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 4);
        if (ref.current) {
          ref.current.textContent = Math.floor(target * eased).toLocaleString("it-IT");
        }
        if (progress < 1) {
          requestAnimationFrame(frame);
        }
      };
      requestAnimationFrame(frame);
    }, startDelay);

    return () => window.clearTimeout(timeout);
  }, [duration, startDelay, target]);

  return ref;
}

export const LoginStats = () => {
  const bookingsRef = useCountUp(248);
  const contractsRef = useCountUp(96);

  return (
    <aside className="premium-login-side premium-login-side--right">
      <article className="premium-login-command-card" data-cursor="hover">
        <p className="premium-login-stat-label">CONTROL ROOM</p>
        <p className="premium-login-feature-title">Tutto quello che serve prima che diventi urgente.</p>
        <div className="premium-login-command-grid">
          <span>Booking</span>
          <span>Contratti</span>
          <span>Clienti</span>
          <span>Scadenze</span>
        </div>
      </article>

      <article className="premium-login-stat-card premium-login-stat-card--violet" data-cursor="hover">
        <p className="premium-login-stat-label">PRENOTAZIONI MESE</p>
        <p className="premium-login-stat-value">
          <span ref={bookingsRef}>0</span>
        </p>
        <p className="premium-login-stat-delta">↑ pianificazione live per sede e veicolo</p>
      </article>

      <article className="premium-login-stat-card premium-login-stat-card--cyan" data-cursor="hover">
        <p className="premium-login-stat-label">CONTRATTI DIGITALI</p>
        <p className="premium-login-stat-value">
          <span ref={contractsRef}>0</span>%
        </p>
        <p className="premium-login-stat-delta">↑ PDF, email, WhatsApp e firma</p>
      </article>

      <article className="premium-login-feature-callout" data-cursor="hover">
        <p className="premium-login-stat-label">SECURITY LAYER</p>
        <p className="premium-login-feature-title">Workspace sicuro e privacy</p>
        <p className="premium-login-feature-subtitle">Pensato per aziende che devono scalare senza perdere controllo.</p>
      </article>
    </aside>
  );
};
