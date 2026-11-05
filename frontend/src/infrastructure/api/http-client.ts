import { captureSiteStamp, captureSiteAccount, assertSiteAccount, assertSiteStamp, assertSiteResponse, invalidateSiteStamp, siteRequestHeaders, beginSiteWrite, type SiteStamp, type SiteAccountStamp, SiteContextChangedError } from "../../application/stores/site-access-store";
import axios from "axios";
import { snackbar } from "../../application/stores/snackbar-store";
import { useAuthStore } from "../../application/stores/auth-store";
import { ApiRepository } from "../../domain/repositories/api-repository";
import { tokenStorage } from "../auth/token-storage";
import { getApiBaseUrl } from "./api-base-url";
import { getLoginRedirectPath } from "../../presentation/routes/safe-return-to";

const API_BASE_URL = getApiBaseUrl();

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  withCredentials: true
});

type ViewRequest = { _fleetumView?: SiteStamp; _fleetumOwner?: SiteAccountStamp; _releaseView?: () => void };
const assertRequestOwner = (request: ViewRequest) => {
  if (request._fleetumOwner) assertSiteAccount(request._fleetumOwner);
  if (request._fleetumView) assertSiteStamp(request._fleetumView);
};

export class HttpClientError extends Error {
  status?: number;
  code?: string;
  details?: Record<string, unknown>;
  isNetwork: boolean;
  isTimeout: boolean;

  constructor(
    message: string,
    options: {
      status?: number;
      code?: string;
      details?: Record<string, unknown>;
      isNetwork?: boolean;
      isTimeout?: boolean;
    } = {}
  ) {
    super(message);
    this.name = "HttpClientError";
    this.status = options.status;
    this.code = options.code;
    this.details = options.details;
    this.isNetwork = Boolean(options.isNetwork);
    this.isTimeout = Boolean(options.isTimeout);
  }
}

const AUTH_ROUTES = ["/auth/login", "/auth/signup", "/auth/forgot-password", "/auth/reset-password", "/auth/accept-invite", "/auth/refresh"];
let refreshPromise: Promise<{ user?: unknown; csrfToken?: string } | null> | null = null;
let refreshAccount: SiteAccountStamp | null = null;

const getCookieValue = (name: string) => {
  const raw = document.cookie
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(`${name}=`));
  if (!raw) return undefined;
  return decodeURIComponent(raw.slice(name.length + 1));
};

const isStateChangingMethod = (method?: string) => {
  const normalized = String(method ?? "get").toUpperCase();
  return ["POST", "PUT", "PATCH", "DELETE"].includes(normalized);
};

const readCsrfToken = () => getCookieValue("fermi_csrf") ?? tokenStorage.getCsrf();

const logoutAndRedirectToLogin = () => {
  const loginPath = getLoginRedirectPath(window.location);
  tokenStorage.clear();
  useAuthStore.getState().logout();
  if (window.location.pathname !== "/login") window.location.replace(loginPath);
};

const tryRefreshSession = async () => {
  const account = captureSiteAccount();
  if (refreshPromise && refreshAccount?.owner===account.owner && refreshAccount.epoch===account.epoch) return refreshPromise;

  refreshAccount=account;
  refreshPromise = (async () => {
    try {
      const remember = tokenStorage.shouldRemember();
      const refreshRes = await axios.post(`${API_BASE_URL}/auth/refresh`, {}, { timeout: 15000, withCredentials: true });

      const nextUser = refreshRes.data?.user;
      const csrfToken = typeof refreshRes.data?.csrfToken === "string" ? refreshRes.data.csrfToken : undefined;

      try{assertSiteAccount(account);}catch{return null;}
      if (nextUser) useAuthStore.getState().setSession(nextUser as any, remember);

      if (csrfToken) tokenStorage.setCsrf(csrfToken, remember);
      return { user: nextUser, csrfToken };
    } catch {
      return null;
    } finally {
      if(refreshAccount===account){refreshPromise=null;refreshAccount=null;}
    }
  })();

  return refreshPromise;
};

api.interceptors.request.use(async (config) => {
  const request = config as typeof config & ViewRequest;
  const business = !/^\/(auth|public|health|ready)(\/|$)/.test(String(config.url ?? ""));
  // Own metadata may outlive a view revision, but never its account identity.
  if (String(config.url ?? "") === "/auth/site-access") {
    request._fleetumOwner ??= captureSiteAccount();
    assertRequestOwner(request);
  }
  if (business) { if(request._fleetumView) assertSiteStamp(request._fleetumView); else request._fleetumView=captureSiteStamp(); }
  if (isStateChangingMethod(config.method)) {
    let csrfToken = readCsrfToken();
    if (!csrfToken) {
      const refreshed = await tryRefreshSession();
      csrfToken = refreshed?.csrfToken ?? readCsrfToken();
    }
    if (csrfToken) config.headers["X-CSRF-Token"] = csrfToken;
  }

  if(request._fleetumView){ assertSiteStamp(request._fleetumView); config.headers.delete("X-Fleetum-Site"); config.headers.delete("X-Fleetum-Site-Revision"); Object.assign(config.headers,siteRequestHeaders()); request._releaseView=beginSiteWrite(request._fleetumView,config.method); }
  return config;
});

api.interceptors.response.use(
  (res) => {
    const request=res.config as typeof res.config & ViewRequest;
    request._releaseView?.(); assertRequestOwner(request);
    if(request._fleetumView)assertSiteResponse(request._fleetumView,res.headers["x-fleetum-site-revision"],res.headers["x-fleetum-site-view"],res.status>=200&&res.status<300);
    const csrfToken = typeof res.data?.csrfToken === "string" ? res.data.csrfToken : undefined;
    if (csrfToken) tokenStorage.setCsrf(csrfToken, tokenStorage.shouldRemember());
    return res;
  },
  async (error) => {
    const originalRequest = error.config ?? {};
    originalRequest._releaseView?.();
    try{assertRequestOwner(originalRequest);}catch(stale){return Promise.reject(stale);}
    const status = error.response?.status as number | undefined;
    const apiErrorCode = error.response?.data?.error as string | undefined;
    if(originalRequest._fleetumView){
      try{
        if(apiErrorCode==="SITE_CONTEXT_STALE"){invalidateSiteStamp(originalRequest._fleetumView);throw new SiteContextChangedError();}
        assertSiteResponse(originalRequest._fleetumView,error.response?.headers?.["x-fleetum-site-revision"],error.response?.headers?.["x-fleetum-site-view"]);
      }catch(stale){return Promise.reject(stale);}
    }
    const apiMessage = error.response?.data?.message as string | undefined;
    const apiDetails = error.response?.data?.details as Record<string, unknown> | undefined;
    const requestUrl = String(originalRequest.url ?? "");
    const isAuthRoute = AUTH_ROUTES.some((route) => requestUrl.startsWith(route));
    const isSilentSessionCheck = requestUrl.startsWith("/auth/me");

    const licenseMessage =
      apiErrorCode === "LICENSE_PENDING"
        ? "Completa Stripe Checkout con una carta valida per attivare la prova di 14 giorni e usare il gestionale."
        : apiErrorCode === "LICENSE_EXPIRED"
        ? "Licenza scaduta. Rinnova per continuare."
        : apiErrorCode === "LICENSE_SUSPENDED"
          ? "Licenza sospesa. Contatta il supporto."
          : apiErrorCode === "LICENSE_PAST_DUE"
            ? "Pagamento non riuscito. Sostituisci la carta o completa il pagamento per riattivare l'accesso."
            : apiErrorCode === "LICENSE_CANCELED"
              ? "Abbonamento cancellato. Riattiva il piano per continuare."
              : apiErrorCode === "TENANT_INACTIVE"
                ? "Tenant disattivato. Contatta l'amministratore."
                : null;

    const planLimitMessage =
      apiErrorCode === "PLAN_LIMIT"
        ? `Feature premium bloccata.${apiDetails?.requiredPlan ? ` Richiede piano ${String(apiDetails.requiredPlan)}.` : ""} Apri "Upgrade piano" per abilitarla.`
        : null;

    const validationMessage = (() => {
      if (apiErrorCode !== "VALIDATION_ERROR" || !apiDetails) return null;
      const fieldErrors = apiDetails.fieldErrors as Record<string, unknown> | undefined;
      if (!fieldErrors || typeof fieldErrors !== "object") return apiMessage ?? "Request non valida";
      const firstEntry = Object.entries(fieldErrors).find(([, messages]) => Array.isArray(messages) && messages.length > 0);
      if (!firstEntry) return apiMessage ?? "Request non valida";
      const [field, messages] = firstEntry;
      const firstMessage = Array.isArray(messages) ? String(messages[0]) : "valore non valido";
      return `Campo ${field}: ${firstMessage}`;
    })();

    const isNetwork = error.code === "ERR_NETWORK";
    const isTimeout = error.code === "ECONNABORTED";

    if (status === 401 && apiErrorCode === "UNAUTHORIZED" && !originalRequest._retry && !isAuthRoute) {
      try {
        originalRequest._retry = true;
        const refreshed = await tryRefreshSession();
        assertRequestOwner(originalRequest);
        if (refreshed) {
          originalRequest.headers = { ...(originalRequest.headers ?? {}) };
          if (isStateChangingMethod(originalRequest.method)) {
            const csrfToken = refreshed.csrfToken ?? readCsrfToken();
            if (csrfToken) originalRequest.headers["X-CSRF-Token"] = csrfToken;
          }
          return api.request(originalRequest);
        }
        logoutAndRedirectToLogin();
      } catch (failure) {
        if(failure instanceof SiteContextChangedError)return Promise.reject(failure);
        logoutAndRedirectToLogin();
      }
    }

    if (
      status === 403 &&
      apiErrorCode === "CSRF_INVALID" &&
      !originalRequest._csrfRetry &&
      !isAuthRoute &&
      isStateChangingMethod(originalRequest.method)
    ) {
      originalRequest._csrfRetry = true;
      const refreshed = await tryRefreshSession();
      try{assertRequestOwner(originalRequest);}catch(stale){return Promise.reject(stale);}
      const csrfToken = refreshed?.csrfToken ?? readCsrfToken();
      if (csrfToken) {
        originalRequest.headers = {
          ...(originalRequest.headers ?? {}),
          "X-CSRF-Token": csrfToken
        };
        return api.request(originalRequest);
      }
    }

    const message =
      planLimitMessage ||
      licenseMessage ||
      validationMessage ||
      apiMessage ||
      (status === 402 ? "Licenza scaduta. Rinnova per continuare." : null) ||
      (status === 403 ? "Accesso non consentito." : null) ||
      (isTimeout || isNetwork
        ? isStateChangingMethod(originalRequest.method)
          ? "Esito da verificare. Controlla la risorsa prima di riprovare l’operazione."
          : "Connessione non disponibile. Controlla la rete e riprova il caricamento."
        : "Operazione non completata. Verifica l’esito prima di riprovare.");

    // The form owns field validation. Other errors are a deferred fallback:
    // the viewport removes it if the same message is already shown inline.
    if (!isSilentSessionCheck && !isAuthRoute && apiErrorCode !== "VALIDATION_ERROR") {
      snackbar.error(message, {origin:"transport", key:JSON.stringify([originalRequest.method,requestUrl,apiErrorCode,message])});
    }
    return Promise.reject(
      new HttpClientError(message, {
        status,
        code: apiErrorCode ?? error.code,
        details: apiDetails,
        isNetwork,
        isTimeout
      })
    );
  }
);

export const httpClient: ApiRepository = {
  async get<T>(url: string, params?: Record<string, string | number | undefined>) {
    const res = await api.get<T>(url, { params });
    return res.data;
  },
  async post<T>(
    url: string,
    body?: unknown,
    options?: { headers?: Record<string, string>; timeoutMs?: number; suppressSuccessToast?: boolean }
  ) {
    const res = await api.post<T>(url, body, {
      headers: options?.headers,
      ...(typeof options?.timeoutMs === "number" ? { timeout: options.timeoutMs } : {})
    });
    return res.data;
  },
  async put<T>(url: string, body?: unknown) {
    const res = await api.put<T>(url, body);
    return res.data;
  },
  async patch<T>(url: string, body?: unknown) {
    const res = await api.patch<T>(url, body);
    return res.data;
  },
  async delete(url: string) {
    await api.delete(url);
  }
};

// Opt in only for resources whose absence is a normal UI state. Other failures
// keep the existing auth, license, CSRF and error interceptors unchanged.
export async function getOptionalResource<T>(url: string): Promise<T | null> {
  const response = await api.get<T>(url, {
    validateStatus: (status) => (status >= 200 && status < 300) || status === 404
  });
  return response.status === 404 ? null : response.data;
}
