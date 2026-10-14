# Platform health in isolated staging

The synthetic staging baseline uses the strict Platform IP allowlist with only
loopback permitted and trusted-device access disabled. An anonymous public health
request therefore returns `403` with `PLATFORM_IP_FORBIDDEN`. Requiring public
`200` incorrectly fails a deployment even when the Platform service is healthy.

The trusted `ops/staging/check-platform-health.sh` control checks both boundaries:

1. Inside `fleetum_staging_backend`, request
   `http://127.0.0.1:4100/platform-api/health` without forwarded IP headers. Require
   status `200`, JSON `ok: true` and `service: fleetum-platform-api`.
2. From the host, request the public HTTPS endpoint with normal TLS verification.
   Require status `403` and parse the exact JSON error `PLATFORM_IP_FORBIDDEN`.
   A generic forbidden page, optional device mode, redirect, public `200`, transport
   failure or malformed response fails the check. Response bodies are not logged.

The workflow copies this helper from its pinned trusted control checkout, never
from the application candidate. A missing helper rejects deployment before any
manifest promotion. The first invocation retains the deployment lock; the final
health step reuses the same helper before the release proof is published. Direct
and sudo Docker modes target only the fixed staging backend and staging Docker
config. This is a health/read-only check, not a Platform login or E2E attestation.

No application guard, environment configuration or database migration changes.
If this check fails, retain evidence and the staging database; there is no
automatic database restore. A deployment may already have migrated, bootstrapped
and started containers before health failure. Verify the synthetic bootstrap
state before a subsequent deployment, normally with `bootstrapSynthetic=false`;
do not treat a failed workflow as evidence of an empty database.

Rollback of this control is a source revert and review through the normal CI
process. It restores the former public-health expectation and its known failure
under strict mode; it does not revert application containers or database state.
Do not weaken the Platform allowlist to make the workflow pass.
