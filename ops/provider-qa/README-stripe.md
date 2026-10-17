# Local Stripe startup proof

This is a separate entrypoint for the provider QA laboratory. The existing
offline entrypoint, normal server, production/staging configuration and Google
mode are unchanged. It is not a deployment entrypoint.

`serve-stripe.mts` requires the existing provider QA isolation profile, test mode,
`DOTENV_CONFIG_PATH=/dev/null`, private temporary uploads and a bounded lease.
Before importing the app it performs seven GETs against Stripe, with no retries,
to verify the declared account, test mode, six canonical prices, three products
and the complete portal selected for this sandbox. A mismatch prevents startup.
Network failures produce a fixed error code rather than raw provider messages.
The app binds only `127.0.0.1:4200`; email and automatic workers remain disabled.

## Reproduce the bounded startup check

Requires the already installed Node22.23.1, the local Docker socket, cached
`postgres:16-alpine` image and the protected, previously authorized test key:
`/private/tmp/fleetum-stripe-qa-key-20261017-58rnppyd/stripe-test-key`.
No login, new API key, provider configuration or real dotenv file is required.
The proof refuses real dotenv files that Prisma could otherwise discover.

```bash
python3 -B ops/provider-qa/verify-stripe-startup.py --evidence-dir /absolute/new/evidence-directory
```

The script uses the recorded Fleetum QA account/catalog bindings from the
17October configuration evidence. It creates one PostgreSQL container using
tmpfs, 256MiB memory, 0.5CPU, one labeled network and a random loopback database
port. It applies the actual migrations and creates two synthetic tenants/users.
Stripe credentials are passed only to the API process, never to migration/seed
processes or command arguments. Cookie/password/raw app output are not retained.

The API lease is120seconds, its preflight deadline30seconds. Every process stage
has a timeout; timed-out Node process groups are terminated. Progress receipts
record the phase and owned resource identities without secrets, so an interrupted
run can be reconciled. Cleanup verifies ownership before removing resources.

The proof checks readiness, login, authenticated profile, missing/invalid webhook
signatures, sequential and concurrent delivery of one **locally signed synthetic
ignored event**, one unique billing event row, and unchanged licenses for both
tenants. It records cleanup separately from test success.

## What a passing startup proof establishes

It establishes that this local API can start with the verified Stripe sandbox
and a temporary real PostgreSQL database, while refusing invalid signatures and
handling that ignored event without a license change. It makes **no Stripe
writes** and creates no checkout, customer, invoice, subscription or payment.
The local webhook signing secret is a generated fixture; it is not a Stripe CLI
delivery secret. This does not certify real Stripe forwarding, successful paid
checkout, activation, paid-event races, renewals, card updates or the portal UI.
Those remain the next integration checks, with synthetic sandbox resources and
an actual provider delivery secret.

## Hosted Stripe flow with a human operator

`verify-stripe-flow.py` reuses the disposable database/startup fixture through
an internal integration callback. The ordinary startup command above keeps
its original synthetic ignored-event proof. Flow mode seeds two pending tenants
and uses the existing test key with an isolated Stripe CLI configuration.
The CLI signing secret and captured signed bodies stay in memory. A loopback
forwarder on 4210 verifies signatures and forwards only this fixture's events;
the return page on 5273 does not activate a license.

```bash
python3 -B ops/provider-qa/verify-stripe-flow.py --evidence-dir /absolute/new/case-directory
```

Only start this interactive command when the human is available. Its lease is
1500 seconds; it reserves 90 seconds for cleanup. The profile still rejects live
keys, real dotenv discovery, public binds, workers and email. Its per-run caps
are one checkout/customer/subscription, four portal sessions, two entered test
cards, four observed invoices, 80 direct fixture GETs and 12 direct fixture writes.
These counters do not meter every request made by the app SDK, CLI or hosted UI.

The fixture publishes a private control file and accepts numbered 0600 command
files under its own 0700 temporary root. Browser target URLs are private temporary
files, not evidence. Valid commands are checkout, release, replay, end_trial,
verify_paid, portal_card, verify_card, portal_upgrade, verify_upgrade,
portal_cancel, verify_cancel_scheduled, snapshot, finish and abort.

The browser approval gate refused the final Checkout submission even in this
sandbox. The human must press final financial buttons personally. Do not retry
that submission via locators, coordinates, another browser or an API workaround.
The end_trial command returns USER_ACTION_REQUIRED and makes no provider write;
any trial-ending/payment action must be completed by the human in the sandbox.
The fixture refuses subscription updates and invoice payment/finalization API
calls. Portal plan confirmation also remains a human action. Verify provider and license
state after each completed human action rather than treating consent as payment.

Before release, real provider envelopes are held briefly in memory so the
fixture can verify that returning from Checkout leaves the license pending.
Release preserves each original body/signature; expired signatures are refused,
never regenerated. A captured actual Checkout event can be replayed concurrently
within its signature tolerance. Checks include trial and paid period ends,
unchanged control tenant, portal card default, and PRO price overriding historical
STARTER metadata. This covers backend/hosted-provider integration; it does not
replace a full Fleetum frontend journey or production endpoint verification.

Cleanup expires the owned open checkout, cancels only the owned test subscription,
deletes only its synthetic customer after checking ownership, stops CLI/proxy/
return page/API, and removes the disposable database/network/root. Immutable test
invoice/event history can remain in Stripe. A failed provider cleanup is a failed
overall cleanup even when local resources are gone; reconcile the exact owned IDs.
The separately authorized test-key copy remains subject to deletion at final QA
closure. No permanent webhook endpoint or catalog/portal setting is created here.

Offline forwarding-boundary checks:

```bash
python3 -B ops/tests/test_provider_qa_stripe_events.py
```

Tests and type checking:

```bash
node --test ops/tests/provider-qa-stripe-preflight.test.mjs ops/tests/provider-qa-network.test.mjs
node node_modules/typescript/bin/tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --esModuleInterop --skipLibCheck --strict ops/provider-qa/serve-stripe.mts
python3 -B ops/tests/test_provider_qa_process.py
```

Run the existing backend isolation tests from `backend/`:

```bash
cd backend
NODE_ENV=test DOTENV_CONFIG_PATH=/dev/null node --import tsx --test tests/provider-qa.test.ts tests/staging-isolation.test.ts
```

Use Node22.23.1.
If files are cloud placeholders, restore their local availability first; do not
weaken assertions, increase timeouts or call a failed database run a pass.

## Impact and rollback

The QA entrypoints change no application middleware, migration, dependency lock,
UI, production/staging manifest or existing offline guard. The accompanying
billing fix also reads current Stripe subscription-item period ends, with trial
and renewal regression tests; it requires no migration or provider setting change.
No publish, merge or deploy is implied. Removing the QA files removes these extra
entrypoints; reverting the billing fallback restores its previous behavior.
