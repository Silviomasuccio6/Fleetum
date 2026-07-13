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
6. Verify both the free-space and usage thresholds before pulling images, after the pull and again before Prisma migration; abort before migration if a threshold is not met.
7. Pull the selected images on the VPS.
8. Backup database with `deploy/backup/backup-postgres.sh`.
9. Backup uploads with `deploy/backup/backup-uploads.sh`.
10. Run Prisma migration separately only if both backups completed.
11. Restart services.
12. Health check `/api/ready`.
13. Automatic application rollback if health fails.
14. Repeat safe Docker cleanup after a healthy release, emit a `df -h` / `docker system df` report, then perform public health checks and log review.

## Images

Production uses immutable GHCR image tags generated from the deployed commit SHA:

```txt
ghcr.io/silviomasuccio6/fleetum-backend:<commit-sha>
ghcr.io/silviomasuccio6/fleetum-frontend:<commit-sha>
```

The workflow also updates `latest`, but the deploy step passes the explicit SHA-tagged images through `FLEETUM_BACKEND_IMAGE` and `FLEETUM_FRONTEND_IMAGE` to keep the release traceable.

### Disk capacity guard

The deploy script reserves `10 GB` of free filesystem capacity by default and blocks deployment at `90%` filesystem usage. It checks these limits before the image pull, after the pull and immediately before Prisma migration. It only removes:

- Docker build cache;
- dangling image layers;
- old `ghcr.io/silviomasuccio6/fleetum-backend` and `fleetum-frontend` tags that are not active, not the rollback release and not the target release.

It never prunes PostgreSQL, named volumes, `/opt/fleetum/uploads`, local backups or arbitrary third-party images. The final deploy log prints a safe capacity report using `df -h` and `docker system df`.

Configure these non-secret GitHub production Variables only when a different capacity policy is required:

```txt
FLEETUM_MIN_FREE_DISK_GB=10
FLEETUM_MAX_DISK_USAGE_PERCENT=90
FLEETUM_DISK_ALERT_WARNING_PERCENT=80
FLEETUM_DISK_ALERT_CRITICAL_PERCENT=90
FLEETUM_DISK_ALERT_COOLDOWN_HOURS=24
```

The disk alert uses the existing Resend configuration from `/opt/fleetum/env/backup.env`. Set `DISK_ALERT_EMAIL` there to override `BACKUP_ALERT_EMAIL`; no alert credential belongs in GitHub Variables or the repository. Alerts are sent once per severity level and then rate-limited by the cooldown state file.

If a deploy stops for low disk space, investigate before retrying:

```bash
df -h /
docker system df
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
```

The current 72 GB VPS should be expanded to **120-160 GB** before file volume or customer count grows materially. Docker image retention is a safety net, not a substitute for capacity planning.

## Migration command

Exact-money migrations include a mandatory reconciliation gate. The safe deploy script
runs `npm run money:reconcile:prod` after Prisma migrations and before restarting the app.
Any mismatch stops the release while the previous application remains active. See
[`docs/database/exact-money-migration.md`](../database/exact-money-migration.md).

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
FLEETUM_BACKEND_IMAGE=ghcr.io/silviomasuccio6/fleetum-backend:<commit-sha> \
FLEETUM_FRONTEND_IMAGE=ghcr.io/silviomasuccio6/fleetum-frontend:<commit-sha> \
ENV_FILE=/opt/fleetum/env/compose.env \
./deploy/scripts/safe-production-deploy.sh
```

Never restart production with an unqualified `docker compose up -d`: `docker-compose.prod.yml` requires immutable backend and frontend image tags to prevent an accidental fallback to `latest`.

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
