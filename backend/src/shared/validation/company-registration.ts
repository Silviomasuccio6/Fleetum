const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const sdiPattern = /^[A-Z0-9]{7}$/;
const italianPostalCodePattern = /^\d{5}$/;
const countryCodePattern = /^[A-Z]{2}$/;

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
export const normalizeVatNumberForCountry = (value?: string | null, country?: string | null) => {
  const normalizedCountry = normalizeCountryCode(country);
  if (normalizedCountry === "IT") return normalizeItalianVatNumber(value);
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase()
    .slice(0, 32);
};
export const normalizeSdiCode = (value?: string | null) => String(value ?? "").trim().replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 7);
export const normalizePostalCode = (value?: string | null) => String(value ?? "").replace(/\D/g, "").slice(0, 5);
export const normalizePostalCodeForCountry = (value?: string | null, country?: string | null) => {
  const normalizedCountry = normalizeCountryCode(country);
  if (normalizedCountry === "IT") return normalizePostalCode(value);
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase()
    .slice(0, 16);
};
export const normalizeTaxCode = (value?: string | null) => String(value ?? "").trim().replace(/\s+/g, "").toUpperCase();

const hasText = (value?: string | null) => String(value ?? "").trim().length > 0;
const comparable = (value?: string | null) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const placeholderExactValues = new Set([
  "test",
  "demo",
  "prova",
  "fake",
  "finto",
  "fittizio",
  "placeholder",
  "esempio",
  "na",
  "n a",
  "nessuno",
  "xxx",
  "xxxx",
  "azienda",
  "azienda demo",
  "azienda test",
  "demo srl",
  "test srl",
  "societa demo",
  "societa test",
  "company test",
  "test company",
  "indirizzo test",
  "via test"
]);

const placeholderTokenPattern = /(^|\s)(test|demo|prova|fake|finto|fittizio|placeholder|esempio)(\s|$)/;
const placeholderEmailDomains = new Set([
  "example.com",
  "example.it",
  "example.org",
  "test.com",
  "test.it",
  "demo.com",
  "demo.it",
  "localhost"
]);

export const isLikelyPlaceholderText = (value?: string | null) => {
  const cleaned = comparable(value);
  if (!cleaned) return false;
  return placeholderExactValues.has(cleaned) || placeholderTokenPattern.test(cleaned);
};

export const isLikelyPlaceholderEmail = (value?: string | null) => {
  const email = String(value ?? "").trim().toLowerCase();
  if (!emailPattern.test(email)) return false;
  const [localPart, domain = ""] = email.split("@");
  return (
    placeholderExactValues.has(comparable(localPart)) ||
    placeholderEmailDomains.has(domain) ||
    domain.endsWith(".example") ||
    domain.endsWith(".test") ||
    domain.includes("example") ||
    domain.includes("localhost")
  );
};

export const isValidItalianVatNumber = (value?: string | null) => {
  const vat = normalizeItalianVatNumber(value);
  if (!/^\d{11}$/.test(vat)) return false;
  if (isRepeated(vat) || isNumericRamp(vat)) return false;
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
const isNumericRamp = (value: string) => {
  if (!/^\d+$/.test(value)) return false;
  const ascending = "01234567890123456789";
  const descending = "98765432109876543210";
  return ascending.includes(value) || descending.includes(value);
};
const isSequential = (value: string) => {
  const chars = value.split("").map((char) => char.charCodeAt(0));
  return chars.every((char, index) => index === 0 || char === chars[index - 1] + 1);
};

const hasEnoughIdentifierEntropy = (value?: string | null) => {
  const normalized = String(value ?? "").trim().replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  if (normalized.length < 4) return false;
  if (isRepeated(normalized) || isSequential(normalized) || isNumericRamp(normalized)) return false;
  return !isLikelyPlaceholderText(normalized);
};

const isLikelyPlaceholderPhone = (value?: string | null) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length < 6) return true;
  return isRepeated(digits) || isNumericRamp(digits);
};

const isLikelyPlaceholderPostalCode = (value?: string | null, country?: string | null) => {
  const normalized = normalizePostalCodeForCountry(value, country);
  const compact = normalized.replace(/[^A-Z0-9]/g, "");
  if (!compact) return true;
  if (isRepeated(compact) || isNumericRamp(compact)) return true;
  return ["00000", "12345", "ABCDE", "XXXXX"].includes(compact);
};

export const isLikelyPlaceholderSdiCode = (value?: string | null) => {
  const sdi = normalizeSdiCode(value);
  if (!sdi) return false;
  const blacklist = new Set([
    "0000000",
    "XXXXXXX",
    "ABCDEFG",
    "ABC1234",
    "123ABCD",
    "A1B2C3D",
    "TEST123",
    "PROVA12",
    "DEMO123",
    "FAKE123",
    "AAAAAAA",
    "1234567",
    "7654321"
  ]);
  return blacklist.has(sdi) || isRepeated(sdi) || isSequential(sdi) || isNumericRamp(sdi) || isLikelyPlaceholderText(sdi);
};

export const isValidSdiCodeFormat = (value?: string | null) => {
  const sdi = normalizeSdiCode(value);
  return !sdi || (sdiPattern.test(sdi) && !isLikelyPlaceholderSdiCode(sdi));
};

export const validateCompanyRegistrationDraft = (input: CompanyRegistrationDraft): CompanyRegistrationValidationError[] => {
  const errors: CompanyRegistrationValidationError[] = [];
  const country = normalizeCountryCode(input.country);
  const vat = normalizeVatNumberForCountry(input.vatNumber, country);
  const sdi = normalizeSdiCode(input.sdiCode);
  const pec = String(input.pec ?? "").trim().toLowerCase();
  const companyEmail = String(input.companyEmail ?? "").trim().toLowerCase();

  if (!countryCodePattern.test(country)) errors.push({ field: "country", code: "COUNTRY_INVALID", message: "Seleziona una nazione valida." });
  if (!hasText(input.tenantName) || isLikelyPlaceholderText(input.tenantName)) errors.push({ field: "tenantName", code: "COMPANY_NAME_REQUIRED", message: "Inserisci una ragione sociale reale, non un valore di test." });
  if (!hasText(input.companyEmail) || !emailPattern.test(companyEmail) || isLikelyPlaceholderEmail(companyEmail)) errors.push({ field: "companyEmail", code: "COMPANY_EMAIL_INVALID", message: "Inserisci un'email aziendale reale e verificabile, non un placeholder." });
  if (!hasText(input.companyPhone) || isLikelyPlaceholderPhone(input.companyPhone)) errors.push({ field: "companyPhone", code: "COMPANY_PHONE_REQUIRED", message: "Inserisci un telefono aziendale valido, non un numero di test." });
  if (!hasText(input.legalAddress) || isLikelyPlaceholderText(input.legalAddress)) errors.push({ field: "legalAddress", code: "LEGAL_ADDRESS_REQUIRED", message: "Inserisci la sede legale reale, non un valore di test." });

  if (country === "IT") {
    if (!isValidItalianVatNumber(vat)) errors.push({ field: "vatNumber", code: "VAT_NUMBER_INVALID", message: "La Partita IVA italiana deve avere 11 cifre e un codice di controllo valido." });
    if (!isValidItalianFiscalCode(input.taxCode)) errors.push({ field: "taxCode", code: "TAX_CODE_INVALID", message: "Il codice fiscale aziendale non è valido." });
    if (!hasText(input.city) || isLikelyPlaceholderText(input.city)) errors.push({ field: "city", code: "CITY_REQUIRED", message: "Seleziona il comune." });
    if (!/^[A-Z]{2}$/.test(String(input.province ?? "").trim().toUpperCase())) errors.push({ field: "province", code: "PROVINCE_INVALID", message: "Seleziona una provincia italiana valida." });
    if (!italianPostalCodePattern.test(normalizePostalCode(input.postalCode)) || isLikelyPlaceholderPostalCode(input.postalCode, country)) errors.push({ field: "postalCode", code: "POSTAL_CODE_INVALID", message: "Il CAP italiano deve contenere 5 cifre reali." });
    if (!pec || !emailPattern.test(pec) || isLikelyPlaceholderEmail(pec)) errors.push({ field: "pec", code: "PEC_REQUIRED", message: "Inserisci una PEC valida. Lo SDI verrà verificato manualmente o tramite provider." });
    if (sdi && !isValidSdiCodeFormat(sdi)) errors.push({ field: "sdiCode", code: "SDI_CODE_INVALID", message: "Il codice SDI deve avere 7 caratteri reali: non usare codici di test o placeholder." });
  } else {
    if (!hasEnoughIdentifierEntropy(vat)) errors.push({ field: "vatNumber", code: "VAT_OR_TAX_ID_REQUIRED", message: "Inserisci un identificativo fiscale/VAT reale per l'azienda estera." });
    if (!hasText(input.city) || isLikelyPlaceholderText(input.city)) errors.push({ field: "city", code: "CITY_REQUIRED", message: "Inserisci la città." });
    if (!hasText(input.province) || isLikelyPlaceholderText(input.province)) errors.push({ field: "province", code: "PROVINCE_REQUIRED", message: "Inserisci provincia, stato o area amministrativa." });
    if (!hasText(input.postalCode) || isLikelyPlaceholderPostalCode(input.postalCode, country)) errors.push({ field: "postalCode", code: "POSTAL_CODE_REQUIRED", message: "Inserisci un codice postale reale." });
  }

  return errors;
};
