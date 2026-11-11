import { httpClient } from "../../infrastructure/api/http-client";

export const stoppagesUseCases = {
  list: (params: Record<string, string | number | undefined>) =>
    httpClient.get<{ data: any[]; total: number; page: number; pageSize: number }>("/stoppages", params),
  getById: (id: string) => httpClient.get<any>(`/stoppages/${id}`),
  create: (input: unknown) => httpClient.post<any>("/stoppages", input),
  update: (id: string, input: unknown) => httpClient.patch<any>(`/stoppages/${id}`, input),
  updateStatus: (id: string, status: "OPEN" | "IN_PROGRESS" | "WAITING_PARTS" | "SOLICITED" | "CLOSED" | "CANCELED") =>
    httpClient.patch<any>(`/stoppages/${id}/status`, { status }),
  bulkUpdate: (input: {
    ids: string[];
    action: "SET_STATUS" | "SET_PRIORITY" | "SEND_REMINDER";
    status?: "OPEN" | "IN_PROGRESS" | "WAITING_PARTS" | "SOLICITED" | "CLOSED" | "CANCELED";
    priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  }) => httpClient.post<{ data: Array<{ id: string; ok: boolean; message?: string }> }>("/stoppages/bulk", input),
  alerts: () => httpClient.get<{ data: any[] }>("/stoppages/alerts/list"),
  slaOverview: () => httpClient.get<{ kpis: any; data: any[] }>("/stoppages/sla/overview"),
  assignmentSuggestions: () => httpClient.get<{ data: any[]; suggestions: any[] }>("/stoppages/assignment/suggestions"),
  calendar: (params?: Record<string, string | number | undefined>) => httpClient.get<{ data: any[] }>("/stoppages/calendar", params),
  getAppleCalendarFeed: (params?: Record<string, string | number | undefined>) =>
    httpClient.get<{ data: { httpUrl: string; webcalUrl: string; expiresAt: string | null; privacy?: "masked" | "full" } }>(
      "/stoppages/calendar/apple/feed",
      params
    ),
  syncGoogleCalendar: (input?: Record<string, string | number | undefined>) =>
    httpClient.post<{
      data: {
        requiresOAuth: boolean;
        authUrl?: string;
        synced?: number;
        pushed?: number;
        imported?: number;
        updated?: number;
        removed?: number;
        accountEmail?: string | null;
        calendarUrl?: string;
      };
    }>("/stoppages/calendar/google/sync", input ?? {}),
  revokeCalendarFeeds:()=>httpClient.post<void>("/stoppages/calendar/apple/revoke",{},{suppressSuccessToast:true}),
  importAppleCalendarFeed: (input: { feedUrl: string; dateFrom?: string; dateTo?: string }) =>
    httpClient.post<{ data: { imported: number; updated: number; scanned: number } }>("/stoppages/calendar/apple/import", input),
  listCustomCalendarEvents: (params?: Record<string, string | number | undefined>) =>
    httpClient.get<{ data: any[] }>("/stoppages/calendar/custom", params),
  createCustomCalendarEvent: (input: unknown) => httpClient.post<{ data: any }>("/stoppages/calendar/custom", input),
  updateCustomCalendarEvent: (eventId: string, input: unknown) =>
    httpClient.patch<{ data: any }>(`/stoppages/calendar/custom/${eventId}`, input),
  deleteCustomCalendarEvent: (eventId: string) => httpClient.delete(`/stoppages/calendar/custom/${eventId}`),
  costsSummary: (params?: Record<string, string | number | undefined>) => httpClient.get<any>("/stoppages/costs/summary", params),
  costsVariance: (params?: Record<string, string | number | undefined>) => httpClient.get<any>("/stoppages/costs/variance", params),
  slaEscalations: () => httpClient.get<{ kpis: any; data: any[] }>("/stoppages/sla/escalations"),
  preventiveDue: (params?: Record<string, string | number | undefined>) => httpClient.get<{ kpis: any; data: any[] }>("/stoppages/preventive/due", params),
  events: (id: string) => httpClient.get<{ data: any[] }>(`/stoppages/${id}/events`),
  workflowTransition: (id: string, input: { toStatus: "OPEN" | "IN_PROGRESS" | "WAITING_PARTS" | "SOLICITED" | "CLOSED" | "CANCELED"; note?: string; closureSummary?: string }) =>
    httpClient.post(`/stoppages/${id}/workflow/transition`, input),
  reminderTemplatePreview: (id: string, channel: "EMAIL" | "WHATSAPP" = "EMAIL") =>
    httpClient.get<any>(`/stoppages/${id}/reminders/template-preview`, { channel }),
  listPartsOrders: (id: string) => httpClient.get<{ data: any[] }>(`/stoppages/${id}/parts-orders`),
  addPartsOrder: (id: string, input: { description: string; supplier?: string; etaDate?: string; estimatedCost?: number }) =>
    httpClient.post(`/stoppages/${id}/parts-orders`, input),
  listCostApprovals: (id: string) => httpClient.get<{ requests: any[]; decisions: any[] }>(`/stoppages/${id}/cost-approvals`),
  requestCostApproval: (id: string, input: { estimatedTotalCost: number; reason: string; note?: string }) =>
    httpClient.post(`/stoppages/${id}/cost-approvals/request`, input),
  decideCostApproval: (id: string, input: { approved: boolean; approvedCost?: number; reason?: string }) =>
    httpClient.post(`/stoppages/${id}/cost-approvals/decision`, input),
  getClosureChecklist: (id: string) => httpClient.get<{ data: any }>(`/stoppages/${id}/closure-checklist`),
  saveClosureChecklist: (
    id: string,
    input: { photosUploaded: boolean; finalCauseSet: boolean; finalCostSet: boolean; operatorSigned: boolean; notes?: string }
  ) => httpClient.post(`/stoppages/${id}/closure-checklist`, input),
  setFinalCost: (id: string, actualTotalCost: number) => httpClient.post(`/stoppages/${id}/final-cost`, { actualTotalCost }),
  remove: (id: string) => httpClient.delete(`/stoppages/${id}`),
  sendEmailReminder: (id: string) => httpClient.post(`/stoppages/${id}/reminders/email`),
  getWhatsappLink: (id: string) => httpClient.get<{ url: string }>(`/stoppages/${id}/reminders/whatsapp-link`)
};
