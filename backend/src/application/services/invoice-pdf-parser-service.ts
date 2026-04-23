import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const MAX_REASONABLE_INVOICE_TOTAL = 1_000_000;
let pdfParseCtorPromise: Promise<any> | null = null;

const getPdfParseCtor = async () => {
  if (!pdfParseCtorPromise) {
    pdfParseCtorPromise = import("pdf-parse").then((module) => module.PDFParse);
  }
  return pdfParseCtorPromise;
};

const parseEuroAmount = (rawAmount: string): number | null => {
  const normalized = rawAmount
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".")
    .trim();
  if (!normalized) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
};

type Candidate = {
  amount: number;
  score: number;
  source: "strict" | "fallback" | "derived";
};

const pickBestCandidate = (candidates: Candidate[]): Candidate | null => {
  if (!candidates.length) return null;
  const strictCandidates = candidates.filter((candidate) => candidate.source !== "fallback");
  const pool = strictCandidates.length ? strictCandidates : candidates;

  pool.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.amount - a.amount;
  });

  const best = pool[0];
  const minScore = best?.source === "fallback" ? 18 : 40;
  if (!best || best.score < minScore) return null;
  if (best.amount > MAX_REASONABLE_INVOICE_TOTAL) return null;
  return best;
};

const extractTotalCandidates = (text: string): Candidate[] => {
  const compact = text.replace(/\s+/g, " ");
  const patterns: Array<{ regex: RegExp; score: number; source: "strict" | "fallback" }> = [
    { regex: /totale\s+(?:da\s+pagare|a\s+pagare)\s*[:€]?\s*([0-9][0-9.,\s]{1,20})/gi, score: 100, source: "strict" },
    { regex: /totale\s+(?:documento|fattura)\s*[:€]?\s*([0-9][0-9.,\s]{1,20})/gi, score: 95, source: "strict" },
    { regex: /importo\s+da\s+pagare\s*[:€]?\s*([0-9][0-9.,\s]{1,20})/gi, score: 92, source: "strict" },
    { regex: /importo\s+totale\s*[:€]?\s*([0-9][0-9.,\s]{1,20})/gi, score: 90, source: "strict" },
    { regex: /tot(?:ale)?\s*(?:eur|euro)\s*[:€]?\s*([0-9][0-9.,\s]{1,20})/gi, score: 86, source: "strict" },
    { regex: /da\s+pagare\s*[:€]?\s*([0-9][0-9.,\s]{1,20})/gi, score: 84, source: "strict" },
    { regex: /tot\.\s*(?:da\s+pagare)?\s*[:€]?\s*([0-9][0-9.,\s]{1,20})/gi, score: 82, source: "strict" },
    { regex: /totale\s*[:€]?\s*([0-9][0-9.,\s]{1,20})/gi, score: 70, source: "strict" },
    { regex: /grand\s+total\s*[:€]?\s*([0-9][0-9.,\s]{1,20})/gi, score: 80, source: "strict" },
    { regex: /€\s*([0-9][0-9.,\s]{1,20})/gi, score: 45, source: "fallback" },
    { regex: /([0-9][0-9.,\s]{1,20})\s*(?:€|eur|euro)\b/gi, score: 45, source: "fallback" }
  ];

  const candidates: Candidate[] = [];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.regex.exec(compact)) !== null) {
      const raw = (match[1] ?? "").replace(/\s+/g, "");
      if (raw.includes("%")) continue;
      const amount = parseEuroAmount(raw);
      if (amount === null) continue;
      if (amount > MAX_REASONABLE_INVOICE_TOTAL) continue;
      const context = compact.slice(Math.max(0, match.index - 30), Math.min(compact.length, match.index + 80)).toLowerCase();
      const hasTotalHint = context.includes("tot") || context.includes("pagare") || context.includes("importo");
      const isImponibileContext = context.includes("imponibile") && !context.includes("da pagare");
      const hasInvoiceNoise =
        context.includes("p.iva") ||
        context.includes("partita iva") ||
        context.includes("iban") ||
        context.includes("codice fiscale") ||
        context.includes("capitale sociale");
      const contextBoost = hasTotalHint ? 12 : 0;
      const highAmountPenalty = amount > 50_000 ? 48 : amount > 20_000 ? 28 : 0;
      const contextPenalty = (isImponibileContext ? 28 : 0) + (hasInvoiceNoise ? 18 : 0) + highAmountPenalty;
      candidates.push({ amount, score: pattern.score + contextBoost - contextPenalty, source: pattern.source });
    }
  }

  return candidates;
};

const extractLooseAmountCandidates = (text: string): Candidate[] => {
  const compact = text.replace(/\s+/g, " ");
  const regex = /\b([0-9]{1,3}(?:[.\s][0-9]{3})*,[0-9]{2}|[0-9]{1,6}\.[0-9]{2})\b/g;
  const candidates: Candidate[] = [];

  let match: RegExpExecArray | null;
  while ((match = regex.exec(compact)) !== null) {
    const raw = match[1] ?? "";
    const amount = parseEuroAmount(raw);
    if (amount === null || amount > MAX_REASONABLE_INVOICE_TOTAL) continue;
    const context = compact.slice(Math.max(0, match.index - 36), Math.min(compact.length, match.index + 52)).toLowerCase();

    const positiveContext =
      (context.includes("totale") ? 18 : 0) +
      (context.includes("pagare") ? 14 : 0) +
      (context.includes("imponibile") ? 10 : 0) +
      (context.includes("imposte") || context.includes("iva") ? 10 : 0);

    const negativeContext =
      (context.includes("partita iva") || context.includes("p.iva") ? 24 : 0) +
      (context.includes("codice fiscale") ? 20 : 0) +
      (context.includes("tel.") || context.includes("fax") ? 14 : 0) +
      (context.includes("capitale sociale") ? 36 : 0) +
      (context.includes("penale") ? 20 : 0);

    const highAmountPenalty = amount > 50_000 ? 52 : amount > 20_000 ? 30 : 0;
    const score = 20 + positiveContext - negativeContext - highAmountPenalty;
    candidates.push({ amount, score, source: "fallback" });
  }

  return candidates;
};

const isLikelyVatRate = (value: number) => Number.isInteger(value) && value > 0 && value <= 30;

const extractAmountsAfterLabel = (text: string, labelRegexSource: string): number[] => {
  const regex = new RegExp(`${labelRegexSource}[^\\d€]{0,24}(?:€\\s*)?([0-9][0-9.,\\s]{1,20})`, "gi");
  const values: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const amount = parseEuroAmount(match[1] ?? "");
    if (amount === null || amount > MAX_REASONABLE_INVOICE_TOTAL) continue;
    values.push(amount);
  }
  return values;
};

const extractDerivedTaxCandidates = (text: string): Candidate[] => {
  const compact = text.replace(/\s+/g, " ");
  const candidates: Candidate[] = [];

  const imponibili = extractAmountsAfterLabel(compact, "(?:imponibile|tot\\.?\\s*imponibile)");
  const ivaValues = extractAmountsAfterLabel(compact, "(?:\\biva\\b|imposta)").filter((value) => !isLikelyVatRate(value));

  for (const imponibile of imponibili) {
    for (const iva of ivaValues) {
      if (iva <= 0) continue;
      if (iva > imponibile * 0.5) continue;
      const total = imponibile + iva;
      if (total > MAX_REASONABLE_INVOICE_TOTAL) continue;
      candidates.push({ amount: Math.round(total * 100) / 100, score: 112, source: "derived" });
    }
  }

  const aliquotaRegex = /aliquota[^0-9]{0,18}\d{1,2}\s*%?\s+([0-9][0-9.,\s]{1,20})\s+\d{1,2}\s+([0-9][0-9.,\s]{1,20})/gi;
  let match: RegExpExecArray | null;
  while ((match = aliquotaRegex.exec(compact)) !== null) {
    const imponibile = parseEuroAmount(match[1] ?? "");
    const iva = parseEuroAmount(match[2] ?? "");
    if (imponibile === null || iva === null) continue;
    const total = imponibile + iva;
    if (total > MAX_REASONABLE_INVOICE_TOTAL) continue;
    candidates.push({ amount: Math.round(total * 100) / 100, score: 114, source: "derived" });
  }

  return candidates;
};

const extractInvoiceTotalFromText = (text: string): number | null => {
  if (!text.trim()) return null;
  const candidates = [...extractTotalCandidates(text), ...extractDerivedTaxCandidates(text), ...extractLooseAmountCandidates(text)];
  const best = pickBestCandidate(candidates);
  if (!best) return null;
  return Math.round(best.amount * 100) / 100;
};

const splitPdfPages = (text: string): string[] => {
  if (!text.trim()) return [];
  const pages = text
    .replace(/\r/g, "")
    .split(/\f|\u000c/g)
    .map((page) => page.trim())
    .filter((page) => page.length > 0);

  if (pages.length > 1) return pages;
  return [text.trim()];
};

const scoreInvoicePageContext = (text: string): number => {
  const lower = text.toLowerCase();
  let score = 0;

  const strongKeywords = [
    "fattura",
    "invoice",
    "totale da pagare",
    "importo da pagare",
    "imponibile",
    "aliquota",
    "iva",
    "scadenza"
  ];
  const mediumKeywords = ["documento", "cliente", "fornitore", "p.iva", "partita iva", "codice fiscale", "pagamento", "eur", "euro"];
  const weakNegativeKeywords = ["preventivo", "proforma", "ordine"];

  strongKeywords.forEach((keyword) => {
    if (lower.includes(keyword)) score += 10;
  });
  mediumKeywords.forEach((keyword) => {
    if (lower.includes(keyword)) score += 4;
  });
  weakNegativeKeywords.forEach((keyword) => {
    if (lower.includes(keyword)) score -= 6;
  });

  const euroMatches = lower.match(/€|eur|euro/g);
  if (euroMatches) score += Math.min(12, euroMatches.length * 2);

  if (/\b\d{2}\/\d{2}\/\d{4}\b/.test(lower) || /\b\d{4}-\d{2}-\d{2}\b/.test(lower)) {
    score += 3;
  }
  if (/\b(?:fattura|invoice)\s*(?:n|nr|no|numero)?\s*[:#-]?\s*[a-z0-9./-]{2,}\b/i.test(text)) {
    score += 12;
  }
  return score;
};

const extractInvoiceTotalFromPageTexts = (pageTexts: string[]): number | null => {
  const pages = pageTexts.map((page) => page.trim()).filter((page) => page.length > 0);
  if (!pages.length) return null;
  if (pages.length === 1) return extractInvoiceTotalFromText(pages[0]);

  const pageCandidates = pages
    .map((page) => {
      const candidates = [...extractTotalCandidates(page), ...extractDerivedTaxCandidates(page), ...extractLooseAmountCandidates(page)];
      const best = pickBestCandidate(candidates);
      if (!best) return null;
      const contextScore = scoreInvoicePageContext(page);
      if (best.source === "fallback" && best.score < 40 && contextScore < 8) {
        return null;
      }
      const strictBoost = best.source !== "fallback" ? 16 : 0;
      const finalScore = best.score + contextScore + strictBoost;
      return { best, finalScore };
    })
    .filter((entry): entry is { best: Candidate; finalScore: number } => entry !== null)
    .sort((a, b) => {
      if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
      return b.best.score - a.best.score;
    });

  if (pageCandidates.length > 0) {
    const top = pageCandidates[0];
    return Math.round(top.best.amount * 100) / 100;
  }

  return extractInvoiceTotalFromText(pages.join(" "));
};

const extractInvoiceTotalFromPdfText = (text: string): number | null => {
  const pages = splitPdfPages(text);
  return extractInvoiceTotalFromPageTexts(pages);
};

const extractPageNumberFromImageName = (name: string): number => {
  const match = name.match(/-(\d+)\.png$/i);
  if (!match) return Number.MAX_SAFE_INTEGER;
  return Number(match[1]);
};

const extractOcrTextsFromPdfPages = async (filePath: string): Promise<string[]> => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fermi-pdf-ocr-"));
  const outputPrefix = path.join(tempDir, "page");
  try {
    await execFile("pdftoppm", ["-r", "300", "-png", filePath, outputPrefix], {
      timeout: 90_000,
      maxBuffer: 20 * 1024 * 1024
    });

    const files = (await fs.readdir(tempDir))
      .filter((name) => /^page-\d+\.png$/i.test(name))
      .sort((a, b) => extractPageNumberFromImageName(a) - extractPageNumberFromImageName(b));

    const texts: string[] = [];
    for (const file of files) {
      const imagePath = path.join(tempDir, file);
      const text = await extractTextFromImage(imagePath);
      if (text.trim()) texts.push(text);
    }
    return texts;
  } catch {
    return [];
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
};

const extractTextFromPdf = async (filePath: string): Promise<string> => {
  const PDFParseCtor = await getPdfParseCtor();
  let parser: any = null;
  try {
    const buffer = await fs.readFile(filePath);
    parser = new PDFParseCtor({ data: buffer });
    const parsed = await parser.getText();
    return parsed?.text ?? "";
  } finally {
    await parser?.destroy().catch(() => undefined);
  }
};

const runTesseract = async (filePath: string, language?: string, psm = "6"): Promise<string | null> => {
  try {
    const args = [filePath, "stdout", "--dpi", "300", "--psm", psm];
    if (language) args.push("-l", language);
    const { stdout } = await execFile("tesseract", args, {
      timeout: 20_000,
      maxBuffer: 20 * 1024 * 1024
    });
    return String(stdout ?? "").trim();
  } catch {
    return null;
  }
};

const scoreOcrText = (text: string): number => {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return -1_000;
  const lower = compact.toLowerCase();

  const letters = (compact.match(/[a-zàèéìòù]/gi) ?? []).length;
  const digits = (compact.match(/\d/g) ?? []).length;

  const keywordScore =
    (lower.includes("fattura") ? 24 : 0) +
    (lower.includes("invoice") ? 24 : 0) +
    (lower.includes("totale") ? 20 : 0) +
    (lower.includes("imponibile") ? 16 : 0) +
    (lower.includes("iva") ? 12 : 0) +
    (lower.includes("da pagare") ? 14 : 0);

  const noisePenalty = compact.length < 40 ? 20 : 0;
  return letters * 0.09 + digits * 0.05 + keywordScore - noisePenalty;
};

const extractLabeledTotalAmount = (text: string): number | null => {
  const compact = text.replace(/\s+/g, " ");
  const patterns = [
    /totale\s+(?:da\s+pagare|a\s+pagare)\s*[:€]?\s*([0-9][0-9.,\s]{1,20})/gi,
    /importo\s+da\s+pagare\s*[:€]?\s*([0-9][0-9.,\s]{1,20})/gi,
    /totale\s*[:€]?\s*([0-9][0-9.,\s]{1,20})\s*(?:eur|euro|€)?/gi
  ];

  let best: number | null = null;
  for (const regex of patterns) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(compact)) !== null) {
      const amount = parseEuroAmount(match[1] ?? "");
      if (amount === null || amount > MAX_REASONABLE_INVOICE_TOTAL) continue;
      if (best === null || amount > best) best = amount;
    }
  }
  return best;
};

const detectRotationForImage = async (filePath: string): Promise<number> => {
  try {
    const { stdout } = await execFile("tesseract", [filePath, "stdout", "--psm", "0"], {
      timeout: 20_000,
      maxBuffer: 4 * 1024 * 1024
    });
    const raw = String(stdout ?? "");
    const rotateMatch = raw.match(/Rotate:\s*(\d+)/i);
    const orientationMatch = raw.match(/Orientation in degrees:\s*(\d+)/i);
    const rotate = rotateMatch ? Number(rotateMatch[1]) : orientationMatch ? (360 - Number(orientationMatch[1])) % 360 : 0;
    if (![0, 90, 180, 270].includes(rotate)) return 0;
    return rotate;
  } catch {
    return 0;
  }
};

const createRotatedCopy = async (filePath: string, rotateDeg: number): Promise<string | null> => {
  if (![90, 180, 270].includes(rotateDeg)) return null;
  const rotatedPath = path.join(
    os.tmpdir(),
    `fermi-ocr-rot-${Date.now()}-${Math.random().toString(16).slice(2)}${path.extname(filePath) || ".png"}`
  );
  try {
    await execFile("sips", ["-r", String(rotateDeg), filePath, "--out", rotatedPath], {
      timeout: 20_000,
      maxBuffer: 4 * 1024 * 1024
    });
    return rotatedPath;
  } catch {
    await fs.rm(rotatedPath, { force: true }).catch(() => undefined);
    return null;
  }
};

const extractTextFromImage = async (filePath: string): Promise<string> => {
  const psmAttempts = ["11", "6"];
  const languageAttempts = ["ita+eng"];
  const imageAttempts: string[] = [filePath];
  let rotatedCopyPath: string | null = null;

  const rotate = await detectRotationForImage(filePath);
  if (rotate && rotate !== 0) {
    rotatedCopyPath = await createRotatedCopy(filePath, rotate);
    if (rotatedCopyPath) imageAttempts.push(rotatedCopyPath);
  }

  let bestText = "";
  let bestScore = -1_000;
  try {
    let shouldStop = false;
    for (const imagePath of imageAttempts) {
      if (shouldStop) break;
      for (const psm of psmAttempts) {
        if (shouldStop) break;
        for (const language of languageAttempts) {
          const text = await runTesseract(imagePath, language, psm);
          if (!text || text.length < 8) continue;
          const score = scoreOcrText(text);
          const labeledTotal = extractLabeledTotalAmount(text);
          const totalBonus = labeledTotal !== null ? 250 + Math.min(48, labeledTotal / 20) : 0;
          const candidateScore = score + totalBonus;
          if (candidateScore > bestScore) {
            bestScore = candidateScore;
            bestText = text;
            if (labeledTotal !== null && candidateScore >= 300) {
              shouldStop = true;
              break;
            }
          }
        }
      }
    }
  } finally {
    if (rotatedCopyPath) {
      await fs.rm(rotatedCopyPath, { force: true }).catch(() => undefined);
    }
  }

  return bestText.trim();
};

const isPdfFile = (mimeType: string, filePath: string) =>
  mimeType === "application/pdf" || path.extname(filePath).toLowerCase() === ".pdf";

const isImageFile = (mimeType: string, filePath: string) =>
  mimeType.startsWith("image/") || [".jpg", ".jpeg", ".png", ".webp"].includes(path.extname(filePath).toLowerCase());

export const extractInvoiceTotalFromPdf = async (filePath: string, mimeType = "application/pdf"): Promise<number | null> => {
  try {
    if (isPdfFile(mimeType, filePath)) {
      const parsedText = await extractTextFromPdf(filePath);
      const parsedTotal = extractInvoiceTotalFromPdfText(parsedText);
      if (parsedTotal !== null) return parsedTotal;

      const ocrPageTexts = await extractOcrTextsFromPdfPages(filePath);
      const ocrTotal = extractInvoiceTotalFromPageTexts(ocrPageTexts);
      if (ocrTotal !== null) return ocrTotal;
      return null;
    }

    if (!isImageFile(mimeType, filePath)) return null;
    const text = await extractTextFromImage(filePath);
    return extractInvoiceTotalFromText(text);
  } catch {
    return null;
  }
};
