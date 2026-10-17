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

Only new local QA files; no application feature, migration, dependency, UI,
production/staging manifest or existing offline guard is changed. No publish,
merge or deploy is implied. Removing these new QA files removes the extra
entrypoint; the previous laboratory remains available.
