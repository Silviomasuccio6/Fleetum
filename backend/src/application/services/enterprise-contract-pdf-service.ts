import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";

type ContractBranding = {
  companyName?: string | null;
  companyAddress?: string | null;
  companyVat?: string | null;
  companyEmail?: string | null;
  companyPhone?: string | null;
  logoFilePath?: string | null;
  logoFileName?: string | null;
  brandPrimary?: string | null;
  brandAccent?: string | null;
  brandFont?: string | null;
};

type EnterpriseContractPdfInput = {
  contract: {
    title: string;
    content: string;
    status?: string | null;
    templateVersion?: number | null;
    emailTo?: string | null;
    createdAt?: Date | string | null;
    updatedAt?: Date | string | null;
    lastSentAt?: Date | string | null;
    signedAt?: Date | string | null;
    latestDelivery?: {
      channel?: string | null;
      recipient?: string | null;
      status?: string | null;
      sentAt?: Date | string | null;
      createdAt?: Date | string | null;
      errorMessage?: string | null;
    } | null;
    signatureFilePath?: string | null;
    signatureMimeType?: string | null;
    signatureSizeBytes?: number | null;
  };
  booking: {
    code: string;
    status: string;
    contractStatus: string;
    customerName: string;
    customerEmail?: string | null;
    customerPhone?: string | null;
    customerDocument?: string | null;
    pickupAt: Date;
    returnAt: Date;
    pickupLocation?: string | null;
    returnLocation?: string | null;
    pickupKm?: number | null;
    returnKm?: number | null;
    expectedTotal?: number | null;
    finalTotal?: number | null;
    contractSignedAt?: Date | string | null;
    vehicle?: {
      plate?: string | null;
      brand?: string | null;
      model?: string | null;
    } | null;
    customer?: {
      customerType?: string | null;
      firstName?: string | null;
      lastName?: string | null;
      email?: string | null;
      phone?: string | null;
      drivingLicenseNumber?: string | null;
      drivingLicenseIssuedAt?: Date | string | null;
      drivingLicenseExpiresAt?: Date | string | null;
      drivingLicenseAuthority?: string | null;
      drivingLicenseCategory?: string | null;
      taxCode?: string | null;
      dateOfBirth?: Date | string | null;
      placeOfBirth?: string | null;
      nationality?: string | null;
      documentType?: string | null;
      documentNumber?: string | null;
      documentIssuedAt?: Date | string | null;
      documentExpiresAt?: Date | string | null;
      documentAuthority?: string | null;
      residenceAddress?: string | null;
      companyName?: string | null;
      companyLegalForm?: string | null;
      companyVatNumber?: string | null;
      companyTaxCode?: string | null;
      companyLegalAddress?: string | null;
      companyPec?: string | null;
      companySdi?: string | null;
      companyRea?: string | null;
      legalRepFirstName?: string | null;
      legalRepLastName?: string | null;
      legalRepTaxCode?: string | null;
      legalRepRole?: string | null;
      legalRepEmail?: string | null;
      legalRepPhone?: string | null;
    } | null;
    pricingSnapshot?: {
      priceListName?: string | null;
      pricePackageName?: string | null;
      extraKmPolicyName?: string | null;
      baseRateUnit?: string | null;
      baseRateAmount?: number | null;
      vatRate?: number | null;
      discountPercent?: number | null;
      hourOverflowRule?: string | null;
      estimatedKm?: number | null;
      actualKm?: number | null;
      includedKmTotal?: number | null;
      extraKmEstimated?: number | null;
      extraKmActual?: number | null;
      extraKmEstimatedCost?: number | null;
      extraKmActualCost?: number | null;
      daysCharged?: number | null;
      expectedSubtotal?: number | null;
      expectedTaxAmount?: number | null;
      expectedTotal?: number | null;
      finalSubtotal?: number | null;
      finalTaxAmount?: number | null;
      finalTotal?: number | null;
      notes?: string | null;
    } | null;
  };
  branding?: ContractBranding | null;
};

type InfoItem = { label: string; value: string; emphasize?: boolean };

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN_X = 42;
const MARGIN_BOTTOM = 54;

const BOOKING_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Bozza",
  QUOTED: "Preventivo",
  HOLD: "Opzione",
  CONFIRMED: "Confermata",
  CONTRACT_SIGNED: "Contratto firmato",
  READY_FOR_HANDOVER: "Pronta consegna",
  IN_RENT: "In noleggio",
  CLOSED: "Chiusa",
  CANCELED: "Annullata",
  NO_SHOW: "No-show"
};

const CONTRACT_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Bozza",
  READY: "Pronto",
  SENT: "Inviato",
  SIGNED: "Firmato",
  ERROR: "Errore",
  NOT_READY: "Non pronto"
};

const DELIVERY_CHANNEL_LABELS: Record<string, string> = {
  EMAIL: "Email",
  WHATSAPP: "WhatsApp"
};

const DELIVERY_STATUS_LABELS: Record<string, string> = {
  PENDING: "In coda",
  SENT: "Inviato",
  FAILED: "Errore"
};

const BASE_RATE_UNIT_LABELS: Record<string, string> = {
  DAILY: "Giornaliera",
  WEEKLY: "Settimanale",
  MONTHLY: "Mensile"
};

const OVERFLOW_RULE_LABELS: Record<string, string> = {
  HALF_DAY: "Mezza giornata",
  FULL_DAY: "Giornata intera",
  PRO_RATA: "Pro-rata"
};

const asText = (value?: string | null, fallback: string | null = "-") => {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized || String(fallback ?? "-");
};

const safeDate = (value?: Date | string | null) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDate = (value?: Date | string | null) => {
  const parsed = safeDate(value);
  if (!parsed) return "-";
  return parsed.toLocaleDateString("it-IT");
};

const formatDateTime = (value?: Date | string | null) => {
  const parsed = safeDate(value);
  if (!parsed) return "-";
  return parsed.toLocaleString("it-IT", {
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

const formatNumber = (value?: number | null, digits = 0) => {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";
  return new Intl.NumberFormat("it-IT", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
};

const sanitizeHex = (value?: string | null, fallback = "#21375d") => {
  const normalized = String(value ?? "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized : fallback;
};

const hexToRgb = (hex: string) => {
  const value = sanitizeHex(hex).slice(1);
  return rgb(
    parseInt(value.slice(0, 2), 16) / 255,
    parseInt(value.slice(2, 4), 16) / 255,
    parseInt(value.slice(4, 6), 16) / 255
  );
};

const labelOf = (dictionary: Record<string, string>, raw?: string | null) => {
  const key = String(raw ?? "").trim().toUpperCase();
  if (!key) return "-";
  return dictionary[key] ?? key.replace(/_/g, " ");
};

const wrapLines = (text: string, maxWidth: number, font: PDFFont, fontSize: number) => {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [""];
  const words = normalized.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines;
};

const maybeEmbedLogo = async (pdfDoc: PDFDocument, logoFilePath?: string | null): Promise<PDFImage | null> => {
  if (!logoFilePath) return null;
  try {
    const absolutePath = path.resolve(process.cwd(), logoFilePath);
    const image = await fs.readFile(absolutePath);
    const extension = path.extname(logoFilePath).toLowerCase();
    if (extension === ".png") return pdfDoc.embedPng(image);
    if (extension === ".jpg" || extension === ".jpeg") return pdfDoc.embedJpg(image);
    return null;
  } catch {
    return null;
  }
};

const contractSummaryClauses = (content: string) => {
  const lines = content
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const extracted = lines.filter((line) => /^\d+[\).]|^art\.?\s*\d+/i.test(line)).slice(0, 8);
  if (extracted.length > 0) return extracted;
  return lines.slice(0, 7);
};

const fullCustomerName = (input: EnterpriseContractPdfInput["booking"]) => {
  const first = asText(input.customer?.firstName, "");
  const last = asText(input.customer?.lastName, "");
  return `${first} ${last}`.trim() || asText(input.customerName);
};

const isCorporateCustomer = (input: EnterpriseContractPdfInput["booking"]) =>
  input.customer?.customerType === "PERSONA_GIURIDICA";

const kmTravelled = (pickupKm?: number | null, returnKm?: number | null) => {
  if (typeof pickupKm !== "number" || typeof returnKm !== "number") return null;
  const diff = returnKm - pickupKm;
  return diff >= 0 ? diff : null;
};

const rentalDurationText = (pickupAt: Date | string, returnAt: Date | string) => {
  const pickup = safeDate(pickupAt);
  const dropoff = safeDate(returnAt);
  if (!pickup || !dropoff) return "-";
  const diffMs = Math.max(0, dropoff.getTime() - pickup.getTime());
  const hours = diffMs / (1000 * 60 * 60);
  const days = hours / 24;
  return `${formatNumber(days, 2)} gg · ${formatNumber(hours, 1)} h`;
};

const normalizeMultiline = (content: string) =>
  content
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");

export const buildEnterpriseContractPdf = async (input: EnterpriseContractPdfInput): Promise<Buffer> => {
  const primaryHex = sanitizeHex(input.branding?.brandPrimary, "#1f3763");
  const accentHex = sanitizeHex(input.branding?.brandAccent, "#5b8bd9");
  const titleFontFamily = String(input.branding?.brandFont ?? "helvetica").toLowerCase();

  const pdfDoc = await PDFDocument.create();
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont =
    titleFontFamily === "times"
      ? await pdfDoc.embedFont(StandardFonts.TimesRomanBold)
      : await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const headingFont =
    titleFontFamily === "times"
      ? await pdfDoc.embedFont(StandardFonts.TimesRoman)
      : await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const companyName = asText(input.branding?.companyName, "Fleet Ops Suite");
  const companyAddress = asText(input.branding?.companyAddress, "Via Demo 1, 00100 Roma");
  const companyVat = asText(input.branding?.companyVat, "P.IVA 00000000000");
  const companyEmail = asText(input.branding?.companyEmail, "info@fleetops.demo");
  const companyPhone = asText(input.branding?.companyPhone, "Tel. +39 000 0000000");

  const pages: PDFPage[] = [];
  const addFooter = (page: PDFPage, pageNumber: number, totalPages: number) => {
    page.drawLine({
      start: { x: MARGIN_X, y: 38 },
      end: { x: PAGE_W - MARGIN_X, y: 38 },
      thickness: 0.6,
      color: hexToRgb("#d2daea")
    });
    page.drawText(`${companyName} · ${companyVat}`, {
      x: MARGIN_X,
      y: 24,
      size: 7.5,
      font: regularFont,
      color: hexToRgb("#5c6e8f")
    });
    page.drawText(`Pagina ${pageNumber}/${totalPages}`, {
      x: PAGE_W - MARGIN_X - 62,
      y: 24,
      size: 7.5,
      font: regularFont,
      color: hexToRgb("#5c6e8f")
    });
  };

  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  pages.push(page);
  const contentWidth = PAGE_W - MARGIN_X * 2;
  let cursorY = PAGE_H - 194;

  page.drawRectangle({ x: 0, y: PAGE_H - 142, width: PAGE_W, height: 142, color: hexToRgb(primaryHex) });
  page.drawRectangle({ x: 0, y: PAGE_H - 145, width: PAGE_W, height: 3, color: hexToRgb(accentHex) });

  const logo = await maybeEmbedLogo(pdfDoc, input.branding?.logoFilePath);
  const signatureImage = await maybeEmbedLogo(pdfDoc, input.contract.signatureFilePath);
  if (logo) {
    const targetH = 44;
    const scaled = logo.scale(targetH / logo.height);
    page.drawImage(logo, {
      x: MARGIN_X,
      y: PAGE_H - 98,
      width: scaled.width,
      height: scaled.height
    });
  }

  page.drawText(companyName, {
    x: MARGIN_X + 92,
    y: PAGE_H - 66,
    size: 16,
    font: boldFont,
    color: rgb(1, 1, 1)
  });
  page.drawText(`${companyAddress} · ${companyVat}`, {
    x: MARGIN_X + 92,
    y: PAGE_H - 84,
    size: 9,
    font: regularFont,
    color: rgb(0.93, 0.95, 1)
  });
  page.drawText(`${companyEmail} · ${companyPhone}`, {
    x: MARGIN_X + 92,
    y: PAGE_H - 98,
    size: 9,
    font: regularFont,
    color: rgb(0.93, 0.95, 1)
  });

  page.drawText("CONTRATTO DI NOLEGGIO", {
    x: MARGIN_X,
    y: PAGE_H - 164,
    size: 18,
    font: headingFont,
    color: hexToRgb(primaryHex)
  });
  page.drawText(asText(input.contract.title, "Contratto standard"), {
    x: MARGIN_X,
    y: PAGE_H - 181,
    size: 9.6,
    font: regularFont,
    color: hexToRgb("#385581")
  });

  const chipText = [
    `Booking ${asText(input.booking.code)}`,
    `Prenotazione: ${labelOf(BOOKING_STATUS_LABELS, input.booking.status)}`,
    `Contratto: ${labelOf(CONTRACT_STATUS_LABELS, input.booking.contractStatus)}`
  ].join("  ·  ");
  const chipWidth = boldFont.widthOfTextAtSize(chipText, 8.5) + 16;
  page.drawRectangle({
    x: PAGE_W - MARGIN_X - chipWidth,
    y: PAGE_H - 183,
    width: chipWidth,
    height: 17,
    color: hexToRgb("#e8eefb")
  });
  page.drawText(chipText, {
    x: PAGE_W - MARGIN_X - chipWidth + 8,
    y: PAGE_H - 177,
    size: 8.5,
    font: boldFont,
    color: hexToRgb(primaryHex)
  });

  const createContentPage = (title = "Contratto noleggio - continua") => {
    page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    pages.push(page);
    page.drawRectangle({ x: 0, y: PAGE_H - 46, width: PAGE_W, height: 46, color: hexToRgb("#f1f5ff") });
    page.drawRectangle({ x: 0, y: PAGE_H - 48, width: PAGE_W, height: 2, color: hexToRgb(accentHex) });
    page.drawText(title, {
      x: MARGIN_X,
      y: PAGE_H - 29,
      size: 11.5,
      font: boldFont,
      color: hexToRgb(primaryHex)
    });
    cursorY = PAGE_H - 74;
  };

  const ensureSpace = (neededHeight: number, continuationTitle?: string) => {
    if (cursorY - neededHeight >= MARGIN_BOTTOM) return;
    createContentPage(continuationTitle ?? "Contratto noleggio - continua");
  };

  const drawSectionTitle = (title: string, subtitle?: string) => {
    ensureSpace(34, title);
    page.drawRectangle({
      x: MARGIN_X,
      y: cursorY - 22,
      width: contentWidth,
      height: 22,
      color: hexToRgb("#eef3ff")
    });
    page.drawText(title.toUpperCase(), {
      x: MARGIN_X + 9,
      y: cursorY - 15,
      size: 9.2,
      font: boldFont,
      color: hexToRgb(primaryHex)
    });
    if (subtitle) {
      const lines = wrapLines(subtitle, contentWidth - 20, regularFont, 8.6);
      let subtitleY = cursorY - 34;
      for (const line of lines) {
        ensureSpace(14, title);
        page.drawText(line, {
          x: MARGIN_X + 2,
          y: subtitleY,
          size: 8.6,
          font: regularFont,
          color: hexToRgb("#546789")
        });
        subtitleY -= 10;
        cursorY -= 10;
      }
    }
    cursorY -= 28;
  };

  const drawInfoGrid = (items: InfoItem[], columns = 2) => {
    if (items.length === 0) return;
    const gridGap = 10;
    const colWidth = (contentWidth - gridGap * (columns - 1)) / columns;
    for (let index = 0; index < items.length; index += columns) {
      const chunk = items.slice(index, index + columns);
      const metrics = chunk.map((item) => {
        const labelLines = wrapLines(item.label.toUpperCase(), colWidth - 12, boldFont, 7.2);
        const valueLines = wrapLines(asText(item.value), colWidth - 12, item.emphasize ? boldFont : regularFont, 9.2);
        const cellHeight = 10 + labelLines.length * 8.2 + 4 + valueLines.length * 10.4 + 6;
        return { item, labelLines, valueLines, cellHeight };
      });
      const rowHeight = Math.max(...metrics.map((entry) => entry.cellHeight));
      ensureSpace(rowHeight + 8, "Dettaglio contratto");
      const topY = cursorY;
      metrics.forEach((entry, idx) => {
        const x = MARGIN_X + idx * (colWidth + gridGap);
        page.drawRectangle({
          x,
          y: topY - rowHeight + 2,
          width: colWidth,
          height: rowHeight,
          color: hexToRgb(entry.item.emphasize ? "#edf4ff" : "#f8faff")
        });
        let lineY = topY - 9;
        for (const line of entry.labelLines) {
          page.drawText(line, {
            x: x + 6,
            y: lineY,
            size: 7.2,
            font: boldFont,
            color: hexToRgb("#64789b")
          });
          lineY -= 8.2;
        }
        lineY -= 2;
        for (const line of entry.valueLines) {
          page.drawText(line, {
            x: x + 6,
            y: lineY,
            size: 9.2,
            font: entry.item.emphasize ? boldFont : regularFont,
            color: hexToRgb("#1f2f4d")
          });
          lineY -= 10.4;
        }
      });
      cursorY -= rowHeight + 6;
    }
  };

  const drawBullets = (title: string, bullets: string[]) => {
    drawSectionTitle(title);
    const list = bullets.length > 0 ? bullets : ["Nessuna clausola disponibile."];
    for (const bullet of list) {
      const lines = wrapLines(asText(bullet), contentWidth - 24, regularFont, 9.3);
      const needed = lines.length * 11 + 8;
      ensureSpace(needed, title);
      page.drawText("•", {
        x: MARGIN_X + 4,
        y: cursorY - 2,
        size: 10,
        font: boldFont,
        color: hexToRgb(primaryHex)
      });
      let lineY = cursorY;
      for (const line of lines) {
        page.drawText(line, {
          x: MARGIN_X + 15,
          y: lineY - 2,
          size: 9.3,
          font: regularFont,
          color: hexToRgb("#243656")
        });
        lineY -= 11;
      }
      cursorY = lineY - 1;
    }
    cursorY -= 4;
  };

  const drawSignatures = () => {
    drawSectionTitle("Sottoscrizione");
    const signedAt = input.contract.signedAt ?? input.booking.contractSignedAt;
    const statement = signedAt
      ? `Firma registrata il ${formatDateTime(signedAt)}.`
      : "Con la firma il cliente dichiara di aver letto e accettato tutte le condizioni contrattuali.";
    const statementLines = wrapLines(statement, contentWidth, regularFont, 9);
    for (const line of statementLines) {
      ensureSpace(12, "Sottoscrizione");
      page.drawText(line, {
        x: MARGIN_X,
        y: cursorY,
        size: 9,
        font: regularFont,
        color: hexToRgb("#364c72")
      });
      cursorY -= 11;
    }
    cursorY -= 6;
    ensureSpace(72, "Sottoscrizione");
    const leftX = MARGIN_X;
    const rightX = PAGE_W - MARGIN_X - 220;
    page.drawText("Luogo e data", { x: leftX, y: cursorY, size: 8.8, font: boldFont, color: hexToRgb("#546988") });
    page.drawLine({
      start: { x: leftX, y: cursorY - 8 },
      end: { x: leftX + 180, y: cursorY - 8 },
      thickness: 0.8,
      color: hexToRgb("#96a8c7")
    });
    page.drawText("Firma cliente", { x: rightX, y: cursorY, size: 8.8, font: boldFont, color: hexToRgb("#546988") });
    page.drawLine({
      start: { x: rightX, y: cursorY - 8 },
      end: { x: rightX + 180, y: cursorY - 8 },
      thickness: 0.8,
      color: hexToRgb("#96a8c7")
    });
    page.drawRectangle({
      x: rightX + 2,
      y: cursorY - 58,
      width: 176,
      height: 44,
      color: hexToRgb("#f7faff")
    });
    page.drawRectangle({
      x: rightX + 2,
      y: cursorY - 58,
      width: 176,
      height: 44,
      borderColor: hexToRgb("#c8d4ea"),
      borderWidth: 0.6
    });
    if (signatureImage) {
      const targetHeight = 36;
      const scaled = signatureImage.scale(targetHeight / signatureImage.height);
      const maxWidth = 170;
      const drawWidth = Math.min(maxWidth, scaled.width);
      const drawHeight = (scaled.height * drawWidth) / scaled.width;
      page.drawImage(signatureImage, {
        x: rightX + 5 + (maxWidth - drawWidth) / 2,
        y: cursorY - 56 + (40 - drawHeight) / 2,
        width: drawWidth,
        height: drawHeight
      });
    } else {
      page.drawText("Nessuna firma grafica", {
        x: rightX + 38,
        y: cursorY - 37,
        size: 8.2,
        font: regularFont,
        color: hexToRgb("#7c8ba8")
      });
    }
    cursorY -= 60;
    page.drawText("Firma operatore", { x: rightX, y: cursorY, size: 8.8, font: boldFont, color: hexToRgb("#546988") });
    page.drawLine({
      start: { x: rightX, y: cursorY - 8 },
      end: { x: rightX + 180, y: cursorY - 8 },
      thickness: 0.8,
      color: hexToRgb("#96a8c7")
    });
    cursorY -= 24;
  };

  const companyCustomer = isCorporateCustomer(input.booking);
  const legalRep = [asText(input.booking.customer?.legalRepFirstName, ""), asText(input.booking.customer?.legalRepLastName, "")]
    .filter(Boolean)
    .join(" ")
    .trim();
  const traveledKm = kmTravelled(input.booking.pickupKm, input.booking.returnKm);
  const snapshot = input.booking.pricingSnapshot;

  const partyLessor: InfoItem[] = [
    { label: "Locatore", value: companyName },
    { label: "Sede", value: companyAddress },
    { label: "P.IVA", value: companyVat },
    { label: "Email", value: companyEmail },
    { label: "Telefono", value: companyPhone }
  ];

  const partyCustomer: InfoItem[] = companyCustomer
    ? [
        { label: "Tipo intestatario", value: "Persona giuridica" },
        { label: "Ragione sociale", value: asText(input.booking.customer?.companyName, input.booking.customerName) },
        { label: "Forma giuridica", value: asText(input.booking.customer?.companyLegalForm) },
        {
          label: "Partita IVA / CF",
          value: `${asText(input.booking.customer?.companyVatNumber)} / ${asText(input.booking.customer?.companyTaxCode)}`
        },
        { label: "Sede legale", value: asText(input.booking.customer?.companyLegalAddress) },
        { label: "PEC / SDI / REA", value: `${asText(input.booking.customer?.companyPec)} · ${asText(input.booking.customer?.companySdi)} · ${asText(input.booking.customer?.companyRea)}` },
        {
          label: "Legale rappresentante",
          value: `${legalRep || "-"} (${asText(input.booking.customer?.legalRepRole)})`
        },
        {
          label: "Contatti referente",
          value: `${asText(input.booking.customer?.legalRepEmail, input.booking.customerEmail)} · ${asText(input.booking.customer?.legalRepPhone, input.booking.customerPhone)}`
        }
      ]
    : [
        { label: "Tipo intestatario", value: "Persona fisica" },
        { label: "Nominativo", value: fullCustomerName(input.booking) },
        { label: "Codice fiscale", value: asText(input.booking.customer?.taxCode) },
        { label: "Data e luogo nascita", value: `${formatDate(input.booking.customer?.dateOfBirth)} · ${asText(input.booking.customer?.placeOfBirth)}` },
        { label: "Nazionalita", value: asText(input.booking.customer?.nationality) },
        { label: "Residenza", value: asText(input.booking.customer?.residenceAddress) },
        {
          label: "Documento identita",
          value: `${asText(input.booking.customer?.documentType)} ${asText(input.booking.customer?.documentNumber)} · scad. ${formatDate(input.booking.customer?.documentExpiresAt)}`
        },
        {
          label: "Patente",
          value: `${asText(input.booking.customer?.drivingLicenseNumber)} · cat. ${asText(input.booking.customer?.drivingLicenseCategory)} · scad. ${formatDate(input.booking.customer?.drivingLicenseExpiresAt)}`
        },
        {
          label: "Contatti",
          value: `${asText(input.booking.customer?.email, input.booking.customerEmail)} · ${asText(input.booking.customer?.phone, input.booking.customerPhone)}`
        }
      ];

  const rentalDetails: InfoItem[] = [
    { label: "Codice prenotazione", value: asText(input.booking.code), emphasize: true },
    {
      label: "Veicolo",
      value: `${asText(input.booking.vehicle?.brand)} ${asText(input.booking.vehicle?.model)} (${asText(input.booking.vehicle?.plate)})`
    },
    { label: "Ritiro", value: `${formatDateTime(input.booking.pickupAt)} · ${asText(input.booking.pickupLocation)}` },
    { label: "Rientro", value: `${formatDateTime(input.booking.returnAt)} · ${asText(input.booking.returnLocation)}` },
    { label: "Durata stimata", value: rentalDurationText(input.booking.pickupAt, input.booking.returnAt) },
    {
      label: "Km uscita / rientro / percorsi",
      value: `${formatNumber(input.booking.pickupKm)} / ${formatNumber(input.booking.returnKm)} / ${formatNumber(traveledKm)}`
    }
  ];

  const contractStatusItems: InfoItem[] = [
    { label: "Stato prenotazione", value: labelOf(BOOKING_STATUS_LABELS, input.booking.status) },
    { label: "Stato contratto", value: labelOf(CONTRACT_STATUS_LABELS, input.contract.status ?? input.booking.contractStatus), emphasize: true },
    { label: "Template versione", value: String(input.contract.templateVersion ?? "-") },
    { label: "Creato il", value: formatDateTime(input.contract.createdAt) },
    { label: "Ultimo aggiornamento", value: formatDateTime(input.contract.updatedAt) },
    { label: "Ultimo invio", value: formatDateTime(input.contract.lastSentAt) },
    { label: "Firmato il", value: formatDateTime(input.contract.signedAt ?? input.booking.contractSignedAt) },
    { label: "Destinatario email", value: asText(input.contract.emailTo, input.booking.customerEmail) },
    {
      label: "Ultima delivery",
      value: input.contract.latestDelivery
        ? `${labelOf(DELIVERY_CHANNEL_LABELS, input.contract.latestDelivery.channel)} · ${labelOf(DELIVERY_STATUS_LABELS, input.contract.latestDelivery.status)} · ${formatDateTime(input.contract.latestDelivery.sentAt ?? input.contract.latestDelivery.createdAt)}`
        : "-"
    },
    {
      label: "Firma grafica",
      value: signatureImage ? `Acquisita (${formatNumber(input.contract.signatureSizeBytes)} bytes)` : "Non acquisita"
    },
    { label: "Dettaglio errore delivery", value: asText(input.contract.latestDelivery?.errorMessage) }
  ];

  const economicItems: InfoItem[] = [
    { label: "Totale previsto", value: formatMoney(snapshot?.expectedTotal ?? input.booking.expectedTotal), emphasize: true },
    { label: "Totale finale", value: formatMoney(snapshot?.finalTotal ?? input.booking.finalTotal), emphasize: true },
    { label: "Subtotale previsto", value: formatMoney(snapshot?.expectedSubtotal) },
    { label: "IVA prevista", value: formatMoney(snapshot?.expectedTaxAmount) },
    { label: "Subtotale finale", value: formatMoney(snapshot?.finalSubtotal) },
    { label: "IVA finale", value: formatMoney(snapshot?.finalTaxAmount) },
    { label: "Listino", value: asText(snapshot?.priceListName) },
    { label: "Pacchetto km", value: asText(snapshot?.pricePackageName) },
    { label: "Policy km extra", value: asText(snapshot?.extraKmPolicyName) },
    { label: "Tariffa base", value: `${formatMoney(snapshot?.baseRateAmount)} (${labelOf(BASE_RATE_UNIT_LABELS, snapshot?.baseRateUnit)})` },
    { label: "Regola overflow ore", value: labelOf(OVERFLOW_RULE_LABELS, snapshot?.hourOverflowRule) },
    { label: "IVA % / Sconto %", value: `${formatNumber(snapshot?.vatRate, 2)} / ${formatNumber(snapshot?.discountPercent, 2)}` },
    { label: "Giorni addebitati", value: formatNumber(snapshot?.daysCharged, 2) },
    { label: "Km inclusi totali", value: formatNumber(snapshot?.includedKmTotal) },
    { label: "Km stimati / reali", value: `${formatNumber(snapshot?.estimatedKm)} / ${formatNumber(snapshot?.actualKm)}` },
    { label: "Extra km stimati / reali", value: `${formatNumber(snapshot?.extraKmEstimated)} / ${formatNumber(snapshot?.extraKmActual)}` },
    { label: "Costo extra km stimato / reale", value: `${formatMoney(snapshot?.extraKmEstimatedCost)} / ${formatMoney(snapshot?.extraKmActualCost)}` },
    { label: "Note pricing", value: asText(snapshot?.notes) }
  ];

  drawSectionTitle("Parti contrattuali", "Anagrafica completa delle parti coinvolte nel noleggio.");
  drawInfoGrid(partyLessor, 2);
  drawSectionTitle(companyCustomer ? "Intestatario giuridico" : "Intestatario persona fisica");
  drawInfoGrid(partyCustomer, 2);

  drawSectionTitle("Dettaglio noleggio e veicolo");
  drawInfoGrid(rentalDetails, 2);

  drawSectionTitle("Stato operativo contratto");
  drawInfoGrid(contractStatusItems, 2);

  drawSectionTitle("Riepilogo economico e pricing");
  drawInfoGrid(economicItems, 2);

  drawBullets("Condizioni principali in sintesi", contractSummaryClauses(input.contract.content));
  drawSignatures();

  createContentPage("Condizioni generali di noleggio");
  drawSectionTitle("Testo integrale condizioni", "Di seguito il testo completo del contratto in vigore.");
  const fullText = normalizeMultiline(input.contract.content);
  const paragraphs = fullText
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\n/g, " ").trim())
    .filter(Boolean);
  const resolvedParagraphs = paragraphs.length > 0 ? paragraphs : ["Nessuna condizione disponibile nel template contratto."];

  for (const paragraph of resolvedParagraphs) {
    const paragraphLines = wrapLines(paragraph, contentWidth, regularFont, 9);
    ensureSpace(paragraphLines.length * 11 + 8, "Condizioni generali di noleggio");
    for (const line of paragraphLines) {
      page.drawText(line, {
        x: MARGIN_X,
        y: cursorY,
        size: 9,
        font: regularFont,
        color: hexToRgb("#263754")
      });
      cursorY -= 11;
    }
    cursorY -= 4;
  }

  const totalPages = pages.length;
  pages.forEach((entry, index) => addFooter(entry, index + 1, totalPages));

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
};
