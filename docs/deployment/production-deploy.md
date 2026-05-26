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
2. Backup database with `deploy/backup/backup-postgres.sh`.
3. Backup uploads with `deploy/backup/backup-uploads.sh` when document/storage changes are involved.
4. GitHub Actions builds and pushes backend/frontend images to GHCR.
5. Upload deployment manifests to the VPS.
6. Pull the selected images on the VPS.
7. Run Prisma migration separately.
8. Restart services.
9. Health checks.
10. Log review.

## Images

Production uses immutable GHCR image tags generated from the deployed commit SHA:

```txt
ghcr.io/silviomasuccio6/fleetum-backend:<commit-sha>
ghcr.io/silviomasuccio6/fleetum-frontend:<commit-sha>
```

The workflow also updates `latest`, but the deploy step passes the explicit SHA-tagged images through `FLEETUM_BACKEND_IMAGE` and `FLEETUM_FRONTEND_IMAGE` to keep the release traceable.

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

## Backup commands

Backups should run before migrations and before any deploy that changes persistence, storage or document handling.

```bash
cd /opt/fleetum/app
BACKUP_DIR=/opt/fleetum/backups/postgres ./deploy/backup/backup-postgres.sh
BACKUP_DIR=/opt/fleetum/backups/uploads ./deploy/backup/backup-uploads.sh
```

For offsite copies, configure `OFFSITE_RCLONE_TARGET` outside the repository.

## Rollback

- Revert to previous Git commit or image tag.
- Restart containers.
- Restore DB only if the migration changed data destructively and rollback was approved.
- Verify `/api/ready` and core login/booking flows.

## Notes

- Runtime backend starts only the app. Prisma migrations are a deploy step.
- The VPS should not build production images. GitHub Actions builds and publishes images, then the VPS pulls them.
- Secrets live outside the repository.
- GHCR login happens inside GitHub Actions using a short-lived token before pulling private images.
- Platform Console requires configured IP allowlist and OTP.
