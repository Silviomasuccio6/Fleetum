const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const sdiPattern = /^[A-Z0-9]{7}$/;
const italianPostalCodePattern = /^\d{5}$/;

const fiscalCodeEvenMap: Record<string, number> = {
  "0": 0, "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
  A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6, H: 7, I: 8, J: 9, K: 10, L: 11, M: 12,
  N: 13, O: 14, P: 15, Q: 16, R: 17, S: 18, T: 19, U: 20, V: 21, W: 22, X: 23, Y: 24, Z: 25
};

const fiscalCodeOddMap: Record<string, number> = {
  "0": 1, "1": 0, "2": 5, "3": 7, "4": 9, "5": 13, "6": 15, "7": 17, "8": 19, "9": 21,
  A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21, K: 2, L: 4, M: 18,
  N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14, U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23
};

export type CompanyRegistrationDraft = {
  country?: string | null;
  tenantName?: string | null;
  vatNumber?: string | null;
  taxCode?: string | null;
  pec?: string | null;
  sdiCode?: string | null;
  legalAddress?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
  companyEmail?: string | null;
  companyPhone?: string | null;
};

export type CompanyRegistrationValidationError = {
  field: keyof CompanyRegistrationDraft;
  code: string;
  message: string;
};

export const normalizeCountryCode = (value?: string | null) => String(value ?? "IT").trim().toUpperCase();
export const normalizeItalianVatNumber = (value?: string | null) => String(value ?? "").replace(/\D/g, "");
export const normalizeSdiCode = (value?: string | null) => String(value ?? "").trim().replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 7);
export const normalizePostalCode = (value?: string | null) => String(value ?? "").replace(/\D/g, "").slice(0, 5);
export const normalizeTaxCode = (value?: string | null) => String(value ?? "").trim().replace(/\s+/g, "").toUpperCase();

const hasText = (value?: string | null) => String(value ?? "").trim().length > 0;

export const isValidItalianVatNumber = (value?: string | null) => {
  const vat = normalizeItalianVatNumber(value);
  if (!/^\d{11}$/.test(vat)) return false;
  let sum = 0;
  for (let index = 0; index < vat.length; index += 1) {
    let digit = Number(vat[index]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
};

export const isValidItalianFiscalCode = (value?: string | null) => {
  const fiscalCode = normalizeTaxCode(value);
  if (!fiscalCode) return true;
  if (/^\d{11}$/.test(fiscalCode)) return isValidItalianVatNumber(fiscalCode);
  if (!/^[A-Z0-9]{16}$/.test(fiscalCode)) return false;
  let sum = 0;
  for (let index = 0; index < 15; index += 1) {
    const char = fiscalCode[index];
    sum += (index + 1) % 2 === 0 ? fiscalCodeEvenMap[char] ?? 0 : fiscalCodeOddMap[char] ?? 0;
  }
  const expected = String.fromCharCode("A".charCodeAt(0) + (sum % 26));
  return fiscalCode[15] === expected;
};

const isRepeated = (value: string) => value.length > 0 && new Set(value.split("")).size === 1;
const isSequential = (value: string) => {
  const chars = value.split("").map((char) => char.charCodeAt(0));
  return chars.every((char, index) => index === 0 || char === chars[index - 1] + 1);
};

export const isLikelyPlaceholderSdiCode = (value?: string | null) => {
  const sdi = normalizeSdiCode(value);
  if (!sdi) return false;
  const blacklist = new Set(["0000000", "XXXXXXX", "ABCDEFG", "ABC1234", "TEST123", "PROVA12", "AAAAAAA", "1234567", "7654321"]);
  return blacklist.has(sdi) || isRepeated(sdi) || isSequential(sdi);
};

export const isValidSdiCodeFormat = (value?: string | null) => {
  const sdi = normalizeSdiCode(value);
  return !sdi || (sdiPattern.test(sdi) && !isLikelyPlaceholderSdiCode(sdi));
};

export const validateCompanyRegistrationDraft = (input: CompanyRegistrationDraft): CompanyRegistrationValidationError[] => {
  const errors: CompanyRegistrationValidationError[] = [];
  const country = normalizeCountryCode(input.country);
  const vat = normalizeItalianVatNumber(input.vatNumber);
  const sdi = normalizeSdiCode(input.sdiCode);
  const pec = String(input.pec ?? "").trim().toLowerCase();

  if (!hasText(input.tenantName)) errors.push({ field: "tenantName", code: "COMPANY_NAME_REQUIRED", message: "Inserisci la ragione sociale o nome azienda." });
  if (!hasText(input.companyEmail) || !emailPattern.test(String(input.companyEmail).trim())) errors.push({ field: "companyEmail", code: "COMPANY_EMAIL_INVALID", message: "Inserisci un'email aziendale valida." });
  if (!hasText(input.companyPhone) || String(input.companyPhone).trim().length < 6) errors.push({ field: "companyPhone", code: "COMPANY_PHONE_REQUIRED", message: "Inserisci un telefono aziendale valido." });
  if (!hasText(input.legalAddress)) errors.push({ field: "legalAddress", code: "LEGAL_ADDRESS_REQUIRED", message: "Inserisci la sede legale." });

  if (country === "IT") {
    if (!isValidItalianVatNumber(vat)) errors.push({ field: "vatNumber", code: "VAT_NUMBER_INVALID", message: "La Partita IVA italiana deve avere 11 cifre e un codice di controllo valido." });
    if (!isValidItalianFiscalCode(input.taxCode)) errors.push({ field: "taxCode", code: "TAX_CODE_INVALID", message: "Il codice fiscale aziendale non è valido." });
    if (!hasText(input.city)) errors.push({ field: "city", code: "CITY_REQUIRED", message: "Seleziona il comune." });
    if (!/^[A-Z]{2}$/.test(String(input.province ?? "").trim().toUpperCase())) errors.push({ field: "province", code: "PROVINCE_INVALID", message: "Seleziona una provincia italiana valida." });
    if (!italianPostalCodePattern.test(normalizePostalCode(input.postalCode))) errors.push({ field: "postalCode", code: "POSTAL_CODE_INVALID", message: "Il CAP italiano deve contenere 5 cifre." });
    if (!pec || !emailPattern.test(pec)) errors.push({ field: "pec", code: "PEC_REQUIRED", message: "Inserisci una PEC valida. Lo SDI verrà verificato manualmente o tramite provider." });
    if (sdi && !isValidSdiCodeFormat(sdi)) errors.push({ field: "sdiCode", code: "SDI_CODE_INVALID", message: "Il codice SDI deve avere 7 caratteri reali: non usare codici di test o placeholder." });
  } else {
    if (!hasText(input.city)) errors.push({ field: "city", code: "CITY_REQUIRED", message: "Inserisci la città." });
    if (!hasText(input.postalCode)) errors.push({ field: "postalCode", code: "POSTAL_CODE_REQUIRED", message: "Inserisci il codice postale." });
  }

  return errors;
};
