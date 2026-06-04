#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/backup/lib.sh
source "$SCRIPT_DIR/lib.sh"

BACKUP_DIR="${BACKUP_DIR:-/opt/fleetum/backups/postgres}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
COMPOSE_FILE="${COMPOSE_FILE:-/opt/fleetum/app/docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-/opt/fleetum/env/compose.env}"
SERVICE_NAME="${POSTGRES_SERVICE_NAME:-postgres}"
DB_USER="${POSTGRES_USER:-fleetum}"
DB_NAME="${POSTGRES_DB:-fleetum}"
PG_DUMP_DATABASE_URL="${PG_DUMP_DATABASE_URL:-${DIRECT_URL:-}}"
POSTGRES_IMAGE="${POSTGRES_IMAGE:-postgres:16-alpine}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUTPUT_FILE="$BACKUP_DIR/fleetum-postgres-$TIMESTAMP.sql.gz"
TMP_FILE="$OUTPUT_FILE.tmp"
MIN_BACKUP_BYTES="${MIN_POSTGRES_BACKUP_BYTES:-1024}"

umask 077
mkdir -p "$BACKUP_DIR"
require_positive_int "RETENTION_DAYS" "$RETENTION_DAYS"
require_positive_int "MIN_POSTGRES_BACKUP_BYTES" "$MIN_BACKUP_BYTES"
require_offsite_config

command -v docker >/dev/null 2>&1 || fail "docker command not found"

cleanup() {
  rm -f "$TMP_FILE"
}
trap cleanup EXIT

log "starting PostgreSQL backup: $OUTPUT_FILE"

if [ -n "$PG_DUMP_DATABASE_URL" ]; then
  log "using managed PostgreSQL connection for pg_dump"
  docker run --rm "$POSTGRES_IMAGE" \
    pg_dump "$PG_DUMP_DATABASE_URL" --no-owner --no-privileges \
    | gzip -9 > "$TMP_FILE" || fail "managed pg_dump failed"
else
  [ -f "$COMPOSE_FILE" ] || fail "compose file not found: $COMPOSE_FILE"
  cd "$(dirname "$COMPOSE_FILE")"

  if [ -f "$ENV_FILE" ]; then
    COMPOSE_ENV_ARGS=(--env-file "$ENV_FILE")
  else
    COMPOSE_ENV_ARGS=()
  fi

  docker compose "${COMPOSE_ENV_ARGS[@]}" -f "$COMPOSE_FILE" exec -T "$SERVICE_NAME" \
    pg_dump -U "$DB_USER" -d "$DB_NAME" --no-owner --no-privileges \
    | gzip -9 > "$TMP_FILE" || fail "compose pg_dump failed"
fi

mv "$TMP_FILE" "$OUTPUT_FILE"
chmod 600 "$OUTPUT_FILE"
verify_backup_file "$OUTPUT_FILE" "$MIN_BACKUP_BYTES"
copy_to_offsite "$OUTPUT_FILE" "postgres"
prune_local_backups "$BACKUP_DIR" 'fleetum-postgres-*.sql.gz' "$RETENTION_DAYS"
prune_offsite_backups "postgres" "$RETENTION_DAYS"

SIZE_BYTES="$(file_size_bytes "$OUTPUT_FILE")"
log "PostgreSQL backup completed: $OUTPUT_FILE (${SIZE_BYTES} bytes)"
notify_backup_success "PostgreSQL backup completed: $OUTPUT_FILE (${SIZE_BYTES} bytes)"
