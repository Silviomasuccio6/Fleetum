export type StoredDocument = {
  id: string;
  tenantId: string;
  ownerType: 'contract' | 'customer' | 'vehicle' | 'invoice' | 'legal_document';
  ownerId: string;
  storageProvider: 's3' | 'r2' | 'minio' | 'local-dev';
  objectKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  retentionCode?: string;
  createdAt: string;
  deletedAt?: string;
};

export type SignedUrlRequest = {
  tenantId: string;
  documentId: string;
  expiresInSeconds: number;
  purpose: 'download' | 'preview' | 'upload';
};
