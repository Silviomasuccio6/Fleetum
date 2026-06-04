import { httpClient } from "../../infrastructure/api/http-client";
import { getApiBaseUrl } from "../../infrastructure/api/api-base-url";
import type {
  AiSuggestionDto,
  AnalyticsReportDto,
  ApiQueryParams,
  DashboardStatsDto,
  TeamPerformanceDto,
  VehicleProfitabilityReportDto,
  WorkshopCapacityDto,
  WorkshopHealthDto
} from "../dtos/stats-dto";

type ExportQueryParams = Record<string, string | number | undefined>;

export const statsUseCases = {
  dashboard: () => httpClient.get<DashboardStatsDto>("/stats/dashboard"),
  analytics: (params?: ExportQueryParams) => httpClient.get<AnalyticsReportDto>("/stats/analytics", params),
  vehicleProfitability: (params?: ApiQueryParams) =>
    httpClient.get<VehicleProfitabilityReportDto>("/stats/vehicles/profitability", params as ExportQueryParams),
  workshopsHealth: (params?: ExportQueryParams) => httpClient.get<{ data: WorkshopHealthDto[] }>("/stats/workshops/health", params),
  workshopsCapacity: (params?: ExportQueryParams) => httpClient.get<{ data: WorkshopCapacityDto[] }>("/stats/workshops/capacity", params),
  teamPerformance: (params?: ExportQueryParams) => httpClient.get<{ data: TeamPerformanceDto[] }>("/stats/team/performance", params),
  aiSuggestions: () => httpClient.get<{ data: AiSuggestionDto[] }>("/stats/ai/suggestions"),
  downloadAnalyticsXlsx: async (params?: ExportQueryParams) => {
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
  downloadAnalyticsCsv: async (params?: ExportQueryParams) => {
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
