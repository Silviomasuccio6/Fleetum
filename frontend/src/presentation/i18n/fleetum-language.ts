import { useEffect, useState } from "react";

export type FleetumLanguage = "it" | "en";

export const FLEETUM_LANGUAGE_STORAGE_KEY = "fleetum-language";
export const FLEETUM_LANGUAGE_EVENT = "fleetum-language-change";

const TRANSLATIONS_IT_EN: Record<string, string> = {
  "Bentornato": "Welcome back",
  "Accedi alla control room operativa della tua azienda.": "Access your company's operating control room.",
  "Continua con Google": "Continue with Google",
  "o continua con email": "or continue with email",
  "Indirizzo email": "Email address",
  "Password": "Password",
  "Ricordami": "Remember me",
  "Password dimenticata?": "Forgot password?",
  "Accedi al workspace": "Sign in to workspace",
  "Accesso in corso...": "Signing in...",
  "Accesso effettuato": "Signed in",
  "Non hai un account?": "Don't have an account?",
  "Crea account e scegli piano →": "Create account and choose a plan →",
  "Accedendo confermi di aver letto l'": "By signing in, you confirm you have read the ",
  "informativa privacy": "privacy notice",
  "Crea account": "Create account",
  "Avvia il tuo ambiente con credenziali admin iniziali": "Launch your workspace with initial admin credentials",
  "o continua con registrazione": "or continue with registration",
  "Avanzamento registrazione": "Registration progress",
  "Registrazione guidata": "Guided registration",
  "Azienda": "Company",
  "Referente": "Contact",
  "Conferma": "Confirm",
  "Dati tenant e fiscali": "Tenant and tax data",
  "Admin iniziale": "Initial admin",
  "Branding e privacy": "Branding and privacy",
  "completato": "completed",
  "Step 1 · Dati aziendali": "Step 1 · Company details",
  "Step 2 · Referente e accesso admin": "Step 2 · Contact and admin access",
  "Step 3 · Conferma workspace": "Step 3 · Confirm workspace",
  "Nome azienda": "Company name",
  "Partita IVA": "VAT number",
  "Forma giuridica": "Legal form",
  "Codice fiscale azienda": "Company tax code",
  "Email aziendale": "Company email",
  "Telefono aziendale": "Company phone",
  "Sito web": "Website",
  "Sede legale": "Registered office",
  "Comune": "City",
  "Prov.": "Province",
  "CAP": "ZIP code",
  "Paese": "Country",
  "PEC": "Certified email",
  "Codice SDI": "SDI code",
  "Nome": "First name",
  "Cognome": "Last name",
  "Telefono referente": "Contact phone",
  "Ruolo in azienda": "Company role",
  "Email login": "Login email",
  "Admin": "Admin",
  "Colore primario": "Primary color",
  "Colore accento": "Accent color",
  "Ho letto l'": "I have read the ",
  "e confermo la presa visione.": "and confirm acknowledgement.",
  "Indietro": "Back",
  "Continua con referente": "Continue to contact",
  "Continua alla conferma": "Continue to confirmation",
  "Creazione account...": "Creating account...",
  "Hai già un account?": "Already have an account?",
  "Vai al login →": "Go to login →",
  "Vai al login": "Go to login",
  "Tenant creato correttamente": "Tenant created successfully",
  "Workspace pronto": "Workspace ready",
  "Crea un altro tenant": "Create another tenant",
  "Dashboard": "Dashboard",
  "Booking Noleggi": "Rental Booking",
  "Contratti Noleggio": "Rental Contracts",
  "Listini Noleggi": "Rental Price Lists",
  "Calendario Fermi": "Downtime Calendar",
  "Fermi Tecnici": "Technical Downtime",
  "Fermi": "Downtime",
  "Scadenziario": "Deadlines",
  "Manutenzioni": "Maintenance",
  "Kanban Fermi": "Downtime Kanban",
  "Statistiche": "Analytics",
  "Panoramica": "Overview",
  "Anagrafiche": "Master Data",
  "Sedi": "Sites",
  "Officine": "Workshops",
  "Veicoli": "Vehicles",
  "Clienti": "Customers",
  "Utenti e Ruoli": "Users and Roles",
  "Profilo": "Profile",
  "Profilo Azienda": "Company Profile",
  "Upgrade piano": "Upgrade plan",
  "Logout": "Logout",
  "Esci": "Logout",
  "Filtri": "Filters",
  "Reset": "Reset",
  "Aggiorna": "Refresh",
  "Azioni": "Actions",
  "Cerca": "Search",
  "Nuovo cliente": "New customer",
  "Nuova prenotazione": "New booking",
  "Nuovo evento": "New event",
  "Nuova manutenzione": "New maintenance",
  "Salva": "Save",
  "Annulla": "Cancel",
  "Modifica": "Edit",
  "Elimina": "Delete",
  "Scarica": "Download",
  "Stampa": "Print",
  "Invia": "Send",
  "Apri": "Open",
  "Chiudi": "Close",
  "Precedente": "Previous",
  "Successiva": "Next",
  "Tutte le sedi": "All sites",
  "Tutti gli stati": "All statuses",
  "Occupati": "Occupied",
  "Liberi": "Available",
  "Occupazione": "Occupancy",
  "Veicolo / Targa": "Vehicle / Plate",
  "Targa": "Plate",
  "Cliente": "Customer",
  "Contratto": "Contract",
  "Contratti": "Contracts",
  "Stato": "Status",
  "Uscita": "Pickup",
  "Rientro": "Return",
  "Data": "Date",
  "Ora": "Time",
  "Totale": "Total",
  "Costo": "Cost",
  "Attiva": "Active",
  "Scaduta": "Expired",
  "Scaduto": "Expired",
  "In scadenza": "Due soon",
  "Nessuna azione": "No action",
  "Caricamento": "Loading",
  "Caricamento...": "Loading...",
  "Request non valida": "Invalid request",
  "Token mancante": "Missing token",
  "Selezione lingua": "Language selector",
  "La control room": "The control room",
  "per noleggi e flotta.": "for rentals and fleet.",
  "Booking mensile per macchina, contratti digitali, clienti, manutenzioni e scadenze in un unico workspace enterprise.": "Monthly vehicle booking, digital contracts, customers, maintenance and deadlines in one enterprise workspace.",
  "SaaS operativo per autonoleggi": "Operating SaaS for rental companies",
  "Booking live": "Live booking",
  "Contratti smart": "Smart contracts",
  "Fleet control": "Fleet control",
  "Fleetum workspace cloud-ready": "Fleetum cloud-ready workspace",
  "CONTROL ROOM": "CONTROL ROOM",
  "Tutto quello che serve prima che diventi urgente.": "Everything you need before it becomes urgent.",
  "PRENOTAZIONI MESE": "MONTHLY BOOKINGS",
  "CONTRATTI DIGITALI": "DIGITAL CONTRACTS",
  "SECURITY LAYER": "SECURITY LAYER",
  "Workspace sicuro e privacy": "Secure workspace and privacy",
  "Pensato per aziende che devono scalare senza perdere controllo.": "Designed for companies that need to scale without losing control.",
  "pianificazione live per sede e veicolo": "live planning by site and vehicle",
  "PDF, email, WhatsApp e firma": "PDF, email, WhatsApp and signature"
  ,
  "Pannello operativo": "Operations panel",
  "Panoramica manageriale: stato generale, priorita operative e attivita recenti.": "Management overview: general status, operational priorities and recent activity.",
  "Overview": "Overview",
  "Operativita": "Operations",
  "Attivita Recenti": "Recent Activity",
  "Fermi aperti": "Open downtime",
  "Critici aperti": "Open critical items",
  "Overdue > 30gg": "Overdue > 30 days",
  "Costo stimato cumulato": "Estimated cumulative cost",
  "Situazioni operative attive": "Active operational cases",
  "Priorita alta da presidiare": "High-priority items to monitor",
  "Da riallineare con officine": "To realign with workshops",
  "Impatto economico corrente": "Current economic impact",
  "Aperture vs Chiusure": "Openings vs Closures",
  "Confronto giornaliero tra nuovi fermi aperti e chiusi.": "Daily comparison between newly opened and closed downtime.",
  "Reminder Inviati": "Sent Reminders",
  "Volume reminder inviati nel range selezionato.": "Reminder volume sent in the selected range.",
  "Saldo Aperture-Chiusure": "Open-Close Balance",
  "Differenza operativa giornaliera tra aperture e chiusure.": "Daily operational difference between openings and closures.",
  "Trend avanzati bloccati": "Advanced trends locked",
  "Analisi aperture/chiusure e reminder disponibile dal piano PRO.": "Open/close and reminder analytics available from the PRO plan.",
  "Trend disponibile dal piano PRO": "Trend available from the PRO plan",
  "Caricamento trend": "Loading trend",
  "Trend precedente": "Previous trend",
  "Trend successivo": "Next trend",
  "Aperti": "Opened",
  "Chiusi": "Closed",
  "Saldo": "Balance",
  "Alert prioritari": "Priority alerts",
  "Nessun alert prioritario.": "No priority alerts.",
  "Control Room Noleggi": "Rental Control Room",
  "Disponibilita, uscite, rientri, contratti e criticita operative in un unico pannello.": "Availability, pickups, returns, contracts and operational issues in one panel.",
  "Disponibili oggi": "Available today",
  "Occupati oggi": "Occupied today",
  "Uscite oggi": "Pickups today",
  "Rientri oggi": "Returns today",
  "Da preparare e consegnare": "To prepare and hand over",
  "Contratti da generare": "Contracts to generate",
  "Contratti da inviare": "Contracts to send",
  "Contratti inviati oggi": "Contracts sent today",
  "Contratti firmati": "Signed contracts",
  "Contratti in errore": "Contracts in error",
  "Senza firma": "Unsigned",
  "Trend booking operativo": "Operational booking trend",
  "Prenotazioni create, uscite e rientri negli ultimi 30 giorni.": "Bookings created, pickups and returns over the last 30 days.",
  "Nessun dato booking disponibile.": "No booking data available.",
  "Economia noleggio": "Rental economics",
  "Mese corrente, previsto vs consuntivo.": "Current month, expected vs actual.",
  "Ricavi previsti": "Expected revenue",
  "Ricavi consuntivi": "Actual revenue",
  "Ticket medio": "Average ticket",
  "Extra km": "Extra km",
  "Prossime uscite": "Upcoming pickups",
  "Prossimi rientri": "Upcoming returns",
  "Prenotazioni critiche": "Critical bookings",
  "Nessuna uscita programmata.": "No scheduled pickups.",
  "Nessun rientro programmato.": "No scheduled returns.",
  "Nessuna criticita booking.": "No booking issues.",
  "Occupazione flotta": "Fleet occupancy",
  "Stato contratti": "Contract status",
  "Top veicoli noleggiati": "Top rented vehicles",
  "Ricavo": "Revenue",
  "Nessun ranking veicoli.": "No vehicle ranking.",
  "Totale fermi": "Total downtime",
  "Nuovi fermi (30gg)": "New downtime (30 days)",
  "Chiusi (30gg)": "Closed (30 days)",
  "Durata media chiusura": "Average closure duration",
  "Escalation L3": "L3 escalations",
  "Preventiva gg in scadenza": "Preventive days due soon",
  "Preventiva gg scaduta": "Preventive days overdue",
  "Preventiva km in scadenza": "Preventive km due soon",
  "Preventiva km scaduta": "Preventive km overdue",
  "Scostamento costi": "Cost variance",
  "Distribuzione stati fermi": "Downtime status distribution",
  "Suggerimenti assegnazione": "Assignment suggestions",
  "Carico": "Load",
  "peso": "weight",
  "Ultimi utenti iscritti": "Latest registered users",
  "Ultimi fermi creati": "Latest downtime created",
  "Ultimi reminder inviati": "Latest reminders sent",
  "Caricamento dashboard": "Loading dashboard",
  "Apri Booking": "Open Booking",
  "Listini": "Price lists",
  "Creato": "Created",
  "Create": "Created",
  "Rientri": "Returns",
  "Uscite": "Pickups",
  "reali": "actual",
  "mancanti": "missing",
  "giorni": "days",
  "Scadenziario Veicoli": "Vehicle Deadlines",
  "Alert su manutenzione chilometrica e revisione con sincronizzazione task nel calendario.": "Alerts for mileage maintenance and inspections with task sync to calendar.",
  "Alert totali": "Total alerts",
  "KM scaduti": "Overdue KM",
  "KM in scadenza": "KM due soon",
  "Revisioni scadute": "Overdue inspections",
  "Revisioni in scadenza": "Inspections due soon",
  "Critici": "Critical",
  "Configurazione alert": "Alert configuration",
  "Elenco scadenze": "Deadline list",
  "Nessuna scadenza attiva con i parametri correnti.": "No active deadlines with the current parameters.",
  "Anagrafica Clienti": "Customer Registry",
  "Gestione clienti centralizzata con storico noleggi e contratti in ordine cronologico.": "Centralized customer management with rental and contract history in chronological order.",
  "Nessun cliente trovato.": "No customer found.",
  "Anagrafica Cliente": "Customer Profile",
  "Dati Cliente": "Customer Data",
  "Tipo intestatario": "Holder type",
  "Ragione sociale *": "Company name *",
  "CF società": "Company tax code",
  "Nome legale rappr.": "Legal rep. first name",
  "Cognome legale rappr.": "Legal rep. last name",
  "CF legale rappr.": "Legal rep. tax code",
  "Email legale rappr.": "Legal rep. email",
  "Telefono legale rappr.": "Legal rep. phone",
  "Patente *": "Driving license *",
  "Categoria patente": "License category",
  "Rilascio patente": "License issue date",
  "Scadenza patente": "License expiry date",
  "Autorità patente": "License authority",
  "Data nascita": "Date of birth",
  "Luogo nascita": "Place of birth",
  "Nazionalità": "Nationality",
  "Codice fiscale": "Tax code",
  "Residenza": "Residence",
  "Documento tipo": "Document type",
  "Documento numero": "Document number",
  "Rilascio documento": "Document issue date",
  "Scadenza documento": "Document expiry date",
  "Autorità documento": "Document authority",
  "Note": "Notes",
  "Manutenzioni Veicoli": "Vehicle Maintenance",
  "Registro interventi effettuati su ogni mezzo con storico consultabile e filtro rapido.": "Maintenance register for each vehicle with searchable history and quick filters.",
  "Export Manutenzioni": "Export Maintenance",
  "Registro manutenzioni": "Maintenance register",
  "Veicolo": "Vehicle",
  "Fatture senza totale": "Invoices without total",
  "Elimina allegato": "Delete attachment",
  "Data da": "Date from",
  "Data a": "Date to",
  "Preset rapido": "Quick preset",
  "Modifica manutenzione": "Edit maintenance",
  "Targa veicolo": "Vehicle plate",
  "Data intervento": "Service date",
  "Tipo manutenzione": "Maintenance type",
  "Km al servizio": "Service km",
  "Costo (EUR)": "Cost (EUR)",
  "Officina / Fornitore": "Workshop / Supplier",
  "Descrizione intervento": "Service description",
  "Allegati (immagini, PDF, documenti)": "Attachments (images, PDF, documents)",
  "Nessun veicolo trovato.": "No vehicle found.",
  "Contratti pronti ma non ancora inviati": "Contracts ready but not sent yet",
  "Invii completati nelle ultime 24h": "Deliveries completed in the last 24h",
  "Contratti con firma acquisita": "Contracts with captured signature",
  "Invii o firme con esito KO": "Deliveries or signatures failed",
  "Noleggi con handover in giornata": "Rentals with handover today",
  "Veicoli attesi al rientro oggi": "Vehicles expected back today",
  "Da inviare": "To send",
  "Inviati oggi": "Sent today",
  "Firmati": "Signed",
  "In errore": "In error",
  "Elenco contratti": "Contract list",
  "Timeline operativa": "Operational timeline",
  "Nessun contratto trovato.": "No contract found.",
  "Nessun evento recente.": "No recent event.",
  "Monitoraggio operativo contratti, invii multicanale e collegamenti rapidi con booking/clienti.": "Operational contract monitoring, multichannel deliveries and quick links to booking/customers.",
  "Prenotazione: tutti": "Booking: all",
  "Control Booking": "Booking Control",
  "Prenotazione selezionata": "Selected booking",
  "Transizione stato": "Status transition",
  "Contratto operativo": "Operational contract",
  "Stato documento": "Document status",
  "Email cliente": "Customer email",
  "Titolo contratto": "Contract title",
  "Oggetto email": "Email subject",
  "Corpo email": "Email body",
  "Contenuto contratto": "Contract content",
  "Nessuna consegna.": "No delivery.",
  "Nessun evento.": "No event.",
  "Workflow contratto noleggio": "Rental contract workflow",
  "Aggiornamento operativo": "Operational update",
  "Timeline": "Timeline",
  "Nessuna nota disponibile.": "No note available.",
  "Anagrafica Cliente & Documenti": "Customer Registry & Documents",
  "Carica documenti cliente (PDF/JPG/PNG)": "Upload customer documents (PDF/JPG/PNG)",
  "Documenti salvati": "Saved documents",
  "Nessun documento.": "No document.",
  "Prenotazione": "Booking",
  "Nuova prenotazione da calendario": "New booking from calendar",
  "Modifica prenotazione": "Edit booking",
  "Veicolo (targa/modello/sede)": "Vehicle (plate/model/site)",
  "Cliente non trovato.": "Customer not found.",
  "Listino noleggio": "Rental price list",
  "Pacchetto km": "Km package",
  "Nessun pacchetto": "No package",
  "Tariffario km extra": "Extra km pricing",
  "Nessuna policy": "No policy",
  "Km stimati": "Estimated km",
  "Km reali (consuntivo)": "Actual km (final)",
  "Totale previsto (EUR)": "Expected total (EUR)",
  "Data/ora uscita": "Pickup date/time",
  "Data/ora rientro": "Return date/time",
  "Km all'uscita": "Pickup km",
  "Km al rientro": "Return km",
  "Luogo uscita": "Pickup location",
  "Luogo rientro": "Return location",
  "Listini attivi": "Active price lists",
  "Pacchetti km inclusi": "Included km packages",
  "Nome pacchetto": "Package name",
  "Tipo": "Type",
  "Codice": "Code",
  "Km inclusi": "Included km",
  "Scope km": "Km scope",
  "Ordine": "Order",
  "Non attivo": "Inactive",
  "Nessun pacchetto.": "No package.",
  "Nome tariffario": "Policy name",
  "Tutti i pacchetti": "All packages",
  "Prezzo €/km extra": "Extra €/km price",
  "Scaglioni (uno per riga)": "Tiers (one per row)",
  "Nessun tariffario km extra.": "No extra km policy.",
  "Eccedenza oraria": "Hourly overage",
  "Nessun addebito extra": "No extra charge",
  "Mezza giornata": "Half day",
  "Giornata intera": "Full day",
  "Validita da": "Valid from",
  "Validita fino a": "Valid until",
  "Priorita": "Priority",
  "Email": "Email",
  "Telefono": "Phone",
  "Ruolo": "Role"
};

const PLACEHOLDER_TRANSLATIONS_IT_EN: Record<string, string> = {
  "nome@azienda.com": "name@company.com",
  "Es. Fleetum Italia": "E.g. Fleetum Italy",
  "11 cifre": "11 digits",
  "SRL, SPA, ditta individuale...": "LLC, corporation, sole proprietorship...",
  "Opzionale": "Optional",
  "info@azienda.com": "info@company.com",
  "https://azienda.it": "https://company.com",
  "Via, numero civico": "Street, building number",
  "Comune": "City",
  "pec@azienda.it": "pec@company.com",
  "7 caratteri": "7 characters",
  "admin@azienda.com": "admin@company.com",
  "Min. 8 caratteri, maiuscola, numero e simbolo": "Min. 8 characters, uppercase letter, number and symbol",
  "Cerca targa, modello o cliente...": "Search plate, model or customer...",
  "Cerca": "Search"
  ,
  "Soglia km avviso": "Km warning threshold",
  "Giorni avviso revisione": "Inspection warning days",
  "Cerca per nome, ragione sociale, P.IVA, email, telefono...": "Search by name, company name, VAT, email, phone...",
  "Cerca per targa, tipo manutenzione o officina...": "Search by plate, maintenance type or workshop...",
  "Scrivi targa (es. AB123CD)": "Type plate (e.g. AB123CD)",
  "Tagliando, freni, pneumatici...": "Service, brakes, tires...",
  "Es. 125000": "E.g. 125000",
  "Es. 380.50": "E.g. 380.50",
  "Nome officina o fornitore": "Workshop or supplier name",
  "Dettaglio lavorazione effettuata": "Work details performed",
  "Cerca cliente, targa, codice booking...": "Search customer, plate, booking code...",
  "cliente@email.it": "customer@email.com",
  "Transmission ID": "Transmission ID",
  "Messaggio CARGOS": "CARGOS message",
  "Inserisci nota operativa...": "Enter operational note...",
  "Cerca cliente per nome, documento, email...": "Search customer by name, document, email...",
  "Scrivi targa o modello...": "Type plate or model...",
  "Cerca nome, ragione sociale, email, documento...": "Search name, company name, email, document...",
  "Es. 320": "E.g. 320",
  "Compila in chiusura": "Fill at closing"
};

export const translationsItEn = TRANSLATIONS_IT_EN;
export const placeholderTranslationsItEn = PLACEHOLDER_TRANSLATIONS_IT_EN;

export function getFleetumLanguage(): FleetumLanguage {
  if (typeof window === "undefined") return "it";
  return localStorage.getItem(FLEETUM_LANGUAGE_STORAGE_KEY) === "en" ? "en" : "it";
}

export function setFleetumLanguage(language: FleetumLanguage) {
  if (typeof window === "undefined") return;
  localStorage.setItem(FLEETUM_LANGUAGE_STORAGE_KEY, language);
  document.documentElement.lang = language;
  window.dispatchEvent(new CustomEvent(FLEETUM_LANGUAGE_EVENT, { detail: { language } }));
}

export function useFleetumLanguage() {
  const [language, setLanguageState] = useState<FleetumLanguage>(() => getFleetumLanguage());

  useEffect(() => {
    const onChange = (event: Event) => {
      const custom = event as CustomEvent<{ language?: FleetumLanguage }>;
      setLanguageState(custom.detail?.language === "en" ? "en" : "it");
    };
    window.addEventListener(FLEETUM_LANGUAGE_EVENT, onChange);
    document.documentElement.lang = language;
    return () => window.removeEventListener(FLEETUM_LANGUAGE_EVENT, onChange);
  }, [language]);

  const setLanguage = (next: FleetumLanguage) => {
    setLanguageState(next);
    setFleetumLanguage(next);
  };

  return { language, setLanguage };
}

export function translateText(value: string, language: FleetumLanguage) {
  if (language === "it") return value;
  const progressMatch = value.match(/^(\d+)% completato$/i);
  if (progressMatch) return `${progressMatch[1]}% completed`;
  const trendMatch = value.match(/^Trend (\d+)\/(\d+) · Range (.+)$/i);
  if (trendMatch) return `Trend ${trendMatch[1]}/${trendMatch[2]} · Range ${trendMatch[3]}`;
  const noTrendMatch = value.match(/^Nessun dato trend disponibile per (.+)\.$/i);
  if (noTrendMatch) return `No trend data available for ${noTrendMatch[1]}.`;
  const vehiclesMatch = value.match(/^Su (.+) veicoli noleggio$/i);
  if (vehiclesMatch) return `Out of ${vehiclesMatch[1]} rental vehicles`;
  const occupancyMatch = value.match(/^Occupazione (.+)$/i);
  if (occupancyMatch) return `Occupancy ${occupancyMatch[1]}`;
  const overdueReturnsMatch = value.match(/^(.+) rientri scaduti$/i);
  if (overdueReturnsMatch) return `${overdueReturnsMatch[1]} overdue returns`;
  const kmMissingMatch = value.match(/^Km: mancanti$/i);
  if (kmMissingMatch) return "Km: missing";
  const occupiedDaysMatch = value.match(/^(.+) gg$/i);
  if (occupiedDaysMatch) return `${occupiedDaysMatch[1]} days`;
  const revenueMatch = value.match(/^Ricavo: (.+)$/i);
  if (revenueMatch) return `Revenue: ${revenueMatch[1]}`;
  const loadMatch = value.match(/^Carico: (.+) fermi · peso (.+)$/i);
  if (loadMatch) return `Load: ${loadMatch[1]} downtime · weight ${loadMatch[2]}`;
  return TRANSLATIONS_IT_EN[value] ?? value;
}

export function reverseTranslateText(value: string) {
  const progressMatch = value.match(/^(\d+)% completed$/i);
  if (progressMatch) return `${progressMatch[1]}% completato`;
  const noTrendMatch = value.match(/^No trend data available for (.+)\.$/i);
  if (noTrendMatch) return `Nessun dato trend disponibile per ${noTrendMatch[1]}.`;
  const vehiclesMatch = value.match(/^Out of (.+) rental vehicles$/i);
  if (vehiclesMatch) return `Su ${vehiclesMatch[1]} veicoli noleggio`;
  const occupancyMatch = value.match(/^Occupancy (.+)$/i);
  if (occupancyMatch) return `Occupazione ${occupancyMatch[1]}`;
  const overdueReturnsMatch = value.match(/^(.+) overdue returns$/i);
  if (overdueReturnsMatch) return `${overdueReturnsMatch[1]} rientri scaduti`;
  const kmMissingMatch = value.match(/^Km: missing$/i);
  if (kmMissingMatch) return "Km: mancanti";
  const occupiedDaysMatch = value.match(/^(.+) days$/i);
  if (occupiedDaysMatch) return `${occupiedDaysMatch[1]} gg`;
  const revenueMatch = value.match(/^Revenue: (.+)$/i);
  if (revenueMatch) return `Ricavo: ${revenueMatch[1]}`;
  const loadMatch = value.match(/^Load: (.+) downtime · weight (.+)$/i);
  if (loadMatch) return `Carico: ${loadMatch[1]} fermi · peso ${loadMatch[2]}`;
  for (const [it, en] of Object.entries(TRANSLATIONS_IT_EN)) {
    if (en === value) return it;
  }
  return value;
}

export function translatePlaceholder(value: string, language: FleetumLanguage) {
  if (language === "it") return value;
  return PLACEHOLDER_TRANSLATIONS_IT_EN[value] ?? value;
}

export function reverseTranslatePlaceholder(value: string) {
  for (const [it, en] of Object.entries(PLACEHOLDER_TRANSLATIONS_IT_EN)) {
    if (en === value) return it;
  }
  return value;
}
