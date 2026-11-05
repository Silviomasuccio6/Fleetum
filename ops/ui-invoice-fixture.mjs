import { tsImport } from "tsx/esm/api";

// UI preview only: use the same renderer, with synthetic booking data and no
// database/client, env-file loader, provider SDK or persistent invoice creation.
let modules;
export const uiInvoiceFixture = async booking => {
  modules ??= Promise.all([
    tsImport("../backend/src/application/services/booking-invoice-model.ts", import.meta.url),
    tsImport("../backend/src/application/services/booking-invoice-pdf.ts", import.meta.url)
  ]);
  const [{ buildBookingInvoiceModel }, { renderBookingInvoicePdf }] = await modules;
  const total = booking.expectedTotal, subtotal = Math.round(total / 1.22 * 100) / 100;
  const model = buildBookingInvoiceModel({
    tenantName: "Autonoleggio Demo", generatedAt: new Date(),
    profile: { legalName: "Autonoleggio Demo - azienda fittizia", legalAddress: "Via di prova 1", city: "Milano", vatNumber: "00000000000", email: "noleggio@example.invalid" },
    booking: { ...booking, pickupAt: new Date(booking.pickupAt), returnAt: new Date(booking.returnAt), site: booking.vehicle.site, pickupSite: booking.vehicle.site, returnSite: booking.vehicle.site },
    pricing: { priceListName: "Condizioni dimostrative", expectedSubtotal: subtotal, expectedTaxAmount: Math.round((total - subtotal) * 100) / 100, expectedTotal: total, vatRate: 22 }
  });
  model.warnings.unshift("FACSIMILE - DATI E IMPORTI SINTETICI. Anteprima locale, nessuna emissione o richiesta di pagamento.");
  return renderBookingInvoicePdf(model);
};
