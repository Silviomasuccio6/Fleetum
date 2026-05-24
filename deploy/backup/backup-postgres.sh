#!/usr/bin/env sh
set -eu

BACKUP_DIR="${BACKUP_DIR:-/opt/fleetum/backups/postgres}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
COMPOSE_FILE="${COMPOSE_FILE:-/opt/fleetum/app/docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-/opt/fleetum/env/compose.env}"
SERVICE_NAME="${POSTGRES_SERVICE_NAME:-postgres}"
DB_USER="${POSTGRES_USER:-fleetum}"
DB_NAME="${POSTGRES_DB:-fleetum}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUTPUT_FILE="$BACKUP_DIR/fleetum-postgres-$TIMESTAMP.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "[backup-postgres] starting backup: $OUTPUT_FILE"
cd "$(dirname "$COMPOSE_FILE")"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T "$SERVICE_NAME" \
  pg_dump -U "$DB_USER" -d "$DB_NAME" --no-owner --no-privileges \
  | gzip -9 > "$OUTPUT_FILE"

chmod 600 "$OUTPUT_FILE"
find "$BACKUP_DIR" -type f -name 'fleetum-postgres-*.sql.gz' -mtime +"$RETENTION_DAYS" -delete

echo "[backup-postgres] completed: $OUTPUT_FILE"
