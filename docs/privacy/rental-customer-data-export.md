# Rental Customer Data Export

Technical documentation only. The export scope and retention rules must be validated by the appointed legal/privacy professionals.

## Endpoint

`GET /api/privacy/data-subjects/customers/:customerId/export`

Required permission: `privacy:export`. Every query is restricted to the authenticated `tenantId`.

## Versioning

The response exposes `schemaVersion`. Version `1.0.0` contains these stable sections:

- `data.profile`
- `data.attachments`
- `data.bookings`, including pricing snapshots, notes, contracts, contract events and deliveries
- `data.payments.profiles`
- `data.payments.methods`
- `data.payments.deposits`
- `data.payments.extraCharges`
- `data.payments.events`
- `data.consents`
- `data.communications`
- `data.auditTrail`
- `data.storedFiles`

Breaking response changes require a new major schema version. Additive sections require at least a minor version.

## Relation inventory

All direct Prisma relations on `RentalCustomer` are declared in `rental-customer-data-export-inventory.ts`. A schema-driven test fails if a new relation is added without an explicit inclusion or exclusion decision.

Auxiliary records without a Prisma relation are associated as follows:

| Source | Association rule |
| --- | --- |
| `ConsentLog` | Matching tenant and either `customerId` or `subjectType=rental_customer` plus `subjectId` |
| `EmailQueue` | Matching tenant and current customer email |
| `AuditLog` | Matching tenant and a related customer, booking, contract, attachment, deposit or extra-charge resource ID |
| `StoredFileObject` | Matching tenant and a related resource ID |

## Security exclusions

The JSON does not expose reusable Stripe identifiers, raw Stripe webhook payloads, provider bucket/storage keys, newly generated signed URLs, or embedded Base64 attachments. Sensitive internal identifiers are recursively removed from consent metadata and audit details. Functional payment records, masked card data, consent evidence, communication bodies and stored-file metadata remain included.

Attachments must be delivered through a separate authenticated export package if file portability is required. They must never be made public to complete a data-subject export.
