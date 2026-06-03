#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/backup/lib.sh
source "$SCRIPT_DIR/lib.sh"

UPLOADS_DIR="${UPLOADS_DIR:-/opt/fleetum/uploads}"
BACKUP_DIR="${BACKUP_DIR:-/opt/fleetum/backups/uploads}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUTPUT_FILE="$BACKUP_DIR/fleetum-uploads-$TIMESTAMP.tar.gz"
TMP_FILE="$OUTPUT_FILE.tmp"
MIN_BACKUP_BYTES="${MIN_UPLOADS_BACKUP_BYTES:-128}"

umask 077
mkdir -p "$BACKUP_DIR"
require_positive_int "RETENTION_DAYS" "$RETENTION_DAYS"
require_positive_int "MIN_UPLOADS_BACKUP_BYTES" "$MIN_BACKUP_BYTES"
require_offsite_config

[ -d "$UPLOADS_DIR" ] || fail "uploads directory not found: $UPLOADS_DIR"
command -v tar >/dev/null 2>&1 || fail "tar command not found"

cleanup() {
  rm -f "$TMP_FILE"
}
trap cleanup EXIT

log "starting uploads backup: $OUTPUT_FILE"
tar -czf "$TMP_FILE" -C "$(dirname "$UPLOADS_DIR")" "$(basename "$UPLOADS_DIR")" || fail "uploads tar failed"
mv "$TMP_FILE" "$OUTPUT_FILE"
chmod 600 "$OUTPUT_FILE"
verify_backup_file "$OUTPUT_FILE" "$MIN_BACKUP_BYTES"
copy_to_offsite "$OUTPUT_FILE" "uploads"
prune_local_backups "$BACKUP_DIR" 'fleetum-uploads-*.tar.gz' "$RETENTION_DAYS"
prune_offsite_backups "uploads" "$RETENTION_DAYS"

SIZE_BYTES="$(file_size_bytes "$OUTPUT_FILE")"
log "Uploads backup completed: $OUTPUT_FILE (${SIZE_BYTES} bytes)"
notify_backup_success "Uploads backup completed: $OUTPUT_FILE (${SIZE_BYTES} bytes)"
