# Fleetum PostgreSQL Restore Runbook

## Scope

This runbook restores a Fleetum PostgreSQL dump created by `deploy/backup/backup-postgres.sh`.

## Safety checklist

- [ ] Confirm this restore target is correct.
- [ ] Stop application writes before restore.
- [ ] Take a fresh backup before replacing data.
- [ ] Confirm the dump file checksum/size.
- [ ] Confirm who approved the restore.

## Restore on an empty database

```bash
cd /opt/fleetum/app
BACKUP_FILE=/opt/fleetum/backups/postgres/fleetum-postgres-YYYYMMDDTHHMMSSZ.sql.gz

docker compose --env-file /opt/fleetum/env/compose.env -f docker-compose.prod.yml down backend

gunzip -c "$BACKUP_FILE" | docker compose --env-file /opt/fleetum/env/compose.env -f docker-compose.prod.yml exec -T postgres \
  psql -U fleetum -d fleetum

docker compose --env-file /opt/fleetum/env/compose.env -f docker-compose.prod.yml up -d
curl -fsS https://api.fleetum.it/api/ready
```

## Verification

- `GET /api/ready` returns 200.
- Login works.
- Tenant data is visible only to the correct tenant.
- Booking/contratti smoke tests pass.
- Backend logs show no migration/query errors.

## Restore test cadence

- Monthly: restore the latest dump to an isolated staging/test database.
- Before risky migrations: create a fresh dump and verify it is not empty.
- After storage changes: test both PostgreSQL and uploads restore paths.

## Non-destructive restore test

Use `deploy/backup/restore-postgres-test.sh` to verify a dump without touching production.

```bash
/opt/fleetum/app/deploy/backup/restore-postgres-test.sh
```

The script starts a temporary PostgreSQL container, restores the latest dump, verifies the restored schema and removes the container at the end.

To keep the temporary container for inspection:

```bash
KEEP_CONTAINER=true /opt/fleetum/app/deploy/backup/restore-postgres-test.sh
```

## Production warning

Never restore over production without approval, fresh backup, maintenance window and rollback plan.
