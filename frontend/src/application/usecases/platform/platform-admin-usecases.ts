import { platformAuthStorage } from "../../../infrastructure/platform/platform-auth-storage";

const configuredApiBase = import.meta.env.VITE_PLATFORM_API_BASE_URL || "/platform-api";
const isBrowser = typeof window !== "undefined";
const isLocalPlatformHost = isBrowser && ["localhost", "127.0.0.1"].includes(window.location.hostname);
const apiBase = configuredApiBase.includes("127.0.0.1") || configuredApiBase.includes("localhost")
  ? (isLocalPlatformHost ? configuredApiBase : "/platform-api")
  : configuredApiBase;

type PlatformApiError = Error & { status?: number; code?: string };

const authHeaders = () => {
  const token = platformAuthStorage.get();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
};

const platformFetch = (input: RequestInfo | URL, init?: RequestInit) =>
  fetch(input, { credentials: "include", ...init });

export type LicenseStatus = "PENDING" | "ACTIVE" | "SUSPENDED" | "EXPIRED" | "TRIAL" | "PAST_DUE" | "CANCELED";
export type QuickAction =
  | "ACTIVATE_LICENSE"
  | "SUSPEND_LICENSE"
  | "TRIAL_14_DAYS"
  | "RENEW_30_DAYS"
  | "RENEW_365_DAYS"
  | "DEACTIVATE_TENANT"
  | "REACTIVATE_TENANT";

export type PlatformRevenueMetrics = {
  selectedMonth: string;
  previousMonth: string;
  range?: "2W" | "1M" | "6M" | "1Y";
  granularity?: "day" | "month";
  planPricing: Record<"STARTER" | "PRO" | "ENTERPRISE", number>;
  assumptions: {
    formula: string;
    seatsFactorRule: string;
    billingCycleRule: string;
  };
  kpis: {
    mrrTotal: number;
    mrrLost: number;
    deltaFromPrevious: number;
    tenantsByPlan: Record<"STARTER" | "PRO" | "ENTERPRISE", number>;
    mrrByPlan: Record<"STARTER" | "PRO" | "ENTERPRISE", number>;
  };
  breakdown: Array<{
    plan: "STARTER" | "PRO" | "ENTERPRISE";
    basePrice: number;
    activeTenants: number;
    totalTenants: number;
    seatsTotal: number;
    estimatedRevenue: number;
  }>;
  trend: Array<{
    month: string;
    mrrTotal: number;
    mrrLost: number;
  }>;
};

export type PlatformDashboardLiveMetrics = {
  generatedAt: string;
  liveWindowMinutes: number;
  activeUsersLive: number;
  previousWindowActiveUsers: number;
  deltaFromPreviousWindow: number;
  activeTenantsLive: number;
  topTenants: Array<{
    tenantId: string;
    tenantName: string;
    activeUsers: number;
  }>;
  mrrMonthly: number;
  mrrLost: number;
  mrrDeltaFromPrevious: number;
  month: string;
};

export type PlatformInvoice = {
  id: string;
  tenantId: string;
  tenantName: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  periodStart: string;
  periodEnd: string;
  status: "DRAFT" | "GENERATED" | "SENT" | "PAID" | "OVERDUE" | "VOID" | "ERROR";
  currency: string;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  billingName: string;
  billingEmail?: string | null;
  sentAt?: string | null;
  createdAt: string;
  deliveries: Array<{
    id: string;
    channel: "EMAIL";
    recipient: string;
    status: "PENDING" | "SENT" | "FAILED";
    provider?: string | null;
    providerMessageId?: string | null;
    errorMessage?: string | null;
    sentAt?: string | null;
    createdAt: string;
  }>;
  items: Array<{
    id: string;
    description: string;
    quantity: number;
    unitPrice: number;
    subtotal: number;
    taxRate: number;
    taxAmount: number;
    total: number;
  }>;
};

export type PlatformOverview = {
  generatedAt: string;
  windowDays: number;
  kpis: {
    tenantsTotal: number;
    activeTenants: number;
    trialActive: number;
    trialExpiring: number;
    suspendedLicenses: number;
    mrrEstimated: number;
    demoRequests: number;
    signups: number;
    websiteVisits: number;
    visitToDemoRate: number;
    invoicesToSend: number;
    invoiceErrors: number;
    emailErrors: number;
  };
  revenueByPlan: Record<string, { tenants: number; mrr: number }>;
  alerts: Array<{ type: string; severity: "LOW" | "MEDIUM" | "HIGH"; label: string }>;
  recentAudit: Array<{ id: string; tenantId: string; tenantName: string; action: string; resource: string; resourceId?: string | null; createdAt: string }>;
};

export type PlatformWebsiteAnalytics = {
  generatedAt: string;
  windowDays: number;
  totals: {
    events: number;
    pageViews: number;
    uniqueVisitors: number;
    ctaClicks: number;
    demoSubmits: number;
    signupStarted: number;
    signupCompleted: number;
    onboardingCompanyCompleted: number;
    checkoutStarted: number;
    checkoutCompleted: number;
    checkoutFailed: number;
    trialActivated: number;
    visitToDemoRate: number;
    demoToSignupRate: number;
    visitToSignupRate: number;
    signupStartToCompletionRate: number;
    signupToCompanyCompletionRate: number;
    companyToCheckoutRate: number;
    checkoutCompletionRate: number;
    checkoutFailureRate: number;
    signupToTrialRate: number;
    visitToTrialRate: number;
  };
  trend: Array<{
    date: string;
    pageViews: number;
    ctaClicks: number;
    demoSubmits: number;
    signups: number;
    companyCompleted: number;
    checkoutStarted: number;
    checkoutCompleted: number;
    checkoutFailed: number;
    trialActivated: number;
  }>;
  funnel: Array<{ key: string; label: string; value: number; rateFromPrevious: number; rateFromVisits: number }>;
  topPages: Array<{ label: string; value: number }>;
  topReferrers: Array<{ label: string; value: number }>;
  topSources: Array<{ label: string; value: number }>;
  topCampaigns: Array<{ label: string; value: number }>;
  sourcePerformance: Array<{
    label: string;
    visitors: number;
    pageViews: number;
    ctaClicks: number;
    demoSubmits: number;
    signupStarted: number;
    signupCompleted: number;
    onboardingCompanyCompleted: number;
    checkoutStarted: number;
    checkoutCompleted: number;
    checkoutFailed: number;
    trialActivated: number;
    visitToSignupRate: number;
    signupToCheckoutRate: number;
    checkoutCompletionRate: number;
    visitToTrialRate: number;
  }>;
  deviceBreakdown: Array<{ label: string; value: number }>;
  browserBreakdown: Array<{ label: string; value: number }>;
  eventCounts: Record<string, number>;
};

export type PlatformDemoLead = {
  id: string;
  companyName: string;
  fullName: string;
  email: string;
  emailMasked?: string | null;
  phone?: string | null;
  fleetSize?: string | null;
  message?: string | null;
  source: string;
  status: "NEW" | "CONTACTED" | "QUALIFIED" | "WON" | "LOST" | "SPAM";
  referrer?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  emailQueueId?: string | null;
  emailDeliveryStatus?: string | null;
  createdAt: string;
  updatedAt: string;
  contactedAt?: string | null;
  archivedAt?: string | null;
};

export type PlatformSystemHealth = {
  generatedAt: string;
  api: { status: string; responseTimeMs: number };
  db: { status: string };
  email: { status: string; provider: string; pending: number; failed: number };
  stripe: { status: string };
  storage: { status: string; uploadDir: string };
  invoices: { errors: number };
};

export type PlatformSecurityOverview = {
  generatedAt: string;
  auth: { otpEmail: string | null; tokenTtl: string; blockedLoginStates: number };
  controls: { ipAllowlist: string; corsOrigin: string };
  recentEvents: Array<{ id: string; action: string; tenantName: string; createdAt: string; resource: string; resourceId?: string | null }>;
};

export type PlatformTrustedDevice = {
  id: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
  revokedAt: string | null;
  status: "ACTIVE" | "EXPIRED" | "REVOKED";
};

const toPlatformError = (response: Response, payload: any, fallback: string): PlatformApiError => {
  const error = new Error(payload?.message || fallback) as PlatformApiError;
  error.status = response.status;
  if (payload?.code) error.code = String(payload.code);
  return error;
};

const throwIfNotOk = async (response: Response, fallback: string) => {
  if (response.ok) return;
  const payload = await response.json().catch(() => null);
  throw toPlatformError(response, payload, fallback);
};

export const platformAdminUseCases = {
  login: async (input: { email: string; password: string; otp?: string; trustDevice?: boolean }) => {
    const response = await platformFetch(`${apiBase}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    });
    const data = await response.json();
    if (!response.ok) throw toPlatformError(response, data, "Login platform fallito");
    if (data.token) platformAuthStorage.set(data.token);
    return data;
  },
  requestPasswordReset: async (email: string) => {
    const response = await platformFetch(`${apiBase}/auth/password-reset/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    });
    const data = await response.json();
    if (!response.ok) throw toPlatformError(response, data, "Richiesta recupero password fallita");
    return data as { message: string };
  },
  verifyPasswordReset: async (input: { email: string; otp: string }) => {
    const response = await platformFetch(`${apiBase}/auth/password-reset/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    });
    const data = await response.json();
    if (!response.ok) throw toPlatformError(response, data, "Verifica codice OTP fallita");
    return data as { message: string; resetToken: string };
  },
  confirmPasswordReset: async (input: { resetToken: string; newPassword: string; confirmPassword: string }) => {
    const response = await platformFetch(`${apiBase}/auth/password-reset/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    });
    const data = await response.json();
    if (!response.ok) throw toPlatformError(response, data, "Cambio password fallito");
    platformAuthStorage.clear();
    return data as { message: string };
  },
  logout: () => platformAuthStorage.clear(),
  listTrustedDevices: async () => {
    const response = await platformFetch(`${apiBase}/security/trusted-devices`, { headers: { ...authHeaders() } });
    const data = await response.json();
    if (!response.ok) throw toPlatformError(response, data, "Impossibile caricare dispositivi fidati");
    return data as { data: PlatformTrustedDevice[] };
  },
  revokeTrustedDevice: async (id: string) => {
    const response = await platformFetch(`${apiBase}/security/trusted-devices/${id}`, {
      method: "DELETE",
      headers: { ...authHeaders() }
    });
    const data = await response.json();
    if (!response.ok) throw toPlatformError(response, data, "Revoca dispositivo fidato fallita");
    return data as { revoked: true };
  },
  listTenants: async () => {
    const response = await platformFetch(`${apiBase}/tenants`, { headers: { ...authHeaders() } });
    const data = await response.json();
    if (!response.ok) throw toPlatformError(response, data, "Impossibile caricare tenant");
    return data as { data: any[] };
  },
  overview: async (days = 30) => {
    const response = await platformFetch(`${apiBase}/overview?days=${days}`, { headers: { ...authHeaders() } });
    const data = await response.json();
    if (!response.ok) throw toPlatformError(response, data, "Impossibile caricare overview platform");
    return data as { data: PlatformOverview };
  },
  websiteAnalytics: async (days = 30) => {
    const response = await platformFetch(`${apiBase}/analytics/website?days=${days}`, { headers: { ...authHeaders() } });
    const data = await response.json();
    if (!response.ok) throw toPlatformError(response, data, "Impossibile caricare analytics sito");
    return data as { data: PlatformWebsiteAnalytics };
  },
  listDemoLeads: async () => {
    const response = await platformFetch(`${apiBase}/demo-leads`, { headers: { ...authHeaders() } });
    const data = await response.json();
    if (!response.ok) throw toPlatformError(response, data, "Impossibile caricare richieste demo");
    return data as { data: PlatformDemoLead[] };
  },
  updateDemoLead: async (id: string, status: PlatformDemoLead["status"]) => {
    const response = await platformFetch(`${apiBase}/demo-leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ status })
    });
    const data = await response.json();
    if (!response.ok) throw toPlatformError(response, data, "Aggiornamento lead demo fallito");
    return data as { data: PlatformDemoLead };
  },
  systemHealth: async () => {
    const response = await platformFetch(`${apiBase}/system-health`, { headers: { ...authHeaders() } });
    const data = await response.json();
    if (!response.ok) throw toPlatformError(response, data, "Impossibile caricare system health");
    return data as { data: PlatformSystemHealth };
  },
  securityOverview: async () => {
    const response = await platformFetch(`${apiBase}/security`, { headers: { ...authHeaders() } });
    const data = await response.json();
    if (!response.ok) throw toPlatformError(response, data, "Impossibile caricare security overview");
    return data as { data: PlatformSecurityOverview };
  },
  listUsers: async () => {
    const response = await platformFetch(`${apiBase}/users`, { headers: { ...authHeaders() } });
    const data = await response.json();
    if (!response.ok) throw toPlatformError(response, data, "Impossibile caricare utenti");
    return data as { data: any[] };
  },
  listRecentEvents: async (limit = 20) => {
    const response = await platformFetch(`${apiBase}/events/recent?limit=${limit}`, { headers: { ...authHeaders() } });
    const data = await response.json();
    if (!response.ok) throw toPlatformError(response, data, "Impossibile caricare eventi recenti");
    return data as { data: any[] };
  },
  revenueMetrics: async (input?: { month?: string; months?: number; range?: "2W" | "1M" | "6M" | "1Y" }) => {
    const query = new URLSearchParams();
    if (input?.month) query.set("month", input.month);
    if (input?.months) query.set("months", String(input.months));
    if (input?.range) query.set("range", input.range);
    const response = await platformFetch(`${apiBase}/metrics/revenue?${query.toString()}`, { headers: { ...authHeaders() } });
    const data = await response.json();
    if (!response.ok) throw toPlatformError(response, data, "Impossibile caricare report ricavi");
    return data as PlatformRevenueMetrics;
  },
  dashboardLiveMetrics: async (input?: { windowMinutes?: number }) => {
    const query = new URLSearchParams();
    if (input?.windowMinutes) query.set("windowMinutes", String(input.windowMinutes));
    const response = await platformFetch(`${apiBase}/metrics/dashboard-live?${query.toString()}`, { headers: { ...authHeaders() } });
    if (response.status === 404) {
      const now = new Date();
      return {
        generatedAt: now.toISOString(),
        liveWindowMinutes: input?.windowMinutes ?? 15,
        activeUsersLive: 0,
        previousWindowActiveUsers: 0,
        deltaFromPreviousWindow: 0,
        activeTenantsLive: 0,
        topTenants: [],
        mrrMonthly: 0,
        mrrLost: 0,
        mrrDeltaFromPrevious: 0,
        month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
      } as PlatformDashboardLiveMetrics;
    }
    const data = await response.json();
    if (!response.ok) throw toPlatformError(response, data, "Impossibile caricare metriche live dashboard");
    return data as PlatformDashboardLiveMetrics;
  },
  revenueCsv: async (input?: { month?: string; months?: number; range?: "2W" | "1M" | "6M" | "1Y" }) => {
    const query = new URLSearchParams();
    if (input?.month) query.set("month", input.month);
    if (input?.months) query.set("months", String(input.months));
    if (input?.range) query.set("range", input.range);
    const response = await platformFetch(`${apiBase}/metrics/revenue/export.csv?${query.toString()}`, {
      headers: { ...authHeaders() }
    });
    await throwIfNotOk(response, "Export CSV ricavi fallito");
    return response.blob();
  },
  updateLicense: async (
    tenantId: string,
    payload: {
      plan: string;
      seats: number;
      status: LicenseStatus;
      expiresAt?: string | null;
      priceMonthly?: number | null;
      billingCycle?: "monthly" | "yearly";
    }
  ) => {
    const response = await platformFetch(`${apiBase}/tenants/${tenantId}/license`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw toPlatformError(response, data, "Aggiornamento licenza fallito");
    return data;
  },
  updateTenantStatus: async (tenantId: string, isActive: boolean) => {
    const response = await platformFetch(`${apiBase}/tenants/${tenantId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ isActive })
    });
    const data = await response.json();
    if (!response.ok) throw toPlatformError(response, data, "Aggiornamento stato tenant fallito");
    return data;
  },
  quickAction: async (tenantId: string, action: QuickAction) => {
    const response = await platformFetch(`${apiBase}/tenants/${tenantId}/quick-action`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ action })
    });
    const data = await response.json();
    if (!response.ok) throw toPlatformError(response, data, "Azione rapida fallita");
    return data;
  },
  listInvoices: async () => {
    const response = await platformFetch(`${apiBase}/invoices`, { headers: { ...authHeaders() } });
    const data = await response.json();
    if (!response.ok) throw toPlatformError(response, data, "Impossibile caricare fatture");
    return data as { data: PlatformInvoice[] };
  },
  generateInvoice: async (tenantId: string) => {
    const response = await platformFetch(`${apiBase}/tenants/${tenantId}/invoices/generate`, {
      method: "POST",
      headers: { ...authHeaders() }
    });
    const data = await response.json();
    if (!response.ok) throw toPlatformError(response, data, "Generazione fattura fallita");
    return data as { data: PlatformInvoice };
  },
  sendInvoiceEmail: async (invoiceId: string) => {
    const response = await platformFetch(`${apiBase}/invoices/${invoiceId}/send-email`, {
      method: "POST",
      headers: { ...authHeaders() }
    });
    const data = await response.json();
    if (!response.ok) throw toPlatformError(response, data, "Invio fattura fallito");
    return data as { data: PlatformInvoice };
  },
  updateInvoiceStatus: async (invoiceId: string, status: PlatformInvoice["status"]) => {
    const response = await platformFetch(`${apiBase}/invoices/${invoiceId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ status })
    });
    const data = await response.json();
    if (!response.ok) throw toPlatformError(response, data, "Aggiornamento stato fattura fallito");
    return data as { data: PlatformInvoice };
  },
  invoicePdfUrl: (invoiceId: string) => `${apiBase}/invoices/${invoiceId}/pdf`,
  downloadInvoicePdf: async (invoiceId: string) => {
    const response = await platformFetch(`${apiBase}/invoices/${invoiceId}/pdf`, { headers: { ...authHeaders() } });
    await throwIfNotOk(response, "Download PDF fattura fallito");
    return response.blob();
  }
};
