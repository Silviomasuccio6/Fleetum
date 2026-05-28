#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/fleetum/app}"
LOG_DIR="${LOG_DIR:-/opt/fleetum/logs}"
POSTGRES_SCHEDULE="${POSTGRES_SCHEDULE:-15 2 * * *}"
UPLOADS_SCHEDULE="${UPLOADS_SCHEDULE:-30 2 * * *}"
BEGIN_MARKER="# BEGIN FLEETUM MANAGED BACKUPS"
END_MARKER="# END FLEETUM MANAGED BACKUPS"
POSTGRES_SCRIPT="$APP_DIR/deploy/backup/backup-postgres.sh"
UPLOADS_SCRIPT="$APP_DIR/deploy/backup/backup-uploads.sh"

if [ ! -x "$POSTGRES_SCRIPT" ]; then
  echo "[install-cron] missing executable: $POSTGRES_SCRIPT" >&2
  exit 2
fi

if [ ! -x "$UPLOADS_SCRIPT" ]; then
  echo "[install-cron] missing executable: $UPLOADS_SCRIPT" >&2
  exit 2
fi

mkdir -p "$LOG_DIR"

CURRENT_CRON="$(mktemp)"
NEXT_CRON="$(mktemp)"
trap 'rm -f "$CURRENT_CRON" "$NEXT_CRON"' EXIT

crontab -l > "$CURRENT_CRON" 2>/dev/null || true

# Remove previously managed Fleetum block and the old one-line backup job.
# Keep this in a single awk command so empty crontabs do not fail under pipefail.
awk -v begin="$BEGIN_MARKER" -v end="$END_MARKER" '
  $0 == begin { skip = 1; next }
  $0 == end { skip = 0; next }
  $0 ~ /\/opt\/fleetum\/app\/ops\/backup-db-prod\.sh/ { next }
  skip != 1 { print }
' "$CURRENT_CRON" > "$NEXT_CRON"

{
  echo "$BEGIN_MARKER"
  echo "$POSTGRES_SCHEDULE $POSTGRES_SCRIPT >> $LOG_DIR/backup-postgres.log 2>&1"
  echo "$UPLOADS_SCHEDULE $UPLOADS_SCRIPT >> $LOG_DIR/backup-uploads.log 2>&1"
  echo "$END_MARKER"
} >> "$NEXT_CRON"

crontab "$NEXT_CRON"

echo "[install-cron] installed Fleetum managed backup cron"
