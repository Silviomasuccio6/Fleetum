# Exact monetary storage migration

## Purpose

Fleetum historically stores several monetary values and percentage rates as PostgreSQL
`double precision` through Prisma `Float`. Binary floating point is unsuitable as the
authoritative representation for invoices, rental pricing, costs, deposits and ROI.

This migration uses an expand, cutover and contract strategy so production remains
backward-compatible and rollbackable.

## Audited scope

- 37 Prisma `Float` fields were identified.
- 35 monetary or rate fields receive exact `Decimal` shadow columns.
- `RentalBookingPricingSnapshot.daysCharged` remains `Float` because it is a fractional duration.
- `InvoiceItem.quantity` remains `Float` because it is a fractional quantity.

Money uses `Decimal(19,2)`. Per-unit rates use `Decimal(19,4)`. VAT and percentage
rates use `Decimal(9,4)`.

## Expand release

Migration `20260713130000_exact_money_shadow_columns`:

1. Adds exact columns without dropping or changing legacy columns.
2. Backfills exact values using PostgreSQL `ROUND(...::numeric, scale)`.
3. Installs `BEFORE INSERT OR UPDATE` triggers that derive exact values from the legacy fields.
4. Adds validated consistency constraints for all 35 field pairs.
5. Marks exact shadows for required legacy fields as `NOT NULL` after backfill.

The exact fields are marked `@ignore` during this phase. Prisma Migrate tracks the
database columns, while Prisma Client neither exposes nor requires them. Existing HTTP
and internal DTO payloads therefore remain unchanged.

The application still writes and reads legacy fields in the expand release. The database
trigger creates an exact authoritative copy for every write while the compatibility layer
is active.

## Deployment gate

Production deploy order is mandatory:

1. Confirm minimum free disk space.
2. Back up PostgreSQL and uploads, including the configured offsite target.
3. Pull immutable target images.
4. Run `prisma migrate deploy` using `DIRECT_URL` when configured.
5. Run `npm run money:reconcile:prod` using the same direct database connection.
6. Restart the application only when reconciliation reports zero mismatches.
7. Run readiness checks.

The reconciliation command reports only model, field and row counts. It does not log
monetary values, PII or connection details.

## Lock and capacity considerations

The expand migration updates affected tables and validates constraints. On large tables,
this consumes I/O and can wait for table locks. Deploy during a low-traffic window and do
not bypass the backup or free-space preflight. If the migration cannot acquire its lock,
stop and investigate rather than manually marking it as applied.

## Rollback

The expand release is backward-compatible:

- If migration or reconciliation fails, the deploy stops before restarting containers.
- The currently running application continues using legacy columns.
- If the new application fails readiness checks, the normal immutable-image rollback can run.
- Do not drop exact columns or triggers during an incident; leaving additive objects in place
  is safer than running a destructive down migration.

Restore from the verified pre-migration backup only if the database migration itself caused
data corruption. A code rollback does not require database rollback during the expand phase.

## Cutover release

After the expand release has reconciled successfully in production:

1. Deploy the controlled read layer with `EXACT_MONEY_READ_MODE=legacy`.
2. Enable `compare` in staging and verify zero mismatches and zero fallbacks.
3. Repeat `compare` in production for an agreed observation window.
4. Enable `exact` only after reconciliation and shadow-read metrics remain clean.
5. Convert service boundaries to decimal-safe strings or integer minor units in a later release.
6. Write both representations explicitly while keeping database constraints enabled.
7. Add reconciliation tests for generated invoices, exports and Stripe amounts.
8. Monitor at least one complete billing and rental-reporting cycle.

## Controlled read modes

`EXACT_MONEY_READ_MODE` controls the read path without changing existing HTTP response
shapes:

- `legacy` is the safe default. It returns Prisma legacy fields and performs no raw exact-column query.
- `compare` reads exact shadows in parallel, records aggregate mismatches and still returns legacy values.
- `exact` replaces audited legacy fields with exact shadow values converted to the existing number shape.
  If an exact row or value is unexpectedly missing while the legacy value exists, Fleetum records a
  fallback and returns the legacy value instead of failing the business request.

If the exact-column query itself fails in `compare` or `exact`, the request keeps the legacy
payload and emits an aggregate fallback metric. The read rollout must not turn an observability
or migration issue into an outage.

The reader uses a static audited table/column registry. IDs and tenant scope are parameterized.
Logs and metrics contain model names and aggregate counts only; they never contain monetary
values, SQL parameters, PII or tenant names.

The first controlled-read scope covers:

- tenant subscriptions and billing dunning;
- invoices and invoice items, including PDF/email reads;
- rental list prices, extra-kilometre policies and booking pricing snapshots;
- dashboard statistics and stoppage costs;
- vehicle profitability, maintenance costs and vehicle costs;
- Platform Console subscription summaries.

## Controlled read observability

Monitor these Prometheus metrics by `model` and `mode`:

- `fleetum_exact_money_read_batches_total`;
- `fleetum_exact_money_records_checked_total`;
- `fleetum_exact_money_mismatches_total`;
- `fleetum_exact_money_fallbacks_total`.

Promotion gates:

1. `compare` must show no unexplained mismatches.
2. `exact` must show zero fallbacks.
3. Readiness, invoice generation, rental quote, dashboard and profitability smoke tests must pass.
4. Production reconciliation must still report zero mismatches before every deploy.

Rollback is configuration-only: set `EXACT_MONEY_READ_MODE=legacy`, restart the backend and
confirm `/api/ready`. Do not remove exact columns, triggers or constraints during rollback.

## Contract release

Legacy Float columns may be removed only after:

- zero production reconciliation mismatches for the agreed observation period;
- all services, exports, seeds and operational scripts use exact fields;
- rollback no longer depends on an application image that reads legacy columns;
- a fresh verified backup and restore drill exist for the contract migration.

The contract migration must be a separate reviewed release. It must remove triggers and
constraints before dropping legacy columns and must never be bundled with unrelated changes.
