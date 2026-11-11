import { scopedFetch } from "../../infrastructure/api/scoped-fetch";
import { getApiBaseUrl } from "../../infrastructure/api/api-base-url";

export const downloadBookingInvoiceDraft = async (bookingId: string, signal?: AbortSignal): Promise<Blob> => {
  const response = await scopedFetch(`${getApiBaseUrl()}/rental-bookings/${encodeURIComponent(bookingId)}/invoice/draft.pdf`, {
    credentials: "include", cache: "no-store", headers: { Accept: "application/pdf" }, signal
  });
  if (!response.ok) {
    let message = "Bozza fattura non disponibile. Riprova.";
    try {
      const error = await response.json();
      if (typeof error?.message === "string" && error.message.length <= 400) message = error.message;
    } catch { /* Keep a user-facing fallback for an empty or non-JSON error. */ }
    throw new Error(message);
  }
  if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/pdf")) {
    throw new Error("Il servizio non ha restituito un PDF valido. Riprova.");
  }
  const blob = await response.blob();
  if (blob.size === 0 || blob.size > 10 * 1024 * 1024 || new TextDecoder().decode(await blob.slice(0, 5).arrayBuffer()) !== "%PDF-") {
    throw new Error("Il servizio non ha restituito un PDF valido. Riprova.");
  }
  return blob;
};
