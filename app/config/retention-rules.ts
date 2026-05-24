export type RetentionRule = {
  code: string;
  dataCategory: string;
  proposedRetention: string;
  reviewRequired: Array<'legal' | 'privacy' | 'tax' | 'security'>;
  deletionMode: 'delete' | 'anonymize' | 'archive' | 'manual-review';
};

export const retentionRules: RetentionRule[] = [
  {
    code: 'rental-contracts',
    dataCategory: 'Contratti noleggio',
    proposedRetention: '{{retention_rental_contracts}}',
    reviewRequired: ['legal', 'privacy'],
    deletionMode: 'manual-review'
  },
  {
    code: 'identity-documents',
    dataCategory: 'Documenti identita e patenti',
    proposedRetention: '{{retention_identity_documents}}',
    reviewRequired: ['privacy', 'legal'],
    deletionMode: 'delete'
  },
  {
    code: 'billing-records',
    dataCategory: 'Fatture e pagamenti',
    proposedRetention: '{{retention_billing_records}}',
    reviewRequired: ['tax', 'legal'],
    deletionMode: 'archive'
  }
];
