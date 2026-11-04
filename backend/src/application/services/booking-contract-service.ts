type BookingTemplateContext = {
  booking: {
    code: string;
    pickupAt?: Date | string | null;
    returnAt?: Date | string | null;
    pickupLocation?: string | null;
    returnLocation?: string | null;
    pickupKm?: number | null;
    returnKm?: number | null;
    kmDriven?: number | null;
  };
  customer: {
    type?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    phone?: string | null;
    documentNumber?: string | null;
    drivingLicenseNumber?: string | null;
    taxCode?: string | null;
    residenceAddress?: string | null;
    companyName?: string | null;
    companyVat?: string | null;
    companyTaxCode?: string | null;
    companyAddress?: string | null;
    companyPec?: string | null;
    companySdi?: string | null;
    companyRea?: string | null;
    companyLegalRepFullName?: string | null;
    companyLegalRepTaxCode?: string | null;
  };
  vehicle: {
    plate?: string | null;
    brand?: string | null;
    model?: string | null;
  };
  pricing: {
    expectedTotal?: number | null;
    finalTotal?: number | null;
    priceListName?: string | null;
    pricePackageName?: string | null;
    extraKmPolicyName?: string | null;
    estimatedKm?: number | null;
    actualKm?: number | null;
    includedKmTotal?: number | null;
    extraKmEstimated?: number | null;
    extraKmActual?: number | null;
  };
};

const formatDateTime = (value?: Date | string | null) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
};

const formatMoney = (value?: number | null) => {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";
  return `${new Intl.NumberFormat("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} EUR`;
};

const formatNumber = (value?: number | null, suffix = "") => {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";
  return `${new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 }).format(value)}${suffix}`;
};

const normalize = (value?: string | null) => (value ?? "").trim();

export const buildContractTemplateMap = (context: BookingTemplateContext) => {
  const customerName = [normalize(context.customer.firstName), normalize(context.customer.lastName)].filter(Boolean).join(" ").trim();
  const customerType = normalize(context.customer.type) || "PERSONA_FISICA";
  return {
    "booking.code": context.booking.code,
    "booking.pickupAt": formatDateTime(context.booking.pickupAt),
    "booking.returnAt": formatDateTime(context.booking.returnAt),
    "booking.pickupLocation": normalize(context.booking.pickupLocation) || "-",
    "booking.returnLocation": normalize(context.booking.returnLocation) || "-",
    "booking.pickupKm": formatNumber(context.booking.pickupKm, " km"),
    "booking.returnKm": formatNumber(context.booking.returnKm, " km"),
    "booking.kmDriven": formatNumber(context.booking.kmDriven, " km"),
    "customer.type": customerType,
    "customer.firstName": normalize(context.customer.firstName) || "-",
    "customer.lastName": normalize(context.customer.lastName) || "-",
    "customer.fullName": customerName || "-",
    "customer.email": normalize(context.customer.email) || "-",
    "customer.phone": normalize(context.customer.phone) || "-",
    "customer.documentNumber": normalize(context.customer.documentNumber) || "-",
    "customer.drivingLicenseNumber": normalize(context.customer.drivingLicenseNumber) || "-",
    "customer.taxCode": normalize(context.customer.taxCode) || "-",
    "customer.residenceAddress": normalize(context.customer.residenceAddress) || "-",
    "company.name": normalize(context.customer.companyName) || "-",
    "company.vat": normalize(context.customer.companyVat) || "-",
    "company.taxCode": normalize(context.customer.companyTaxCode) || "-",
    "company.address": normalize(context.customer.companyAddress) || "-",
    "company.pec": normalize(context.customer.companyPec) || "-",
    "company.sdi": normalize(context.customer.companySdi) || "-",
    "company.rea": normalize(context.customer.companyRea) || "-",
    "company.legalRepFullName": normalize(context.customer.companyLegalRepFullName) || "-",
    "company.legalRepTaxCode": normalize(context.customer.companyLegalRepTaxCode) || "-",
    "vehicle.plate": normalize(context.vehicle.plate) || "-",
    "vehicle.brand": normalize(context.vehicle.brand) || "-",
    "vehicle.model": normalize(context.vehicle.model) || "-",
    "pricing.expectedTotal": formatMoney(context.pricing.expectedTotal),
    "pricing.finalTotal": formatMoney(context.pricing.finalTotal),
    "pricing.priceListName": normalize(context.pricing.priceListName) || "-",
    "pricing.pricePackageName": normalize(context.pricing.pricePackageName) || "-",
    "pricing.extraKmPolicyName": normalize(context.pricing.extraKmPolicyName) || "-",
    "pricing.estimatedKm": formatNumber(context.pricing.estimatedKm, " km"),
    "pricing.actualKm": formatNumber(context.pricing.actualKm, " km"),
    "pricing.includedKmTotal": formatNumber(context.pricing.includedKmTotal, " km"),
    "pricing.extraKmEstimated": formatNumber(context.pricing.extraKmEstimated, " km"),
    "pricing.extraKmActual": formatNumber(context.pricing.extraKmActual, " km")
  } as const;
};

export const sanitizeTemplateInput = (raw: string) => {
  return raw
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\son\w+='[^']*'/gi, "")
    .replace(/javascript:/gi, "")
    .trim();
};

export const renderContractTemplate = (template: string, dictionary: Record<string, string>) => {
  const safeTemplate = sanitizeTemplateInput(template);
  return safeTemplate.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_match, token: string) => {
    const key = token.trim();
    return dictionary[key] ?? "";
  });
};

export const defaultContractTemplate = () => ({
  name: "Template contratto noleggio enterprise",
  content: [
    "CONDIZIONI GENERALI DEL NOLEGGIO SENZA CONDUCENTE",
    "Riferimento prenotazione: {{booking.code}}",
    "",
    "1. PARTI E DOCUMENTI DEL CONTRATTO",
    "Locatore, intestatario, eventuale rappresentante, conducenti, veicolo, periodo e luoghi sono identificati nelle sezioni specifiche di questo documento. Le condizioni economiche concordate e le regole operative riportate nel riepilogo ne fanno parte. Eventuali divergenze devono essere chiarite prima della sottoscrizione.",
    "",
    "2. CONDUCENTI AUTORIZZATI",
    "I conducenti autorizzati sono esclusivamente le persone fisiche identificate nella sezione Conducenti autorizzati. L’intestatario e il legale rappresentante non sono automaticamente autorizzati alla guida. Il Locatore verifica documenti, validità e categoria della patente, nonché i requisiti previsti per il veicolo e dalle coperture concordate, prima della consegna.",
    "L’aggiunta o sostituzione di un conducente richiede identificazione e accordo documentato prima della guida; non modifica retroattivamente un documento già sottoscritto.",
    "",
    "3. VEICOLO, DURATA E TERRITORIO",
    "Il veicolo è concesso temporaneamente senza conducente per il periodo e nei luoghi indicati. Il Cliente lo utilizza con diligenza, nel rispetto del Codice della strada, della destinazione d’uso e del territorio consentito. Gare, subnoleggio, traino non autorizzato, uso illecito e guida senza i requisiti richiesti non sono consentiti.",
    "",
    "4. PREZZO E PAGAMENTO",
    "Importi, IVA, sconti, chilometri inclusi, condizioni degli extra e modalità di pagamento sono quelli espressamente concordati e riportati nel documento e nel preventivo richiamato. Un valore non compilato non equivale a zero. Gli importi consuntivi non ancora determinati devono essere documentati e comunicati prima della relativa richiesta, secondo gli accordi e la normativa applicabile.",
    "",
    "5. CAUZIONE, COPERTURE E FRANCHIGIE",
    "Cauzione, coperture, esclusioni e franchigie sono indicate nelle condizioni specifiche. La cauzione è distinta dal corrispettivo del noleggio; la sua indicazione non attesta un incasso né autorizza di per sé un addebito. Modalità di costituzione, eventuali trattenute motivate e svincolo seguono l’accordo di pagamento e la documentazione dell’evento. Una franchigia non costituisce un addebito automatico.",
    "",
    "6. CONSEGNA E VERBALE",
    "Alla consegna le parti verificano condizioni del veicolo, danni preesistenti, chilometraggio, carburante o carica, dotazioni, chiavi e documenti. Le risultanze e le eventuali contestazioni sono riportate nel verbale e nelle fotografie associate. La firma di questo contratto prima del ritiro non attesta la futura consegna né l’assenza di difetti non ancora verificati.",
    "",
    "7. RICONSEGNA, RITARDI E PROROGHE",
    "Il Cliente riconsegna il veicolo nel luogo e all’orario concordati, con le dotazioni ricevute. Il confronto avviene rispetto al verbale iniziale, tenendo conto della normale usura. Proroghe, rientri in altra sede e ritardi sono gestiti secondo le condizioni specifiche; il Cliente contatta il Locatore prima della scadenza ove possibile. Eventuali differenze sono descritte e documentate, con possibilità di osservazioni del Cliente.",
    "",
    "8. CARBURANTE, RICARICA E CHILOMETRI",
    "Livelli iniziali e finali, chilometri e criteri di rifornimento o ricarica sono rilevati nei verbali. Eccedenze, servizi o differenze possono essere richiesti soltanto secondo le condizioni concordate e con il relativo riscontro, senza duplicare importi già compresi nel prezzo.",
    "",
    "9. SINISTRI, FURTO E ASSISTENZA",
    "In caso di incidente, furto, guasto o anomalia, il Cliente mette in sicurezza le persone e il veicolo, avvisa tempestivamente il Locatore ai contatti di assistenza indicati e segue le istruzioni ricevute, ferme le comunicazioni alle autorità quando richieste. Raccoglie, ove possibile e in sicurezza, dati utili, fotografie e documentazione dell’evento. Responsabilità, coperture ed eventuali esclusioni sono valutate secondo i fatti documentati, gli accordi e la normativa applicabile.",
    "",
    "10. ANNULLAMENTO E MANCATO RITIRO",
    "Condizioni, termini ed eventuali importi applicabili sono quelli specificamente comunicati e concordati prima della prenotazione, riportati nelle condizioni specifiche. Restano fermi i diritti inderogabili del Cliente. Non si applicano importi o termini non espressamente determinati nel relativo accordo.",
    "",
    "11. DATI PERSONALI E COMUNICAZIONI",
    "Il Locatore fornisce separatamente l’informativa sul trattamento dei dati, indicando titolare, finalità, basi giuridiche, destinatari, conservazione e diritti. I recapiti possono essere utilizzati per le comunicazioni necessarie al noleggio e agli adempimenti previsti. Gli eventuali obblighi di pubblica sicurezza sono gestiti dal Locatore. La firma del contratto non costituisce consenso a comunicazioni promozionali.",
    "",
    "12. ALLEGATI E MODIFICHE",
    "L’elenco dei documenti richiamati identifica quelli previsti per la pratica; la loro effettiva consegna e accettazione devono essere verificate separatamente. Un elenco non equivale alla consegna dei file. Modifiche successive e nuovi accordi sono documentati in una nuova versione, mantenendo disponibile quella già sottoscritta.",
    "",
    "13. SOTTOSCRIZIONE E APPROVAZIONI SPECIFICHE",
    "La sottoscrizione riguarda questa esatta versione del documento. La conferma tramite codice email viene registrata insieme all’impronta del PDF; non è descritta come firma qualificata o avanzata. Le clausole che richiedono una specifica approvazione devono essere individuate e gestite separatamente prima dell’utilizzo del modello. Il Cliente può chiedere chiarimenti prima di firmare e riceve copia del documento sottoscritto."
  ].join("\n"),
  emailSubject: "Contratto noleggio {{booking.code}}",
  emailBody: [
    "Gentile {{customer.fullName}},",
    "",
    "in allegato trova il contratto relativo alla prenotazione {{booking.code}}.",
    "",
    "Cordiali saluti,"
  ].join("\n")
});

const escapePdfText = (text: string) =>
  text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

export const buildSimplePdfBuffer = (title: string, body: string) => {
  const rawLines = [title, "", ...body.split("\n")].map((line) => line.replace(/\s+/g, " ").trim());
  const wrappedLines: string[] = [];
  const maxCharsPerLine = 96;

  for (const rawLine of rawLines) {
    if (!rawLine) {
      wrappedLines.push("");
      continue;
    }
    if (rawLine.length <= maxCharsPerLine) {
      wrappedLines.push(rawLine);
      continue;
    }

    const words = rawLine.split(" ");
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length <= maxCharsPerLine) {
        current = candidate;
      } else {
        wrappedLines.push(current);
        current = word;
      }
    }
    if (current) wrappedLines.push(current);
  }

  const lines = wrappedLines.slice(0, 56);
  const streamText = [
    "BT",
    "/F1 10 Tf",
    "12 TL",
    "48 804 Td",
    ...lines
      .map((line, idx) => `${idx === 0 ? "" : "T* "}( ${escapePdfText(line)} ) Tj`)
      .map((x) => x.trim()),
    "ET"
  ].join("\n");

  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n",
    `4 0 obj\n<< /Length ${Buffer.byteLength(streamText, "utf8")} >>\nstream\n${streamText}\nendstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n"
  ];
  const header = "%PDF-1.4\n";
  const offsets: number[] = [];
  let cursor = header.length;
  objects.forEach((obj) => {
    offsets.push(cursor);
    cursor += obj.length;
  });
  const xrefStart = cursor;
  const xref =
    `xref\n0 ${objects.length + 1}\n` +
    "0000000000 65535 f \n" +
    offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(header + objects.join("") + xref + trailer, "utf8");
};
