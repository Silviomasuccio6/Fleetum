# Fleetum — Pagamenti e garanzie

Scope: only the approved block 3 operational surface, local branch
`codex/payments-contracts-ux-20261106`. It extends the established Fleetum UI;
it does not replace the product's visual direction or change login.

## Purpose and authority

Rental operators and managers need to see agreed rental amounts, receipts, balances,
guarantees and extras without mistaking one for another. Visibility follows the
booking's responsible/pickup/return sites, independent of a vehicle's present site.
Shared customer records never grant access to another branch's finances.

The booking's final total, otherwise expected total, is authoritative for the agreed
base-rental price. A missing amount stays unknown; zero is free. A saved pricing
snapshot is descriptive: its unit rate and discount percentage are shown separately,
never used to overwrite the agreed amount. The legacy snapshot has no reliable
discount-author/reason fields. Their absence is labelled explicitly; no author,
reason, pre-discount total or authorization is inferred from unrelated metadata.

`RentalCollectionEntry` is the sole confirmed manual base-rental receipts source.
Amounts are exact integer cents in EUR. Cash, received bank transfers and an external
POS are manual records of money already moved, never online verification. An expected
transfer and a saved card are not receipts. Refunds and reversals append linked
entries; original financial history cannot be edited or deleted. Actor, transaction
date, reference, reason and creation time are preserved. Overpayments remain credits.

## Interaction and quality bar

One route, `/pagamenti-garanzie`, joins sidebar/search and booking/contract links.
URL filters keep date/site/customer/booking/status/method and return context. Counts,
filters, aggregates and pagination run server-side. The existing table/card layout,
soft surfaces, typography, blue accent, light/dark and IT/EN remain the authority.

Details distinguish list-rate basis, saved discount, agreed total, received and due.
Recording a receipt/refund/correction requires a protected-focus amount/method
confirmation, synchronous submission lock and server idempotency. An uncertain
network result locks the submitted data for an exact-key retry; it does not fabricate
a financial outcome. Inline errors persist beyond finite compact popups.

## Boundaries

Stripe guarantees/extras reuse their dedicated services and verified server states;
the base-rental ledger never consumes their amounts. Real authorization deadlines
come from the authoritative Stripe charge when supplied; no fixed duration is
invented. Base-rental online collection remains disabled pending a per-rental-business
merchant/beneficiary model. No provider keys, real emails, charges or CARGOS sends
are part of this block. No push, merge, deploy, main or production changes.

Existing roles and read/charge/refund permissions remain in force; no new role grant
is deployed. The local read-only preview has synthetic data; browser POST tests are
intercepted. Persistent tests use temporary PostgreSQL only.

Blocks 4/5 own new agreed-price/discount editing with explicit authorization and
provenance, manual booking conversion, signature modes and final professional PDF.
Free, discounted and unpaid contracts remain allowed; collection and conversion
are independent. This page does not add a payment prerequisite or perform conversion.

The approved full brief is the block 3 section of
`PROMPT_PAGAMENTI_GARANZIE_CONTRATTI_NOTIFICHE_20261106.md` in the durable handoff folder.
