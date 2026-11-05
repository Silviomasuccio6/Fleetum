import { GenericCrudPage } from "../shared/generic-crud-page";
import { masterDataUseCases } from "../../../application/usecases/master-data-usecases";

export const WorkshopsPage = () => (
  <GenericCrudPage
    scope="workshops"
    title="Officine"
    createLabel="Nuova officina"
    list={(params) => masterDataUseCases.listWorkshops(params)}
    create={(input) => masterDataUseCases.createWorkshop(input)}
    update={(id, input) => masterDataUseCases.updateWorkshop(id, input)}
    remove={(id) => masterDataUseCases.deleteWorkshop(id)}
    fields={[
      { key: "name", label: "Nome officina", placeholder: "Officina Verdi" },
      { key: "contactName", label: "Referente", placeholder: "Luca Bianchi" },
      { key: "email", label: "Email", type: "email", placeholder: "officina@mail.it" },
      { key: "phone", label: "Telefono", placeholder: "+39..." },
      { key: "whatsapp", label: "Numero WhatsApp", placeholder: "393331234567" },
      { key: "address", label: "Indirizzo", placeholder: "Via Torino 10" },
      { key: "city", label: "Città", placeholder: "Roma" },
      { key: "notes", label: "Note", placeholder: "Orari e note operative" }
    ]}
  />
);
