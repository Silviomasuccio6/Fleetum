#!/usr/bin/env sh
set -eu

UPLOADS_DIR="${UPLOADS_DIR:-/opt/fleetum/uploads}"
BACKUP_DIR="${BACKUP_DIR:-/opt/fleetum/backups/uploads}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUTPUT_FILE="$BACKUP_DIR/fleetum-uploads-$TIMESTAMP.tar.gz"

mkdir -p "$BACKUP_DIR"

echo "[backup-uploads] starting backup: $OUTPUT_FILE"
tar -czf "$OUTPUT_FILE" -C "$(dirname "$UPLOADS_DIR")" "$(basename "$UPLOADS_DIR")"
chmod 600 "$OUTPUT_FILE"
find "$BACKUP_DIR" -type f -name 'fleetum-uploads-*.tar.gz' -mtime +"$RETENTION_DAYS" -delete

if [ "${OFFSITE_SYNC_CMD:-}" ]; then
  echo "[backup-uploads] running offsite sync command"
  sh -c "$OFFSITE_SYNC_CMD"
fi

echo "[backup-uploads] completed: $OUTPUT_FILE"
