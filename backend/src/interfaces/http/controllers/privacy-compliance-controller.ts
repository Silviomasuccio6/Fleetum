import { Request, Response } from "express";
import { z } from "zod";
import { PrivacyComplianceService } from "../../../application/services/privacy-compliance-service.js";

const retentionQuerySchema = z.object({
  expiredTokenRetentionDays: z.coerce.number().int().min(1).max(365).optional(),
  expiredSessionRetentionDays: z.coerce.number().int().min(1).max(730).optional(),
  deletedCustomerAttachmentGraceDays: z.coerce.number().int().min(0).max(365).optional(),
  deletedStoredFileObjectGraceDays: z.coerce.number().int().min(0).max(365).optional()
});

const retentionRunSchema = retentionQuerySchema.extend({
  confirmation: z.literal("RUN_RETENTION")
});

const anonymizeCustomerSchema = z.object({
  confirmation: z.literal("ANONYMIZE_CUSTOMER"),
  legalBasis: z.string().trim().min(3).max(300),
  deleteAttachments: z.boolean().optional().default(true)
});

const erasureRequestSchema = z.object({
  customerId: z.string().trim().min(1),
  legalBasis: z.string().trim().min(3).max(300).default("GDPR right to erasure request"),
  deleteAttachments: z.boolean().optional().default(true)
});

export class PrivacyComplianceController {
  constructor(private readonly service: PrivacyComplianceService) {}

  exportCustomerData = async (req: Request, res: Response) => {
    const result = await this.service.exportCustomerData({
      tenantId: req.auth!.tenantId,
      userId: req.auth?.userId,
      customerId: req.params.customerId
    });
    res.json(result);
  };

  anonymizeCustomer = async (req: Request, res: Response) => {
    const payload = anonymizeCustomerSchema.parse(req.body);
    const result = await this.service.anonymizeCustomer({
      tenantId: req.auth!.tenantId,
      userId: req.auth?.userId,
      customerId: req.params.customerId,
      ...payload
    });
    res.json(result);
  };

  createErasureRequest = async (req: Request, res: Response) => {
    const payload = erasureRequestSchema.parse(req.body);
    const result = await this.service.createErasureRequest({
      tenantId: req.auth!.tenantId,
      userId: req.auth?.userId,
      ...payload
    });
    res.status(202).json(result);
  };

  previewRetention = async (req: Request, res: Response) => {
    const query = retentionQuerySchema.parse(req.query);
    const result = await this.service.previewRetention({
      tenantId: req.auth!.tenantId,
      ...query
    });
    res.json(result);
  };

  runRetention = async (req: Request, res: Response) => {
    const payload = retentionRunSchema.parse(req.body);
    const result = await this.service.runRetention({
      tenantId: req.auth!.tenantId,
      userId: req.auth?.userId,
      ...payload
    });
    res.json(result);
  };
}
