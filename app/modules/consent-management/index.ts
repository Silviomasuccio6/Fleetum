export type ConsentRecord = {
  id: string;
  tenantId: string;
  subjectId: string;
  subjectType: 'fleetum_user' | 'rental_customer' | 'driver';
  documentCode: string;
  documentVersion: string;
  acceptedAt: string;
  ipAddress?: string;
  userAgent?: string;
  signatureMethod?: 'manual' | 'electronic' | 'digital' | 'none';
  contractId?: string;
  checkboxValues: Record<string, boolean>;
  documentHash: string;
};

export const buildConsentRecord = (input: ConsentRecord): ConsentRecord => ({
  ...input,
  acceptedAt: input.acceptedAt || new Date().toISOString()
});
