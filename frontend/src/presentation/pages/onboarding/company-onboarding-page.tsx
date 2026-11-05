import { useLocation } from "react-router-dom";
import { AccessBrandBar } from "../../components/layout/access-shell";
import { getActivationPath } from "../auth/access-flow";
import { CompanyProfilePage } from "../profile/company-profile-page";

export const CompanyOnboardingPage = () => {
  const location = useLocation();
  return <main className="workspace-shell access-shell access-onboarding"><div className="access-workspace"><AccessBrandBar/>
    <ol className="access-step-list" aria-label="Primo utilizzo di Fleetum"><li aria-current="step">1. Dati aziendali</li><li>2. Piano e attivazione</li><li>3. Gestionale</li></ol>
    <p className="access-onboarding-intro">Controlla i dati dell’azienda e del referente. Serviranno per contratti e documenti; dopo il salvataggio potrai scegliere il piano. I campi e le verifiche fiscali restano obbligatori dove previsti.</p>
    <CompanyProfilePage onboarding nextPath={getActivationPath(location.search,true)}/>
  </div></main>;
};
export default CompanyOnboardingPage;
