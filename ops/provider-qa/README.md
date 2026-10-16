# Local provider QA laboratory

This profile prepares Stripe/Google testing without changing the provider-free
staging baseline. It is local preparation, not an external-provider acceptance.
The dedicated entrypoint currently accepts **offline mode only**. Other modes
fail before loading the application; no external execution has been armed.

## Boundaries

- `FLEETUM_ENVIRONMENT=provider-qa`, `NODE_ENV=test`; the normal `server.ts` refuses
  this profile. The dedicated entrypoint binds only `127.0.0.1:4200` and exits
  within its lease (default60seconds, maximum1hour).
- UI origin `http://localhost:5273`; callback
  `http://localhost:4200/api/auth/google/callback`. These are local-test addresses,
  not new public domains or proof of HTTPS/proxy behavior.
- Dedicated PostgreSQL user/database `fleetum_provider_qa`, a random loopback
  port and a fresh synthetic dataset. Never reuse the persistent staging DB.
- Temporary upload root bound to a random run ID. Email fails before provider
  SDK construction; automatic workers remain stopped. Apple/S3/Resend refused.
- Stripe configuration requires test-key prefixes and an expected account ID.
  Prefix validation alone does **not** attest sandbox identity: actual account,
  `livemode=false` and catalog verification remain prerequisites for execution.
- Google configuration binds the client ID, declared test project and exact
  callback. A declaration is **not** proof of project separation or permissions;
  the owner must first verify these in the Google dashboard.
- HTTP/HTTPS/fetch destinations are limited by application-level guards. This
  is not an OS firewall or protection against arbitrary native socket code.
  The disposable PostgreSQL uses a dedicated Docker bridge; its host port is
  published only on127.0.0.1. No remote resource is used by the offline probe.
- The launcher receives a newly constructed environment. It does not load real
  dotenv files, print credentials/cookies, retain raw app output or send email.

## Run the offline proof on the Mac

Requires Node22.23.1, Docker Desktop and the already-cached postgres16 image.
Use an evidence directory that does not yet exist:

```bash
python3 -B ops/provider-qa/verify-offline.py --evidence-dir /absolute/new/evidence-directory
```

The probe creates one labeled network and one bounded PostgreSQL container,
applies the real migrations, creates two synthetic tenants/users and exercises
readiness, login and authenticated profile over loopback. It checks ownership
before deleting only its own container/network and removes its temporary root.
Do not change the evidence path to overwrite an earlier attempt.

## External execution remains pending

Before arming an external entrypoint, review the exact source and prepare one
bounded execution proposal with:

1. Stripe sandbox ID, test-only key delivery through a protected destination,
   expected account/catalog/currency/interval, signed webhook endpoint and
   checks for duplicate events, ordering, races and uncertain outcomes.
2. A separate Google project/client, controlled test identities, exact callback
   and browserA/B, replay, expiry, PKCE/nonce and intent/provider cases.
3. The owner's supported commercial flows, resource lease, retry limits,
   evidence redaction and cleanup. Do not modify production clients or keys.

Google permits loopback HTTP redirects for local testing. A successful local
provider run would still not certify the public HTTPS/proxy target.

Official references checked16October2026:
[Stripe sandbox](https://docs.stripe.com/sandboxes),
[Stripe testing](https://docs.stripe.com/testing),
[Google separate projects](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance),
[Google redirects](https://developers.google.com/identity/protocols/oauth2/web-server).

## Impact and rollback

No migration, dependency, production/staging manifest or UI change. Existing
production/staging defaults and provider restrictions are preserved and tested.
This branch is local and unpublished. Discarding/reverting its commit removes
the new profile; the installed staging release is unaffected.
