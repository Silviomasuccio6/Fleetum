// Locate the visible controls by their meaning, independently of card markup.
export const vehicleSearch = page => page.getByRole("textbox", { name: /^(Cerca nella flotta|Search the fleet)$/ });
export const vehiclePaginationStatus = page => page.getByRole("status")
  .filter({ hasText: /Totale record|Total records/ }).filter({ visible: true });
export const bookingDetailsPanel = page => page.getByRole("complementary", { name: /^(Dettaglio prenotazione|Booking details)$/ });

export function bookingCalendarButtonNamePattern({ code, customerName }) {
  if (typeof code !== "string" || !code || typeof customerName !== "string" || !customerName) {
    throw new Error("Booking identity is required");
  }
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // The new accessible name appends status and dates after the booking identity.
  return new RegExp(`^(?:Prenotazione|Booking) ${escape(code)} - ${escape(customerName)}(?:,|$)`);
}

// Keep all three API values mandatory, including the empty-list convention.
export function vehiclePaginationTextPattern({ page, pageSize, total }) {
  if (![page, pageSize, total].every(Number.isSafeInteger) || page < 1 || pageSize < 1 || total < 0) {
    throw new Error("Invalid vehicle pagination API contract");
  }
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (page > pages) throw new Error("Vehicle page exceeds the API page count");
  // Accept legitimate integer grouping in IT/EN without accepting a different total.
  const formattedTotal = String(total).replace(/\B(?=(\d{3})+(?!\d))/g, "[.,\\s]?");
  return new RegExp(`^\\s*(?:Pagina|Page)\\s*${page}\\s*(?:di|of)\\s*${pages}\\s*·\\s*(?:Totale record|Total records):\\s*${formattedTotal}\\s*$`);
}
