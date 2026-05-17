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

const maybeEmbedFirstExistingImage = async (pdfDoc: PDFDocument, candidates: string[]): Promise<PDFImage | null> => {
  for (const candidate of candidates) {
    try {
      const absolutePath = path.resolve(process.cwd(), candidate);
      const image = await fs.readFile(absolutePath);
      const extension = path.extname(candidate).toLowerCase();
      if (extension === ".png") return pdfDoc.embedPng(image);
      if (extension === ".jpg" || extension === ".jpeg") return pdfDoc.embedJpg(image);
    } catch {
      // Try the next known brand asset path.
    }
  }
  return null;
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

const isTemplateSignaturePlaceholder = (line: string) => {
  const normalized = line.trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized.startsWith("firma cliente") ||
    normalized.startsWith("firma operatore") ||
    normalized.startsWith("luogo e data") ||
    normalized === "data" ||
    normalized.startsWith("data:")
  );
};

const compactJoin = (...values: Array<string | null | undefined>) =>
  values
    .map((value) => asText(value, ""))
    .filter(Boolean)
    .join(" · ");

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

  const companyName = asText(input.branding?.companyName, "Fleetum");
  const companyAddress = asText(input.branding?.companyAddress, "Via Demo 1, 00100 Roma");
  const companyVat = asText(input.branding?.companyVat, "P.IVA 00000000000");
  const companyEmail = asText(input.branding?.companyEmail, "info@fleetops.demo");
  const companyPhone = asText(input.branding?.companyPhone, "Tel. +39 000 0000000");

  let fleetumMark: PDFImage | null = null;
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
    const poweredBy = "Powered by Fleetum";
    const poweredWidth = regularFont.widthOfTextAtSize(poweredBy, 7.2);
    const poweredX = PAGE_W / 2 - poweredWidth / 2 + 6;
    if (fleetumMark) {
      const markH = 9;
      const scaled = fleetumMark.scale(markH / fleetumMark.height);
      page.drawImage(fleetumMark, {
        x: poweredX - scaled.width - 4,
        y: 21.2,
        width: scaled.width,
        height: scaled.height
      });
    }
    page.drawText(poweredBy, {
      x: poweredX,
      y: 24,
      size: 7.2,
      font: regularFont,
      color: hexToRgb("#7c8ba8")
    });
  };

  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  pages.push(page);
  const contentWidth = PAGE_W - MARGIN_X * 2;
  let cursorY = PAGE_H - 194;

  page.drawRectangle({ x: 0, y: PAGE_H - 142, width: PAGE_W, height: 142, color: hexToRgb(primaryHex) });
  page.drawRectangle({ x: 0, y: PAGE_H - 145, width: PAGE_W, height: 3, color: hexToRgb(accentHex) });

  fleetumMark = await maybeEmbedFirstExistingImage(pdfDoc, [
    "../frontend/public/brand/fleetum-favicon.png",
    "frontend/public/brand/fleetum-favicon.png",
    "../../frontend/public/brand/fleetum-favicon.png"
  ]);
  const signatureImage = await maybeEmbedLogo(pdfDoc, input.contract.signatureFilePath);

  page.drawText(companyName, {
    x: MARGIN_X + 20,
    y: PAGE_H - 66,
    size: 16,
    font: boldFont,
    color: rgb(1, 1, 1)
  });
  page.drawText(`${companyAddress} · ${companyVat}`, {
    x: MARGIN_X + 20,
    y: PAGE_H - 84,
    size: 9,
    font: regularFont,
    color: rgb(0.93, 0.95, 1)
  });
  page.drawText(`${companyEmail} · ${companyPhone}`, {
    x: MARGIN_X + 20,
    y: PAGE_H - 98,
    size: 9,
    font: regularFont,
    color: rgb(0.93, 0.95, 1)
  });
  if (fleetumMark) {
    const markH = 18;
    const scaled = fleetumMark.scale(markH / fleetumMark.height);
    page.drawImage(fleetumMark, {
      x: PAGE_W - MARGIN_X - 132,
      y: PAGE_H - 73,
      width: scaled.width,
      height: scaled.height
    });
  }
  page.drawText("Powered by", {
    x: PAGE_W - MARGIN_X - 106,
    y: PAGE_H - 63,
    size: 7.2,
    font: regularFont,
    color: rgb(0.78, 0.84, 0.96)
  });
  page.drawText("Fleetum", {
    x: PAGE_W - MARGIN_X - 106,
    y: PAGE_H - 78,
    size: 13,
    font: boldFont,
    color: rgb(1, 1, 1)
  });

  page.drawText("CONTRATTO DI NOLEGGIO", {
    x: MARGIN_X,
    y: PAGE_H - 164,
    size: 18,
    font: headingFont,
    color: hexToRgb(primaryHex)
  });

  const chipText = [
    `Contratto ${asText(input.booking.code)}`,
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
  const titleLines = wrapLines(asText(input.contract.title, "Contratto standard"), contentWidth - chipWidth - 18, regularFont, 9.6).slice(0, 2);
  titleLines.forEach((line, index) => {
    page.drawText(line, {
      x: MARGIN_X,
      y: PAGE_H - 181 - index * 11,
      size: 9.6,
      font: regularFont,
      color: hexToRgb("#385581")
    });
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
    const subtitleLines = subtitle ? wrapLines(subtitle, contentWidth - 20, regularFont, 8.6) : [];
    const requiredHeight = 30 + (subtitleLines.length > 0 ? subtitleLines.length * 10 + 10 : 0);
    ensureSpace(requiredHeight + 6, title);
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
    if (subtitleLines.length > 0) {
      let subtitleY = cursorY - 34;
      for (const line of subtitleLines) {
        page.drawText(line, {
          x: MARGIN_X + 2,
          y: subtitleY,
          size: 8.6,
          font: regularFont,
          color: hexToRgb("#546789")
        });
        subtitleY -= 10;
      }
    }
    cursorY -= requiredHeight;
  };

  const drawExecutiveNotice = () => {
    const status = labelOf(CONTRACT_STATUS_LABELS, input.contract.status ?? input.booking.contractStatus);
    const lines = [
      "Documento contrattuale di noleggio senza conducente. Le sezioni seguenti riepilogano parti, veicolo, periodo, condizioni economiche e sottoscrizione.",
      `Codice: ${asText(input.booking.code)} · Stato contratto: ${status} · Template v${String(input.contract.templateVersion ?? "-")}`
    ];
    const wrapped = lines.flatMap((line) => wrapLines(line, contentWidth - 24, regularFont, 8.8));
    const height = 22 + wrapped.length * 10;
    ensureSpace(height + 8, "Sintesi contratto");
    page.drawRectangle({
      x: MARGIN_X,
      y: cursorY - height,
      width: contentWidth,
      height,
      color: hexToRgb("#f5f8ff")
    });
    page.drawRectangle({
      x: MARGIN_X,
      y: cursorY - height,
      width: 3,
      height,
      color: hexToRgb(accentHex)
    });
    page.drawText("RIEPILOGO CONTRATTO", {
      x: MARGIN_X + 12,
      y: cursorY - 15,
      size: 8.4,
      font: boldFont,
      color: hexToRgb(primaryHex)
    });
    let lineY = cursorY - 29;
    for (const line of wrapped) {
      page.drawText(line, {
        x: MARGIN_X + 12,
        y: lineY,
        size: 8.8,
        font: regularFont,
        color: hexToRgb("#34486a")
      });
      lineY -= 10;
    }
    cursorY -= height + 12;
  };

  const drawPremiumSection = (title: string) => {
    ensureSpace(34, title);
    page.drawRectangle({
      x: MARGIN_X,
      y: cursorY - 24,
      width: contentWidth,
      height: 24,
      color: hexToRgb("#f6f9ff")
    });
    page.drawRectangle({
      x: MARGIN_X,
      y: cursorY - 24,
      width: 4,
      height: 24,
      color: hexToRgb(accentHex)
    });
    page.drawText(title.toUpperCase(), {
      x: MARGIN_X + 13,
      y: cursorY - 15,
      size: 8.7,
      font: boldFont,
      color: hexToRgb(primaryHex)
    });
    cursorY -= 38;
  };

  const drawPremiumCard = (x: number, y: number, width: number, height: number, title?: string) => {
    page.drawRectangle({
      x,
      y: y - height,
      width,
      height,
      color: rgb(1, 1, 1),
      borderColor: hexToRgb("#d8e0ee"),
      borderWidth: 0.8
    });
    if (title) {
      page.drawText(title.toUpperCase(), {
        x: x + 12,
        y: y - 18,
        size: 7.6,
        font: boldFont,
        color: hexToRgb("#687893")
      });
    }
  };

  const drawPremiumLabelValue = (
    label: string,
    value: string,
    x: number,
    y: number,
    width: number,
    options?: { strong?: boolean; lines?: number }
  ) => {
    page.drawText(label.toUpperCase(), {
      x,
      y: y + 12,
      size: 6.8,
      font: boldFont,
      color: hexToRgb("#6b7890")
    });
    const lines = wrapLines(asText(value), width, options?.strong ? boldFont : regularFont, options?.strong ? 9.5 : 9).slice(
      0,
      options?.lines ?? 2
    );
    lines.forEach((line, index) => {
      page.drawText(line, {
        x,
        y: y - index * 10.5,
        size: index === 0 && options?.strong ? 9.5 : 9,
        font: index === 0 && options?.strong ? boldFont : regularFont,
        color: hexToRgb("#182338")
      });
    });
  };

  const drawPremiumParties = (leftTitle: string, leftItems: InfoItem[], rightTitle: string, rightItems: InfoItem[]) => {
    drawPremiumSection("Parti contrattuali");
    const gap = 14;
    const cardWidth = (contentWidth - gap) / 2;
    const cardHeight = 170;
    ensureSpace(cardHeight + 12, "Parti contrattuali");
    const topY = cursorY;
    drawPremiumCard(MARGIN_X, topY, cardWidth, cardHeight, leftTitle);
    drawPremiumCard(MARGIN_X + cardWidth + gap, topY, cardWidth, cardHeight, rightTitle);
    const drawColumn = (x: number, items: InfoItem[]) => {
      let localY = topY - 44;
      for (const item of items.slice(0, 5)) {
        drawPremiumLabelValue(item.label, item.value, x + 14, localY, cardWidth - 28, { strong: item.emphasize });
        localY -= 31;
      }
    };
    drawColumn(MARGIN_X, leftItems);
    drawColumn(MARGIN_X + cardWidth + gap, rightItems);
    cursorY -= cardHeight + 18;
  };

  const drawPremiumVehiclePeriod = () => {
    if (cursorY - 166 < MARGIN_BOTTOM) {
      createContentPage("Veicolo e condizioni economiche");
    }
    drawPremiumSection("Veicolo e periodo di noleggio");
    const cardHeight = 114;
    ensureSpace(cardHeight + 12, "Veicolo e periodo di noleggio");
    const topY = cursorY;
    drawPremiumCard(MARGIN_X, topY, contentWidth, cardHeight);
    const col = (contentWidth - 56) / 3;
    drawPremiumLabelValue(
      "Veicolo",
      `${asText(input.booking.vehicle?.brand)} ${asText(input.booking.vehicle?.model)}`,
      MARGIN_X + 18,
      topY - 40,
      col,
      { strong: true }
    );
    drawPremiumLabelValue("Targa", asText(input.booking.vehicle?.plate), MARGIN_X + 18 + col, topY - 40, col, { strong: true });
    drawPremiumLabelValue("Codice", asText(input.booking.code), MARGIN_X + 18 + col * 2, topY - 40, col, { strong: true });
    drawPremiumLabelValue("Uscita", `${formatDateTime(input.booking.pickupAt)} · ${asText(input.booking.pickupLocation)}`, MARGIN_X + 18, topY - 88, col);
    drawPremiumLabelValue("Rientro", `${formatDateTime(input.booking.returnAt)} · ${asText(input.booking.returnLocation)}`, MARGIN_X + 18 + col, topY - 88, col);
    drawPremiumLabelValue(
      "Km",
      `${formatNumber(input.booking.pickupKm)} uscita · ${formatNumber(input.booking.returnKm)} rientro · ${formatNumber(traveledKm)} percorsi`,
      MARGIN_X + 18 + col * 2,
      topY - 88,
      col
    );
    cursorY -= cardHeight + 18;
  };

  const drawPremiumEconomicTable = (items: Array<[string, string, string, boolean?]>) => {
    const rowHeight = 21;
    const cardHeight = 20 + items.length * rowHeight;
    if (cursorY - (38 + cardHeight + 12) < MARGIN_BOTTOM) {
      createContentPage("Condizioni economiche");
    }
    drawPremiumSection("Condizioni economiche");
    ensureSpace(cardHeight + 12, "Condizioni economiche");
    const topY = cursorY;
    drawPremiumCard(MARGIN_X, topY, contentWidth, cardHeight);
    page.drawText("Voce", { x: MARGIN_X + 16, y: topY - 18, size: 6.8, font: boldFont, color: hexToRgb("#7a879b") });
    page.drawText("Dettaglio", { x: MARGIN_X + 188, y: topY - 18, size: 6.8, font: boldFont, color: hexToRgb("#7a879b") });
    page.drawText("Importo / regola", {
      x: PAGE_W - MARGIN_X - 104,
      y: topY - 18,
      size: 6.8,
      font: boldFont,
      color: hexToRgb("#7a879b")
    });
    let rowY = topY - 38;
    for (const [label, description, value, important] of items) {
      page.drawText(label, { x: MARGIN_X + 16, y: rowY, size: 9, font: boldFont, color: hexToRgb("#182338") });
      page.drawText(description, { x: MARGIN_X + 188, y: rowY, size: 8.7, font: regularFont, color: hexToRgb("#66758d") });
      const valueWidth = boldFont.widthOfTextAtSize(value, 9);
      page.drawText(value, {
        x: PAGE_W - MARGIN_X - 16 - valueWidth,
        y: rowY,
        size: 9,
        font: boldFont,
        color: important ? hexToRgb("#0f7a4d") : hexToRgb("#182338")
      });
      page.drawLine({
        start: { x: MARGIN_X + 16, y: rowY - 8 },
        end: { x: PAGE_W - MARGIN_X - 16, y: rowY - 8 },
        thickness: 0.45,
        color: hexToRgb("#e2e8f3")
      });
      rowY -= rowHeight;
    }
    cursorY -= cardHeight + 18;
  };

  const drawPremiumClauses = (clauses: Array<[string, string]>) => {
    drawPremiumSection("Clausole principali");
    const cardHeight = 282;
    ensureSpace(cardHeight + 12, "Clausole principali");
    const topY = cursorY;
    drawPremiumCard(MARGIN_X, topY, contentWidth, cardHeight);
    let localY = topY - 34;
    for (const [title, body] of clauses) {
      page.drawText(title, { x: MARGIN_X + 16, y: localY, size: 9.4, font: boldFont, color: hexToRgb(primaryHex) });
      localY -= 13;
      for (const line of wrapLines(body, contentWidth - 32, regularFont, 8.4).slice(0, 2)) {
        page.drawText(line, { x: MARGIN_X + 16, y: localY, size: 8.4, font: regularFont, color: hexToRgb("#536177") });
        localY -= 10;
      }
      localY -= 10;
    }
    cursorY -= cardHeight + 18;
  };

  const drawPremiumDeliverySummary = () => {
    drawPremiumSection("Riepilogo consegna");
    const cardHeight = 66;
    ensureSpace(cardHeight + 12, "Riepilogo consegna");
    const topY = cursorY;
    drawPremiumCard(MARGIN_X, topY, contentWidth, cardHeight);
    drawPremiumLabelValue("Stato veicolo", "Da verbale/allegati di consegna", MARGIN_X + 16, topY - 38, 150, { strong: true });
    drawPremiumLabelValue("Dotazioni", "Chiavi, documenti veicolo, triangolo, giubbotto, kit emergenza", MARGIN_X + 190, topY - 38, 230);
    drawPremiumLabelValue("Note", "Eventuali danni o anomalie devono essere riportati prima dell'uscita.", MARGIN_X + 16, topY - 64, 460);
    cursorY -= cardHeight + 18;
  };

  const drawKeyFacts = (items: InfoItem[]) => {
    const gap = 8;
    const cardWidth = (contentWidth - gap * (items.length - 1)) / items.length;
    const cardHeight = 48;
    ensureSpace(cardHeight + 14, "Riepilogo contratto");
    items.forEach((item, index) => {
      const x = MARGIN_X + index * (cardWidth + gap);
      page.drawRectangle({
        x,
        y: cursorY - cardHeight,
        width: cardWidth,
        height: cardHeight,
        color: hexToRgb(index === 0 ? "#edf4ff" : "#f8faff")
      });
      page.drawRectangle({
        x,
        y: cursorY - cardHeight,
        width: 2.4,
        height: cardHeight,
        color: hexToRgb(index === 0 ? accentHex : "#d7e0f2")
      });
      page.drawText(item.label.toUpperCase(), {
        x: x + 9,
        y: cursorY - 14,
        size: 6.9,
        font: boldFont,
        color: hexToRgb("#6c7d98")
      });
      const valueLines = wrapLines(item.value, cardWidth - 18, item.emphasize ? boldFont : regularFont, item.emphasize ? 10 : 9.1).slice(0, 2);
      let valueY = cursorY - 30;
      for (const line of valueLines) {
        page.drawText(line, {
          x: x + 9,
          y: valueY,
          size: item.emphasize ? 10 : 9.1,
          font: item.emphasize ? boldFont : regularFont,
          color: hexToRgb("#182946")
        });
        valueY -= 11;
      }
    });
    cursorY -= cardHeight + 14;
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

  const measureInfoColumnHeight = (items: InfoItem[]) => {
    if (items.length === 0) return 30;
    let total = 22; // compact section badge/header
    for (const item of items) {
      const labelLines = wrapLines(item.label.toUpperCase(), (contentWidth - 10) / 2 - 12, boldFont, 7.2);
      const valueLines = wrapLines(asText(item.value), (contentWidth - 10) / 2 - 12, item.emphasize ? boldFont : regularFont, 9.2);
      const rowHeight = 7 + labelLines.length * 7 + 2 + valueLines.length * 9 + 4;
      total += rowHeight + 3;
    }
    return total;
  };

  const drawInfoColumnAt = (x: number, width: number, topY: number, title: string, items: InfoItem[]) => {
    let localY = topY;
    page.drawRectangle({
      x,
      y: localY - 18,
      width,
      height: 18,
      color: hexToRgb("#eef3ff")
    });
    page.drawText(title.toUpperCase(), {
      x: x + 8,
      y: localY - 12.5,
      size: 8.3,
      font: boldFont,
      color: hexToRgb(primaryHex)
    });
    localY -= 22;

    for (const item of items) {
      const labelLines = wrapLines(item.label.toUpperCase(), width - 12, boldFont, 7.2);
      const valueLines = wrapLines(asText(item.value), width - 12, item.emphasize ? boldFont : regularFont, 9.2);
      const rowHeight = 7 + labelLines.length * 7 + 2 + valueLines.length * 9 + 4;

      page.drawRectangle({
        x,
        y: localY - rowHeight + 2,
        width,
        height: rowHeight,
        color: hexToRgb(item.emphasize ? "#edf4ff" : "#f8faff")
      });

      let lineY = localY - 6;
      for (const line of labelLines) {
        page.drawText(line, {
          x: x + 6,
          y: lineY,
          size: 6.8,
          font: boldFont,
          color: hexToRgb("#64789b")
        });
        lineY -= 7;
      }
      lineY -= 1;
      for (const line of valueLines) {
        page.drawText(line, {
          x: x + 6,
          y: lineY,
          size: 8.6,
          font: item.emphasize ? boldFont : regularFont,
          color: hexToRgb("#1f2f4d")
        });
        lineY -= 9;
      }

      localY -= rowHeight + 3;
    }

    return topY - localY;
  };

  const drawPartiesSideBySide = (leftTitle: string, leftItems: InfoItem[], rightTitle: string, rightItems: InfoItem[]) => {
    const columnGap = 10;
    const columnWidth = (contentWidth - columnGap) / 2;
    const leftHeight = measureInfoColumnHeight(leftItems);
    const rightHeight = measureInfoColumnHeight(rightItems);
    const neededHeight = Math.max(leftHeight, rightHeight) + 4;

    ensureSpace(neededHeight, "Parti contrattuali");
    const topY = cursorY;

    drawInfoColumnAt(MARGIN_X, columnWidth, topY, leftTitle, leftItems);
    drawInfoColumnAt(MARGIN_X + columnWidth + columnGap, columnWidth, topY, rightTitle, rightItems);

    cursorY -= neededHeight;
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
    const signedDateLabel = formatDate(signedAt ?? new Date());
    const signedPlaceLabel = asText(input.booking.returnLocation, input.booking.pickupLocation);
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
    ensureSpace(126, "Sottoscrizione");
    const cardTopY = cursorY;
    const cardHeight = 110;
    page.drawRectangle({
      x: MARGIN_X,
      y: cardTopY - cardHeight,
      width: contentWidth,
      height: cardHeight,
      color: rgb(1, 1, 1),
      borderColor: hexToRgb("#d8e0ee"),
      borderWidth: 0.8
    });
    const leftX = MARGIN_X;
    const clientX = MARGIN_X + 225;
    const operatorX = MARGIN_X + 390;
    page.drawText("Luogo e data", { x: leftX + 16, y: cardTopY - 32, size: 8.4, font: boldFont, color: hexToRgb("#546988") });
    page.drawText(`${signedPlaceLabel} · ${signedDateLabel}`, {
      x: leftX + 16,
      y: cardTopY - 55,
      size: 8.4,
      font: regularFont,
      color: hexToRgb("#3f5478")
    });
    page.drawText("Firma cliente", { x: clientX, y: cardTopY - 32, size: 8.4, font: boldFont, color: hexToRgb("#546988") });
    if (signatureImage) {
      const targetHeight = 36;
      const scaled = signatureImage.scale(targetHeight / signatureImage.height);
      const maxWidth = 138;
      const drawWidth = Math.min(maxWidth, scaled.width);
      const drawHeight = (scaled.height * drawWidth) / scaled.width;
      page.drawImage(signatureImage, {
        x: clientX + (maxWidth - drawWidth) / 2,
        y: cardTopY - 75,
        width: drawWidth,
        height: drawHeight
      });
    } else {
      page.drawText("Nessuna firma grafica", {
        x: clientX + 10,
        y: cardTopY - 64,
        size: 8.2,
        font: regularFont,
        color: hexToRgb("#7c8ba8")
      });
    }
    page.drawText("Firma operatore", { x: operatorX, y: cardTopY - 32, size: 8.4, font: boldFont, color: hexToRgb("#546988") });
    page.drawText(companyName, {
      x: operatorX,
      y: cardTopY - 64,
      size: 8.2,
      font: regularFont,
      color: hexToRgb("#3f5478")
    });
    cursorY -= cardHeight + 12;
  };

  const drawConditionsSignatureBlock = () => {
    const signedAt = input.contract.signedAt ?? input.booking.contractSignedAt;
    const signedDateLabel = formatDate(signedAt ?? new Date());
    const signedPlaceLabel = asText(input.booking.returnLocation, input.booking.pickupLocation);
    ensureSpace(94, "Condizioni generali di noleggio");

    const leftX = MARGIN_X;
    const rightX = PAGE_W - MARGIN_X - 220;
    page.drawText("Sottoscrizione finale contratto", {
      x: MARGIN_X,
      y: cursorY - 20,
      size: 8.8,
      font: boldFont,
      color: hexToRgb(primaryHex)
    });

    const baseY = cursorY - 38;
    page.drawText("Data", { x: leftX, y: baseY, size: 8.6, font: boldFont, color: hexToRgb("#546988") });
    page.drawText(`${signedPlaceLabel} · ${signedDateLabel}`, {
      x: leftX,
      y: baseY - 20,
      size: 8.2,
      font: regularFont,
      color: hexToRgb("#3f5478")
    });

    page.drawText("Firma cliente", { x: rightX, y: baseY, size: 8.6, font: boldFont, color: hexToRgb("#546988") });

    if (signatureImage) {
      const targetHeight = 24;
      const scaled = signatureImage.scale(targetHeight / signatureImage.height);
      const maxWidth = 172;
      const drawWidth = Math.min(maxWidth, scaled.width);
      const drawHeight = (scaled.height * drawWidth) / scaled.width;
      page.drawImage(signatureImage, {
        x: rightX + (maxWidth - drawWidth) / 2,
        y: baseY - 36 + (24 - drawHeight) / 2,
        width: drawWidth,
        height: drawHeight
      });
    }

    cursorY -= 92;
  };

  const companyCustomer = isCorporateCustomer(input.booking);
  const legalRep = [asText(input.booking.customer?.legalRepFirstName, ""), asText(input.booking.customer?.legalRepLastName, "")]
    .filter(Boolean)
    .join(" ")
    .trim();
  const naturalPersonName = fullCustomerName(input.booking);
  const contractRelationship = companyCustomer
    ? "Societa locatrice / persona giuridica cliente con conducente fisico autorizzato"
    : "Societa locatrice / persona fisica cliente e conducente principale";
  const traveledKm = kmTravelled(input.booking.pickupKm, input.booking.returnKm);
  const snapshot = input.booking.pricingSnapshot;

  const partyLessor: InfoItem[] = [
    { label: "Societa", value: companyName },
    { label: "Sede", value: companyAddress },
    { label: "P.IVA", value: companyVat },
    { label: "Email", value: companyEmail },
    { label: "Telefono", value: companyPhone }
  ];

  const partyCustomer: InfoItem[] = companyCustomer
    ? [
        { label: "Ragione sociale", value: asText(input.booking.customer?.companyName, input.booking.customerName) },
        {
          label: "Partita IVA / CF",
          value: `${asText(input.booking.customer?.companyVatNumber)} / ${asText(input.booking.customer?.companyTaxCode)}`
        },
        { label: "Sede legale", value: asText(input.booking.customer?.companyLegalAddress) },
        { label: "PEC / SDI", value: `${asText(input.booking.customer?.companyPec)} · ${asText(input.booking.customer?.companySdi)}` },
        {
          label: "Legale rappresentante",
          value: `${legalRep || "-"} (${asText(input.booking.customer?.legalRepRole)})`
        }
      ]
    : [
        { label: "Nominativo", value: fullCustomerName(input.booking) },
        { label: "Codice fiscale", value: asText(input.booking.customer?.taxCode) },
        { label: "Data e luogo nascita", value: `${formatDate(input.booking.customer?.dateOfBirth)} · ${asText(input.booking.customer?.placeOfBirth)}` },
        { label: "Residenza", value: asText(input.booking.customer?.residenceAddress) },
        {
          label: "Documento identita",
          value: `${asText(input.booking.customer?.documentType)} ${asText(input.booking.customer?.documentNumber)} · scad. ${formatDate(input.booking.customer?.documentExpiresAt)}`
        },
        {
          label: "Patente",
          value: `${asText(input.booking.customer?.drivingLicenseNumber)} · cat. ${asText(input.booking.customer?.drivingLicenseCategory)} · scad. ${formatDate(input.booking.customer?.drivingLicenseExpiresAt)}`
        }
      ];

  const driverItems: InfoItem[] = companyCustomer
    ? [
        { label: "Conducente/referente principale", value: legalRep || "Da indicare e verificare prima della consegna" },
        { label: "Codice fiscale conducente", value: asText(input.booking.customer?.legalRepTaxCode) },
        {
          label: "Contatti conducente/referente",
          value: compactJoin(input.booking.customer?.legalRepEmail, input.booking.customer?.legalRepPhone) || asText(input.booking.customerPhone)
        },
        {
          label: "Conducenti aggiuntivi",
          value: "Ammessi solo se identificati e autorizzati prima della consegna."
        }
      ]
    : [
        { label: "Conducente principale", value: naturalPersonName },
        { label: "Patente", value: compactJoin(input.booking.customer?.drivingLicenseNumber, `cat. ${asText(input.booking.customer?.drivingLicenseCategory)}`, `scad. ${formatDate(input.booking.customer?.drivingLicenseExpiresAt)}`) },
        { label: "Documento", value: compactJoin(input.booking.customer?.documentType, input.booking.customer?.documentNumber, `scad. ${formatDate(input.booking.customer?.documentExpiresAt)}`) },
        {
          label: "Conducenti aggiuntivi",
          value: "Validi solo se registrati dal Locatore con documento e patente."
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
    { label: "Ultimo invio", value: formatDateTime(input.contract.lastSentAt) },
    { label: "Firmato il", value: formatDateTime(input.contract.signedAt ?? input.booking.contractSignedAt) },
    {
      label: "Firma grafica",
      value: signatureImage ? `Acquisita (${formatNumber(input.contract.signatureSizeBytes)} bytes)` : "Non acquisita"
    }
  ];

  const economicItems: InfoItem[] = [
    { label: "Totale previsto", value: formatMoney(snapshot?.expectedTotal ?? input.booking.expectedTotal), emphasize: true },
    { label: "Totale finale", value: formatMoney(snapshot?.finalTotal ?? input.booking.finalTotal), emphasize: true },
    { label: "Listino", value: asText(snapshot?.priceListName) },
    { label: "Pacchetto km", value: asText(snapshot?.pricePackageName) },
    { label: "Policy km extra", value: asText(snapshot?.extraKmPolicyName) },
    { label: "Km inclusi totali", value: formatNumber(snapshot?.includedKmTotal) },
    { label: "IVA % / Sconto %", value: `${formatNumber(snapshot?.vatRate, 2)} / ${formatNumber(snapshot?.discountPercent, 2)}` }
  ];

  drawPremiumParties(
    "Locatore",
    partyLessor,
    companyCustomer ? "Intestatario giuridico" : "Intestatario persona fisica",
    partyCustomer
  );

  drawPremiumVehiclePeriod();

  drawPremiumEconomicTable([
    ["Listino applicato", asText(snapshot?.priceListName), `${formatMoney(snapshot?.baseRateAmount)} / ${labelOf(BASE_RATE_UNIT_LABELS, snapshot?.baseRateUnit)}`],
    ["Pacchetto km", asText(snapshot?.pricePackageName), `${formatNumber(snapshot?.includedKmTotal)} km inclusi`],
    ["Extra km", asText(snapshot?.extraKmPolicyName), `${formatNumber(snapshot?.extraKmActual ?? snapshot?.extraKmEstimated)} km`],
    ["Totale previsto", "IVA inclusa salvo extra, danni o rettifiche", formatMoney(snapshot?.expectedTotal ?? input.booking.expectedTotal), true],
    ["Totale finale", "Valore consuntivo se disponibile", formatMoney(snapshot?.finalTotal ?? input.booking.finalTotal), true]
  ]);

  createContentPage("Condizioni, responsabilita e firme");
  page.drawText("CONDIZIONI, RESPONSABILITA E FIRME", {
    x: MARGIN_X,
    y: PAGE_H - 66,
    size: 17,
    font: boldFont,
    color: hexToRgb(primaryHex)
  });
  page.drawText("Sintesi operativa delle condizioni principali. Il template puo essere personalizzato dalla societa di noleggio.", {
    x: MARGIN_X,
    y: PAGE_H - 84,
    size: 8.8,
    font: regularFont,
    color: hexToRgb("#66758d")
  });
  cursorY = PAGE_H - 120;
  drawPremiumClauses([
    [
      "1. Uso del veicolo",
      "Il Cliente utilizza il veicolo con diligenza, nel rispetto del Codice della Strada, delle condizioni del Locatore e dei limiti assicurativi."
    ],
    [
      "2. Danni, sinistri e furto",
      "Ogni danno, sinistro, furto o evento rilevante deve essere comunicato tempestivamente alla societa di noleggio e documentato secondo procedura."
    ],
    [
      "3. Multe, pedaggi e oneri",
      "Multe, pedaggi, ZTL, parcheggi e ogni onere generato durante il periodo di noleggio restano a carico del Cliente o conducente."
    ],
    [
      "4. Ritardo riconsegna",
      "La riconsegna oltre l'orario previsto puo comportare addebiti aggiuntivi secondo listino e regole di tolleranza indicate."
    ],
    [
      "5. Privacy e trattamento dati",
      "I dati sono trattati per gestione contrattuale, amministrativa, sicurezza, tutela dei diritti e obblighi normativi."
    ],
    [
      "6. Firma elettronica",
      "La firma acquisita digitalmente viene associata al contratto con timestamp e riferimento tecnico interno, ove disponibile."
    ]
  ]);
  drawPremiumDeliverySummary();
  drawSignatures();

  const totalPages = pages.length;
  pages.forEach((entry, index) => addFooter(entry, index + 1, totalPages));

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
};
