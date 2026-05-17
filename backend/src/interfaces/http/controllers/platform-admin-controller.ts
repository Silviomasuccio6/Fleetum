import { Request, Response } from "express";
import { PlatformAdminService } from "../../../application/services/platform-admin-service.js";
import { getClientIp } from "../../../shared/utils/ip.js";
import {
  platformLoginSchema,
  quickLicenseActionSchema,
  recentEventsQuerySchema,
  revenueReportQuerySchema,
  tenantIdSchema,
  updateLicenseSchema,
  updateTenantStatusSchema
} from "../validators/platform-admin-validators.js";

export class PlatformAdminController {
  constructor(private readonly service: PlatformAdminService) {}

  login = async (req: Request, res: Response) => {
    const input = platformLoginSchema.parse(req.body);
    const result = await this.service.login({ ...input, ip: getClientIp(req) });
    res.json(result);
  };

  tenants = async (_req: Request, res: Response) => {
    const result = await this.service.listTenantsWithLicenses();
    res.json(result);
  };

  users = async (_req: Request, res: Response) => {
    const result = await this.service.listUsersGlobal();
    res.json(result);
  };

  tenantProfile = async (req: Request, res: Response) => {
    const tenantId = tenantIdSchema.parse(req.params.id);
    const result = await this.service.tenantCompanyProfile(tenantId);
    res.json(result);
  };

  tenantOnboardingStatus = async (req: Request, res: Response) => {
    const tenantId = tenantIdSchema.parse(req.params.id);
    const result = await this.service.tenantOnboardingStatus(tenantId);
    res.json(result);
  };

  recentEvents = async (req: Request, res: Response) => {
    const query = recentEventsQuerySchema.parse(req.query);
    const result = await this.service.listRecentEvents(query.limit);
    res.json(result);
  };

  revenueMetrics = async (req: Request, res: Response) => {
    const query = revenueReportQuerySchema.parse(req.query);
    const result = await this.service.revenueReport(query);
    res.json(result);
  };

  revenueCsv = async (req: Request, res: Response) => {
    const query = revenueReportQuerySchema.parse(req.query);
    const exported = await this.service.revenueReportCsv(query);

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=\"${exported.fileName}\"`);
    res.send(exported.csv);
  };

  updateLicense = async (req: Request, res: Response) => {
    const tenantId = tenantIdSchema.parse(req.params.id);
    const payload = updateLicenseSchema.parse(req.body);
    const result = await this.service.updateLicense({
      tenantId,
      actorUserId: req.auth?.userId ?? "platform-admin",
      sourceIp: getClientIp(req),
      ...payload
    });
    res.json(result);
  };

  updateTenantStatus = async (req: Request, res: Response) => {
    const tenantId = tenantIdSchema.parse(req.params.id);
    const payload = updateTenantStatusSchema.parse(req.body);
    const result = await this.service.updateTenantStatus({
      tenantId,
      actorUserId: req.auth?.userId ?? "platform-admin",
      sourceIp: getClientIp(req),
      isActive: payload.isActive
    });
    res.json(result);
  };

  quickAction = async (req: Request, res: Response) => {
    const tenantId = tenantIdSchema.parse(req.params.id);
    const payload = quickLicenseActionSchema.parse(req.body);
    const result = await this.service.executeQuickAction({
      tenantId,
      actorUserId: req.auth?.userId ?? "platform-admin",
      sourceIp: getClientIp(req),
      action: payload.action
    });
    res.json(result);
  };
}
