# Platform Satinata: targeted production compatibility candidate

Local preparation only. No production installation is authorized by this file.

## Scope and baseline

This branch starts at the production backend source
`db1f231dc8cb699f1a5ce4215a0278c93212d16d`. It backports only the Platform
logout and invoice-email protocols needed by Satinata. It does not promote the
tenant application from main or the application candidate in PR #156.

The historical production image/source mapping is read-only evidence, not proof
that a future live server or database still matches this baseline. Revalidate
image digests, deployed schema and migration metadata before installation.

## Behavior and failure handling

- Platform logout persists a SHA-256 bearer fingerprint in PlatformSecurityEvent.
  An authorization check after the logout commit rejects that bearer. Already
  admitted requests can finish. Retries are idempotent; another session remains
  usable. Password-reset revocation stays independent. A database error denies
  authorization instead of treating the session as valid.
- New sessions receive a unique JWT ID. Never log the bearer. Revocation events
  must not be deleted while their corresponding token can still be valid.
- Invoice-email commands require X-Idempotency-Key. Delivery, queue row and
  tenant-scoped command ledger are committed in the same transaction. A reused
  key with different invoice/recipient/content is rejected with HTTP 409.
- A dedicated consumer owns only SAAS_INVOICE_EMAIL. A conditional, expiring
  lease prevents simultaneous consumers from owning the same row. The legacy
  tenant email worker excludes that type and otherwise keeps its behavior.
- Provider calls use a stable key derived from the queue ID and time out after
  30 seconds. Ambiguous retries use that same key, stop before the provider's
  retention expires, and then require reconciliation. This is not an unlimited
  exactly-once guarantee across an external service.
- A verified receipt allows local completion without another provider call.
  Partial or conflicting receipts are held for reconciliation. A lost database
  commit acknowledgement cannot revert a completed row. Paid invoices remain
  paid, and failed resends do not downgrade an already sent invoice.
- Legacy pending rows lacking a valid command marker are not assigned a fresh
  provider key. They are marked for reconciliation unless a verified durable
  receipt can complete them locally. Inspect aggregate backlog metadata and plan
  that reconciliation before rollout; do not blindly resend historical rows.
- HTTP success includes emailDelivery.id/status. The matching UI retains the
  request key and reports PENDING as processing; only SENT confirms dispatch.
  Provider acceptance is not evidence of delivery to the recipient's inbox.

## Database impact and compatibility

Exactly one new migration is included:
`20260921150000_final_release_blocker_atomicity`. Its SQL is byte-identical to
the existing migration in main `76c1756c8394f9557e611704fee0cfeaf29a7800`.
Reusing that canonical unit avoids altered historical checksums and a later
attempt to recreate objects under the same migration name.

Active objects: EmailQueue lease columns/index and InvoiceEmailRequest with its
indexes and foreign keys. The same canonical SQL also creates two passive
ledgers (RentalBookingCreateRequest and BookingContractEmailRequest) and adds
two nullable DemoLead columns plus their unique index. This candidate adds the
corresponding Prisma models/relations but does not activate the other handlers.
It contains no row deletions, tenant backfill or credential changes. PostgreSQL
still takes schema locks while applying DDL; duration and production table
sizes are not established by synthetic tests.

An isolated PostgreSQL 16.15 trial applied 42 baseline migrations, this canonical
unit (43 total), and the later main chain (48 total) with an unchanged legacy
synthetic row. That proves the tested source chains can upgrade; it does not
prove the state or size of the live production database. No real database or
email provider was used for these tests.

## Dependency scope

Targeted security fixes align body-parser, follow-redirects, proxy-addr, qs,
deepmerge-ts, brace-expansion, uuid, sharp, csv-parse, morgan and Zod with patched
versions. Zod 4 requires three small validator type/API adaptations; the original
validation rules and messages remain. Prisma stays on major 6. Backend build,
unit regressions and the synthetic database suite cover this candidate; no
general dependency upgrade is intended.

## Candidate image security refinement, 16 November 2026

The independent Linux image scan found additional runtime findings not covered
by the workspace's production npm audit. The candidate now pins Multer2.5.0,
updates the reported Alpine security packages in both image stages, and removes
the global npm/npx toolchain only from the final runtime. Node remains22.23.1;
application node_modules and the direct Prisma CLI remain available. Installation
must use `/app/node_modules/.bin/prisma` rather than npx. No live provider setting,
env value, database migration or business handler is changed by this refinement.

Four synthetic HTTP regressions exercise the actual rental upload middleware:
exact size-limit acceptance, oversized-file cleanup, rejected media types and
cleanup/process availability after a disconnected upload. Two failed on the
old parser; all four passed after the update. The image gate additionally checks
the direct migration CLI with networking disabled and the absence of global npm.
Actual image scan success must still be proven by the new exact-source CI;
local compilation/audit alone cannot substitute for that proof.

Official upstream security/release notes:
https://github.com/expressjs/multer/releases/tag/v2.5.0

## Rollout and rollback requirements (not executed)


1. Publish/review the exact source candidates and run their CI. Do not merge this
   old-baseline application branch wholesale into main: that would roll back
   unrelated main changes. A trusted release must bind the reviewed base,
   patches, derived trees, images and test evidence explicitly.
2. Verify the actual production images, migration history and aggregate pending
   queue state; take and verify a fresh database/storage backup. Do not export
   customer records or secrets into the repository or CI artifacts.
3. Prepare a protected production-only GitHub path for the backend patch plus
   the Platform asset closure. The current Platform staging-only controls are
   insufficient. Do not use the full current main deployment as a substitute.
4. Quiesce/drain the old invoice worker before switching versions. Never leave
   old and new invoice consumers running concurrently during installation.
5. Apply the expand-only schema and backend; validate the protocol before
   exposing Satinata. Overlay only platform.html and its verified dependency
   closure, preserving the live tenant and website trees and original logos.
6. On visual regression use the separately prepared old-visual frontend with
   the new logout/invoice protocol, keeping this security backend and schema.
   Blindly restoring the original backend could re-enable revoked bearers and
   old invoice sending. Full backend recovery requires a separately reviewed
   containment/forward-fix plan, not an automatic downgrade or database restore.
7. Do not drop the new tables/columns or purge revocation/command records as a
   routine rollback. Verify authenticated login/logout, concurrent/replayed
   invoice commands, tenant boundaries, health and asset preservation after any
   authorized installation; no real invoice email is sent without authorization.

Residual gates: public review/CI, exact production release workflow and image
proofs, fresh live preflight/backup metadata, protected approval and controlled
installation, post-install authenticated verification. Apple/OAuth, Stripe,
CARGOS, tenant redesign and provider settings are outside this patch.
