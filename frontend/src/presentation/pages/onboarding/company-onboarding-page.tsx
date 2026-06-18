import { CompanyProfilePage } from "../profile/company-profile-page";

export const CompanyOnboardingPage = () => (
  <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6 lg:px-8">
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">Onboarding Fleetum</p>
            <h1 className="mt-2 text-2xl font-semibold text-slate-950">Prima i dati societari, poi il piano</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Abbiamo recuperato da Google nome, cognome ed email quando disponibili. Completa ora i dati aziendali:
              serviranno per contratti, fatture, documenti e attivazione corretta del tenant.
            </p>
          </div>
          <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-800">
            Step obbligatorio prima di Stripe
          </div>
        </div>
      </header>

      <CompanyProfilePage onboarding nextPath="/activate?welcome=billing&profile=completed" />
    </div>
  </main>
);

export default CompanyOnboardingPage;
