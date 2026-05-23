import { Request, Response } from "express";
import { PlatformAdminService } from "../../../application/services/platform-admin-service.js";
import { InvoiceService } from "../../../application/services/invoice-service.js";
import { PlatformConsoleService } from "../../../application/services/platform-console-service.js";
import { getClientIp } from "../../../shared/utils/ip.js";
import {
  demoLeadIdSchema,
  invoiceIdSchema,
  platformLoginSchema,
  platformRangeQuerySchema,
  quickLicenseActionSchema,
  recentEventsQuerySchema,
  revenueReportQuerySchema,
  tenantIdSchema,
  updateDemoLeadSchema,
  updateInvoiceStatusSchema,
  updateLicenseSchema,
  updateTenantStatusSchema
} from "../validators/platform-admin-validators.js";

export class PlatformAdminController {
  constructor(
    private readonly service: PlatformAdminService,
    private readonly invoiceService: InvoiceService,
    private readonly consoleService: PlatformConsoleService
  ) {}

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

  overview = async (req: Request, res: Response) => {
    const query = platformRangeQuerySchema.parse(req.query);
    const result = await this.consoleService.overview(query.days);
    res.json(result);
  };

  websiteAnalytics = async (req: Request, res: Response) => {
    const query = platformRangeQuerySchema.parse(req.query);
    const result = await this.consoleService.websiteAnalytics(query.days);
    res.json(result);
  };

  demoLeads = async (_req: Request, res: Response) => {
    const result = await this.consoleService.listDemoLeads();
    res.json(result);
  };

  updateDemoLead = async (req: Request, res: Response) => {
    const id = demoLeadIdSchema.parse(req.params.id);
    const payload = updateDemoLeadSchema.parse(req.body);
    const result = await this.consoleService.updateDemoLead({ id, status: payload.status });
    res.json(result);
  };

  systemHealth = async (_req: Request, res: Response) => {
    const result = await this.consoleService.systemHealth();
    res.json(result);
  };

  securityOverview = async (_req: Request, res: Response) => {
    const result = await this.consoleService.securityOverview();
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

  dashboardLiveMetrics = async (req: Request, res: Response) => {
    const windowMinutes = Math.min(Math.max(Number(req.query.windowMinutes ?? 15), 1), 120);
    const result = await this.consoleService.dashboardLiveMetrics(windowMinutes);
    res.json(result);
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

  invoices = async (_req: Request, res: Response) => {
    const result = await this.invoiceService.listPlatformInvoices();
    res.json(result);
  };

  tenantInvoices = async (req: Request, res: Response) => {
    const tenantId = tenantIdSchema.parse(req.params.tenantId);
    const result = await this.invoiceService.listTenantInvoices(tenantId);
    res.json(result);
  };

  generateInvoice = async (req: Request, res: Response) => {
    const tenantId = tenantIdSchema.parse(req.params.tenantId);
    const result = await this.invoiceService.generateForTenant({
      tenantId,
      actorUserId: req.auth?.userId ?? "platform-admin",
      sourceIp: getClientIp(req)
    });
    res.status(201).json(result);
  };

  invoice = async (req: Request, res: Response) => {
    const invoiceId = invoiceIdSchema.parse(req.params.invoiceId);
    const result = await this.invoiceService.getPlatformInvoice(invoiceId);
    res.json(result);
  };

  invoicePdf = async (req: Request, res: Response) => {
    const invoiceId = invoiceIdSchema.parse(req.params.invoiceId);
    const pdf = await this.invoiceService.pdfBufferForPlatform(invoiceId);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename=\"fleetum-${invoiceId}.pdf\"`);
    res.send(pdf);
  };

  sendInvoiceEmail = async (req: Request, res: Response) => {
    const invoiceId = invoiceIdSchema.parse(req.params.invoiceId);
    const result = await this.invoiceService.sendEmail({
      invoiceId,
      actorUserId: req.auth?.userId ?? "platform-admin",
      sourceIp: getClientIp(req)
    });
    res.json(result);
  };

  updateInvoiceStatus = async (req: Request, res: Response) => {
    const invoiceId = invoiceIdSchema.parse(req.params.invoiceId);
    const payload = updateInvoiceStatusSchema.parse(req.body);
    const result = await this.invoiceService.updateStatus({
      invoiceId,
      status: payload.status,
      actorUserId: req.auth?.userId ?? "platform-admin",
      sourceIp: getClientIp(req)
    });
    res.json(result);
  };
}
