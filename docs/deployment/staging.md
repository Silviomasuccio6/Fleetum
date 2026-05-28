# Fleetum Staging Environment

## Domains

- `staging.fleetum.it`
- `api-staging.fleetum.it`
- `platform-staging.fleetum.it`

## Goals

- Validate releases before production.
- Use a separate PostgreSQL database.
- Use Stripe test mode.
- Use email sandbox/test configuration where possible.
- Keep secrets outside git.

## Files

- `docker-compose.staging.yml`
- `.github/workflows/deploy-staging.yml`
- `deploy/caddy/Caddyfile.staging`
- `deploy/env/backend.env.staging.example`

## GitHub Actions deploy

Staging deploys are manual only. This avoids accidental deploys while the staging DNS, secrets and database are still being prepared.

Required GitHub Secrets:

- `FLEETUM_STAGING_HOST`
- `FLEETUM_STAGING_USER`
- `FLEETUM_STAGING_SSH_KEY`

Optional GitHub Variables:

- `FLEETUM_STAGING_APP_DIR`, defaults to `/opt/fleetum-staging/app`
- `FLEETUM_STAGING_ENV_FILE`, defaults to `/opt/fleetum-staging/env/compose.env`

To run:

1. Open GitHub Actions.
2. Select `Deploy Staging`.
3. Choose the branch/tag/SHA to deploy, normally `develop`.
4. Type `DEPLOY_STAGING` in the confirmation input.
5. Wait for image build, migration, container restart and health checks.

The workflow builds staging-tagged GHCR images, uploads only deployment manifests, runs Prisma migrations separately, starts containers and verifies staging URLs.

## Manual deploy order

```bash
cd /opt/fleetum-staging/app
export FLEETUM_BACKEND_IMAGE=ghcr.io/silviomasuccio6/fleetum-backend:staging-latest
export FLEETUM_FRONTEND_IMAGE=ghcr.io/silviomasuccio6/fleetum-frontend:staging-latest
docker compose --env-file /opt/fleetum-staging/env/compose.env -f docker-compose.staging.yml pull
docker compose --env-file /opt/fleetum-staging/env/compose.env -f docker-compose.staging.yml run --rm backend \
  npx prisma migrate deploy --schema prisma/schema.prisma
docker compose --env-file /opt/fleetum-staging/env/compose.env -f docker-compose.staging.yml up -d
```

## Health checks

```bash
curl -fsS https://api-staging.fleetum.it/api/health
curl -fsS https://api-staging.fleetum.it/api/ready
curl -fsS https://platform-staging.fleetum.it/platform-api/health
```

## Notes

- Do not reuse production database credentials.
- Use Stripe test keys and email sandbox/test behavior where possible.
- Keep staging secrets outside git.
- If staging runs on the same VPS as production, confirm port/reverse-proxy design before exposing it publicly.
