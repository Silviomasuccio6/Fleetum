import { Request, Response } from "express";
import { TenantProfileService } from "../../../application/services/tenant-profile-service.js";
import { validateUploadedFile } from "../../../infrastructure/storage/file-security.js";
import { AppError } from "../../../shared/errors/app-error.js";
import { tenantCompanyProfileSchema } from "../validators/tenant-profile-validators.js";

export class TenantProfileController {
  constructor(private readonly service: TenantProfileService) {}

  getProfile = async (req: Request, res: Response) => {
    const result = await this.service.getProfile(req.auth!.tenantId);
    res.json(result);
  };

  completeness = async (req: Request, res: Response) => {
    const result = await this.service.getProfile(req.auth!.tenantId);
    res.json(result.completeness);
  };

  updateProfile = async (req: Request, res: Response) => {
    const input = tenantCompanyProfileSchema.parse(req.body);
    const result = await this.service.updateProfile(req.auth!.tenantId, req.auth!.userId, input);
    res.json(result);
  };

  uploadLogo = async (req: Request, res: Response) => {
    const file = req.file;
    if (!file) throw new AppError("Logo mancante", 400, "TENANT_LOGO_REQUIRED");
    const validation = await validateUploadedFile(file.path, file.mimetype);
    file.size = validation.sizeBytes;
    const result = await this.service.setLogo(req.auth!.tenantId, req.auth!.userId, file);
    res.status(201).json(result);
  };

  uploadCompanyVerificationDocument = async (req: Request, res: Response) => {
    const file = req.file;
    if (!file) throw new AppError("Visura camerale mancante", 400, "COMPANY_VERIFICATION_DOCUMENT_REQUIRED");
    const validation = await validateUploadedFile(file.path, file.mimetype);
    file.size = validation.sizeBytes;
    const result = await this.service.setCompanyVerificationDocument(req.auth!.tenantId, req.auth!.userId, file);
    res.status(201).json(result);
  };

  removeLogo = async (req: Request, res: Response) => {
    const result = await this.service.removeLogo(req.auth!.tenantId, req.auth!.userId);
    res.json(result);
  };
}
