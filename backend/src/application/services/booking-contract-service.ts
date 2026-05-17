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
    "CONTRATTO DI NOLEGGIO VEICOLO SENZA CONDUCENTE",
    "",
    "Riferimento contratto: {{booking.code}}",
    "Il presente contratto disciplina il noleggio senza conducente del veicolo indicato, con consegna temporanea dal Locatore al Cliente/Intestatario e con guida consentita esclusivamente ai conducenti autorizzati.",
    "",
    "1. PARTI DEL CONTRATTO",
    "Locatore: società proprietaria o avente disponibilità del veicolo, identificata nei dati aziendali riportati in intestazione del PDF.",
    "Tipo intestatario cliente: {{customer.type}}",
    "Persona fisica: {{customer.fullName}} · CF {{customer.taxCode}} · Documento {{customer.documentNumber}} · Patente {{customer.drivingLicenseNumber}}",
    "Persona giuridica: {{company.name}} · P.IVA {{company.vat}} · CF {{company.taxCode}} · Sede {{company.address}} · PEC/SDI/REA {{company.pec}} / {{company.sdi}} / {{company.rea}}",
    "Legale rappresentante/referente società: {{company.legalRepFullName}} · CF {{company.legalRepTaxCode}}",
    "Contatti operativi cliente: {{customer.email}} · {{customer.phone}}",
    "",
    "2. CONDUCENTI AUTORIZZATI",
    "Il conducente principale è il cliente persona fisica indicato sopra oppure, in caso di persona giuridica, il referente/legale rappresentante o altro soggetto fisico autorizzato e identificato dal Locatore prima della consegna.",
    "Eventuali conducenti aggiuntivi devono essere comunicati al Locatore, identificati con documento e patente validi, e autorizzati prima dell'utilizzo del veicolo.",
    "È vietata la guida da parte di soggetti non autorizzati, privi di patente valida o non conformi ai requisiti assicurativi e contrattuali.",
    "",
    "3. VEICOLO, PERIODO E LUOGHI DI NOLEGGIO",
    "Veicolo: {{vehicle.brand}} {{vehicle.model}} - targa {{vehicle.plate}}",
    "Uscita/ritiro: {{booking.pickupAt}} presso {{booking.pickupLocation}}",
    "Rientro previsto: {{booking.returnAt}} presso {{booking.returnLocation}}",
    "Km uscita: {{booking.pickupKm}} · Km rientro: {{booking.returnKm}} · Km percorsi: {{booking.kmDriven}}",
    "",
    "4. CONDIZIONI ECONOMICHE",
    "Listino applicato: {{pricing.priceListName}}",
    "Pacchetto chilometrico: {{pricing.pricePackageName}}",
    "Regola km extra: {{pricing.extraKmPolicyName}}",
    "Km stimati: {{pricing.estimatedKm}} · Km inclusi: {{pricing.includedKmTotal}} · Extra km stimati: {{pricing.extraKmEstimated}} · Extra km reali: {{pricing.extraKmActual}}",
    "Totale previsto: {{pricing.expectedTotal}}",
    "Totale finale/consuntivo: {{pricing.finalTotal}}",
    "Eventuali importi non determinabili al momento della firma, incluse eccedenze chilometriche, danni, carburante, penali, multe, pedaggi, franchigie o servizi extra, saranno calcolati e addebitati secondo listino, verbali, documentazione fotografica e condizioni accettate.",
    "",
    "5. CONSEGNA, VERIFICA E RICONSEGNA",
    "Alla consegna il Cliente dichiara di ricevere il veicolo in stato idoneo all'uso, salvo difformità annotate nei documenti di consegna, foto, check-in o verbale operativo.",
    "Il Cliente si obbliga a riconsegnare il veicolo nel luogo e nell'orario concordati, con documenti, chiavi, accessori, dotazioni e stato coerenti con la consegna, salvo normale usura.",
    "Ritardi, riconsegne fuori sede o mancata disponibilità del veicolo possono generare addebiti aggiuntivi secondo listino e danno operativo documentato.",
    "",
    "6. OBBLIGHI DI UTILIZZO",
    "Il veicolo deve essere utilizzato con diligenza, nel rispetto del Codice della Strada, delle norme applicabili, dei limiti assicurativi e delle istruzioni ricevute dal Locatore.",
    "Sono vietati subnoleggio, uso per gare, traino non autorizzato, trasporto illecito, sovraccarico, guida sotto effetto di alcol/stupefacenti, uso fuori dai Paesi o aree consentite e ogni impiego non conforme.",
    "Il Cliente risponde per danni, sottrazioni, perdita chiavi/documenti, multe, pedaggi, parcheggi, sanzioni, costi amministrativi e oneri derivanti dall'utilizzo del veicolo durante il periodo di disponibilità.",
    "",
    "7. SINISTRI, FURTO, GUASTI E ASSISTENZA",
    "In caso di sinistro, furto, tentato furto, guasto, fermo, spia anomala o evento dannoso, il Cliente deve informare immediatamente il Locatore e seguire le istruzioni ricevute.",
    "Il Cliente deve raccogliere documentazione utile, inclusi dati delle controparti, denuncia quando richiesta, constatazione amichevole se applicabile, foto, luogo, data e ora dell'evento.",
    "Omissioni, ritardi nella comunicazione o utilizzo del veicolo dopo un'anomalia possono comportare responsabilità e addebiti a carico del Cliente.",
    "",
    "8. CARBURANTE, ENERGIA, PULIZIA E DOTAZIONI",
    "Il veicolo deve essere riconsegnato con livello carburante/energia, pulizia e dotazioni coerenti con la consegna o secondo quanto previsto dal listino applicato.",
    "Differenze, mancanze, ripristini, sanificazioni, lavaggi straordinari o reintegri potranno essere addebitati al Cliente.",
    "",
    "9. TRATTAMENTO DATI, COMUNICAZIONI E ADEMPIMENTI",
    "Il Cliente prende atto che i dati personali, documentali, contrattuali e di utilizzo sono trattati per gestione noleggio, amministrazione, sicurezza, tutela diritti, obblighi normativi e comunicazioni operative.",
    "Il Cliente autorizza l'utilizzo dei recapiti indicati per comunicazioni relative a prenotazione, contratto, pagamenti, rientro, sinistri, documenti e adempimenti connessi.",
    "Quando previsto, i dati necessari potranno essere trattati o comunicati per obblighi verso autorità competenti, sistemi pubblici o adempimenti di pubblica sicurezza.",
    "",
    "10. FIRMA, ACCETTAZIONE E CLAUSOLE",
    "La sottoscrizione cartacea, digitale, grafometrica, OTP o equivalente conferma presa visione e accettazione del contratto, delle condizioni economiche, delle regole di utilizzo, delle responsabilità e degli allegati richiamati.",
    "Il Cliente dichiara che i dati forniti sono corretti, che i documenti esibiti sono validi e che i conducenti autorizzati sono idonei alla guida del veicolo.",
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
