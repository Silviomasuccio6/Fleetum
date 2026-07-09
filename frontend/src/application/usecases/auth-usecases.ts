import { httpClient } from "../../infrastructure/api/http-client";
import type { TenantCompanyProfilePayload } from "./tenant-profile-usecases";

export const authUseCases = {
  signup: (input: {
    tenantName: string;
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    phone?: string;
    adminRole?: string;
    privacyAccepted?: boolean;
    company?: Partial<TenantCompanyProfilePayload>;
  }) =>
    httpClient.post<{
      tenantId: string;
      refreshExpiresAt: string;
      user: any;
      csrfToken: string;
      requiresBilling: boolean;
      next: "/activate";
    }>("/auth/signup", input),
  login: (input: { email: string; password: string }) =>
    httpClient.post<{ refreshExpiresAt: string; user: any; csrfToken: string }>("/auth/login", input),
  forgotPassword: (email: string) => httpClient.post("/auth/forgot-password", { email }),
  resetPassword: (input: { token: string; newPassword: string }) => httpClient.post("/auth/reset-password", input),
  acceptInvite: (input: { token: string; password: string; firstName?: string; lastName?: string }) =>
    httpClient.post("/auth/accept-invite", input),
  me: () => httpClient.get<any>("/auth/me"),
  entitlements: () =>
    httpClient.get<{
      plan: "STARTER" | "PRO" | "ENTERPRISE";
      priceMonthly: number;
      features: string[];
      license: {
        plan: string;
        seats: number;
        status: "PENDING" | "ACTIVE" | "SUSPENDED" | "EXPIRED" | "TRIAL" | "PAST_DUE" | "CANCELED";
        expiresAt: string | null;
        daysRemaining: number | null;
        expiringSoon: boolean;
        billingCycle: "monthly" | "yearly";
        provider: "stripe" | "local";
      };
    }>("/auth/me/entitlements"),
  licenseStatus: () =>
    httpClient.get<{
      plan: string;
      seats: number;
      status: "PENDING" | "ACTIVE" | "SUSPENDED" | "EXPIRED" | "TRIAL" | "PAST_DUE" | "CANCELED";
      expiresAt: string | null;
      daysRemaining: number | null;
      expiringSoon: boolean;
      billingCycle: "monthly" | "yearly";
      provider: "stripe" | "local";
    }>("/auth/license-status"),
  privacyCurrent: () =>
    httpClient.get<{
      notice: {
        id: string;
        version: string;
        title: string;
        summary: string | null;
        content: string;
        publishedAt: string;
      };
      accepted: boolean;
      acceptedAt: string | null;
      source: string | null;
    }>("/auth/privacy/current"),
  acceptPrivacy: (source: "banner" | "signup" | "profile" | "contract" | "manual" = "banner") =>
    httpClient.post<{ accepted: true; version: string; acceptedAt: string }>("/auth/privacy/accept", { source }),
  updateProfile: (input: { firstName: string; lastName: string }) => httpClient.patch<any>("/auth/profile", input),
  changePassword: (input: { currentPassword: string; newPassword: string; logoutAllDevices?: boolean }) =>
    httpClient.post<{ updated: true; sessionsRevoked?: boolean }>("/auth/change-password", input),
  sessions: () =>
    httpClient.get<{
      data: Array<{
        id: string;
        userAgent?: string | null;
        ipAddress?: string | null;
        createdAt: string;
        expiresAt: string;
        revokedAt?: string | null;
      }>;
    }>("/auth/sessions"),
  revokeSession: (sessionId: string) => httpClient.post<{ revoked: true }>(`/auth/sessions/${sessionId}/revoke`),
  revokeAllSessions: () => httpClient.post<{ revoked: true }>("/auth/sessions/revoke-all"),
  logout: () => httpClient.post<{ revoked: true }>("/auth/logout")
};
