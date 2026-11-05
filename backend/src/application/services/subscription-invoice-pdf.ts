import fs from "node:fs/promises";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { AppError } from "../../shared/errors/app-error.js";

export type InvoiceIssuer = { name: string; vat: string; address: string; email: string; pec: string; sdi: string; iban: string; website: string };
export type SubscriptionInvoiceData = {
  invoiceNumber: string; issueDate: Date; dueDate: Date; periodStart: Date; periodEnd: Date;
  status: string; currency: string; subtotal: number; taxRate: number; taxAmount: number; total: number;
  billingName: string; billingAddress: string | null; billingVatNumber: string | null; billingTaxCode: string | null;
  billingEmail: string | null; billingPec: string | null; billingSdi: string | null; notes: string | null;
  items: Array<{ description: string; quantity: number; unitPrice: number; subtotal: number; taxRate: number; taxAmount: number; total: number }>;
};
const W = 595.28, H = 841.89, M = 42, CW = W - M * 2, BOTTOM = 73;
const INK = rgb(.078, .149, .247), MUTED = rgb(.34, .40, .48), BLUE = rgb(.19, .35, .78), LINE = rgb(.84, .87, .91), PALE = rgb(.96, .97, .98);
const asset = (name: string) => new URL(`../../../assets/invoice/${name}`, import.meta.url);
const date = (value: Date) => new Intl.DateTimeFormat("it-IT", { timeZone: "UTC" }).format(value);
const statusLabels: Record<string, string> = { DRAFT: "BOZZA", GENERATED: "GENERATA", SENT: "INVIATA", PAID: "PAGATA", OVERDUE: "SCADUTA", VOID: "ANNULLATA", ERROR: "ERRORE" };

// Presentation consumes stored invoice and item amounts. It never reprices a
// plan, applies today's VAT, consults a live customer profile or adds payments.
export const renderSubscriptionInvoicePdf = async (invoice: SubscriptionInvoiceData, issuer: InvoiceIssuer, options: { companyLogo?: Uint8Array | null; legacy?: boolean; fleetumLogo?: Uint8Array | null } = {}) => {
  const doc = await PDFDocument.create(); doc.registerFontkit(fontkit);
  let regular: PDFFont, bold: PDFFont;
  try { [regular, bold] = await Promise.all(["Regular", "Bold"].map(async face => doc.embedFont(await fs.readFile(asset(`LiberationSans-${face}.ttf`)), { subset: true }))); }
  catch { throw new AppError("Caratteri del documento temporaneamente non disponibili.", 503, "INVOICE_PDF_ASSETS"); }
  const supported = new Set(regular.getCharacterSet());
  const safe = (value: string) => {
    const text = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/gu, " ").trim();
    if (text.length > 4000) throw new AppError("Un dato della fattura è troppo lungo. Verifica il documento.", 409, "INVOICE_TEXT_TOO_LONG");
    if ([...text].some(char => !supported.has(char.codePointAt(0)!))) throw new AppError("Il documento contiene caratteri non ancora rappresentabili nel modello PDF.", 409, "INVOICE_TEXT_UNSUPPORTED");
    return text;
  };
  if (invoice.items.length > 500) throw new AppError("La fattura contiene troppe righe per questo modello.", 409, "INVOICE_TOO_MANY_PAGES");
  const currency = /^[A-Z]{3}$/.test(invoice.currency) ? invoice.currency : "";
  const money = (value: number) => {
    if (!currency || !Number.isFinite(value) || Math.abs(value) > 999999999999.99) throw new AppError("Importi del documento non validi. Verifica la fattura salvata.", 409, "INVOICE_AMOUNTS_INVALID");
    return new Intl.NumberFormat("it-IT", { style: "currency", currency }).format(value);
  };
  const wrap = (value: string, width: number, size = 9.5, font = regular) => {
    const lines: string[] = []; let line = "";
    for (const word of safe(value).split(" ").filter(Boolean)) {
      if (font.widthOfTextAtSize(line ? `${line} ${word}` : word, size) <= width) { line = line ? `${line} ${word}` : word; continue; }
      if (line) { lines.push(line); line = ""; }
      for (const char of word) {
        if (line && font.widthOfTextAtSize(line + char, size) > width) { lines.push(line); line = ""; }
        line += char;
      }
    }
    if (line) lines.push(line); return lines.length ? lines : [""];
  };
  const embed = async (bytes?: Uint8Array | null) => { if (!bytes) return null; try { return await doc.embedPng(bytes); } catch { return null; } };
  const companyLogo = await embed(options.companyLogo);
  const fleetumLogo = await embed(options.fleetumLogo === undefined ? await fs.readFile(asset("fleetum-logo-horizontal.png")).catch(() => null) : options.fleetumLogo);
  let page!: PDFPage, y = 0;
  const text = (value: string, x: number, top: number, size = 9.5, font = regular, color = INK) => page.drawText(safe(value), { x, y: top, size, font, color });
  const right = (value: string, edge: number, top: number, width: number, size = 9.5, font = regular) => {
    value = safe(value); while (size > 6 && font.widthOfTextAtSize(value, size) > width) size -= .25;
    if (font.widthOfTextAtSize(value, size) > width) throw new AppError("Un valore del documento supera lo spazio disponibile.", 409, "INVOICE_TEXT_TOO_LONG");
    text(value, edge - font.widthOfTextAtSize(value, size), top, size, font);
  };
  const logo = (image: PDFImage, x: number, top: number, width: number, height: number) => {
    const ratio = Math.min(width / image.width, height / image.height);
    page.drawImage(image, { x, y: top - height + (height - image.height * ratio) / 2, width: image.width * ratio, height: image.height * ratio });
  };
  const newPage = () => {
    if (doc.getPageCount() >= 15) throw new AppError("La fattura supera la dimensione prevista dal modello PDF.", 409, "INVOICE_TOO_MANY_PAGES");
    page = doc.addPage([W, H]); y = H - 154;
    page.drawRectangle({ x: 0, y: H - 4, width: W, height: 4, color: BLUE });
    if (fleetumLogo) logo(fleetumLogo, M, H - 34, 132, 38); else text("Fleetum", M, H - 62, 23, bold);
    right("Abbonamento", W - M, H - 54, 300, 21, bold);
    const reference = wrap(invoice.invoiceNumber, 300, 10, bold);
    if (reference.length > 2) throw new AppError("Riferimento fattura troppo lungo per il modello.", 409, "INVOICE_TEXT_TOO_LONG");
    reference.forEach((line, i) => right(line, W - M, H - 75 - i * 13, 300, 10, bold));
    text("DOCUMENTO RIEPILOGATIVO / COPIA DI CORTESIA", M, H - 113, 7.7, bold, BLUE);
    right(statusLabels[invoice.status] ?? "STATO NON DISPONIBILE", W - M, H - 113, 135, 8, bold);
    page.drawLine({ start: { x: M, y: H - 128 }, end: { x: W - M, y: H - 128 }, color: LINE, thickness: .7 });
  };
  const ensure = (height: number) => { if (y - height < BOTTOM) newPage(); };
  newPage();
  const parties = [
    { name: issuer.name, details: [issuer.address, issuer.vat, issuer.email, issuer.pec ? `PEC ${issuer.pec}` : "", issuer.sdi ? `SDI ${issuer.sdi}` : "", issuer.website] },
    { name: invoice.billingName, details: [invoice.billingAddress, invoice.billingVatNumber ? `P.IVA ${invoice.billingVatNumber}` : "", invoice.billingTaxCode ? `CF ${invoice.billingTaxCode}` : "", invoice.billingEmail, invoice.billingPec ? `PEC ${invoice.billingPec}` : "", invoice.billingSdi ? `SDI ${invoice.billingSdi}` : ""] }
  ].map(party => [
    ...wrap(party.name, (CW - 18) / 2 - 24, 11, bold).map(value => ({ value, size: 11, font: bold })),
    ...party.details.filter((value): value is string => Boolean(value)).flatMap(value => wrap(value, (CW - 18) / 2 - 24).map(value => ({ value, size: 9.5, font: regular })))
  ]);
  const offsets = [0, 0]; let firstPart = true;
  while (offsets.some((offset, i) => offset < parties[i].length)) {
    ensure(115);
    const logoSpace = firstPart && companyLogo ? 46 : 0;
    const capacity = Math.max(1, Math.floor((y - BOTTOM - 38 - logoSpace) / 14));
    const count = Math.min(capacity, Math.max(...parties.map((lines, i) => lines.length - offsets[i]))), height = 34 + logoSpace + count * 14;
    parties.forEach((lines, i) => {
      const x = M + i * ((CW - 18) / 2 + 18), width = (CW - 18) / 2;
      page.drawRectangle({ x, y: y - height, width, height, color: PALE });
      text(i ? "DESTINATARIO" : "EMITTENTE", x + 12, y - 16, 7.5, bold, MUTED);
      if (i === 1 && logoSpace) logo(companyLogo!, x + 12, y - 25, width - 24, 34);
      lines.slice(offsets[i], offsets[i] + count).forEach((line, j) => text(line.value, x + 12, y - 35 - logoSpace - j * 14, line.size, line.font));
      offsets[i] += count;
    });
    y -= height + 20; firstPart = false;
    if (offsets.some((offset, i) => offset < parties[i].length)) newPage();
  }
  ensure(62);
  for (const [i, label, value] of [[0, "DATA DOCUMENTO", date(invoice.issueDate)], [1, "SCADENZA", date(invoice.dueDate)], [2, "PERIODO ABBONAMENTO", `${date(invoice.periodStart)} - ${date(invoice.periodEnd)}`]] as const) {
    const x = M + i * (CW / 3);
    text(label, x, y, 7.2, bold, MUTED);
    wrap(value, CW / 3 - 8, 9).forEach((line, j) => text(line, x, y - 17 - j * 12, 9));
  }
  y -= 56;
  const heading = () => {
    ensure(60); page.drawRectangle({ x: M, y: y - 28, width: CW, height: 28, color: PALE });
    text("DESCRIZIONE", M + 10, y - 18, 8, bold, MUTED);
    right("Q.TÀ", M + 300, y - 18, 40, 8, bold);
    right("PREZZO UNIT.", M + 397, y - 18, 90, 8, bold);
    right("TOTALE RIGA", W - M - 10, y - 18, 90, 8, bold); y -= 41;
  };
  heading();
  for (const item of invoice.items) {
    if (!Number.isFinite(item.quantity) || Math.abs(item.quantity) > 1e9 || !Number.isFinite(item.taxRate)) throw new AppError("Dati delle righe fattura non validi.", 409, "INVOICE_AMOUNTS_INVALID");
    const lines = [
      ...wrap(item.description, 240, 9.5, bold).map(value => ({ value, font: bold, size: 9.5, color: INK })),
      ...wrap(`Imponibile ${money(item.subtotal)} - IVA ${item.taxRate}%: ${money(item.taxAmount)}`, 240, 8).map(value => ({ value, font: regular, size: 8, color: MUTED }))
    ];
    const rowHeight = lines.length * 13 + 22;
    if (rowHeight <= H - 154 - BOTTOM - 41 && y - rowHeight < BOTTOM) { newPage(); heading(); }
    let offset = 0;
    while (offset < lines.length) {
      if (y - 42 < BOTTOM) { newPage(); heading(); }
      const capacity = Math.max(1, Math.floor((y - BOTTOM - 22) / 13)), part = lines.slice(offset, offset + capacity);
      part.forEach((line, j) => text(line.value, M + 10, y - j * 13, line.size, line.font, line.color));
      if (!offset) {
        right(String(item.quantity), M + 300, y, 40); right(money(item.unitPrice), M + 397, y, 90); right(money(item.total), W - M - 10, y, 90, 9.5, bold);
      }
      offset += part.length; y -= part.length * 13 + 8;
      page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, color: LINE, thickness: .5 }); y -= 14;
      if (offset < lines.length) { newPage(); heading(); }
    }
  }
  const notes = [
    options.legacy ? "Copia ricostruita dai dati salvati. Logo storico e dati emittente all'origine non archiviati; dati Fleetum dalla configurazione corrente." : "Copia conservata alla generazione. Lo stato mostrato si riferisce a quel momento; lo stato aggiornato è disponibile nell'area fatture.",
    issuer.iban ? `Coordinate per il pagamento secondo gli accordi contrattuali: ${issuer.iban}` : "",
    invoice.notes ?? "", "Documento riepilogativo di cortesia. Non sostituisce la fattura elettronica o il documento fiscale del soggetto emittente."
  ];
  const notesHeight = notes.filter(Boolean).reduce((height, note) => height + wrap(note, CW, 8.3).length * 12 + 6, 0);
  ensure(Math.min(H - 154 - BOTTOM, 124 + 13 + notesHeight)); y -= 8;
  const mixedRates = invoice.items.some(item => item.taxRate !== invoice.taxRate);
  const totals = [["Imponibile", money(invoice.subtotal)], [mixedRates ? "Imposte registrate" : `IVA ${invoice.taxRate}%`, money(invoice.taxAmount)], ["Totale documento", money(invoice.total)]];
  totals.forEach(([label, value], i) => {
    if (i === 2) page.drawRectangle({ x: W - M - 280, y: y - 23, width: 280, height: 34, color: PALE });
    text(label, W - M - 270, y - 10, 10, i === 2 ? bold : regular);
    right(value, W - M - 10, y - 10, 120, 10, i === 2 ? bold : regular); y -= 34;
  });
  y -= 13;
  for (const note of notes.filter(Boolean)) {
    for (const line of wrap(note, CW, 8.3)) { ensure(14); text(line, M, y, 8.3, regular, MUTED); y -= 12; } y -= 6;
  }
  const pages = doc.getPages();
  pages.forEach((target, i) => {
    target.drawLine({ start: { x: M, y: 53 }, end: { x: W - M, y: 53 }, color: LINE, thickness: .6 });
    target.drawText("Fleetum Billing - Copia di cortesia", { x: M, y: 30, size: 8, font: regular, color: MUTED });
    target.drawText(`${i + 1} / ${pages.length}`, { x: W - M - 30, y: 30, size: 8, font: regular, color: MUTED });
  });
  doc.setTitle(`Abbonamento Fleetum - ${safe(invoice.invoiceNumber)}`); doc.setAuthor("Fleetum"); doc.setCreationDate(invoice.issueDate); doc.setModificationDate(invoice.issueDate);
  return Buffer.from(await doc.save());
};
