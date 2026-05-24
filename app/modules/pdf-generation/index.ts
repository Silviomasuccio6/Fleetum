export type PdfGenerationRequest = {
  tenantId: string;
  templateCode: string;
  templateVersion: string;
  placeholders: Record<string, string | number | boolean | null>;
  companyLogoUrl?: string;
  companyPrimaryColor?: string;
  poweredByFleetum?: boolean;
};

export type PdfGenerationResult = {
  fileId: string;
  filePath: string;
  documentHash: string;
  templateCode: string;
  templateVersion: string;
  generatedAt: string;
};

export const shouldShowPoweredByFleetum = (request: PdfGenerationRequest) =>
  request.poweredByFleetum !== false;
