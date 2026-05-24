import { LegalDocument, LegalDocumentStatus } from '../../config/document-types';

export type LegalDocumentAcceptance = {
  id: string;
  documentCode: string;
  documentVersion: string;
  acceptedAt: string;
  subjectId: string;
  tenantId?: string;
  ipAddress?: string;
  userAgent?: string;
  documentHash: string;
};

export const canPublishLegalDocument = (document: LegalDocument) =>
  document.status === 'approved' && !document.reviewRequired;

export const markLegalDocumentStatus = (
  document: LegalDocument,
  status: LegalDocumentStatus
): LegalDocument => ({ ...document, status });
