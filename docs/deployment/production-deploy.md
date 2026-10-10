# Fleetum Production Deploy Runbook

## Principle

Production deploys must be repeatable, logged and reversible. Do not deploy manually if GitHub Actions covers the workflow.

## Current production topology

- App dir: `/opt/fleetum/app`
- Env dir: `/opt/fleetum/env`
- Backend env: `/opt/fleetum/env/backend.env`
- Compose env: `/opt/fleetum/env/compose.env`
- PostgreSQL: managed service reached through `DATABASE_URL`/`DIRECT_URL`; no database service exists in the canonical production compose
- Uploads volume: `/opt/fleetum/uploads`

`docker-compose.prod.local-postgres.yml` is an emergency rollback topology, not the normal production topology. Its `/opt/fleetum/postgres` volume is relevant only when that separately approved fallback is active.

## Deploy order

1. Resolve one full commit SHA. A CI-triggered release uses `workflow_run.head_sha`; a manual release is rejected unless CI succeeded for that exact SHA.
2. GitHub Actions checks out that same immutable SHA in every job, then builds and pushes backend/frontend images to GHCR.
3. Upload deployment manifests from the same SHA to a SHA-versioned staging directory on the VPS.
4. Acquire `/opt/fleetum/deploy.lock`, promote the staged manifests, then save the running images and release metadata atomically in `/opt/fleetum/last-deploy.txt`.
5. Reclaim unused Docker build cache, dangling layers and obsolete Fleetum image tags while preserving the running, rollback and target releases.
6. Verify both the free-space and usage thresholds before pulling images, after the pull and again before Prisma migration; abort before migration if a threshold is not met.
7. Pull the selected images on the VPS.
8. Backup database with `deploy/backup/backup-postgres.sh`.
9. Backup uploads with `deploy/backup/backup-uploads.sh`.
10. Run Prisma migration separately only if both backups completed.
11. Restart services.
12. Verify backend readiness plus the frontend, robots, sitemap, `llms.txt` and social-preview asset while the release lock remains active.
13. Automatic application rollback if the restart command fails, including a partial restart, or if any release health check fails. The previous release must pass the same health set before rollback is reported as complete.
14. Repeat safe Docker cleanup after a healthy release, emit a `df -h` / `docker system df` report and finalize the release log.

## Images

Production publishes GHCR image tags generated from the selected full commit SHA:

```txt
ghcr.io/silviomasuccio6/fleetum-backend:<commit-sha>
ghcr.io/silviomasuccio6/fleetum-frontend:<commit-sha>
```

The production deploy uses the immutable image digests returned by the two builds and records the full Git SHA, CI run and deploy run in the release state. Before backup or migration, the VPS confirms that each digest resolves to the same local image as its full-SHA release tag. The production workflow does not publish or consume `latest`.

All release jobs consume the output of the initial source-resolution job. Moving `main` while a workflow is running therefore cannot change the source, images or manifests in that release.

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
FLEETUM_BACKEND_IMAGE=ghcr.io/silviomasuccio6/fleetum-backend@sha256:<backend-digest> \
FLEETUM_FRONTEND_IMAGE=ghcr.io/silviomasuccio6/fleetum-frontend@sha256:<frontend-digest> \
FLEETUM_BACKEND_RELEASE_TAG=ghcr.io/silviomasuccio6/fleetum-backend:<commit-sha> \
FLEETUM_FRONTEND_RELEASE_TAG=ghcr.io/silviomasuccio6/fleetum-frontend:<commit-sha> \
FLEETUM_RELEASE_SHA=<full-40-character-commit-sha> \
ENV_FILE=/opt/fleetum/env/compose.env \
./deploy/scripts/safe-production-deploy.sh
```

## Restart command

```bash
cd /opt/fleetum/app
FLEETUM_BACKEND_IMAGE=ghcr.io/silviomasuccio6/fleetum-backend@sha256:<backend-digest> \
FLEETUM_FRONTEND_IMAGE=ghcr.io/silviomasuccio6/fleetum-frontend@sha256:<frontend-digest> \
FLEETUM_BACKEND_RELEASE_TAG=ghcr.io/silviomasuccio6/fleetum-backend:<commit-sha> \
FLEETUM_FRONTEND_RELEASE_TAG=ghcr.io/silviomasuccio6/fleetum-frontend:<commit-sha> \
FLEETUM_RELEASE_SHA=<full-40-character-commit-sha> \
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
- The safe deploy and manual rollback share `/opt/fleetum/deploy.lock`; a second operation exits instead of changing the same services concurrently.
- Application rollback is attempted after a failed or partial container restart and after any failed release health check. A rollback failure is reported separately and requires operator intervention.
- Manual rollback command:

```bash
cd /opt/fleetum/app
APP_DIR=/opt/fleetum/app \
ENV_FILE=/opt/fleetum/env/compose.env \
LAST_DEPLOY_FILE=/opt/fleetum/last-deploy.txt \
HEALTH_URL=https://api.fleetum.it/api/ready \
./deploy/scripts/rollback-production.sh
```

- Application rollback does not restore the database. Restore DB only if the migration changed data destructively and a separately reviewed restore was approved.
- Before releasing a migration, verify in an isolated rehearsal that the preceding application version can start and serve its critical flows on the migrated schema.
- Verify `/api/ready` and core login/booking flows.

## Notes

- Runtime backend starts only the app. Prisma migrations are a deploy step.
- The VPS should not build production images. GitHub Actions builds and publishes images, then the VPS pulls them.
- Secrets live outside the repository.
- GHCR login happens inside GitHub Actions using a short-lived token before pulling private images.
- Platform Console requires configured IP allowlist and OTP.
