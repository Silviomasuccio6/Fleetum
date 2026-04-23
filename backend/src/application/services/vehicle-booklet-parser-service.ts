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
    year = yRaw < 100 ? 2000 + yRaw : yRaw;
  } else {
    return null;
  }

  if (year < 1950 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const parsed = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
  if (Number.isNaN(parsed.getTime())) return null;
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== month || parsed.getUTCDate() !== day) return null;
  return parsed;
};

const dedupeDates = (dates: Date[]) => {
  const map = new Map<number, Date>();
  dates.forEach((item) => {
    const key = item.getTime();
    if (!map.has(key)) map.set(key, item);
  });
  return Array.from(map.values()).sort((a, b) => a.getTime() - b.getTime());
};

const extractAllDates = (text: string): Date[] => {
  const regex = /\b(\d{4}[./-]\d{2}[./-]\d{2}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4})\b/g;
  const dates: Date[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const parsed = parseDateToken(match[1] ?? "");
    if (parsed) dates.push(parsed);
  }
  return dedupeDates(dates);
};

const extractRegistrationDateFromText = (text: string): Date | null => {
  const compact = text.replace(/\s+/g, " ");
  const patterns = [
    /(?:data\s+di\s+prima\s+immatricolazione|prima\s+immatricolazione|data\s+immatricolazione|immatricolazione|immatr\.)[^0-9]{0,24}(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}[./-]\d{2}[./-]\d{2})/gi,
    /(?:\(|\b)b(?:\)|\b)[^0-9]{0,24}(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}[./-]\d{2}[./-]\d{2})/gi
  ];

  const candidates: Date[] = [];
  for (const regex of patterns) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(compact)) !== null) {
      const parsed = parseDateToken(match[1] ?? "");
      if (parsed) candidates.push(parsed);
    }
  }

  const normalizedCandidates = dedupeDates(candidates);
  if (normalizedCandidates.length > 0) return normalizedCandidates[0];

  const allDates = extractAllDates(compact);
  if (!allDates.length) return null;
  return allDates[0];
};

const extractTextFromPdf = async (filePath: string): Promise<string> => {
  const buffer = await fs.readFile(filePath);
  const PDFParseCtor = await getPdfParseCtor();
  let parser: any = null;
  try {
    parser = new PDFParseCtor({ data: buffer });
    const parsed = await parser.getText();
    return parsed?.text?.trim() ?? "";
  } finally {
    if (parser) await parser.destroy().catch(() => undefined);
  }
};

const extractOcrTextsFromPdfPages = async (filePath: string): Promise<string[]> => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fermi-booklet-ocr-"));
  const outputPrefix = path.join(tempDir, "page");
  try {
    await execFile("pdftoppm", ["-r", "240", "-png", filePath, outputPrefix], {
      timeout: 90_000,
      maxBuffer: 20 * 1024 * 1024
    });

    const files = (await fs.readdir(tempDir))
      .filter((name) => name.toLowerCase().endsWith(".png"))
      .map((name) => path.join(tempDir, name))
      .sort();

    const texts: string[] = [];
    for (const pageFile of files.slice(0, 5)) {
      try {
        const { stdout } = await execFile("tesseract", [pageFile, "stdout", "-l", "ita+eng", "--psm", "6"], {
          timeout: 50_000,
          maxBuffer: 10 * 1024 * 1024
        });
        const cleaned = String(stdout ?? "").trim();
        if (cleaned) texts.push(cleaned);
      } catch {
        // Ignora errori OCR pagina singola.
      }
    }
    return texts;
  } catch {
    return [];
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
};

const extractTextFromImage = async (filePath: string): Promise<string> => {
  try {
    const { stdout } = await execFile("tesseract", [filePath, "stdout", "-l", "ita+eng", "--psm", "6"], {
      timeout: 60_000,
      maxBuffer: 10 * 1024 * 1024
    });
    return String(stdout ?? "").trim();
  } catch {
    return "";
  }
};

const isPdf = (mimeType: string, filePath: string) =>
  mimeType === "application/pdf" || path.extname(filePath).toLowerCase() === ".pdf";

const isImage = (mimeType: string, filePath: string) =>
  mimeType.startsWith("image/") || [".jpg", ".jpeg", ".png", ".webp"].includes(path.extname(filePath).toLowerCase());

export const extractRegistrationDateFromBooklet = async (filePath: string, mimeType: string): Promise<Date | null> => {
  try {
    if (isPdf(mimeType, filePath)) {
      const text = await extractTextFromPdf(filePath);
      const direct = extractRegistrationDateFromText(text);
      if (direct) return direct;
      const ocrPages = await extractOcrTextsFromPdfPages(filePath);
      if (!ocrPages.length) return null;
      return extractRegistrationDateFromText(ocrPages.join("\n"));
    }

    if (!isImage(mimeType, filePath)) return null;
    const text = await extractTextFromImage(filePath);
    return extractRegistrationDateFromText(text);
  } catch {
    return null;
  }
};
