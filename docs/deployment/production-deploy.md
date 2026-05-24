# Fleetum Production Deploy Runbook

## Principle

Production deploys must be repeatable, logged and reversible. Do not deploy manually if GitHub Actions covers the workflow.

## Current production topology

- App dir: `/opt/fleetum/app`
- Env dir: `/opt/fleetum/env`
- Backend env: `/opt/fleetum/env/backend.env`
- Compose env: `/opt/fleetum/env/compose.env`
- PostgreSQL volume: `/opt/fleetum/postgres`
- Uploads volume: `/opt/fleetum/uploads`

## Deploy order

1. CI green.
2. Backup database.
3. Backup uploads when document/storage changes are involved.
4. Upload/pull application files or images.
5. Build/pull containers.
6. Run Prisma migration separately.
7. Restart services.
8. Health checks.
9. Log review.

## Migration command

```bash
cd /opt/fleetum/app
docker compose --env-file /opt/fleetum/env/compose.env -f docker-compose.prod.yml run --rm backend \
  npx prisma migrate deploy --schema prisma/schema.prisma
```

## Restart command

```bash
cd /opt/fleetum/app
docker compose --env-file /opt/fleetum/env/compose.env -f docker-compose.prod.yml up -d
```

## Health checks

```bash
curl -fsS https://api.fleetum.it/api/health
curl -fsS https://api.fleetum.it/api/ready
curl -fsS https://platform.fleetum.it/platform-api/health
curl -fsS https://fleetum.it/robots.txt
curl -fsS https://fleetum.it/sitemap.xml
```

## Rollback

- Revert to previous Git commit or image tag.
- Restart containers.
- Restore DB only if the migration changed data destructively and rollback was approved.
- Verify `/api/ready` and core login/booking flows.

## Notes

- Runtime backend starts only the app. Prisma migrations are a deploy step.
- Secrets live outside the repository.
- Platform Console requires configured IP allowlist and OTP.
