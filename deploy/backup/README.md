# Fleetum Backup Strategy

## Assets

- PostgreSQL data: `/opt/fleetum/postgres` through logical `pg_dump`.
- Uploads/documents: `/opt/fleetum/uploads` archive.
- Env files: `/opt/fleetum/env` must be backed up securely outside the repo.

## Recommended frequency

- PostgreSQL: daily minimum, hourly once production usage grows.
- Uploads: daily minimum, more often if contract/document volume grows.
- Restore test: monthly.

## Cron example

```cron
15 2 * * * /opt/fleetum/app/deploy/backup/backup-postgres.sh >> /opt/fleetum/logs/backup-postgres.log 2>&1
30 2 * * * /opt/fleetum/app/deploy/backup/backup-uploads.sh >> /opt/fleetum/logs/backup-uploads.log 2>&1
```

Production deploys install this schedule automatically through:

```bash
/opt/fleetum/app/deploy/backup/install-cron.sh
```

The installer is idempotent: it replaces the managed Fleetum block and removes the old legacy `ops/backup-db-prod.sh` cron entry if present.

## Configuration

The scripts use safe defaults for production and can be configured with environment variables stored outside git.

```bash
BACKUP_DIR=/opt/fleetum/backups/postgres
UPLOADS_DIR=/opt/fleetum/uploads
RETENTION_DAYS=14
COMPOSE_FILE=/opt/fleetum/app/docker-compose.prod.yml
ENV_FILE=/opt/fleetum/env/compose.env
POSTGRES_SERVICE_NAME=postgres
POSTGRES_USER=fleetum
POSTGRES_DB=fleetum
OFFSITE_RCLONE_TARGET=remote:fleetum-backups
RCLONE_TRANSFERS=4
```

## Offsite

Local backup is not enough. Configure offsite copy with Cloudflare R2, S3, Backblaze B2 or another provider. Use env/config outside the repo.

Recommended option with `rclone`:

```bash
OFFSITE_RCLONE_TARGET="remote:fleetum-backups/postgres" /opt/fleetum/app/deploy/backup/backup-postgres.sh
OFFSITE_RCLONE_TARGET="remote:fleetum-backups/uploads" /opt/fleetum/app/deploy/backup/backup-uploads.sh
```

## Security

- Do not store backup credentials in git.
- Restrict backup file permissions.
- Encrypt offsite backups where possible.
- Test restore regularly.

## Deployment

GitHub Actions deploys the backup runbooks and scripts to `/opt/fleetum/app/deploy/backup`. Cron should execute the scripts from that path so the VPS uses the reviewed version from git.

The production workflow also runs `install-cron.sh` after containers are restarted, so the VPS cron stays aligned with the repository.

## Restore test

Run a restore test at least monthly in staging or on an isolated database. Do not wait for an incident to discover a backup cannot be restored.

Use the non-destructive restore test script:

```bash
/opt/fleetum/app/deploy/backup/restore-postgres-test.sh
```

The script:

- picks the latest PostgreSQL dump by default;
- supports both the new `/opt/fleetum/backups/postgres` path and the legacy `/opt/fleetum/backups` path;
- restores into a temporary PostgreSQL container;
- creates compatibility roles such as `fleetum` for legacy dumps with ownership statements;
- verifies Prisma migrations and public tables;
- removes the temporary container unless `KEEP_CONTAINER=true` is set.

To test a specific dump:

```bash
BACKUP_FILE=/opt/fleetum/backups/postgres/fleetum-postgres-YYYYMMDDTHHMMSSZ.sql.gz \
  /opt/fleetum/app/deploy/backup/restore-postgres-test.sh
```
