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
- `deploy/caddy/Caddyfile.staging`
- `deploy/env/backend.env.staging.example`

## Deploy order

```bash
cd /opt/fleetum-staging/app
docker compose --env-file /opt/fleetum-staging/env/compose.env -f docker-compose.staging.yml build
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

The staging workflow should be added only after DNS and GitHub Secrets are configured.
