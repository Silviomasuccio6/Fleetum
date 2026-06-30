import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  isLikelyPlaceholderSdiCode,
  isValidItalianFiscalCode,
  isValidItalianVatNumber,
  validateCompanyRegistrationDraft
} from "../src/shared/validation/company-registration.js";

describe("company registration validation", () => {
  it("keeps frontend and backend validation rules in sync", () => {
    const backendValidation = readFileSync(fileURLToPath(new URL("../src/shared/validation/company-registration.ts", import.meta.url)), "utf8");
    const frontendValidation = readFileSync(fileURLToPath(new URL("../../frontend/src/shared/validation/company-registration.ts", import.meta.url)), "utf8");

    assert.equal(frontendValidation, backendValidation);
  });

  it("validates Italian VAT checksum", () => {
    assert.equal(isValidItalianVatNumber("07643520567"), true);
    assert.equal(isValidItalianVatNumber("12345678901"), false);
  });

  it("rejects fake SDI placeholders", () => {
    assert.equal(isLikelyPlaceholderSdiCode("ABCDEFG"), true);
    assert.equal(isLikelyPlaceholderSdiCode("0000000"), true);
    assert.equal(isLikelyPlaceholderSdiCode("ABC1234"), true);
  });

  it("validates company fiscal payload for Italian signup", () => {
    const errors = validateCompanyRegistrationDraft({
      country: "IT",
      tenantName: "Rossi Noleggi Srl",
      vatNumber: "07643520567",
      taxCode: "07643520567",
      pec: "amministrazione@pec.rossinoleggi.it",
      sdiCode: "M5UXCR1",
      legalAddress: "Via Roma 1",
      city: "Roma",
      province: "RM",
      postalCode: "00118",
      companyEmail: "amministrazione@rossinoleggi.it",
      companyPhone: "+3906123456"
    });

    assert.deepEqual(errors, []);
    assert.equal(isValidItalianFiscalCode("07643520567"), true);
  });

  it("requires PEC and valid SDI for Italian company data", () => {
    const errors = validateCompanyRegistrationDraft({
      country: "IT",
      tenantName: "Demo Srl",
      vatNumber: "12345678901",
      pec: "",
      sdiCode: "ABCDEFG",
      legalAddress: "Via Roma 1",
      city: "Roma",
      province: "RM",
      postalCode: "00118",
      companyEmail: "info@example.com",
      companyPhone: "+3906123456"
    });

    assert.ok(errors.some((error) => error.code === "VAT_NUMBER_INVALID"));
    assert.ok(errors.some((error) => error.code === "PEC_REQUIRED"));
    assert.ok(errors.some((error) => error.code === "SDI_CODE_INVALID"));
  });

  it("accepts controlled international company data without forcing Italian VAT or CAP rules", () => {
    const errors = validateCompanyRegistrationDraft({
      country: "GB",
      tenantName: "Blue Rentals Ltd",
      vatNumber: "GB123456789",
      legalAddress: "10 Fleet Street",
      city: "London",
      province: "Greater London",
      postalCode: "SW1A 1AA",
      companyEmail: "billing@bluerentals.co.uk",
      companyPhone: "+442079460000"
    });

    assert.deepEqual(errors, []);
  });

  it("rejects obvious placeholders and fake contact values", () => {
    const errors = validateCompanyRegistrationDraft({
      country: "IT",
      tenantName: "Demo Srl",
      vatNumber: "07643520567",
      taxCode: "07643520567",
      pec: "test@example.com",
      sdiCode: "M5UXCR1",
      legalAddress: "Via test",
      city: "Roma",
      province: "RM",
      postalCode: "00118",
      companyEmail: "info@example.com",
      companyPhone: "1234567"
    });

    assert.ok(errors.some((error) => error.code === "COMPANY_NAME_REQUIRED"));
    assert.ok(errors.some((error) => error.code === "COMPANY_EMAIL_INVALID"));
    assert.ok(errors.some((error) => error.code === "COMPANY_PHONE_REQUIRED"));
    assert.ok(errors.some((error) => error.code === "LEGAL_ADDRESS_REQUIRED"));
    assert.ok(errors.some((error) => error.code === "PEC_REQUIRED"));
  });
});
