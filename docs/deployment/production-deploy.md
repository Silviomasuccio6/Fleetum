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
2. GitHub Actions builds and pushes backend/frontend images to GHCR.
3. Upload deployment manifests to the VPS.
4. Save currently running image tags in `/opt/fleetum/last-deploy.txt`.
5. Reclaim unused Docker build cache, dangling layers and obsolete Fleetum image tags while preserving the running, rollback and target releases.
6. Verify at least `10 GB` is free on the VPS filesystem before pulling images; abort before migration if the threshold is not met.
7. Pull the selected images on the VPS.
8. Backup database with `deploy/backup/backup-postgres.sh`.
9. Backup uploads with `deploy/backup/backup-uploads.sh`.
10. Run Prisma migration separately only if both backups completed.
11. Restart services.
12. Health check `/api/ready`.
13. Automatic application rollback if health fails.
14. Repeat safe Docker cleanup after a healthy release, then perform public health checks and log review.

## Images

Production uses immutable GHCR image tags generated from the deployed commit SHA:

```txt
ghcr.io/silviomasuccio6/fleetum-backend:<commit-sha>
ghcr.io/silviomasuccio6/fleetum-frontend:<commit-sha>
```

The workflow also updates `latest`, but the deploy step passes the explicit SHA-tagged images through `FLEETUM_BACKEND_IMAGE` and `FLEETUM_FRONTEND_IMAGE` to keep the release traceable.

### Disk capacity guard

The deploy script reserves `10 GB` of free filesystem capacity by default before it pulls a new image. It only removes:

- Docker build cache;
- dangling image layers;
- old `ghcr.io/silviomasuccio6/fleetum-backend` and `fleetum-frontend` tags that are not active, not the rollback release and not the target release.

It never prunes PostgreSQL, named volumes, `/opt/fleetum/uploads`, local backups or arbitrary third-party images. Override the threshold only deliberately with `MIN_FREE_DISK_GB`, for example `MIN_FREE_DISK_GB=15`.

If a deploy stops for low disk space, investigate before retrying:

```bash
df -h /
docker system df
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
```

The current 72 GB VPS should be expanded before file volume or customer count grows materially. Docker image retention is a safety net, not a substitute for capacity planning.

## Migration command

```bash
cd /opt/fleetum/app
FLEETUM_BACKEND_IMAGE=ghcr.io/silviomasuccio6/fleetum-backend:<commit-sha> \
FLEETUM_FRONTEND_IMAGE=ghcr.io/silviomasuccio6/fleetum-frontend:<commit-sha> \
ENV_FILE=/opt/fleetum/env/compose.env \
./deploy/scripts/safe-production-deploy.sh
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

Backups must run before migrations. The production workflow enforces this through
`deploy/scripts/safe-production-deploy.sh`.

```bash
cd /opt/fleetum/app
BACKUP_DIR=/opt/fleetum/backups/postgres ./deploy/backup/backup-postgres.sh
BACKUP_DIR=/opt/fleetum/backups/uploads ./deploy/backup/backup-uploads.sh
```

For offsite copies, configure `OFFSITE_RCLONE_TARGET` outside the repository.

## Rollback

- Automatic rollback uses `/opt/fleetum/last-deploy.txt`.
- Manual rollback command:

```bash
cd /opt/fleetum/app
APP_DIR=/opt/fleetum/app \
ENV_FILE=/opt/fleetum/env/compose.env \
LAST_DEPLOY_FILE=/opt/fleetum/last-deploy.txt \
./deploy/scripts/rollback-production.sh
```

- Restore DB only if the migration changed data destructively and rollback was approved.
- Verify `/api/ready` and core login/booking flows.

## Notes

- Runtime backend starts only the app. Prisma migrations are a deploy step.
- The VPS should not build production images. GitHub Actions builds and publishes images, then the VPS pulls them.
- Secrets live outside the repository.
- GHCR login happens inside GitHub Actions using a short-lived token before pulling private images.
- Platform Console requires configured IP allowlist and OTP.
