import { httpClient } from "../../infrastructure/api/http-client";
import { getApiBaseUrl } from "../../infrastructure/api/api-base-url";

const normalizeListParams = (params: Record<string, string | number | undefined>) => {
  const rawPageSize = params.pageSize;
  const asNumber = typeof rawPageSize === "number" ? rawPageSize : Number(rawPageSize);
  if (Number.isFinite(asNumber) && asNumber > 200) {
    return { ...params, pageSize: 200 };
  }
  return params;
};

const list = (resource: "sites" | "workshops" | "vehicles" | "vehicle-maintenances", params: Record<string, string | number | undefined>) =>
  httpClient.get<{ data: any[]; total: number; page: number; pageSize: number }>(`/master-data/${resource}`, normalizeListParams(params));
const create = (resource: "sites" | "workshops" | "vehicles" | "vehicle-maintenances", input: unknown) =>
  httpClient.post(`/master-data/${resource}`, input);
const update = (resource: "sites" | "workshops" | "vehicles" | "vehicle-maintenances", id: string, input: unknown) =>
  httpClient.patch(`/master-data/${resource}/${id}`, input);
const remove = (resource: "sites" | "workshops" | "vehicles" | "vehicle-maintenances", id: string) =>
  httpClient.delete(`/master-data/${resource}/${id}`);
const importVehicles = (input: { file: File; dryRun?: boolean; defaultSiteId?: string }) => {
  const formData = new FormData();
  formData.append("file", input.file);
  if (typeof input.dryRun === "boolean") formData.append("dryRun", String(input.dryRun));
  if (input.defaultSiteId) formData.append("defaultSiteId", input.defaultSiteId);
  return httpClient.post<{
    totalRows: number;
    validRows: number;
    inserted: number;
    skipped: number;
    errors: Array<{ row: number; field: string; reason: string; value?: string }>;
    dryRun: boolean;
  }>("/master-data/vehicles/import", formData);
};
const uploadVehicleMaintenanceAttachments = (maintenanceId: string, files: File[]) => {
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));
  return httpClient.post<{
    uploaded: number;
    invoicePdfFiles?: number;
    invoiceAnalyzableFiles?: number;
    invoiceAnalysisQueued?: number;
    invoiceTotalsFound?: number;
    invoiceTotalsMissing?: number;
    invoiceTotalAmount?: number;
    costUpdatedTo?: number | null;
  }>(`/uploads/vehicle-maintenances/${maintenanceId}/attachments`, formData, { timeoutMs: 120000 });
};
const uploadVehicleBooklet = (vehicleId: string, file: File) => {
  const formData = new FormData();
  formData.append("file", file);
  return httpClient.post<{
    booklet: {
      id: string;
      fileName: string;
      mimeType: string;
      sizeBytes: number;
      extractedRegistrationDate: string | null;
    };
    detectedRegistrationDate: string | null;
    revisionDueAt: string | null;
  }>(`/uploads/vehicles/${vehicleId}/booklet`, formData, { timeoutMs: 120000 });
};
const deleteVehicleBooklet = (bookletId: string) => httpClient.delete(`/uploads/vehicle-booklets/${bookletId}`);
const downloadVehicleBooklet = async (bookletId: string) => {
  const base = getApiBaseUrl();
  const response = await fetch(`${base}/uploads/vehicle-booklets/${bookletId}/file`, {
    credentials: "include"
  });
  if (!response.ok) throw new Error("Download libretto fallito");
  return response.blob();
};
const deleteVehicleMaintenanceAttachment = (attachmentId: string) =>
  httpClient.delete(`/uploads/vehicle-maintenance-attachments/${attachmentId}`);
const listVehicleDeadlines = (params?: Record<string, string | number | boolean | undefined>) =>
  httpClient.get<{
    kpis: {
      total: number;
      dueNowKm: number;
      dueSoonKm: number;
      dueNowRevision: number;
      dueSoonRevision: number;
      critical: number;
    };
    data: any[];
  }>("/master-data/vehicle-deadlines", params as Record<string, string | number | undefined>);
const syncVehicleDeadlinesCalendar = (input?: {
  vehicleIds?: string[];
  includeSoon?: boolean;
  kmWarning?: number;
  revisionWarningDays?: number;
}) => httpClient.post<{ synced: number; created: number; updated: number; removed: number }>("/master-data/vehicle-deadlines/calendar-sync", input ?? {});
const downloadVehicleMaintenanceExport = async (
  format: "csv" | "xlsx",
  params?: Record<string, string | number | undefined>
) => {
  const query = new URLSearchParams();
  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && `${value}` !== "") query.set(key, String(value));
  });
  const base = getApiBaseUrl();
  const response = await fetch(`${base}/master-data/vehicle-maintenances/export.${format}?${query.toString()}`, {
    credentials: "include"
  });
  if (!response.ok) {
    let message = "Download export manutenzioni fallito";
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
};

export const masterDataUseCases = {
  listSites: (params: Record<string, string | number | undefined>) => list("sites", params),
  createSite: (input: unknown) => create("sites", input),
  updateSite: (id: string, input: unknown) => update("sites", id, input),
  deleteSite: (id: string) => remove("sites", id),

  listWorkshops: (params: Record<string, string | number | undefined>) => list("workshops", params),
  createWorkshop: (input: unknown) => create("workshops", input),
  updateWorkshop: (id: string, input: unknown) => update("workshops", id, input),
  deleteWorkshop: (id: string) => remove("workshops", id),

  listVehicles: (params: Record<string, string | number | undefined>) => list("vehicles", params),
  createVehicle: (input: unknown) => create("vehicles", input),
  updateVehicle: (id: string, input: unknown) => update("vehicles", id, input),
  deleteVehicle: (id: string) => remove("vehicles", id),
  uploadVehicleBooklet,
  deleteVehicleBooklet,
  downloadVehicleBooklet,
  importVehicles,

  listVehicleMaintenances: (params: Record<string, string | number | undefined>) => list("vehicle-maintenances", params),
  listVehicleDeadlines,
  syncVehicleDeadlinesCalendar,
  createVehicleMaintenance: (input: unknown) => create("vehicle-maintenances", input),
  updateVehicleMaintenance: (id: string, input: unknown) => update("vehicle-maintenances", id, input),
  deleteVehicleMaintenance: (id: string) => remove("vehicle-maintenances", id),
  uploadVehicleMaintenanceAttachments,
  deleteVehicleMaintenanceAttachment,
  downloadVehicleMaintenancesCsv: (params?: Record<string, string | number | undefined>) =>
    downloadVehicleMaintenanceExport("csv", params),
  downloadVehicleMaintenancesXlsx: (params?: Record<string, string | number | undefined>) =>
    downloadVehicleMaintenanceExport("xlsx", params)
};
