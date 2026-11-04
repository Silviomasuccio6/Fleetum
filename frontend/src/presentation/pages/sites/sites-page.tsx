import { GenericCrudPage } from "../shared/generic-crud-page";
import { masterDataUseCases } from "../../../application/usecases/master-data-usecases";

export const SitesPage = () => (
  <GenericCrudPage
    scope="sites"
    title="Sedi"
    createLabel="Nuova sede"
    list={(params) => masterDataUseCases.listSites(params)}
    create={(input) => masterDataUseCases.createSite(input)}
    update={(id, input) => masterDataUseCases.updateSite(id, input)}
    remove={(id) => masterDataUseCases.deleteSite(id)}
    fields={[
      { key: "name", label: "Nome sede", placeholder: "Sede Nord" },
      { key: "address", label: "Indirizzo", placeholder: "Via Roma 1" },
      { key: "city", label: "Città", placeholder: "Milano" },
      { key: "contactName", label: "Referente", placeholder: "Mario Rossi" },
      { key: "email", label: "Email", type: "email", placeholder: "sede@azienda.it" },
      { key: "phone", label: "Telefono", placeholder: "+39..." },
      { key: "notes", label: "Note", placeholder: "Informazioni aggiuntive" }
    ]}
  />
);
