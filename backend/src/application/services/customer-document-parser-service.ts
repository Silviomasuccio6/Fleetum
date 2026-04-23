import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
let pdfParseCtorPromise: Promise<any> | null = null;

const getPdfParseCtor = async () => {
  if (!pdfParseCtorPromise) {
    pdfParseCtorPromise = import("pdf-parse").then((module) => module.PDFParse);
  }
  return pdfParseCtorPromise;
};

export type CustomerDocumentDraftFields = {
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  placeOfBirth?: string;
  nationality?: string;
  residenceAddress?: string;
  taxCode?: string;
  documentType?: string;
  documentNumber?: string;
  documentIssuedAt?: string;
  documentExpiresAt?: string;
  documentAuthority?: string;
  drivingLicenseNumber?: string;
  drivingLicenseIssuedAt?: string;
  drivingLicenseExpiresAt?: string;
  drivingLicenseAuthority?: string;
  drivingLicenseCategory?: string;
};

export type RecognizedCustomerDocumentType =
  | "PATENTE"
  | "CARTA_IDENTITA"
  | "PASSAPORTO"
  | "TESSERA_SANITARIA"
  | "DOCUMENTO_GENERICO";

export type ParsedCustomerDocumentDraft = {
  fields: CustomerDocumentDraftFields;
  score: number;
  source: "pdf-text" | "pdf-ocr" | "image-ocr" | "none";
  warnings: string[];
  textPreview: string;
};

const collapseWhitespace = (value: string) => value.replace(/\s+/g, " ").trim();

const formatDateInput = (date: Date) => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const parseDateToken = (value: string): Date | null => {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  let day = 0;
  let month = 0;
  let year = 0;

  if (/^\d{4}[-/.]\d{2}[-/.]\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split(/[-/.]/).map((chunk) => Number(chunk));
    day = d;
    month = m;
    year = y;
  } else if (/^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(raw)) {
    const [d, m, yRaw] = raw.split(/[-/.]/).map((chunk) => Number(chunk));
    day = d;
    month = m;
    if (yRaw < 100) {
      // Pivot dinamico: "72" => 1972, "31" => 2031.
      const nowTwoDigitYear = new Date().getUTCFullYear() % 100;
      year = yRaw > nowTwoDigitYear + 5 ? 1900 + yRaw : 2000 + yRaw;
    } else {
      year = yRaw;
    }
  } else {
    return null;
  }

  if (year < 1940 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const parsed = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
  if (Number.isNaN(parsed.getTime())) return null;
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== month || parsed.getUTCDate() !== day) return null;
  return parsed;
};

const normalizeName = (value: string | null | undefined) => {
  const normalized = collapseWhitespace(String(value ?? ""));
  if (!normalized) return undefined;
  return normalized
    .toLowerCase()
    .replace(/(^|[\s'-])([a-zà-öø-ÿ])/gi, (_match, p1: string, p2: string) => `${p1}${p2.toUpperCase()}`);
};

const normalizeGeneric = (value: string | null | undefined) => {
  const normalized = collapseWhitespace(String(value ?? ""));
  return normalized || undefined;
};

const normalizeCode = (value: string | null | undefined) => {
  const raw = String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return raw || undefined;
};

const isPdf = (mimeType: string, filePath: string) =>
  mimeType === "application/pdf" || path.extname(filePath).toLowerCase() === ".pdf";

const isImage = (mimeType: string, filePath: string) =>
  mimeType.startsWith("image/") || [".jpg", ".jpeg", ".png", ".webp"].includes(path.extname(filePath).toLowerCase());

const extractTextFromPdf = async (filePath: string): Promise<string> => {
  const buffer = await fs.readFile(filePath);
  const PDFParseCtor = await getPdfParseCtor();
  let parser: any = null;
  try {
    parser = new PDFParseCtor({ data: buffer });
    const parsed = await parser.getText();
    return String(parsed?.text ?? "").trim();
  } finally {
    if (parser) await parser.destroy().catch(() => undefined);
  }
};

const extractTextFromImage = async (filePath: string): Promise<string> => {
  try {
    const { stdout } = await execFile("tesseract", [filePath, "stdout", "-l", "ita+eng", "--psm", "6"], {
      timeout: 60_000,
      maxBuffer: 12 * 1024 * 1024
    });
    return String(stdout ?? "").trim();
  } catch {
    return "";
  }
};

const extractOcrTextsFromPdfPages = async (filePath: string): Promise<string[]> => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fermi-customer-doc-ocr-"));
  const outputPrefix = path.join(tempDir, "page");
  try {
    await execFile("pdftoppm", ["-r", "260", "-png", filePath, outputPrefix], {
      timeout: 90_000,
      maxBuffer: 20 * 1024 * 1024
    });

    const files = (await fs.readdir(tempDir))
      .filter((name) => name.toLowerCase().endsWith(".png"))
      .map((name) => path.join(tempDir, name))
      .sort();

    const texts: string[] = [];
    for (const pageFile of files.slice(0, 8)) {
      try {
        const text = await extractTextFromImage(pageFile);
        if (text) texts.push(text);
      } catch {
        // Ignore single page OCR failures.
      }
    }
    return texts;
  } catch {
    return [];
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
};

const extractBestDocumentText = async (
  filePath: string,
  mimeType: string
): Promise<{ text: string; source: ParsedCustomerDocumentDraft["source"] }> => {
  if (isPdf(mimeType, filePath)) {
    const text = await extractTextFromPdf(filePath).catch(() => "");
    if (text.length >= 80) {
      return { text, source: "pdf-text" };
    }
    const pages = await extractOcrTextsFromPdfPages(filePath);
    const ocrText = pages.join("\n").trim();
    if (ocrText) {
      return { text: [text, ocrText].filter(Boolean).join("\n"), source: "pdf-ocr" };
    }
    return { text, source: text ? "pdf-text" : "none" };
  }

  if (isImage(mimeType, filePath)) {
    const text = await extractTextFromImage(filePath);
    return { text, source: text ? "image-ocr" : "none" };
  }

  return { text: "", source: "none" };
};

const pullLineValue = (lines: string[], patterns: RegExp[]): string | undefined => {
  for (const line of lines) {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match?.[1]) {
        const value = collapseWhitespace(match[1]);
        if (value) return value;
      }
    }
  }
  return undefined;
};

const pullTextValue = (text: string, patterns: RegExp[]): string | undefined => {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const value = collapseWhitespace(match[1]);
      if (value) return value;
    }
  }
  return undefined;
};

const pullDateValue = (lines: string[], text: string, patterns: RegExp[]): string | undefined => {
  const lineValue = pullLineValue(lines, patterns);
  if (lineValue) {
    const parsed = parseDateToken(lineValue);
    if (parsed) return formatDateInput(parsed);
    const embedded = lineValue.match(/\b(\d{4}[./-]\d{2}[./-]\d{2}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4})\b/);
    if (embedded?.[1]) {
      const parsedEmbedded = parseDateToken(embedded[1]);
      if (parsedEmbedded) return formatDateInput(parsedEmbedded);
    }
  }

  const textValue = pullTextValue(text, patterns);
  if (!textValue) return undefined;
  const embedded = textValue.match(/\b(\d{4}[./-]\d{2}[./-]\d{2}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4})\b/);
  const rawDate = embedded?.[1] ?? textValue;
  const parsed = parseDateToken(rawDate);
  return parsed ? formatDateInput(parsed) : undefined;
};

const normalizeLicense = (value: string | null | undefined) => {
  const code = normalizeCode(value);
  if (!code) return undefined;
  const valid = code.length >= 5 && code.length <= 20 && /[A-Z]/.test(code) && /\d/.test(code);
  return valid ? code : undefined;
};

const pullNamedLabel = (text: string, label: "nome" | "cognome") => {
  const stopTokens =
    label === "nome"
      ? "(?:cognome|data\\b|codice\\b|n\\.?\\s*patente|4a\\b|4b\\b|4c\\b|documento\\b|$)"
      : "(?:nome\\b|data\\b|codice\\b|n\\.?\\s*patente|4a\\b|4b\\b|4c\\b|documento\\b|$)";
  const regex = new RegExp(`(?:\\b${label}\\b|${label === "nome" ? "given names?" : "surname"})\\s*[:\\-]?\\s*([A-ZÀ-ÖØ-Ý][A-ZÀ-ÖØ-Ý' -]{1,50}?)(?=\\s+${stopTokens})`, "i");
  const match = text.match(regex);
  return match?.[1] ? collapseWhitespace(match[1]) : undefined;
};

const detectDocumentType = (compact: string): RecognizedCustomerDocumentType | undefined => {
  if (
    /patente|driving\s+licen[cs]e|numero\s+della\s+patente|n\.\s*patente/i.test(compact) ||
    (/(?:^|\s)4\s*[abc](?:\s*[.):-])?/i.test(compact) && /(?:^|\s)5(?:\s*[.):-])?\s*[A-Z0-9]{5,20}/i.test(compact))
  ) {
    return "PATENTE";
  }
  if (
    /carta\s+d['’]?\s*identit[aà]|identity\s+card|\bcie\b|carta\s*identit[aà]\s*elettronica/i.test(compact)
  ) {
    return "CARTA_IDENTITA";
  }
  if (/passaporto|passport/i.test(compact)) return "PASSAPORTO";
  if (/tessera\s+sanitaria|health\s+card|team\s+card|ts[\s/-]?cns/i.test(compact)) return "TESSERA_SANITARIA";
  if (/documento|document\s+no|numero\s+documento|n\.\s*doc/i.test(compact)) return "DOCUMENTO_GENERICO";
  return undefined;
};

const extractDateFromFreeText = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  const match = value.match(/\b(\d{4}[./-]\d{2}[./-]\d{2}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4})\b/);
  if (!match?.[1]) return undefined;
  const parsed = parseDateToken(match[1]);
  return parsed ? formatDateInput(parsed) : undefined;
};

const pullNumberedSection = (text: string, labelPattern: string, stopPattern: string): string | undefined => {
  const regex = new RegExp(
    `(?:^|\\s)${labelPattern}\\s*[\\.):-]?\\s*([A-ZÀ-ÖØ-Ý0-9'().,/\\-\\s]{1,120}?)(?=\\s+(?:${stopPattern})\\s*[\\.):-]?\\s*|$)`,
    "i"
  );
  const match = text.match(regex);
  if (!match?.[1]) return undefined;
  const value = collapseWhitespace(match[1]);
  return value || undefined;
};

const decodeLicenseCategories = (raw: string | undefined): string | undefined => {
  if (!raw) return undefined;
  const allowed = new Set(["AM", "A1", "A2", "A", "B1", "B", "C1", "C", "D1", "D", "BE", "C1E", "CE", "D1E", "DE"]);
  const tokens = raw
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token && allowed.has(token));
  if (tokens.length === 0) return undefined;
  return Array.from(new Set(tokens)).join(" ");
};

const stripSectionAtStop = (value: string | undefined, stopPattern: string) => {
  if (!value) return undefined;
  const cleaned = collapseWhitespace(value).replace(new RegExp(`\\s+(?:${stopPattern})\\s*[\\.):-]?.*$`, "i"), "").trim();
  return cleaned || undefined;
};

const pullNumberedLineSection = (lines: string[], labelPattern: string): string | undefined => {
  const regex = new RegExp(`(?:^|\\s)${labelPattern}\\s*[\\.):-]?\\s*([A-ZÀ-ÖØ-Ý0-9'().,/\\-\\s]{1,120})$`, "i");
  for (const line of lines) {
    const match = line.match(regex);
    if (match?.[1]) {
      const value = collapseWhitespace(match[1]);
      if (value) return value;
    }
  }
  return undefined;
};

const normalizePersonCandidate = (value: string | undefined, kind: "first" | "last"): string | undefined => {
  if (!value) return undefined;

  const connectors = new Set(["DE", "DI", "DA", "DEL", "DELLA", "DEI", "DEGLI", "D'", "VAN", "VON"]);
  const tokens = value
    .replace(/[^A-Za-zÀ-ÖØ-öø-ÿ' -]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase()
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => token.length > 1 || connectors.has(token));

  if (tokens.length === 0) return undefined;

  const normalizedTokens = [...tokens];
  while (normalizedTokens.length > 1 && connectors.has(normalizedTokens[normalizedTokens.length - 1])) {
    normalizedTokens.pop();
  }

  if (kind === "first") {
    while (normalizedTokens.length > 0 && connectors.has(normalizedTokens[0])) {
      normalizedTokens.shift();
    }
    if (normalizedTokens.length > 2) {
      return normalizeName(normalizedTokens.slice(0, 2).join(" "));
    }
  }

  return normalizeName(normalizedTokens.join(" "));
};

const cleanupTailNoise = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  const cleaned = value
    .replace(/^[^A-Za-z0-9À-ÖØ-öø-ÿ]+/, "")
    .replace(/\s+[A-Za-zÀ-ÖØ-öø-ÿ]$/, "")
    .trim();
  return cleaned || undefined;
};

export const parseCustomerDocumentDraft = async (
  filePath: string,
  mimeType: string
): Promise<ParsedCustomerDocumentDraft> => {
  const { text, source } = await extractBestDocumentText(filePath, mimeType);
  const lines = text
    .split(/\r?\n/g)
    .map((line) => collapseWhitespace(line))
    .filter(Boolean);
  const compact = collapseWhitespace(text);
  const upperCompact = compact.toUpperCase();

  const numberedSurname =
    pullNumberedLineSection(lines, "1") ?? pullNumberedSection(compact, "1", "2|3|4\\s*[abc]|5|7|8|9|10|11|12");
  const numberedName =
    pullNumberedLineSection(lines, "2") ?? pullNumberedSection(compact, "2", "3|4\\s*[abc]|5|7|8|9|10|11|12");
  const numberedBirthBlock =
    pullNumberedLineSection(lines, "3") ?? pullNumberedSection(compact, "3", "4\\s*[abc]|5|7|8|9|10|11|12");
  const numberedBirthDate = extractDateFromFreeText(numberedBirthBlock);
  const numberedBirthPlace = normalizeGeneric(
    cleanupTailNoise(
      numberedBirthBlock?.replace(/\b\d{4}[./-]\d{2}[./-]\d{2}\b|\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g, "").trim()
    )
  );
  const numbered4a = stripSectionAtStop(
    pullNumberedLineSection(lines, "4\\s*[aA]") ?? pullNumberedSection(compact, "4\\s*[aA]", "4\\s*[bB]|4\\s*[cC]|5|7|8|9|10|11|12"),
    "4\\s*[bB]|4\\s*[cC]|5|7|8|9|10|11|12"
  );
  const numbered4b = stripSectionAtStop(
    pullNumberedLineSection(lines, "4\\s*[bB]") ?? pullNumberedSection(compact, "4\\s*[bB]", "4\\s*[cC]|5|7|8|9|10|11|12"),
    "4\\s*[cC]|5|7|8|9|10|11|12"
  );
  const numbered4c = cleanupTailNoise(
    stripSectionAtStop(
      pullNumberedLineSection(lines, "4\\s*[cC]") ?? pullNumberedSection(compact, "4\\s*[cC]", "5|7|8|9|10|11|12"),
      "5|7|8|9|10|11|12"
    )
  );
  const numbered5 =
    pullNumberedLineSection(lines, "5") ?? pullNumberedSection(compact, "5", "7|8|9|10|11|12");
  const numbered9 =
    pullNumberedLineSection(lines, "9") ?? pullNumberedSection(compact, "9", "10|11|12");

  const firstName = normalizePersonCandidate(
    pullNamedLabel(compact, "nome") ??
      pullLineValue(lines, [/(?:\bnome\b|given names?)\s*[:\-]?\s*([A-ZÀ-ÖØ-Ý][A-ZÀ-ÖØ-Ý' -]{1,30})\s*$/i]) ??
      numberedName,
    "first"
  );

  const lastName = normalizePersonCandidate(
    pullNamedLabel(compact, "cognome") ??
      pullLineValue(lines, [/(?:\bcognome\b|surname)\s*[:\-]?\s*([A-ZÀ-ÖØ-Ý][A-ZÀ-ÖØ-Ý' -]{1,30})\s*$/i]) ??
      numberedSurname,
    "last"
  );

  const dateOfBirth = pullDateValue(lines, compact, [
    /(?:data(?:\s+di)?\s+nascita|birth(?:\s+date)?|(?:^|\s)3\s*[.):-]?)\D{0,20}(\d{4}[./-]\d{2}[./-]\d{2}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4})/i
  ]) ?? numberedBirthDate;

  const placeOfBirth = normalizeGeneric(
    pullLineValue(lines, [
      /(?:luogo(?:\s+di)?\s+nascita|birth\s+place)\s*[:\-]?\s*([A-Za-zÀ-ÖØ-öø-ÿ' -]{2,70})/i
    ]) ?? numberedBirthPlace
  );

  const nationality = normalizeGeneric(
    pullLineValue(lines, [/(?:nazionalit[aà]|nationality)\s*[:\-]?\s*([A-Za-zÀ-ÖØ-öø-ÿ' -]{2,50})/i])
  );

  const residenceAddress = normalizeGeneric(
    pullLineValue(lines, [/(?:residenza|indirizzo|address)\s*[:\-]?\s*([A-Za-zÀ-ÖØ-öø-ÿ0-9'.,/ -]{4,140})/i])
  );

  const taxCode =
    normalizeCode(
      pullTextValue(compact, [
        /(?:codice\s+fiscale|tax\s+code)\D{0,10}([A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z])/i
      ])
    ) ??
    normalizeCode(upperCompact.match(/\b([A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z])\b/)?.[1]);

  const detectedDocumentType = detectDocumentType(compact);

  const documentNumber = normalizeCode(
    pullTextValue(compact, [
      /(?:n(?:umero)?\s*(?:documento|passaporto|carta|id)|document(?:o)?\s*n(?:umero)?|doc\.?|passport\s*no\.?|n\.?\s*doc(?:umento)?)\D{0,12}([A-Z0-9]{5,25})/i
    ])
  );

  let drivingLicenseNumber = normalizeLicense(
    pullTextValue(compact, [
      /(?:n(?:umero)?\.?\s*patente|patente\s*(?:n(?:umero)?\.?|no\.?)?)\s*[:#-]?\s*([A-Z0-9]{5,20})\b/i,
      /(?:^|\s)5[.)\s:-]*([A-Z0-9]{5,20})\b/i
    ])
  );
  if (!drivingLicenseNumber) {
    drivingLicenseNumber = normalizeLicense(
      pullTextValue(compact, [/(?:^|\s)5[.)\s:-]*([A-Z0-9]{5,20})(?=\s|$)/i])
    );
  }
  if (!drivingLicenseNumber) {
    drivingLicenseNumber = normalizeLicense(numbered5);
  }
  if (!drivingLicenseNumber && detectedDocumentType === "PATENTE") {
    drivingLicenseNumber = normalizeLicense(documentNumber);
  }

  const drivingLicenseIssuedAt = pullDateValue(lines, compact, [
    /(?:\b4a\b|rilascio(?:\s+patente)?|issued)\D{0,16}(\d{4}[./-]\d{2}[./-]\d{2}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4})/i
  ]) ?? extractDateFromFreeText(numbered4a);
  const drivingLicenseExpiresAt = pullDateValue(lines, compact, [
    /(?:\b4b\b|scadenza(?:\s+patente)?|expire[sd]?)\D{0,16}(\d{4}[./-]\d{2}[./-]\d{2}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4})/i
  ]) ?? extractDateFromFreeText(numbered4b);
  const drivingLicenseAuthority = cleanupTailNoise(
    normalizeGeneric(
      pullLineValue(lines, [
        /(?:\b4c\b|autorit[aà]|authority)\s*[:\-]?\s*([A-Za-zÀ-ÖØ-öø-ÿ0-9'.,/ -]{2,90})/i
      ]) ??
        numbered4c
    )
  );
  const drivingLicenseCategory = normalizeGeneric(
    pullLineValue(lines, [
      /(?:categoria|categories?|cat\.)\s*[:\-]?\s*([A-Z0-9,.\s-]{1,25})/i
    ]) ??
      decodeLicenseCategories(numbered9)
  );

  const genericDocumentIssuedAt = pullDateValue(lines, compact, [
    /(?:rilasciat[oa]|rilascio(?:\s+documento)?|issued|issue\s+date|emissione)\D{0,24}(\d{4}[./-]\d{2}[./-]\d{2}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4})/i
  ]);
  const genericDocumentExpiresAt = pullDateValue(lines, compact, [
    /(?:scadenza|valido\s+fino(?:\s+al)?|expire[sd]?|expiry)\D{0,24}(\d{4}[./-]\d{2}[./-]\d{2}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4})/i
  ]);
  const genericDocumentAuthority = cleanupTailNoise(
    normalizeGeneric(
      pullLineValue(lines, [
        /(?:rilasciato\s+da|emesso\s+da|autorit[aà]|authority|questura|comune|motorizzazione)\s*[:\-]?\s*([A-Za-zÀ-ÖØ-öø-ÿ0-9'.,/ -]{2,100})/i
      ])
    )
  );

  const fields: CustomerDocumentDraftFields = {
    firstName,
    lastName,
    dateOfBirth,
    placeOfBirth,
    nationality,
    residenceAddress,
    taxCode,
    documentType: detectedDocumentType,
    documentNumber,
    documentIssuedAt: genericDocumentIssuedAt ?? drivingLicenseIssuedAt,
    documentExpiresAt: genericDocumentExpiresAt ?? drivingLicenseExpiresAt,
    documentAuthority: genericDocumentAuthority ?? drivingLicenseAuthority,
    drivingLicenseNumber,
    drivingLicenseIssuedAt,
    drivingLicenseExpiresAt,
    drivingLicenseAuthority,
    drivingLicenseCategory
  };

  const foundCount = Object.values(fields).filter((value) => Boolean(value)).length;
  const score = Math.min(
    100,
    foundCount * 8 +
      (drivingLicenseNumber ? 30 : 0) +
      (firstName && lastName ? 20 : 0) +
      (dateOfBirth ? 8 : 0) +
      (taxCode ? 6 : 0)
  );

  const warnings: string[] = [];
  if (!drivingLicenseNumber) warnings.push("Numero patente non rilevato automaticamente.");
  if (!firstName || !lastName) warnings.push("Nome/cognome non rilevati con certezza.");
  if (!dateOfBirth) warnings.push("Data di nascita non rilevata.");
  if (!text.trim()) warnings.push("Nessun testo estratto dal documento. Verifica qualità scansione/OCR.");

  return {
    fields,
    score,
    source,
    warnings,
    textPreview: text.slice(0, 1800)
  };
};
