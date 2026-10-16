# Final account and tenant acceptance, 14 October 2026

This tranche adds HTTP/HTTPS acceptance coverage and fixes a newly reproduced
role-change race. It does not deploy production, enable providers, change the
database schema, or integrate the deferred UI redesign.

## Role assignment defect and fix

Two concurrent `PATCH /users/:id/role` requests previously deleted and inserted
role relations in separate transactions. Both could succeed and leave ADMIN and
VIEWER assigned together. An insert failure could also remove the original role.

`PrismaUserRepository.setRole` now locks the tenant-owned, non-deleted User row,
replaces its role and reads its resulting authorization in one transaction. The
row lock interoperates with the existing credential/session lock. An unknown or
foreign user returns null before changing relations; failed inserts roll back
the original grant. No schema migration or additional role is introduced.

Real PostgreSQL barriers reproduce the concurrent requests. A synthetic database
trigger reproduces the insert failure. Before the fix the HTTPS suite had
8 passing and 2 failing scenarios; after the fix and a foreign-tenant regression
it has 11 passing scenarios. The full temporary PostgreSQL security suite has
578 passing tests. Counts overlap: do not sum the targeted and complete suites.

## Current session contract

- Reset preserves account state, consumes its token and sibling resets, and
  revokes previous refresh sessions atomically. Previously issued access and
  refresh cookies are refused at their next protected/refresh request.
- Logout revokes the linked session chain; a captured access/refresh cookie
  cannot resume access. Another tenant's session remains usable.
- A suspended user is refused while its current server-side status is suspended.
  A reset emitted before suspension cannot reactivate it or change credentials.
  Reactivation policy is unchanged; this tranche does not claim a permanent
  session revocation across a later manual reactivation.
- A role change preserves the session and reads current database permissions on
  the next request. It does not force a random logout. Concurrent changes have
  one committed role, and an operation failure preserves the old authorization.
- One refresh token produces one active successor. The documented immediate
  retry of the consumed token cannot create another successor or log out the
  winner. Invitation activation is separate from reset and is single-use.

## Evidence and environment

`backend/tests/security/auth-https-acceptance.test.ts` runs only with the existing
temporary database contract: NODE_ENV=test, RUN_TENANT_ISOLATION_TESTS=1,
DOTENV_CONFIG_PATH=/dev/null, loopback PostgreSQL and database fleetum_ci. It
creates its own synthetic tenants/users and temporary TLS certificate, verifies
that certificate with an explicit CA, and removes its fixtures and certificate.
Only the email transport is simulated; provider HTTP is blocked before importing
the application. Authentication, CSRF, permissions, license and persistence use
the actual implementation. No production environment files or account data are
loaded. A setup attempt with EMAIL_PROVIDER=disabled was rejected because that
value belongs to the strict staging profile; cancelled scenarios are not RED or
PASS. The test fixture uses the allowed test placeholder and simulated transport.

The existing seven-case critical browser suite now checks actual cookie metadata
(HttpOnly, SameSite, Secure, path and host-only scope). Only the guarded loopback
rehearsal expects Secure=false under NODE_ENV=test. Real staging requires Secure.
Cookie values are never included in assertions or evidence.

The tenant case now attempts to attach tenant B's vehicle to tenant A's own
booking, checks the ownership refusal for foreign data and re-reads stable
business/relationship/visible-ledger state for both tenants after the refusals.
It retains the seven required case identities, retry/skip policies and timeouts.
The PostgreSQL suite already checks foreign, inactive and deleted vehicle
assignment; historical unchanged-vehicle behavior is covered separately.

The fresh-browser rehearsal exposed a first-access privacy notice intercepting
the booking click. The contract case now follows its real acknowledgement
button, requires a successful CSRF-protected response and re-reads the current
version's persisted acceptance. It does not hide the notice, force clicks,
preload consent or opt into optional tracking. This is synthetic test acceptance,
not approval of the notice's legal wording or the retention policy.

## Recovery and providers

The first commit containing the role fix is a candidate reserve for local
rehearsal; later acceptance-only changes preserve its application code. M5/M6
are no longer security-equivalent reserves after the role fix: they contain the
reproduced race. Verify the rebuilt reserve on synthetic DB/uploads before any
proposal for an immutable operational fallback. A local rebuilt pair is not a
previous deployed OCI pair and does not approve production RTO/RPO.

Silvio requested Stripe and Google testing and deferred Apple. He confirmed that
the available configurations belong to production, so separate test
configurations are still required. Do not reuse live keys, change the existing
strict staging baseline, or mark Apple tested. Provider sandbox, operational
recovery, load thresholds, legacy/retention decisions and production approval
retain their own gates. No consent or SLA is invented from local test success.

## Review and rollback

Review the small repository implementation change separately from its acceptance
tests. Run the temporary database, release and browser checks on the exact final
source. Rollback needs no SQL: reverting the repository change restores the race
and therefore is not an automatically acceptable production fallback. Preserve
the fix when preparing a reserve. Do not rerun finished live dispatchers.
