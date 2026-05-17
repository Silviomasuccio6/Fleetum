import { ReactNode } from "react";

type AuthShellProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
};

export const AuthShell = ({ title, subtitle, children }: AuthShellProps) => (
  <div className="min-h-screen bg-slate-100 p-4 dark:bg-slate-950 sm:p-6">
    <div className="mx-auto grid min-h-[calc(100vh-2rem)] w-full max-w-6xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-white/10 dark:bg-slate-900 lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden p-8 lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_15%,rgba(59,130,246,0.42),transparent_45%),radial-gradient(circle_at_80%_20%,rgba(45,212,191,0.28),transparent_50%),radial-gradient(circle_at_50%_85%,rgba(99,102,241,0.24),transparent_45%)]" />
        <div className="relative z-10 flex h-full flex-col justify-between rounded-2xl border border-slate-200 bg-white/75 p-8 backdrop-blur-sm dark:border-white/20 dark:bg-white/10">
          <div>
            <img src="/brand/fleetum-logo-full-light.svg" alt="Fleetum" className="h-9 w-auto max-w-[190px] object-contain dark:hidden" />
            <img src="/brand/fleetum-logo-full-dark.svg" alt="Fleetum" className="hidden h-9 w-auto max-w-[190px] object-contain dark:block" />
            <h2 className="mt-4 max-w-sm text-3xl font-semibold leading-tight text-slate-900 dark:text-white">
              Controllo completo di fermi macchina e workflow officine.
            </h2>
          </div>
          <div className="grid gap-2 text-sm text-slate-700 dark:text-slate-100/90">
            <p>Dashboard KPI e trend</p>
            <p>Reminder email e WhatsApp</p>
            <p>Gestione utenti e ruoli</p>
          </div>
        </div>
      </section>

      <section className="flex items-center justify-center bg-slate-50 p-4 dark:bg-slate-900 sm:p-8">
        <div className="w-full max-w-md">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Accesso piattaforma</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-100">{title}</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{subtitle}</p>
          <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-6">{children}</div>
        </div>
      </section>
    </div>
  </div>
);
