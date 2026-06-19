import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isLikelyPlaceholderSdiCode,
  isValidItalianFiscalCode,
  isValidItalianVatNumber,
  validateCompanyRegistrationDraft
} from "../src/shared/validation/company-registration.js";

describe("company registration validation", () => {
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
      tenantName: "Fleetum Test Srl",
      vatNumber: "07643520567",
      taxCode: "07643520567",
      pec: "fleetum.test@pec.example.com",
      sdiCode: "M5UXCR1",
      legalAddress: "Via Roma 1",
      city: "Roma",
      province: "RM",
      postalCode: "00118",
      companyEmail: "info@example.com",
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
});
