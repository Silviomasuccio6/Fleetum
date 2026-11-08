import {rentalTermsSchema,rentalTermLabels} from "./contract-rental-terms.js";
import {contractPdfFonts,CONTRACT_PDF_LAYOUT} from "./contract-pdf-fonts.js";
import {AppError} from "../../shared/errors/app-error.js";
import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { storageProvider } from "../../infrastructure/storage/storage-provider.js";

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

export type EnterpriseContractPdfInput = {
  contract: {
    issuedAt?: Date | string | null;
    documentRevision?: number;
    rentalTerms?: unknown;
    drivers?: NonNullable<EnterpriseContractPdfInput["booking"]["customer"]>[];
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
    priceAgreement?: unknown;
    collections?: {recordedAt:Date|string;receivedCents:number;outstandingCents:number|null;creditCents:number;state:string};
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

const BASE_RATE_UNIT_LABELS: Record<string, string> = {
  DAILY: "Giornaliera",
  WEEKLY: "Settimanale",
  MONTHLY: "Mensile"
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
  return parsed.toLocaleDateString("it-IT",{timeZone:"Europe/Rome"});
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
  const chunks=words.flatMap(word=>{
    const result:string[]=[];let part="";
    for(const char of word){if(part&&font.widthOfTextAtSize(part+char,fontSize)>maxWidth){result.push(part);part=char;}else part+=char;}
    if(part)result.push(part);return result;
  });
  for (const word of chunks) {
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

const maybeEmbedStoredImage = async (pdfDoc: PDFDocument, storageKey?: string | null): Promise<PDFImage | null> => {
  if (!storageKey) return null;
  try {
    const image = await storageProvider.read(storageKey);
    const extension = path.extname(storageKey).toLowerCase();
    if (extension === ".png") return await pdfDoc.embedPng(image);
    if (extension === ".jpg" || extension === ".jpeg") return await pdfDoc.embedJpg(image);
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

const compactJoin = (...values: Array<string | null | undefined>) =>
  values
    .map((value) => asText(value, ""))
    .filter(Boolean)
    .join(" · ");

export const buildEnterpriseContractPdf = async (input: EnterpriseContractPdfInput): Promise<Buffer> => {
  const requestedPrimary=sanitizeHex(input.branding?.brandPrimary,"#1f3763");
  const linear=(value:number)=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4;
  const components=[1,3,5].map(offset=>linear(parseInt(requestedPrimary.slice(offset,offset+2),16)/255));
  const luminance=.2126*components[0]+.7152*components[1]+.0722*components[2];
  // Print on white paper: a tenant's light brand colour must never hide contract text.
  const primaryHex=1.05/(luminance+.05)>=4.5?requestedPrimary:"#1f3763";
  const accentHex = sanitizeHex(input.branding?.brandAccent, "#5b8bd9");
  const pdfDoc = await PDFDocument.create();
  const {regular:regularFont,bold:boldFont,validate}=await contractPdfFonts(pdfDoc);
  validate(input);
  const headingFont=boldFont;
  pdfDoc.setSubject(CONTRACT_PDF_LAYOUT);

  const companyName = asText(input.branding?.companyName, "Locatore da compilare");
  const companyAddress = asText(input.branding?.companyAddress, "Indirizzo da compilare");
  const companyVat = asText(input.branding?.companyVat, "P.IVA / CF da compilare");
  const companyEmail = asText(input.branding?.companyEmail, "Email da compilare");
  const companyPhone = asText(input.branding?.companyPhone, "Telefono da compilare");

  pdfDoc.setTitle(input.contract.title);pdfDoc.setAuthor(companyName);
  const fitText=(text:string,width:number,font:PDFFont,size:number)=>{
    if(font.widthOfTextAtSize(text,size)<=width)return text;
    let value=text;while(value&&font.widthOfTextAtSize(value+"...",size)>width)value=value.slice(0,-1);return value+"...";
  };
  let fleetumMark: PDFImage | null = null;
  const pages: PDFPage[] = [];
  const addFooter = (page: PDFPage, pageNumber: number, totalPages: number) => {
    page.drawLine({
      start: { x: MARGIN_X, y: 38 },
      end: { x: PAGE_W - MARGIN_X, y: 38 },
      thickness: 0.6,
      color: hexToRgb("#d2daea")
    });
    page.drawText(fitText(`${companyName} · ${companyVat}`,165,regularFont,7.5), {
      x: MARGIN_X,
      y: 24,
      size: 7.5,
      font: regularFont,
      color: hexToRgb("#5c6e8f")
    });
    const pageLabel=`Contratto - pagina ${pageNumber} di ${totalPages}`;
    page.drawText(pageLabel, {
      x: PAGE_W - MARGIN_X - regularFont.widthOfTextAtSize(pageLabel,7.5),
      y: 24,
      size: 7.5,
      font: regularFont,
      color: hexToRgb("#5c6e8f")
    });
    const poweredBy = "Powered by Fleetum";
    const poweredWidth = regularFont.widthOfTextAtSize(poweredBy, 7.2);
    const poweredX = PAGE_W / 2 - poweredWidth / 2 - 12;
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
      color: hexToRgb("#526277")
    });
  };

  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  pages.push(page);
  const contentWidth = PAGE_W - MARGIN_X * 2;
  let cursorY = PAGE_H - 160;
  fleetumMark = await maybeEmbedFirstExistingImage(pdfDoc, [
    "../frontend/public/brand/fleetum-favicon.png", "frontend/public/brand/fleetum-favicon.png", "../../frontend/public/brand/fleetum-favicon.png"
  ]);
  const signatureImage = await maybeEmbedStoredImage(pdfDoc, input.contract.signatureFilePath);
  const companyLogo=await maybeEmbedStoredImage(pdfDoc,input.branding?.logoFilePath);
  page.drawRectangle({x:0,y:PAGE_H-4,width:PAGE_W,height:4,color:hexToRgb(primaryHex)});
  const logoWidth=companyLogo?82:0;
  if(companyLogo){const scale=Math.min(70/companyLogo.width,42/companyLogo.height);page.drawImage(companyLogo,{x:MARGIN_X,y:PAGE_H-87,width:companyLogo.width*scale,height:companyLogo.height*scale});}
  page.drawText(fitText(companyName,contentWidth-logoWidth,boldFont,14),{x:MARGIN_X+logoWidth,y:PAGE_H-59,size:14,font:boldFont,color:hexToRgb(primaryHex)});
  page.drawText(fitText(`${companyAddress} · ${companyVat}`,contentWidth-logoWidth,regularFont,8.5),{x:MARGIN_X+logoWidth,y:PAGE_H-76,size:8.5,font:regularFont,color:hexToRgb("#546177")});
  page.drawLine({start:{x:MARGIN_X,y:PAGE_H-100},end:{x:PAGE_W-MARGIN_X,y:PAGE_H-100},thickness:.7,color:hexToRgb("#d8e0e9")});
  page.drawText("CONTRATTO DI NOLEGGIO",{x:MARGIN_X,y:PAGE_H-132,size:20,font:headingFont,color:hexToRgb(primaryHex)});
  const signed=Boolean(input.contract.signedAt??input.booking.contractSignedAt);
  const issued=Boolean(input.contract.issuedAt)||signed;
  const state=signed?"Firma registrata":issued?"Da sottoscrivere":"BOZZA - NON EMESSO";
  // This is the business revision, not the retry/version number of a signing invitation.
  const revision=`Revisione ${(input.contract.documentRevision??0)+1}`;
  const titleLines=wrapLines(asText(input.contract.title,"Contratto di noleggio"),contentWidth,regularFont,10);
  if(titleLines.length>12)throw new AppError('Il titolo del contratto è troppo lungo. Riducilo prima di generare il PDF.',422,'CONTRACT_PDF_TITLE_TOO_LONG');
  for(const line of titleLines){page.drawText(line,{x:MARGIN_X,y:cursorY,size:10,font:regularFont,color:hexToRgb("#546177")});cursorY-=14;}
  cursorY-=8;
  for(const line of wrapLines(`Contratto ${asText(input.booking.code)} · ${revision} · ${state}${input.contract.templateVersion?` · Modello v${input.contract.templateVersion}`:""}`,contentWidth,boldFont,9)){
    page.drawText(line,{x:MARGIN_X,y:cursorY,size:9,font:boldFont,color:hexToRgb(primaryHex)});cursorY-=13;
  }
  if(input.contract.issuedAt){page.drawText(`Emesso il ${formatDateTime(input.contract.issuedAt)}`,{x:MARGIN_X,y:cursorY-2,size:8.5,font:regularFont,color:hexToRgb("#546177")});cursorY-=15;}
  cursorY-=20;

  const createContentPage = (title = "Contratto noleggio - continua") => {
    page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    pages.push(page);
    if(pages.length>40)throw new AppError("Il contratto supera 40 pagine. Verifica le condizioni prima di emetterlo.",422,"CONTRACT_PDF_TOO_MANY_PAGES");
    page.drawRectangle({ x: 0, y: PAGE_H - 46, width: PAGE_W, height: 46, color: hexToRgb("#f3f5f7") });
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
      color: hexToRgb("#f3f5f7")
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

  const drawPremiumSection = (title: string) => {
    ensureSpace(86, title);
    page.drawRectangle({
      x: MARGIN_X,
      y: cursorY - 24,
      width: contentWidth,
      height: 24,
      color: hexToRgb("#f3f5f7")
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

  // Label/value grids retain every line, also when a single field spans pages.
  const drawFieldRows = (title:string,rows:Array<Array<InfoItem|undefined>>) => {
    const gap=14,width=(contentWidth-gap)/2;
    for(const row of rows){
      const metrics=row.map(item=>({item,labels:item?wrapLines(item.label.toUpperCase(),width-24,boldFont,7.5):[],values:item?wrapLines(asText(item.value),width-24,item.emphasize?boldFont:regularFont,10):[]}));
      const lineCount=Math.max(1,...metrics.map(value=>value.values.length)),labelCount=Math.max(1,...metrics.map(value=>value.labels.length));
      for(let start=0;start<lineCount;start+=30){
        const count=Math.min(30,lineCount-start),height=19+labelCount*9+count*12;
        ensureSpace(height+8,title+" - continua");
        metrics.forEach(({item,labels,values},column)=>{if(!item)return;const x=MARGIN_X+column*(width+gap);
          drawPremiumCard(x,cursorY,width,height);
          labels.forEach((line,index)=>page.drawText(line,{x:x+12,y:cursorY-15-index*9,size:7.5,font:boldFont,color:hexToRgb("#687893")}));
          values.slice(start,start+count).forEach((line,index)=>page.drawText(line,{x:x+12,y:cursorY-21-labelCount*9-index*12,size:10,font:item.emphasize?boldFont:regularFont,color:hexToRgb("#182338")}));
        });cursorY-=height+8;
      }
    }cursorY-=7;
  };
  const firstFieldHeight=(items:Array<InfoItem|undefined>)=>{
    const width=(contentWidth-14)/2-24;
    const labelCount=Math.max(1,...items.map(item=>item?wrapLines(item.label.toUpperCase(),width,boldFont,7.5).length:0));
    const valueCount=Math.min(30,Math.max(1,...items.map(item=>item?wrapLines(asText(item.value),width,item.emphasize?boldFont:regularFont,10).length:0)));
    return 19+labelCount*9+valueCount*12;
  };
  const drawCompleteFields = (title:string,items:InfoItem[]) => {
    ensureSpace(38+firstFieldHeight(items.slice(0,2))+8,title);drawPremiumSection(title);
    const rows:Array<Array<InfoItem|undefined>>=[];for(let index=0;index<items.length;index+=2)rows.push(items.slice(index,index+2));
    drawFieldRows(title,rows);
  };
  const drawPremiumParties = (leftTitle:string,leftItems:InfoItem[],rightTitle:string,rightItems:InfoItem[]) => {
    ensureSpace(38+firstFieldHeight([leftItems[0],rightItems[0]])+8,"Parti contrattuali");drawPremiumSection("Parti contrattuali");
    drawFieldRows("Parti contrattuali",Array.from({length:Math.max(leftItems.length,rightItems.length)},(_,index)=>[
      leftItems[index]?{...leftItems[index],label:(index===0?leftTitle+" / ":"")+leftItems[index].label}:undefined,
      rightItems[index]?{...rightItems[index],label:(index===0?rightTitle+" / ":"")+rightItems[index].label}:undefined
    ]));
  };
  const drawPremiumVehiclePeriod = () => drawCompleteFields("Veicolo e periodo di noleggio",rentalDetails);
  const drawPremiumEconomicTable = (items: Array<[string,string,string,boolean?]>) => {
    // Fixed, non-overlapping columns; all descriptions and money values wrap independently.
    const widths=[144,201,contentWidth-144-201],size=8.8;
    const firstHeight=items.length?24+Math.min(30,Math.max(...items[0].slice(0,3).map((value,index)=>wrapLines(asText(String(value)),widths[index]-24,index===1?regularFont:boldFont,size).length)))*12:0;
    ensureSpace(38+firstHeight+8,"Condizioni economiche");drawPremiumSection("Condizioni economiche");
    for(const [label,description,value,important]of items){
      const columns=[label,description,value].map((text,index)=>wrapLines(asText(text),widths[index]-24,index===1?regularFont:boldFont,size));
      const total=Math.max(...columns.map(lines=>lines.length));
      for(let offset=0;offset<total;offset+=30){
        const count=Math.min(30,total-offset),height=24+count*12;
        ensureSpace(height+8,"Condizioni economiche - continua");
        drawPremiumCard(MARGIN_X,cursorY,contentWidth,height);
        let x=MARGIN_X;
        columns.forEach((lines,column)=>{lines.slice(offset,offset+count).forEach((line,index)=>page.drawText(line,{x:x+12,y:cursorY-21-index*12,size,font:column===1?regularFont:boldFont,color:hexToRgb(important?"#15563d":"#243656")}));x+=widths[column];});
        cursorY-=height+5;
      }
    }cursorY-=15;
  };

  const drawPremiumDeliverySummary = () => drawCompleteFields("Consegna e riconsegna",[
    {label:"Stato veicolo e danni",value:"Da rilevare e documentare nel verbale di consegna e nel confronto alla riconsegna."},
    {label:"Dotazioni e livelli",value:"Chiavi, documenti, accessori, carburante o carica effettivi da registrare nel verbale; nessuna dotazione è attestata da questo riepilogo."}
  ]);

  const drawSignatures = () => {
    const signedAt = input.contract.signedAt ?? input.booking.contractSignedAt;
    const signedDateLabel = signedAt ? formatDate(signedAt) : "Da compilare alla sottoscrizione";
    const signedPlaceLabel = ""; // The return/pickup branch is not evidence of where the customer signed.
    const statement = signedAt
      ? `Firma registrata il ${formatDateTime(signedAt)}.`
      : "Spazi per la firma su carta. Se la firma è raccolta tramite Fleetum, la registrazione è allegata al documento dopo la conferma; prima della conferma questo PDF non attesta alcuna firma.";
    const statementLines = wrapLines(statement, contentWidth, regularFont, 9);
    ensureSpace(34+statementLines.length*11+6+126,"Sottoscrizione");
    drawSectionTitle("Sottoscrizione");
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
    page.drawText(fitText(signedDateLabel,195,regularFont,8.4), {
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
      page.drawText("____________________", {
        x: clientX + 10,
        y: cardTopY - 64,
        size: 8.2,
        font: regularFont,
        color: hexToRgb("#526277")
      });
    }
    page.drawText("Firma operatore", { x: operatorX, y: cardTopY - 32, size: 8.4, font: boldFont, color: hexToRgb("#546988") });
    page.drawText("____________",{x:operatorX,y:cardTopY-64,size:8.2,font:regularFont,color:hexToRgb("#526277")});
    cursorY -= cardHeight + 12;
  };

  const companyCustomer = isCorporateCustomer(input.booking);
  const legalRep = [asText(input.booking.customer?.legalRepFirstName, ""), asText(input.booking.customer?.legalRepLastName, "")]
    .filter(Boolean)
    .join(" ")
    .trim();
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

  const driverItems: InfoItem[] = input.contract.drivers?.length?input.contract.drivers.flatMap((driver,index)=>[
    {label:index===0?"Conducente principale":"Conducente aggiuntivo",value:[driver.firstName,driver.lastName].filter(Boolean).join(" ")},
    {label:"Identità e residenza",value:compactJoin(driver.taxCode,formatDate(driver.dateOfBirth),driver.placeOfBirth,driver.residenceAddress)},
    {label:"Documento",value:compactJoin(driver.documentType,driver.documentNumber,`scadenza ${formatDate(driver.documentExpiresAt)}`)},
    {label:"Patente",value:compactJoin(driver.drivingLicenseNumber,`categoria ${asText(driver.drivingLicenseCategory)}`,`scadenza ${formatDate(driver.drivingLicenseExpiresAt)}`)}
  ]):[{label:"Conducente principale",value:"Da designare nelle condizioni specifiche. L’intestatario e il legale rappresentante non sono automaticamente autorizzati alla guida."}];

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

  const agreement=input.booking.priceAgreement as {listCents:number;discountCents:number;agreedCents:number;reason:string}|undefined;
  drawPremiumParties(
    "Locatore",
    partyLessor,
    companyCustomer ? "Intestatario giuridico" : "Intestatario persona fisica",
    partyCustomer
  );

  drawCompleteFields("Conducenti autorizzati",driverItems);
  drawPremiumVehiclePeriod();

  const agreed=input.booking.finalTotal??input.booking.expectedTotal;
  const cents=(value:number|null|undefined)=>typeof value==="number"&&Number.isFinite(value)?Math.round(value*100):null;
  if(agreement&&(![agreement.listCents,agreement.discountCents,agreement.agreedCents].every(value=>Number.isSafeInteger(value)&&value>=0)||agreement.listCents-agreement.discountCents!==agreement.agreedCents||cents(agreed)!==agreement.agreedCents))throw new AppError("Prezzo concordato e sconto non sono coerenti. Verifica il riepilogo economico prima di emettere il contratto.",422,"CONTRACT_PRICE_INCONSISTENT");
  const useFinal=snapshot?.finalTotal!==null&&snapshot?.finalTotal!==undefined;
  const tax=useFinal?snapshot?.finalTaxAmount:snapshot?.expectedTaxAmount;
  const net=useFinal?snapshot?.finalSubtotal:snapshot?.expectedSubtotal;
  const snapshotTotal=useFinal?snapshot?.finalTotal:snapshot?.expectedTotal;
  const taxMatches=cents(agreed)!==null&&cents(snapshotTotal)===cents(agreed)&&cents(net)!==null&&cents(tax)!==null&&(cents(net)! + cents(tax)!) === cents(agreed);
  const prices:Array<[string,string,string,boolean?]>=agreement?[
    ["Prezzo prima dello sconto","Importo lordo concordato",formatMoney(agreement.listCents/100)],
    ["Sconto concordato",agreement.reason,formatMoney(agreement.discountCents/100)],
    ["Totale concordato","Gli incassi e la cauzione sono registrati separatamente",formatMoney(agreed),true]
  ]:[
    ["Listino applicato",asText(snapshot?.priceListName),`${formatMoney(snapshot?.baseRateAmount)} / ${labelOf(BASE_RATE_UNIT_LABELS,snapshot?.baseRateUnit)}`],
    ["Totale concordato","Importo salvato della prenotazione, distinto dagli incassi",formatMoney(agreed),true]
  ];
  prices.push(...(taxMatches?[
    ["Imponibile","Dettaglio fiscale salvato coerente con il totale",formatMoney(net)],
    ["IVA",snapshot?.vatRate!==null&&snapshot?.vatRate!==undefined?`Aliquota registrata ${formatNumber(snapshot.vatRate,2)}%`:"Importo fiscale salvato",formatMoney(tax)]
  ] as Array<[string,string,string]>:[
    ["Dettaglio IVA","non disponibile per questo importo concordato. Verificare il documento fiscale; nessuna aliquota è ricostruita automaticamente.","-"]
  ] as Array<[string,string,string]>));
  drawPremiumEconomicTable(prices);
  if(input.booking.collections){
    const balance=input.booking.collections;
    drawCompleteFields("Pagamenti del noleggio - fotografia alla preparazione",[
      {label:"Incassi netti registrati",value:formatMoney(balance.receivedCents/100)},
      {label:"Residuo da incassare",value:balance.outstandingCents===null?"Importo da definire":formatMoney(balance.outstandingCents/100)},
      {label:"Credito del cliente",value:formatMoney(balance.creditCents/100)},
      {label:"Dati rilevati il",value:formatDateTime(balance.recordedAt)},
      {label:"Ambito",value:"Solo movimenti registrati per il canone di questa prenotazione, al netto di rimborsi e storni. Cauzione e preautorizzazioni non costituiscono pagamento. I movimenti successivi restano nel registro e non modificano questo documento."}
    ]);
  }else drawCompleteFields("Pagamenti del noleggio",[{label:"Incassi",value:"Registro incassi non incluso in questa copia. Il totale concordato non attesta l’avvenuto pagamento."}]);
  drawCompleteFields("Chilometri concordati",[
    {label:"Chilometri inclusi",value:formatNumber(snapshot?.includedKmTotal)},
    {label:"Extra chilometrici",value:compactJoin(snapshot?.extraKmPolicyName,snapshot?.notes)||"Condizioni da definire"}
  ]);

  const rentalTerms=rentalTermsSchema.safeParse(input.contract.rentalTerms);
  if(rentalTerms.success){
    const terms=rentalTerms.data;
    drawCompleteFields("Condizioni specifiche concordate",Object.entries(rentalTermLabels).map(([key,label])=>{
      const value=terms[key as keyof typeof rentalTermLabels];
      return{label,value:value===null||value===""?"DA DEFINIRE":typeof value==="number"?(value===0?"Non prevista (0,00 EUR)":formatMoney(value/100)):value};
    }));
    if(terms.annexes.length)drawCompleteFields("Documenti richiamati",[{label:"Elenco documenti previsti",value:terms.annexes.join("; ")+". La loro consegna e sottoscrizione vanno verificate separatamente; questo elenco non incorpora file nel PDF."}]);
  }else drawCompleteFields("Condizioni specifiche",[{label:"Bozza da completare",value:"Conducente, cauzione, franchigie, coperture e regole operative devono essere completati prima dell’invito alla firma."}]);

  drawPremiumDeliverySummary();
  // A complete delivery section may leave ample space: keep short terms on that
  // page instead of forcing a nearly empty page before the contractual text.
  ensureSpace(190,"Condizioni contrattuali - continua");
  cursorY-=10;
  drawSectionTitle("Condizioni contrattuali integrali","Testo integrale predisposto dal locatore e incluso nel documento da sottoscrivere.");
  // Paginate every line, including long clauses; never truncate agreed text.
  for(const paragraph of normalizeMultiline(input.contract.content).split("\n")) {
    if(!paragraph.trim()){cursorY-=8;continue;}
    for(const line of wrapLines(paragraph,contentWidth-12,regularFont,10.5)) {
      ensureSpace(16,"Condizioni contrattuali - continua");
      page.drawText(line,{x:MARGIN_X+4,y:cursorY-2,size:10.5,font:regularFont,color:hexToRgb("#243656")});
      cursorY-=16;
    }
    cursorY-=5;
  }
  cursorY-=14;
  drawSignatures();

  const totalPages = pages.length;
  pages.forEach((entry, index) => addFooter(entry, index + 1, totalPages));

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
};
