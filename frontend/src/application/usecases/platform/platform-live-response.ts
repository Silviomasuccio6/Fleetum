import type { PlatformDashboardLiveMetrics } from "./platform-admin-usecases";

/** Unavailable telemetry is not evidence of zero users or zero revenue. */
export const readPlatformLiveResponse = async (response: Response): Promise<PlatformDashboardLiveMetrics> => {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.message || "Metriche live non disponibili su questa versione del server.") as Error & { status: number; code?: string };
    error.status = response.status;
    if (payload?.code) error.code = String(payload.code);
    throw error;
  }
  if (!payload || typeof payload !== "object") throw new Error("Risposta delle metriche live non valida.");
  return payload as PlatformDashboardLiveMetrics;
};
