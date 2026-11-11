import fs from "node:fs/promises";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { AppError } from "../../shared/errors/app-error.js";
import type { BookingInvoiceModel } from "./booking-invoice-model.js";

const W = 595.28, H = 841.89, M = 42, CW = W - M * 2, BOTTOM = 74;
const INK = rgb(.078, .149, .247), MUTED = rgb(.38, .44, .53), BLUE = rgb(.19, .35, .78);
const LINE = rgb(.86, .89, .93), PALE = rgb(.96, .97, .98);
const asset = (name: string) => new URL(`../../../assets/invoice/${name}`, import.meta.url);
const money = (value: string) => new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(Number(value));
const date = (value: string) => new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Rome" }).format(new Date(value));

export const renderBookingInvoicePdf = async (model: BookingInvoiceModel, logo?: Uint8Array | null): Promise<Buffer> => {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  let regular: PDFFont, bold: PDFFont;
  try {
    [regular, bold] = await Promise.all([
      fs.readFile(asset("LiberationSans-Regular.ttf")).then(bytes => doc.embedFont(bytes, { subset: true })),
      fs.readFile(asset("LiberationSans-Bold.ttf")).then(bytes => doc.embedFont(bytes, { subset: true }))
    ]);
  } catch { throw new AppError("Caratteri del documento temporaneamente non disponibili.", 503, "INVOICE_PDF_ASSETS"); }
  const supported = new Set(regular.getCharacterSet());
  const safe = (value: string) => {
    const text = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/gu, " ").trim();
    if (text.length > 4000) throw new AppError("Un dato del documento è troppo lungo. Verifica l'anagrafica o le condizioni economiche.", 409, "INVOICE_TEXT_TOO_LONG");
    if ([...text].some(char => !supported.has(char.codePointAt(0)!))) throw new AppError("Il documento contiene caratteri che il modello non può ancora rappresentare correttamente.", 409, "INVOICE_TEXT_UNSUPPORTED");
    return text;
  };
  const wrap = (value: string, width: number, size = 9.5, font = regular) => {
    const result: string[] = [];
    let line = "";
    for (const word of safe(value).split(" ")) {
      if (!word) continue;
      if (font.widthOfTextAtSize(line ? `${line} ${word}` : word, size) <= width) { line = line ? `${line} ${word}` : word; continue; }
      if (line) { result.push(line); line = ""; }
      for (const char of word) {
        if (line && font.widthOfTextAtSize(line + char, size) > width) { result.push(line); line = ""; }
        line += char;
      }
    }
    if (line) result.push(line);
    return result.length ? result : [""];
  };
  let companyLogo: PDFImage | null = null, fleetumLogo: PDFImage | null = null;
  if (logo) { try { companyLogo = await doc.embedPng(logo); } catch { /* Text fallback retains the legal issuer below. */ } }
  try { fleetumLogo = await doc.embedPng(await fs.readFile(asset("fleetum-logo-horizontal.png"))); } catch { /* Wordmark fallback. */ }
  const drawLogo = (image: PDFImage, x: number, y: number, width: number, height: number, target: PDFPage) => {
    const scale = Math.min(width / image.width, height / image.height);
    target.drawImage(image, { x, y: y + (height - image.height * scale) / 2, width: image.width * scale, height: image.height * scale });
  };
  let page!: PDFPage;
  let y = 0;
  const text = (value: string, x: number, top: number, size = 9.5, font = regular, color = INK) => page.drawText(safe(value), { x, y: top, size, font, color });
  const right = (value: string, edge: number, top: number, size = 9.5, font = regular) => text(value, edge - font.widthOfTextAtSize(safe(value), size), top, size, font);
  const newPage = () => {
    if (doc.getPageCount() >= 15) throw new AppError("Il documento supera la dimensione prevista. Verifica i dati della pratica.", 409, "INVOICE_TOO_MANY_PAGES");
    page = doc.addPage([W, H]); y = H - 146;
    page.drawRectangle({ x: 0, y: H - 4, width: W, height: 4, color: INK });
    if (companyLogo) drawLogo(companyLogo, M, H - 91, 170, 44, page); else text("Autonoleggio", M, H - 66, 16, bold);
    right("Bozza fattura", W - M, H - 58, 22, bold);
    right("Pratica di noleggio", W - M, H - 79, 9, regular);
    page.drawLine({ start: { x: M, y: H - 107 }, end: { x: W - M, y: H - 107 }, color: LINE, thickness: .7 });
    text(model.statusLabel, M, H - 122, 8, bold, BLUE);
    right(model.amountBasis === "FINAL" ? "Importi finali salvati" : "Importi previsti salvati", W - M, H - 122, 8);
  };
  const ensure = (height: number) => { if (y - height < BOTTOM) newPage(); };
  newPage();

  const parties = [model.issuer, model.customer].map(party => [
    ...wrap(party.name, (CW - 18) / 2 - 24, 11, bold).map(value => ({ value, font: bold, size: 11 })),
    ...party.details.flatMap(detail => wrap(detail, (CW - 18) / 2 - 24).map(value => ({ value, font: regular, size: 9.5 })))
  ]);
  const offsets = [0, 0];
  while (offsets.some((offset, i) => offset < parties[i].length)) {
    ensure(80);
    const capacity = Math.max(1, Math.floor((y - BOTTOM - 38) / 14));
    const count = Math.min(capacity, Math.max(...parties.map((lines, i) => lines.length - offsets[i])));
    const height = count * 14 + 34;
    parties.forEach((lines, i) => {
      const x = M + i * ((CW - 18) / 2 + 18), width = (CW - 18) / 2;
      page.drawRectangle({ x, y: y - height, width, height, color: PALE });
      text(i ? "CLIENTE" : "EMITTENTE", x + 12, y - 16, 7.5, bold, MUTED);
      lines.slice(offsets[i], offsets[i] + count).forEach((line, index) => text(line.value, x + 12, y - 35 - index * 14, line.size, line.font));
      offsets[i] += count;
    });
    y -= height + 20;
    if (offsets.some((offset, i) => offset < parties[i].length)) newPage();
  }
  const facts = [
    ["PRATICA", model.code, "PREPARATA IL", date(model.generatedAt)],
    ["RITIRO", `${date(model.pickupAt)} - ${model.pickupSite}`, "RESTITUZIONE", `${date(model.returnAt)} - ${model.returnSite}`],
    ["VEICOLO", model.vehicle, "SEDE RESPONSABILE", model.responsibleSite]
  ];
  for (const [leftLabel, leftValue, rightLabel, rightValue] of facts) {
    const values = [wrap(leftValue, CW / 2 - 16), wrap(rightValue, CW / 2 - 16)];
    const height = 25 + Math.max(...values.map(lines => lines.length)) * 13;
    if (height > H - 146 - BOTTOM - 6) throw new AppError("Un dato del documento è troppo lungo. Verifica l'anagrafica o le condizioni economiche.", 409, "INVOICE_TEXT_TOO_LONG");
    ensure(height + 6);
    for (const i of [0, 1]) {
      const x = M + i * (CW / 2 + 5);
      text(i ? rightLabel : leftLabel, x, y - 8, 7.5, bold, MUTED);
      values[i].forEach((line, index) => text(line, x, y - 25 - index * 13));
    }
    y -= height;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, color: LINE, thickness: .5 });
    y -= 12;
  }
  const heading = () => {
    ensure(60);
    page.drawRectangle({ x: M, y: y - 28, width: CW, height: 28, color: PALE });
    text("DESCRIZIONE", M + 10, y - 18, 8, bold, MUTED); text("QUANTITÀ", M + 320, y - 18, 8, bold, MUTED);
    text("IMPORTO", M + 421, y - 18, 8, bold, MUTED); y -= 38;
  };
  heading();
  for (const item of model.items) {
    const lines = [
      ...wrap(item.description, 296, 10, bold).map(value => ({ value, font: bold, size: 10, color: INK })),
      ...wrap(item.detail, 296).map(value => ({ value, font: regular, size: 9.5, color: MUTED }))
    ];
    let offset = 0;
    while (offset < lines.length) {
      if (y - 40 < BOTTOM) { newPage(); heading(); }
      const capacity = Math.max(1, Math.floor((y - BOTTOM - 14) / 14));
      const part = lines.slice(offset, offset + capacity);
      part.forEach((line, index) => text(line.value, M + 10, y - index * 14, line.size, line.font, line.color));
      if (offset === 0) { text(item.quantity, M + 320, y, 9); right(money(item.amount), W - M - 10, y, 10); }
      offset += part.length; y -= part.length * 14 + 12;
      page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, color: LINE, thickness: .5 }); y -= 12;
      if (offset < lines.length) { newPage(); heading(); }
    }
  }
  ensure(132); y -= 8;
  const totals = [["Imponibile", model.subtotal], [model.vatRate === null ? "Imposte registrate" : `IVA ${model.vatRate}%`, model.tax], ["Totale bozza", model.total]];
  totals.forEach(([label, value], index) => {
    if (index === 2) page.drawRectangle({ x: W - M - 270, y: y - 23, width: 270, height: 34, color: rgb(.93, .95, 1) });
    text(label, W - M - 260, y - 10, 10, index === 2 ? bold : regular); right(money(value), W - M - 10, y - 10, 10, index === 2 ? bold : regular); y -= 34;
  });
  y -= 18;
  for (const note of [...model.warnings,
    "Documento preparatorio dai dati attuali della prenotazione, privo di numero di emissione.",
    "Verificare anagrafiche, importi ed eventuali voci aggiuntive prima dell'emissione. I dati potranno cambiare aggiornando la pratica."] ) {
    const lines = wrap(note, CW, 8.5);
    for (const line of lines) { ensure(15); text(line, M, y, 8.5, regular, MUTED); y -= 12; }
    y -= 5;
  }
  const pages = doc.getPages();
  pages.forEach((target, index) => {
    target.drawLine({ start: { x: M, y: 53 }, end: { x: W - M, y: 53 }, color: LINE, thickness: .6 });
    if (fleetumLogo) drawLogo(fleetumLogo, M, 22, 65, 20, target);
    target.drawText("Gestito con Fleetum", { x: fleetumLogo ? M + 75 : M, y: 30, font: regular, size: 8, color: MUTED });
    target.drawText(`${index + 1} / ${pages.length}`, { x: W - M - 30, y: 30, font: regular, size: 8, color: MUTED });
  });
  doc.setTitle(`Bozza fattura - ${model.code}`); doc.setAuthor("Fleetum"); doc.setCreationDate(new Date(model.generatedAt)); doc.setModificationDate(new Date(model.generatedAt));
  return Buffer.from(await doc.save());
};
