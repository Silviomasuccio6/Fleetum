# Fleetum PostgreSQL Restore Runbook

## Scope

This runbook restores a Fleetum PostgreSQL dump created by `deploy/backup/backup-postgres.sh`.

## Safety checklist

- [ ] Confirm this restore target is correct.
- [ ] Stop application writes before restore.
- [ ] Take a fresh backup before replacing data.
- [ ] Confirm the dump file checksum/size.
- [ ] Confirm who approved the restore.

## Canonical production topology

Production uses managed PostgreSQL. `docker-compose.prod.yml` contains only the backend and Caddy; it does not contain a `postgres` service. A production restore must therefore target a provider-created empty database or a provider-native point-in-time restore/branch. Never run a compose `exec postgres` command against the canonical production file.

## Managed PostgreSQL restore

Prefer the provider-native restore or point-in-time recovery procedure because it preserves the provider audit trail and avoids exposing a connection URL in shell history. Record the new database identity, recovery point and approver before changing Fleetum configuration.

For a reviewed plain-SQL restore, keep the target connection fields in a root-readable file outside the repository, for example `/opt/fleetum/env/restore-postgres.env` with mode `600`. The file must define `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` and `PGSSLMODE=require`.

```bash
cd /opt/fleetum/app
BACKUP_FILE=/opt/fleetum/backups/postgres/fleetum-postgres-YYYYMMDDTHHMMSSZ.sql.gz

docker compose --env-file /opt/fleetum/env/compose.env -f docker-compose.prod.yml stop backend

gunzip -c "$BACKUP_FILE" | docker run --rm -i \
  --env-file /opt/fleetum/env/restore-postgres.env \
  postgres:16-alpine \
  psql -v ON_ERROR_STOP=1

docker compose --env-file /opt/fleetum/env/compose.env -f docker-compose.prod.yml up -d --no-build backend caddy
curl -fsS https://api.fleetum.it/api/ready
```

Delete or securely archive the temporary restore env file according to the incident record. Do not paste a database URL into the command line, logs, tickets or chat.

## Emergency local-PostgreSQL fallback

`docker-compose.prod.local-postgres.yml` is a separately approved fallback. It requires explicit immutable backend/frontend image references. Only in that topology is the following service command valid:

```bash
docker compose --env-file /opt/fleetum/env/compose.env -f docker-compose.prod.local-postgres.yml exec -T postgres \
  psql -U fleetum -d fleetum
```

Do not switch from managed PostgreSQL to this fallback after new production writes without an explicit reconciliation plan.

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
