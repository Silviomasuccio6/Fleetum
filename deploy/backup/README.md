# Fleetum Production Backup Strategy

Fleetum production backups must be offsite. Local-only backups are useful for fast restore, but are not enough if the VPS, disk or datacenter fails.

## Assets

- PostgreSQL logical dump via `pg_dump`.
- Uploads/documents archive from `/opt/fleetum/uploads`.
- Env files in `/opt/fleetum/env` must be backed up securely outside git and outside this automated archive process.

## RPO / RTO targets

- RPO target: 24 hours with the current daily schedule.
- RTO target: 4 hours for PostgreSQL restore plus uploads rehydrate on the current single-VPS architecture.
- Monthly restore test is mandatory to keep these targets credible.

## Required production configuration

Copy the example outside the repository:

```bash
sudo cp /opt/fleetum/app/deploy/env/backup.env.production.example /opt/fleetum/env/backup.env
sudo chmod 600 /opt/fleetum/env/backup.env
sudo nano /opt/fleetum/env/backup.env
```

Use either rclone or aws-cli compatible S3 config.

### Option A: rclone, recommended

Works well with Cloudflare R2, AWS S3 and Backblaze B2.

```bash
rclone config
OFFSITE_RCLONE_TARGET=fleetum-r2:fleetum-backups
RCLONE_BIN=/home/fleetum/bin/rclone
```

Backups are uploaded to:

```txt
$OFFSITE_RCLONE_TARGET/postgres/
$OFFSITE_RCLONE_TARGET/uploads/
```

### Option B: aws-cli compatible S3

```bash
OFFSITE_S3_URI=s3://fleetum-backups/prod
S3_ENDPOINT_URL=https://<account-id>.r2.cloudflarestorage.com
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=auto
```

For aws-cli targets, configure bucket lifecycle to expire `postgres/` and `uploads/` objects after 30 days. The script enforces local retention and logs a reminder for remote lifecycle.

## Daily cron

```cron
15 2 * * * /opt/fleetum/app/deploy/backup/backup-postgres.sh >> /opt/fleetum/logs/backup-postgres.log 2>&1
30 2 * * * /opt/fleetum/app/deploy/backup/backup-uploads.sh >> /opt/fleetum/logs/backup-uploads.log 2>&1
*/30 * * * * /opt/fleetum/app/deploy/scripts/disk-capacity-alert.sh --check cron >> /opt/fleetum/logs/disk-capacity.log 2>&1
```

Production deploys install this schedule automatically through:

```bash
/opt/fleetum/app/deploy/backup/install-cron.sh
```

The scripts auto-load `/opt/fleetum/env/backup.env`, so cron does not need to inline secrets. `RCLONE_BIN` is useful when rclone is installed in the Fleetum user's `~/bin` directory, which is not always present in cron's PATH. The disk monitor runs every 30 minutes and uses the same Resend alert channel; production deploy installs the configured non-secret thresholds into its cron entry.

## Manual backup

```bash
/opt/fleetum/app/deploy/backup/backup-postgres.sh
/opt/fleetum/app/deploy/backup/backup-uploads.sh
```

Both scripts fail if offsite backup is not configured unless explicitly overridden with:

```bash
BACKUP_OFFSITE_REQUIRED=false
```

Do not use that override in production except for break-glass diagnostics.

## Retention

Default retention is 30 days:

```bash
RETENTION_DAYS=30
```

- Local files older than retention are deleted by the scripts.
- rclone targets are pruned by `rclone delete --min-age`.
- aws-cli/S3 targets require bucket lifecycle rules for remote retention.

## Alerts

On backup or restore-test failure, scripts can notify through:

- Resend API using `RESEND_API_KEY`, `BACKUP_ALERT_EMAIL`, `RESEND_FROM`.
- Generic webhook using `BACKUP_ALERT_WEBHOOK_URL`.

Success notifications are disabled by default. Enable only if useful:

```bash
BACKUP_NOTIFY_SUCCESS=true
```

## Monthly restore test

GitHub Actions workflow `.github/workflows/backup-restore-test.yml` runs monthly and manually. It SSHes into the VPS and runs:

```bash
/opt/fleetum/app/deploy/backup/backup-postgres.sh
/opt/fleetum/app/deploy/backup/backup-uploads.sh
RESTORE_DRILL_SOURCE=offsite /opt/fleetum/app/deploy/backup/restore-postgres-test.sh
```

Implementation note: because this workflow executes the remote script through an
SSH heredoc, backup commands must not allocate stdin unless they intentionally
consume streamed input. For example, `pg_dump` via `docker exec` must not use
`-i`, otherwise Docker can consume the following heredoc commands and make the
workflow look green after only the PostgreSQL backup.

The restore drill:

- downloads the latest offsite PostgreSQL and uploads backups when `RESTORE_DRILL_SOURCE=offsite`;
- validates gzip and minimum size;
- starts an isolated PostgreSQL 16 container;
- restores the dump;
- verifies Prisma migrations, public tables and critical table row counts;
- extracts uploads into a private temporary directory and verifies at least one recovered file;
- writes markdown and JSON reports to `/opt/fleetum/logs/restore-drills`;
- exposes a safe summary in Platform Console through the backend health endpoint;
- removes the temporary container unless `KEEP_CONTAINER=true`.

Run manually:

```bash
RESTORE_DRILL_SOURCE=offsite /opt/fleetum/app/deploy/backup/restore-postgres-test.sh
```

Use a specific dump:

```bash
BACKUP_FILE=/opt/fleetum/backups/postgres/fleetum-postgres-YYYYMMDDTHHMMSSZ.sql.gz \
UPLOADS_BACKUP_FILE=/opt/fleetum/backups/uploads/fleetum-uploads-YYYYMMDDTHHMMSSZ.tar.gz \
  /opt/fleetum/app/deploy/backup/restore-postgres-test.sh
```

Latest reports:

```bash
cat /opt/fleetum/logs/restore-drills/latest.md
cat /opt/fleetum/logs/restore-drills/latest.json
```

Expected Platform status is `PASS`. `MISSING`, `STALE` or `FAIL` means the restore evidence is not production-ready and risky migrations should wait.

## Security

- Never store backup credentials in git.
- Keep `/opt/fleetum/env/backup.env` mode `600`.
- Keep buckets private.
- Prefer server-side encryption or provider-managed encryption.
- Restrict bucket credentials to the backup bucket/prefix only.
- Test restore monthly and before destructive migrations.
