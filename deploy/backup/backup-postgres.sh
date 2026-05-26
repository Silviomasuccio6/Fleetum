#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/fleetum/backups/postgres}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
COMPOSE_FILE="${COMPOSE_FILE:-/opt/fleetum/app/docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-/opt/fleetum/env/compose.env}"
SERVICE_NAME="${POSTGRES_SERVICE_NAME:-postgres}"
DB_USER="${POSTGRES_USER:-fleetum}"
DB_NAME="${POSTGRES_DB:-fleetum}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUTPUT_FILE="$BACKUP_DIR/fleetum-postgres-$TIMESTAMP.sql.gz"
TMP_FILE="$OUTPUT_FILE.tmp"

umask 077
mkdir -p "$BACKUP_DIR"

if ! [[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]]; then
  echo "[backup-postgres] RETENTION_DAYS must be a positive integer" >&2
  exit 2
fi

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "[backup-postgres] compose file not found: $COMPOSE_FILE" >&2
  exit 2
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "[backup-postgres] docker command not found" >&2
  exit 2
fi

cleanup() {
  rm -f "$TMP_FILE"
}
trap cleanup EXIT

echo "[backup-postgres] starting backup: $OUTPUT_FILE"
cd "$(dirname "$COMPOSE_FILE")"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T "$SERVICE_NAME" \
  pg_dump -U "$DB_USER" -d "$DB_NAME" --no-owner --no-privileges \
  | gzip -9 > "$TMP_FILE"

mv "$TMP_FILE" "$OUTPUT_FILE"
chmod 600 "$OUTPUT_FILE"
find "$BACKUP_DIR" -type f -name 'fleetum-postgres-*.sql.gz' -mtime +"$RETENTION_DAYS" -delete

if [ -n "${OFFSITE_RCLONE_TARGET:-}" ]; then
  if ! command -v rclone >/dev/null 2>&1; then
    echo "[backup-postgres] OFFSITE_RCLONE_TARGET set but rclone is not installed" >&2
    exit 2
  fi
  echo "[backup-postgres] syncing backup directory to configured offsite target"
  rclone copy "$BACKUP_DIR" "$OFFSITE_RCLONE_TARGET" --transfers "${RCLONE_TRANSFERS:-4}"
fi

echo "[backup-postgres] completed: $OUTPUT_FILE"
