export type LegalDocumentStatus = 'draft' | 'review' | 'approved' | 'published' | 'archived';
export type LegalDocumentScope = 'fleetum' | 'tenant' | 'rental_contract';
export type LegalDocumentLanguage = 'it' | 'en';
export type LegalReviewType = 'legal' | 'privacy' | 'tax' | 'security';

export type LegalDocument = {
  id: string;
  code: string;
  title: string;
  version: string;
  status: LegalDocumentStatus;
  scope: LegalDocumentScope;
  language: LegalDocumentLanguage;
  markdownPath: string;
  htmlTemplatePath?: string;
  pdfTemplatePath?: string;
  publishedAt?: string;
  reviewRequired: boolean;
  reviewType: LegalReviewType[];
};

export const fleetumLegalDocuments: LegalDocument[] = [
  {
    id: 'fleetum-terms-it',
    code: 'FLEETUM_TERMS',
    title: 'Termini e Condizioni Fleetum',
    version: '0.1.0-draft',
    status: 'draft',
    scope: 'fleetum',
    language: 'it',
    markdownPath: 'legal/fleetum-saas/terms-and-conditions.md',
    reviewRequired: true,
    reviewType: ['legal', 'privacy', 'tax', 'security']
  },
  {
    id: 'fleetum-dpa-it',
    code: 'FLEETUM_DPA',
    title: 'Data Processing Agreement Fleetum',
    version: '0.1.0-draft',
    status: 'draft',
    scope: 'fleetum',
    language: 'it',
    markdownPath: 'legal/fleetum-saas/dpa-data-processing-agreement.md',
    reviewRequired: true,
    reviewType: ['legal', 'privacy', 'security']
  }
];
