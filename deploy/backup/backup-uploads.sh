#!/usr/bin/env bash
set -euo pipefail

UPLOADS_DIR="${UPLOADS_DIR:-/opt/fleetum/uploads}"
BACKUP_DIR="${BACKUP_DIR:-/opt/fleetum/backups/uploads}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUTPUT_FILE="$BACKUP_DIR/fleetum-uploads-$TIMESTAMP.tar.gz"
TMP_FILE="$OUTPUT_FILE.tmp"

umask 077
mkdir -p "$BACKUP_DIR"

if ! [[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]]; then
  echo "[backup-uploads] RETENTION_DAYS must be a positive integer" >&2
  exit 2
fi

if [ ! -d "$UPLOADS_DIR" ]; then
  echo "[backup-uploads] uploads directory not found: $UPLOADS_DIR" >&2
  exit 2
fi

cleanup() {
  rm -f "$TMP_FILE"
}
trap cleanup EXIT

echo "[backup-uploads] starting backup: $OUTPUT_FILE"
tar -czf "$TMP_FILE" -C "$(dirname "$UPLOADS_DIR")" "$(basename "$UPLOADS_DIR")"
mv "$TMP_FILE" "$OUTPUT_FILE"
chmod 600 "$OUTPUT_FILE"
find "$BACKUP_DIR" -type f -name 'fleetum-uploads-*.tar.gz' -mtime +"$RETENTION_DAYS" -delete

if [ -n "${OFFSITE_RCLONE_TARGET:-}" ]; then
  if ! command -v rclone >/dev/null 2>&1; then
    echo "[backup-uploads] OFFSITE_RCLONE_TARGET set but rclone is not installed" >&2
    exit 2
  fi
  echo "[backup-uploads] syncing backup directory to configured offsite target"
  rclone copy "$BACKUP_DIR" "$OFFSITE_RCLONE_TARGET" --transfers "${RCLONE_TRANSFERS:-4}"
fi

echo "[backup-uploads] completed: $OUTPUT_FILE"
