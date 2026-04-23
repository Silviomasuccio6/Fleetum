import assert from "node:assert/strict";
import test from "node:test";
import { buildContractTemplateMap } from "../src/application/services/booking-contract-service.js";
import { rentalCustomerCreateSchema } from "../src/interfaces/http/validators/rental-bookings-validators.js";

test("customers smoke: persona fisica valida", () => {
  const parsed = rentalCustomerCreateSchema.parse({
    customerType: "PERSONA_FISICA",
    firstName: "Mario",
    lastName: "Rossi",
    drivingLicenseNumber: "AB1234567",
    email: "mario.rossi@example.com"
  });

  assert.equal(parsed.customerType, "PERSONA_FISICA");
  assert.equal(parsed.firstName, "Mario");
  assert.equal(parsed.lastName, "Rossi");
  assert.equal(parsed.drivingLicenseNumber, "AB1234567");
});

test("customers smoke: persona giuridica valida", () => {
  const parsed = rentalCustomerCreateSchema.parse({
    customerType: "PERSONA_GIURIDICA",
    companyName: "Fleet Demo Srl",
    companyVatNumber: "12345678901",
    email: "fleet@example.com"
  });

  assert.equal(parsed.customerType, "PERSONA_GIURIDICA");
  assert.equal(parsed.companyName, "Fleet Demo Srl");
  assert.equal(parsed.companyVatNumber, "12345678901");
});

test("customers smoke: persona giuridica senza partita IVA -> errore", () => {
  assert.throws(() => {
    rentalCustomerCreateSchema.parse({
      customerType: "PERSONA_GIURIDICA",
      companyName: "Fleet Demo Srl",
      email: "fleet@example.com"
    });
  });
});

test("contracts smoke: placeholder company disponibili", () => {
  const dictionary = buildContractTemplateMap({
    booking: { code: "BK-DEMO-1" },
    customer: {
      type: "PERSONA_GIURIDICA",
      companyName: "Fleet Demo Srl",
      companyVat: "12345678901",
      companyTaxCode: "12345678901",
      companyAddress: "Via Roma 1, Milano",
      companyPec: "fleet@pec.example.com",
      companySdi: "ABC1234",
      companyRea: "MI-12345",
      companyLegalRepFullName: "Luca Bianchi",
      companyLegalRepTaxCode: "BNCLCU80A01F205X"
    },
    vehicle: {},
    pricing: {}
  });

  assert.equal(dictionary["customer.type"], "PERSONA_GIURIDICA");
  assert.equal(dictionary["company.name"], "Fleet Demo Srl");
  assert.equal(dictionary["company.vat"], "12345678901");
  assert.equal(dictionary["company.legalRepFullName"], "Luca Bianchi");
});
