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

## Offsite

Local backup is not enough. Configure offsite copy with Cloudflare R2, S3, Backblaze B2 or another provider. Use env/config outside the repo.

Example placeholder:

```bash
OFFSITE_SYNC_CMD="rclone copy /opt/fleetum/backups remote:fleetum-backups --transfers 4"
```

## Security

- Do not store backup credentials in git.
- Restrict backup file permissions.
- Encrypt offsite backups where possible.
- Test restore regularly.
