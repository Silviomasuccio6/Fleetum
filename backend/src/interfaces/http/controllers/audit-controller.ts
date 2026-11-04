import { Request, Response } from "express";
import { AuditService } from "../../../application/services/audit-service.js";
import { z } from "zod";

const pagination = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(10).max(200).default(50)
});

export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  list = async (req: Request, res: Response) => {
    const { page, pageSize } = pagination.parse(req.query);
    const result = await this.auditService.list(req.auth!.tenantId, page, pageSize);
    res.setHeader("Cache-Control", "private, no-store");
    res.json(result);
  };

  exportCsv = async (req: Request, res: Response) => {
    const rows = await this.auditService.exportRows(req.auth!.tenantId, 5000);
    const headers = ["createdAt", "action", "resource", "resourceId", "userId", "details"];
    const escape = (v: unknown) => {
      const raw = String(v ?? "");
      const formulaSafe = /^[\s]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
      return `"${formulaSafe.replace(/"/g, "\"\"")}"`;
    };
    const body = rows
      .map((r) => [r.createdAt.toISOString(), r.action, r.resource, r.resourceId ?? "", r.userId ?? "", JSON.stringify(r.details ?? {})].map(escape).join(","))
      .join("\n");
    const csv = `${headers.join(",")}\n${body}`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", `attachment; filename=\"audit-${new Date().toISOString().slice(0, 10)}.csv\"`);
    res.send(csv);
  };
}
