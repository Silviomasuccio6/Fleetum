import { AuditLogRepository } from "../../domain/repositories/audit-log-repository.js";

import { assertCompanyResourceView, assertSharedCompanyResourceView } from "../../infrastructure/auth/company-resource-access.js";
import { prisma } from "../../infrastructure/database/prisma/client.js";
import { AppError } from "../../shared/errors/app-error.js";
import { companyReportAuthorizationReason, parseCompanyReportAuthorization, type CompanyReportAuthorization } from "./company-report-authorization.js";

const keyMap = {
  sla: "SETTINGS_SLA",
  playbooks: "SETTINGS_PLAYBOOKS",
  reports: "SETTINGS_REPORTS",
  integrations: "SETTINGS_INTEGRATIONS"
} as const;

const defaults = {
  sla: { LOW: 15, MEDIUM: 10, HIGH: 5, CRITICAL: 2 },
  playbooks: {
    WAITING_PARTS: { enabled: true, reminderEveryDays: 3 },
    SOLICITED: { enabled: true, reminderEveryDays: 2 }
  },
  reports: {
    enabled: false,
    recipients: [],
    frequency: "weekly",
    hour: 8,
    minute: 0,
    reportStyle: "EXECUTIVE"
  },
  integrations: {
    erpWebhookUrl: "",
    telematicsWebhookUrl: "",
    ticketingWebhookUrl: ""
  }
};

type SettingsResource = keyof typeof keyMap;

export class SettingsService {
  constructor(private readonly repository: AuditLogRepository) {}

  async getByResource(tenantId: string, resource: SettingsResource) {
    if (resource === "reports" || resource === "integrations") assertCompanyResourceView(tenantId);
    else assertSharedCompanyResourceView(tenantId);
    const row = await this.repository.getLatestByAction(tenantId, resource, keyMap[resource]);
    const details = (row?.details as any) ?? defaults[resource];
    const needsConfirmation = resource === "reports" && details?.enabled === true && !parseCompanyReportAuthorization(details.__siteAuthorization);
    if (details && typeof details === "object" && ("__meta" in details || "__siteAuthorization" in details)) {
      const { __meta, __siteAuthorization, ...clean } = details as any;
      return needsConfirmation ? {...clean,siteConfirmationRequired:true} : clean;
    }
    return needsConfirmation ? {...details,siteConfirmationRequired:true} : details;
  }

  async setByResource(tenantId: string, userId: string | undefined, resource: SettingsResource, details: unknown) {
    const scope = assertCompanyResourceView(tenantId);
    if (resource === "reports" && scope) {
      const authorization: CompanyReportAuthorization = { version: 1, kind: "company", userId: userId ?? "" };
      if (await companyReportAuthorizationReason(prisma, tenantId, authorization)) throw new AppError("Configurazione report non consentita", 403, "FORBIDDEN");
      details = { ...(details as object), __siteAuthorization: authorization };
    }
    await this.repository.create({
      tenantId,
      userId,
      action: keyMap[resource],
      resource,
      details
    });
  }
}
