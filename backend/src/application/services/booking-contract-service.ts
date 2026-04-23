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
  name: "Template contratto enterprise",
  content: [
    "CONTRATTO DI NOLEGGIO VEICOLO SENZA CONDUCENTE",
    "",
    "Riferimento contratto: {{booking.code}}",
    "Tipo intestatario: {{customer.type}}",
    "Cliente: {{customer.fullName}} · CF {{customer.taxCode}}",
    "Contatti cliente: {{customer.email}} · {{customer.phone}}",
    "Documento: {{customer.documentNumber}} · Patente: {{customer.drivingLicenseNumber}}",
    "Residenza: {{customer.residenceAddress}}",
    "Societa: {{company.name}} · P.IVA {{company.vat}} · CF {{company.taxCode}}",
    "Sede legale: {{company.address}}",
    "PEC/SDI/REA: {{company.pec}} · {{company.sdi}} · {{company.rea}}",
    "Legale rappresentante: {{company.legalRepFullName}} · CF {{company.legalRepTaxCode}}",
    "",
    "Veicolo: {{vehicle.brand}} {{vehicle.model}} - {{vehicle.plate}}",
    "Ritiro: {{booking.pickupAt}} ({{booking.pickupLocation}})",
    "Rientro: {{booking.returnAt}} ({{booking.returnLocation}})",
    "Km uscita: {{booking.pickupKm}}",
    "Km rientro: {{booking.returnKm}}",
    "Km percorsi noleggio: {{booking.kmDriven}}",
    "Listino: {{pricing.priceListName}}",
    "Pacchetto km: {{pricing.pricePackageName}}",
    "Policy km extra: {{pricing.extraKmPolicyName}}",
    "Km stimati: {{pricing.estimatedKm}}",
    "Km inclusi: {{pricing.includedKmTotal}}",
    "",
    "Totale previsto: {{pricing.expectedTotal}}",
    "Totale finale: {{pricing.finalTotal}}",
    "",
    "CONDIZIONI PRINCIPALI",
    "1) Oggetto. Il Locatore concede in noleggio il veicolo sopra indicato per il periodo concordato.",
    "2) Utilizzo. Il Cliente deve utilizzare il veicolo con la diligenza del buon padre di famiglia e nel rispetto del Codice della Strada.",
    "3) Divieti. E vietata la sublocazione e la guida a soggetti non autorizzati nel contratto.",
    "4) Responsabilita. Il Cliente risponde di danni, multe, pedaggi e oneri derivanti da utilizzo improprio del veicolo.",
    "5) Riconsegna. Il veicolo deve essere riconsegnato presso la sede concordata, nella data/ora contrattuale, salvo proroga autorizzata.",
    "6) Km extra. Eventuali eccedenze chilometriche sono addebitate secondo listino e policy km extra associata alla prenotazione.",
    "7) Privacy. I dati personali sono trattati per finalita operative, amministrative e di legge, secondo informativa privacy vigente.",
    "8) Foro competente. Per ogni controversia e competente il foro previsto dalla documentazione contrattuale del Locatore.",
    "",
    "Firma cliente: ______________________",
    "Firma operatore: ____________________"
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
