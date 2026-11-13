# Separate local Google QA

The public bindings in `google-qa-bindings.json` were read back from the separate
Fleetum QA project. The existing Fleetum project was not modified. This binding
is console evidence, not proof that a secret works or a Google login succeeds.

`serve-google.mts` is a dedicated loopback entrypoint. The normal server, generic
offline entrypoint, Stripe entrypoint and deployed environments are unchanged.
Both stages require the existing provider QA isolation profile and current
database schema; no new migration is included.

- `offline-proof`: only the literal synthetic fixture secret is accepted. The
  network guard stays in **offline mode**. No real credential file is read and
  redirects to Google are inspected without following them.
- `interactive`: only the bound QA client and local callback are accepted, with
  a maximum 1500-second lease and the existing Google endpoint allowlist. This
  stage requires separate user consent to the actual Google profile login.
  Selecting the stage or passing a command-line flag does not supply consent.

Default proof on a Mac with Node22.23.1, the cached PostgreSQL16 Docker image and
an isolated current Prisma client:

```bash
python3 -B ops/provider-qa/verify-google-startup.py --evidence-dir /absolute/new/case-directory
```

This applies real migrations to an empty temporary database, seeds two synthetic
pending tenants, checks ordinary password login/profile, and exercises actual
HTTP callbacks with distinct cookie jars. It verifies stored PKCE/nonce binding,
wrong cookie context, provider denial, replay, concurrent consumption and expiry.
The existing OAuth persistence test also runs on that disposable PostgreSQL.
These are synthetic callback tests, not real Google browser/profile acceptance.

The fixture deliberately uses `error=access_denied`, so no code exchange is
attempted. It never follows the authorization redirect. The protected tenant and
both pending licenses must remain unchanged. State, binding cookie, verifier,
nonce, passwords and raw app output are not retained in evidence.

Only after the operator has obtained the separate login consent:

```bash
python3 -B ops/provider-qa/verify-google-startup.py --interactive --evidence-dir /absolute/new/case-directory
```

Interactive mode reads only the already authorized QA credential at
`/private/tmp/fleetum-google-qa-key-20261018-43d0fe268723/client.json`, requiring
its original0700 directory,0600 file, current ownership and exact binding.
Migration/seed processes do not receive provider credentials. It seeds the
controlled email from the binding for a login to an existing pending tenant;
it does not cover creating a new tenant through social signup.

The human starts the ordinary local Google route from the private browser-target
file. A minimal laboratory return page binds127.0.0.1:5273, removes the callback
fragment immediately and displays only session verification status. It loads
no external assets. After the human completes login, the operator writes exactly
`{"action":"verify_login"}` to `commands/001.json` in the reported private control
root, with0600 permissions. The fixture verifies one new active session for the
controlled tenant and one consumed Google login flow, with unchanged licenses.
The total human window leaves90seconds for cleanup; it cannot be extended.

The fixture creates at most one PostgreSQL container/network/API, two seed users
and tenants, and one return server. Startup uses at most three synthetic OAuth
starts; interactive mode expects one additional real login start. Do not retry
a failed login by creating extra flows within the same case: abort and retain
the failure. Actual interactive provider requests are not completely metered.

Cleanup stops only owned processes and removes only labeled owned database/network
resources and the private case root. It does not delete the persistent QA project,
OAuth client or separately approved credential copy. The latter must be removed
at final Google QA closure. The runtime is separate from the case resources.

Offline tests:

```bash
node --test ops/tests/provider-qa-google-preflight.test.mjs ops/tests/provider-qa-network.test.mjs
```

No production/staging deploy, provider-live access, email, billing or Apple test
is implied. A future successful local provider run would not certify the public
HTTPS/proxy environment or the entire Fleetum frontend. Rollback removes these
new QA files; no application schema or authentication middleware changed.
