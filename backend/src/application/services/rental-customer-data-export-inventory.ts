export const RENTAL_CUSTOMER_DATA_EXPORT_SCHEMA_VERSION = "1.0.0";

/**
 * Every Prisma relation declared on RentalCustomer must be inventoried here.
 * The schema-completeness test fails when a relation is added without an
 * explicit export or exclusion decision.
 */
export const RENTAL_CUSTOMER_EXPORT_RELATION_INVENTORY = {
  tenant: {
    included: false,
    reason: "Tenant configuration belongs to the controller, not to the rental customer data subject."
  },
  bookings: { included: true, section: "bookings" },
  attachments: { included: true, section: "attachments" },
  paymentProfiles: { included: true, section: "payments.profiles" },
  paymentMethods: { included: true, section: "payments.methods" },
  rentalDeposits: { included: true, section: "payments.deposits" },
  rentalExtraCharges: { included: true, section: "payments.extraCharges" },
  rentalPaymentEvents: { included: true, section: "payments.events" }
} as const;

export const RENTAL_CUSTOMER_AUXILIARY_EXPORT_SOURCES = {
  ConsentLog: "consents",
  EmailQueue: "communications.emailQueue",
  AuditLog: "auditTrail",
  StoredFileObject: "storedFiles"
} as const;
