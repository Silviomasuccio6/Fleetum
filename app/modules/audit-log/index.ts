export type AuditEvent = {
  id: string;
  tenantId: string;
  actorId: string;
  actorType: 'fleetum_admin' | 'tenant_admin' | 'operator' | 'system';
  action: string;
  entityType: string;
  entityId?: string;
  timestamp: string;
  ipAddress?: string;
  metadata?: Record<string, unknown>;
};

export const criticalAuditActions = [
  'legal_document_published',
  'contract_generated',
  'contract_signed',
  'document_uploaded',
  'document_deleted',
  'payment_webhook_received',
  'support_access_customer_data'
] as const;
