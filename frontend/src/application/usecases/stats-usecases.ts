import { httpClient } from "../../infrastructure/api/http-client";
import { getApiBaseUrl } from "../../infrastructure/api/api-base-url";

export const statsUseCases = {
  dashboard: () => httpClient.get<any>("/stats/dashboard"),
  analytics: (params?: Record<string, string | number | undefined>) => httpClient.get<any>("/stats/analytics", params),
  vehicleProfitability: (params?: Record<string, string | number | boolean | undefined>) =>
    httpClient.get<any>("/stats/vehicles/profitability", params as Record<string, string | number | undefined>),
  workshopsHealth: (params?: Record<string, string | number | undefined>) => httpClient.get<{ data: any[] }>("/stats/workshops/health", params),
  workshopsCapacity: (params?: Record<string, string | number | undefined>) => httpClient.get<{ data: any[] }>("/stats/workshops/capacity", params),
  teamPerformance: (params?: Record<string, string | number | undefined>) => httpClient.get<{ data: any[] }>("/stats/team/performance", params),
  aiSuggestions: () => httpClient.get<{ data: any[] }>("/stats/ai/suggestions"),
  downloadAnalyticsXlsx: async (params?: Record<string, string | number | undefined>) => {
    const query = new URLSearchParams();
    Object.entries(params ?? {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && `${value}` !== "") query.set(key, String(value));
    });
    const base = getApiBaseUrl();
    const response = await fetch(`${base}/stats/analytics/export.xlsx?${query.toString()}`, {
      credentials: "include"
    });
    if (!response.ok) {
      let message = "Download report enterprise fallito";
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const payload = await response.json().catch(() => null);
        if (payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string") {
          message = payload.message;
        }
      } else {
        const raw = await response.text().catch(() => "");
        const trimmed = raw.trim();
        if (trimmed) message = trimmed.slice(0, 220);
      }
      throw new Error(message);
    }
    return response.blob();
  },
  downloadAnalyticsCsv: async (params?: Record<string, string | number | undefined>) => {
    const query = new URLSearchParams();
    Object.entries(params ?? {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && `${value}` !== "") query.set(key, String(value));
    });
    const base = getApiBaseUrl();
    const response = await fetch(`${base}/stats/analytics/export.csv?${query.toString()}`, {
      credentials: "include"
    });
    if (!response.ok) {
      let message = "Download report fallito";
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const payload = await response.json().catch(() => null);
        if (payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string") {
          message = payload.message;
        }
      } else {
        const raw = await response.text().catch(() => "");
        const trimmed = raw.trim();
        if (trimmed) message = trimmed.slice(0, 220);
      }
      throw new Error(message);
    }
    return response.blob();
  },
  downloadVehicleProfitability: async (
    format: "pdf" | "xlsx" | "csv",
    params?: Record<string, string | number | boolean | undefined>
  ) => {
    const query = new URLSearchParams();
    Object.entries(params ?? {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && `${value}` !== "") query.set(key, String(value));
    });
    const base = getApiBaseUrl();
    const response = await fetch(`${base}/stats/vehicles/profitability/export.${format}?${query.toString()}`, {
      credentials: "include"
    });
    if (!response.ok) {
      let message = "Download report redditivita veicolo fallito";
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const payload = await response.json().catch(() => null);
        if (payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string") {
          message = payload.message;
        }
      } else {
        const raw = await response.text().catch(() => "");
        const trimmed = raw.trim();
        if (trimmed) message = trimmed.slice(0, 220);
      }
      throw new Error(message);
    }
    return response.blob();
  }
};
