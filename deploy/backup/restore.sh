#!/usr/bin/env bash
set -euo pipefail

# Fleetum restore procedure helper.
# This script is intentionally conservative: it prints the production restore
# steps by default. Set RUN_RESTORE=true only during an approved incident window.
# Always test restores in staging/isolation before touching production.

BACKUP_POSTGRES_FILE="${BACKUP_POSTGRES_FILE:-}"
BACKUP_UPLOADS_FILE="${BACKUP_UPLOADS_FILE:-}"
COMPOSE_FILE="${COMPOSE_FILE:-/opt/fleetum/app/docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-/opt/fleetum/env/compose.env}"
POSTGRES_SERVICE_NAME="${POSTGRES_SERVICE_NAME:-postgres}"
POSTGRES_USER="${POSTGRES_USER:-fleetum}"
POSTGRES_DB="${POSTGRES_DB:-fleetum}"
UPLOADS_DIR="${UPLOADS_DIR:-/opt/fleetum/uploads}"
RUN_RESTORE="${RUN_RESTORE:-false}"

cat <<STEPS
Fleetum restore procedure
=========================

Pre-flight checks:
1. Declare incident owner and freeze deploys.
2. Confirm the restore target and business impact.
3. Take a fresh safety backup of current production before overwriting anything.
4. Verify backup files exist and were downloaded from offsite storage:
   - PostgreSQL dump: ${BACKUP_POSTGRES_FILE:-<set BACKUP_POSTGRES_FILE>}
   - Uploads archive: ${BACKUP_UPLOADS_FILE:-<set BACKUP_UPLOADS_FILE>}
5. Stop backend writes or put the app in maintenance mode.

Database restore steps:
1. Validate dump integrity:
   gzip -t "\$BACKUP_POSTGRES_FILE"
2. Stop application containers except postgres if needed:
   docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" stop backend
3. Drop and recreate the target DB only after approval:
   docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T "$POSTGRES_SERVICE_NAME" \\
     dropdb -U "$POSTGRES_USER" --if-exists "$POSTGRES_DB"
   docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T "$POSTGRES_SERVICE_NAME" \\
     createdb -U "$POSTGRES_USER" "$POSTGRES_DB"
4. Restore dump:
   gzip -dc "\$BACKUP_POSTGRES_FILE" | docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T "$POSTGRES_SERVICE_NAME" \\
     psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"

Uploads restore steps:
1. Validate archive:
   tar -tzf "\$BACKUP_UPLOADS_FILE" >/dev/null
2. Move current uploads aside:
   mv "$UPLOADS_DIR" "${UPLOADS_DIR}.before-restore-\$(date -u +%Y%m%dT%H%M%SZ)"
3. Extract archive:
   mkdir -p "$(dirname "$UPLOADS_DIR")"
   tar -xzf "\$BACKUP_UPLOADS_FILE" -C "$(dirname "$UPLOADS_DIR")"
4. Fix ownership/permissions according to the container user if needed.

Post-restore validation:
1. Restart services:
   docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d
2. Health checks:
   curl -f https://api.fleetum.it/api/ready
   curl -f https://api.fleetum.it/platform-api/ready || true
3. Verify login, tenant data, booking, contracts, and document downloads.
4. Document timeline and update the incident post-mortem.

This script does not run destructive restore commands unless RUN_RESTORE=true.
STEPS

if [ "$RUN_RESTORE" != "true" ]; then
  exit 0
fi

[ -n "$BACKUP_POSTGRES_FILE" ] || { echo "BACKUP_POSTGRES_FILE is required" >&2; exit 2; }
[ -n "$BACKUP_UPLOADS_FILE" ] || { echo "BACKUP_UPLOADS_FILE is required" >&2; exit 2; }
[ -f "$BACKUP_POSTGRES_FILE" ] || { echo "Postgres backup not found: $BACKUP_POSTGRES_FILE" >&2; exit 2; }
[ -f "$BACKUP_UPLOADS_FILE" ] || { echo "Uploads backup not found: $BACKUP_UPLOADS_FILE" >&2; exit 2; }

gzip -t "$BACKUP_POSTGRES_FILE"
tar -tzf "$BACKUP_UPLOADS_FILE" >/dev/null

echo "RUN_RESTORE=true is set. Manual destructive restore commands are documented above."
echo "For safety, execute those commands step-by-step during an approved incident window."
