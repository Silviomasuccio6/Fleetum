# Fleetum Staging Environment

## Domains

- `staging.fleetum.it`
- `api-staging.fleetum.it`
- `platform-staging.fleetum.it`

## Purpose

Staging is the mandatory release rehearsal environment. Its isolated baseline uses a separate PostgreSQL database, synthetic tenants, disabled email and disabled background tasks. Provider credentials (including Stripe test keys) are rejected in this baseline. Production credentials or personal data must never be copied into it. Provider sandbox testing requires a separately reviewed configuration; it is not enabled by this change.

See [isolation policy and local proof](staging-isolation-20261003.md). This document describes future approved operations, not an authorization to dispatch or deploy.

The rehearsal must preserve one release identity from CI to source checkout, images, deployment manifests and test evidence.

## Files

- `docker-compose.staging.yml`
- `.github/workflows/deploy-staging.yml`
- `deploy/caddy/Caddyfile.staging`
- `deploy/env/backend.env.staging.example`

## GitHub Actions deployment

Staging deployments are manual. The workflow:

1. resolves the requested ref once to a full 40-character SHA;
2. requires a successful `CI` run for that exact SHA from this repository;
3. checks out the same immutable SHA for image builds and deployment manifests;
4. publishes full-SHA image tags and deploys the immutable digests returned by the build;
5. stages manifests in a directory named with the release SHA and promotes them while holding the staging deployment lock;
6. validates the backend environment before Prisma migrations, restarts containers, observes the safety policy and internal network, then checks all three staging endpoints;
7. publishes the release proof with isolation policy version 1; E2E requires that proof and repeats the runtime observation before and after the suite.

Protected staging variables must pin `FLEETUM_STAGING_TRUSTED_WORKFLOW_SHA` and `FLEETUM_STAGING_APPROVED_RELEASE_SHA` after human review. Missing/mismatching pins reject the run. Controls and SSH observation execute from a separate checkout of the workflow revision, not from candidate scripts. Branch/environment protections remain an independent prerequisite; CI success is not human approval.

Required GitHub Secrets:

- `FLEETUM_STAGING_HOST`
- `FLEETUM_STAGING_USER`
- `FLEETUM_STAGING_SSH_KEY`
- `FLEETUM_STAGING_KNOWN_HOSTS` (pinned trust, verified independently)

Optional GitHub Variables (only these canonical values are accepted):

- `FLEETUM_STAGING_APP_DIR`, default `/opt/fleetum-staging/app`
- `FLEETUM_STAGING_ENV_FILE`, default `/opt/fleetum-staging/env/compose.env`
- `FLEETUM_STAGING_LOCK_FILE`, default `/opt/fleetum-staging/deploy.lock`

To run the workflow:

1. push the release candidate and obtain a successful hosted CI run;
2. open GitHub Actions and select `Deploy Staging`;
3. enter the exact CI-backed commit SHA;
4. type `DEPLOY_STAGING`;
5. record the SHA, CI run ID and backend/frontend digest references from the job summary;
6. wait for migration, restart and health checks to pass.

The workflow does not turn a local-only branch into a releasable candidate. A branch with no hosted CI evidence is rejected.

## Migration rehearsal

Before a release that contains migrations:

- take a staging database snapshot or dump;
- confirm the release preflight queries against a production-like, redacted restore;
- measure the migration duration and locks;
- verify the preceding application release against the migrated schema;
- run the critical synthetic E2E suite with two distinct tenants;
- document the application rollback and any separately approved database restore procedure.

The staging deployment lock prevents two deployment commands from mutating the environment concurrently. Database restore is never automatic.

## Manual recovery deployment

Use manual commands only for an approved recovery after recording the exact release SHA and the two digest references from the GitHub workflow. The compose file refuses missing image variables and has no mutable fallback.

```bash
cd /opt/fleetum-staging/app
export FLEETUM_BACKEND_IMAGE='ghcr.io/silviomasuccio6/fleetum-backend@sha256:<64-hex-digest>'
export FLEETUM_FRONTEND_IMAGE='ghcr.io/silviomasuccio6/fleetum-frontend@sha256:<64-hex-digest>'
docker compose --project-name fleetum-staging --env-file /opt/fleetum-staging/env/compose.env -f docker-compose.staging.yml pull
docker compose --project-name fleetum-staging --env-file /opt/fleetum-staging/env/compose.env -f docker-compose.staging.yml run --rm backend \
  sh -c 'node dist/shared/config/env.js && npx prisma migrate deploy --schema prisma/schema.prisma'
docker compose --project-name fleetum-staging --env-file /opt/fleetum-staging/env/compose.env -f docker-compose.staging.yml up -d --no-build
```

## Health and release checks

```bash
curl -fsS https://api-staging.fleetum.it/api/health
curl -fsS https://api-staging.fleetum.it/api/ready
curl -fsS https://platform-staging.fleetum.it/platform-api/health
```

After health checks, run `.github/workflows/e2e-nightly.yml` manually with the staging URLs and two complete synthetic tenant credential sets. A green deploy workflow alone does not prove authenticated business flows.

## Environment notes

- Do not reuse production database or provider credentials.
- Keep staging secrets outside Git.
- Keep the public marketing site non-indexable in staging.
- If staging shares a VPS with production, confirm ports, reverse-proxy routing, disk capacity and backup paths before exposing it.

## Isolated baseline

Compose fixes `FLEETUM_ENVIRONMENT=staging`, `EMAIL_PROVIDER=disabled`, dunning/retention flags false and the PostgreSQL user/database `fleetum_staging`. The backend environment must use PostgreSQL host `postgres`, port 5432, database and user `fleetum_staging`. It rejects all provider credentials and noncanonical staging URLs before startup or migration. Email returns `STAGING_EMAIL_DISABLED`; it never reports simulated delivery as successful. No reminder, email queue, scheduled report, retention or dunning cron starts in this mode.

Only backend/PostgreSQL join the internal staging network; Caddy also joins a separate edge network. Runtime observations check the backend's exclusive internal membership. Host firewall, Docker daemon privileges, mount purity and external HTTPS routing still require independent verification; CORS and container names are not evidence of data isolation.

All three Caddy hosts send `X-Robots-Tag: noindex, nofollow, noarchive`, serve a disallow-all robots file and return 404 for sitemap discovery. Production Caddy and SEO files are unchanged. E2E accepts only canonical staging origins; its local rehearsal mode accepts only HTTPS loopback under `NODE_ENV=test`, outside hosted CI. Before business tests it authenticates both accounts and requires distinct nonempty tenant IDs. This does not attest that their data are synthetic.

Rolling back these files reopens the containment gap. There is no database migration or automated restore/financial side effect in this tranche. Stop staging and review before any rollback; do not remove safeguards merely to obtain a green health check.
