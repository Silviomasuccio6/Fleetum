import { Prisma } from "@prisma/client";
import { AppError } from "../../shared/errors/app-error.js";

type Person = {
  customerType?: string; firstName?: string | null; lastName?: string | null;
  companyName?: string | null; companyVatNumber?: string | null; companyTaxCode?: string | null;
  companyLegalAddress?: string | null; companyCity?: string | null; companyPostalCode?: string | null;
  companyPec?: string | null; companySdi?: string | null;
  taxCode?: string | null; residenceAddress?: string | null; residenceCity?: string | null; residencePostalCode?: string | null;
};
type Profile = {
  legalName: string; legalAddress?: string | null; postalCode?: string | null; city?: string | null;
  province?: string | null; vatNumber?: string | null; taxCode?: string | null; email?: string | null; pec?: string | null;
};
type Pricing = {
  priceListName?: string | null; daysCharged?: number | null; vatRate?: number | null;
  expectedSubtotal?: number | null; expectedTaxAmount?: number | null; expectedTotal?: number | null;
  finalSubtotal?: number | null; finalTaxAmount?: number | null; finalTotal?: number | null;
  extraKmEstimatedCost?: number | null; extraKmActualCost?: number | null;
  extraKmEstimated?: number | null; extraKmActual?: number | null;
};
export type BookingInvoiceInput = {
  tenantName: string; generatedAt: Date; profile: Profile | null; pricing: Pricing | null;
  booking: {
    code: string; status: string; customerName: string; expectedTotal?: number | null; finalTotal?: number | null;
    pickupAt: Date; returnAt: Date; customer?: Person | null;
    vehicle: { plate: string; brand: string; model: string };
    site?: { name: string } | null; pickupSite?: { name: string } | null; returnSite?: { name: string } | null;
  };
};
export type BookingInvoiceModel = {
  statusLabel: "BOZZA - NON EMESSA"; amountBasis: "EXPECTED" | "FINAL"; code: string; generatedAt: string;
  issuer: { name: string; details: string[] }; customer: { name: string; details: string[] };
  pickupAt: string; returnAt: string; pickupSite: string; returnSite: string; responsibleSite: string; vehicle: string;
  items: Array<{ description: string; detail: string; quantity: string; amount: string }>;
  subtotal: string; tax: string; total: string; vatRate: string | null; warnings: string[];
};
const text = (value?: string | null) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/gu, " ").trim();
const nonempty = (values: Array<string | null | undefined>) => values.map(text).filter(Boolean);
const incomplete = () => new AppError("Completa e verifica le condizioni economiche della prenotazione prima di preparare la bozza fattura.", 409, "INVOICE_PRICING_INCOMPLETE");
const amount = (value: number | null | undefined) => {
  if (value == null || !Number.isFinite(value) || value < 0 || value > 999999999999.99) throw incomplete();
  return new Prisma.Decimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
};

export const buildBookingInvoiceModel = ({ tenantName, generatedAt, profile, booking, pricing }: BookingInvoiceInput): BookingInvoiceModel => {
  if (["CANCELED", "NO_SHOW"].includes(booking.status)) {
    throw new AppError("Verifica le voci da fatturare per una prenotazione annullata o non ritirata.", 409, "INVOICE_BOOKING_STATE");
  }
  if (!pricing) throw incomplete();
  const final = booking.status === "CLOSED";
  const subtotal = amount(final ? pricing.finalSubtotal : pricing.expectedSubtotal);
  const tax = amount(final ? pricing.finalTaxAmount : pricing.expectedTaxAmount);
  const total = amount(final ? pricing.finalTotal : pricing.expectedTotal);
  if (!subtotal.plus(tax).equals(total)) throw incomplete();
  const bookingTotal = final ? booking.finalTotal : booking.expectedTotal;
  // A closed rental needs a confirmed booking total, not only the tentative
  // final columns a quote can populate before the vehicle is returned.
  if (final && bookingTotal == null) throw incomplete();
  if (bookingTotal != null && !amount(bookingTotal).equals(total)) throw incomplete();
  const extraValue = final ? pricing.extraKmActualCost : pricing.extraKmEstimatedCost;
  const extra = extraValue == null ? new Prisma.Decimal(0) : amount(extraValue);
  if (extra.greaterThan(subtotal)) throw incomplete();
  const km = final ? pricing.extraKmActual : pricing.extraKmEstimated;
  if (extra.greaterThan(0) && (km == null || !Number.isInteger(km) || km <= 0)) throw incomplete();
  const customer = booking.customer;
  const company = customer?.customerType === "PERSONA_GIURIDICA";
  const customerName = company ? text(customer?.companyName) : nonempty([customer?.firstName, customer?.lastName]).join(" ");
  const issuerAddress = nonempty([profile?.legalAddress, profile?.postalCode, profile?.city, profile?.province]).join(", ");
  const customerAddress = company
    ? nonempty([customer?.companyLegalAddress, customer?.companyPostalCode, customer?.companyCity]).join(", ")
    : nonempty([customer?.residenceAddress, customer?.residencePostalCode, customer?.residenceCity]).join(", ");
  const warnings: string[] = [];
  if (!text(profile?.legalName) || !issuerAddress || !text(profile?.vatNumber || profile?.taxCode)) warnings.push("Anagrafica aziendale da completare prima dell'emissione.");
  if (!customerName || !customerAddress) warnings.push("Verificare i dati di fatturazione del cliente prima dell'emissione.");
  const vatRate = pricing.vatRate != null && Number.isFinite(pricing.vatRate) && pricing.vatRate >= 0 && pricing.vatRate <= 100
    ? new Prisma.Decimal(pricing.vatRate).toString() : null;
  return {
    statusLabel: "BOZZA - NON EMESSA", amountBasis: final ? "FINAL" : "EXPECTED", code: text(booking.code), generatedAt: generatedAt.toISOString(),
    issuer: { name: text(profile?.legalName) || text(tenantName), details: nonempty([issuerAddress,
      profile?.vatNumber ? `P.IVA ${text(profile.vatNumber)}` : null, profile?.taxCode ? `CF ${text(profile.taxCode)}` : null, profile?.email, profile?.pec ? `PEC ${text(profile.pec)}` : null]) },
    customer: { name: customerName || text(booking.customerName), details: nonempty([customerAddress,
      company && customer?.companyVatNumber ? `P.IVA ${text(customer.companyVatNumber)}` : null,
      (company ? customer?.companyTaxCode : customer?.taxCode) ? `CF ${text(company ? customer?.companyTaxCode : customer?.taxCode)}` : null,
      company && customer?.companyPec ? `PEC ${text(customer.companyPec)}` : null, company && customer?.companySdi ? `SDI ${text(customer.companySdi)}` : null]) },
    pickupAt: booking.pickupAt.toISOString(), returnAt: booking.returnAt.toISOString(),
    pickupSite: text(booking.pickupSite?.name) || "Sede non classificata", returnSite: text(booking.returnSite?.name) || "Sede non classificata",
    responsibleSite: text(booking.site?.name) || "Sede non classificata", vehicle: nonempty([booking.vehicle.brand, booking.vehicle.model, booking.vehicle.plate]).join(" - "),
    items: [
      { description: "Noleggio", detail: text(pricing.priceListName) || "Condizioni economiche salvate nella prenotazione", quantity: pricing.daysCharged != null && Number.isFinite(pricing.daysCharged) && pricing.daysCharged > 0 ? `${pricing.daysCharged} gg` : "1", amount: subtotal.minus(extra).toFixed(2) },
      ...(extra.greaterThan(0) ? [{ description: "Chilometri aggiuntivi", detail: final ? "Importo finale salvato" : "Importo previsto salvato", quantity: `${km} km`, amount: extra.toFixed(2) }] : [])
    ],
    subtotal: subtotal.toFixed(2), tax: tax.toFixed(2), total: total.toFixed(2), vatRate, warnings
  };
};

export const isTenantBrandingKey = (key: string, tenantId: string) => {
  if (!/^[A-Za-z0-9_-]+$/.test(tenantId)) return false;
  return [`tenants/${tenantId}/branding/`, `uploads/${tenantId}/branding/`].some(prefix =>
    key.startsWith(prefix) && /^[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(png|jpe?g)$/i.test(key.slice(prefix.length)) && !key.includes(".."));
};
