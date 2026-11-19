import type { PlatformDashboardLiveMetrics } from "./platform-admin-usecases";

type LiveErrorFactory = (response: Response, payload: any, fallback: string) => Error;

const defaultError: LiveErrorFactory = (response, payload, fallback) => {
  const error = new Error(payload?.message || fallback) as Error & { status: number; code?: string };
  error.status = response.status;
  if (payload?.code || payload?.error) error.code = String(payload.code || payload.error);
  return error;
};

/** Unavailable telemetry is not evidence of zero users or zero revenue. */
export const readPlatformLiveResponse = async (response: Response, createError: LiveErrorFactory = defaultError): Promise<PlatformDashboardLiveMetrics> => {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw createError(response, payload, "Metriche live non disponibili su questa versione del server.");
  }
  if (!payload || typeof payload !== "object") throw new Error("Risposta delle metriche live non valida.");
  return payload as PlatformDashboardLiveMetrics;
};
