#!/usr/bin/env bash
set -Eeuo pipefail

# Fleetum offsite backup runner.
# Backs up PostgreSQL and /opt/fleetum/uploads, then uploads artifacts to an
# S3-compatible destination using rclone or aws-cli. Secrets must come from
# environment variables or host-level config files, never from git.

APP_NAME="${APP_NAME:-fleetum}"
COMPOSE_FILE="${COMPOSE_FILE:-/opt/fleetum/app/docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-/opt/fleetum/env/compose.env}"
POSTGRES_SERVICE_NAME="${POSTGRES_SERVICE_NAME:-postgres}"
POSTGRES_USER="${POSTGRES_USER:-fleetum}"
POSTGRES_DB="${POSTGRES_DB:-fleetum}"
UPLOADS_DIR="${UPLOADS_DIR:-/opt/fleetum/uploads}"
LOCAL_BACKUP_ROOT="${LOCAL_BACKUP_ROOT:-/opt/fleetum/backups/offsite}"
LOG_FILE="${LOG_FILE:-/opt/fleetum/logs/offsite-backup.log}"
RETENTION_COUNT="${RETENTION_COUNT:-30}"
BACKUP_REMOTE_TOOL="${BACKUP_REMOTE_TOOL:-rclone}" # rclone | aws | none
RCLONE_TARGET="${RCLONE_TARGET:-}"
S3_URI="${S3_URI:-}"
AWS_ENDPOINT_URL="${AWS_ENDPOINT_URL:-}"
DRY_RUN="${DRY_RUN:-false}"
NOTIFY_ON_SUCCESS="${NOTIFY_ON_SUCCESS:-false}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
POSTGRES_DIR="$LOCAL_BACKUP_ROOT/postgres"
UPLOADS_BACKUP_DIR="$LOCAL_BACKUP_ROOT/uploads"
POSTGRES_FILE="$POSTGRES_DIR/${APP_NAME}-postgres-$TIMESTAMP.sql.gz"
UPLOADS_FILE="$UPLOADS_BACKUP_DIR/${APP_NAME}-uploads-$TIMESTAMP.tar.gz"

umask 077
mkdir -p "$POSTGRES_DIR" "$UPLOADS_BACKUP_DIR" "$(dirname "$LOG_FILE")"

to_bool() {
  local normalized
  normalized="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  case "$normalized" in
    1 | true | yes | on) return 0 ;;
    *) return 1 ;;
  esac
}

log() {
  local line="[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [offsite-backup] $*"
  echo "$line" | tee -a "$LOG_FILE"
}

notify_resend() {
  local subject="$1"
  local text="$2"

  [ -n "${RESEND_API_KEY:-}" ] || return 0
  [ -n "${BACKUP_ALERT_EMAIL_TO:-}" ] || return 0
  [ -n "${BACKUP_ALERT_EMAIL_FROM:-}" ] || return 0
  command -v curl >/dev/null 2>&1 || return 0

  local payload
  payload=$(cat <<JSON
{"from":"${BACKUP_ALERT_EMAIL_FROM}","to":["${BACKUP_ALERT_EMAIL_TO}"],"subject":"${subject}","text":"${text}"}
JSON
)

  curl -fsS https://api.resend.com/emails \
    -H "Authorization: Bearer ${RESEND_API_KEY}" \
    -H "Content-Type: application/json" \
    -d "$payload" >/dev/null
}

notify_failure() {
  local message="$1"
  notify_resend "Fleetum backup FAILED" "Fleetum offsite backup failed on $(hostname).

$message

Log: $LOG_FILE" || true
}

notify_success() {
  if to_bool "$NOTIFY_ON_SUCCESS"; then
    notify_resend "Fleetum backup completed" "Fleetum offsite backup completed on $(hostname).

Postgres: $POSTGRES_FILE
Uploads: $UPLOADS_FILE
Log: $LOG_FILE" || true
  fi
}

fail() {
  log "ERROR: $*"
  notify_failure "$*"
  exit 1
}

require_positive_int() {
  local name="$1"
  local value="$2"
  if ! [[ "$value" =~ ^[1-9][0-9]*$ ]]; then
    fail "$name must be a positive integer"
  fi
}

require_command() {
  local command_name="$1"
  command -v "$command_name" >/dev/null 2>&1 || fail "required command not found: $command_name"
}

run_pg_dump() {
  if to_bool "$DRY_RUN"; then
    log "dry-run: creating synthetic PostgreSQL dump at $POSTGRES_FILE"
    printf '%s\n' "-- dry-run ${APP_NAME} postgres backup ${TIMESTAMP}" | gzip -9 > "$POSTGRES_FILE"
    chmod 600 "$POSTGRES_FILE"
    return 0
  fi

  [ -f "$COMPOSE_FILE" ] || fail "compose file not found: $COMPOSE_FILE"
  [ -f "$ENV_FILE" ] || fail "env file not found: $ENV_FILE"
  require_command docker
  require_command gzip

  log "creating PostgreSQL dump: $POSTGRES_FILE"
  local tmp_file="${POSTGRES_FILE}.tmp"
  rm -f "$tmp_file"
  (
    cd "$(dirname "$COMPOSE_FILE")"
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T "$POSTGRES_SERVICE_NAME" \
      pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges
  ) | gzip -9 > "$tmp_file"
  mv "$tmp_file" "$POSTGRES_FILE"
  chmod 600 "$POSTGRES_FILE"
}

run_uploads_archive() {
  if to_bool "$DRY_RUN"; then
    log "dry-run: creating synthetic uploads archive at $UPLOADS_FILE"
    local tmp_dir
    tmp_dir="$(mktemp -d)"
    printf '%s\n' "dry-run ${APP_NAME} uploads backup ${TIMESTAMP}" > "$tmp_dir/README.txt"
    tar -czf "$UPLOADS_FILE" -C "$tmp_dir" README.txt
    rm -rf "$tmp_dir"
    chmod 600 "$UPLOADS_FILE"
    return 0
  fi

  [ -d "$UPLOADS_DIR" ] || fail "uploads directory not found: $UPLOADS_DIR"
  require_command tar

  log "creating uploads archive: $UPLOADS_FILE"
  local tmp_file="${UPLOADS_FILE}.tmp"
  rm -f "$tmp_file"
  tar -czf "$tmp_file" -C "$(dirname "$UPLOADS_DIR")" "$(basename "$UPLOADS_DIR")"
  mv "$tmp_file" "$UPLOADS_FILE"
  chmod 600 "$UPLOADS_FILE"
}

upload_with_rclone() {
  require_command rclone
  [ -n "$RCLONE_TARGET" ] || fail "RCLONE_TARGET is required when BACKUP_REMOTE_TOOL=rclone"

  if to_bool "$DRY_RUN"; then
    log "dry-run: validating rclone command availability; skipping remote upload to $RCLONE_TARGET"
    return 0
  fi

  log "uploading backups with rclone to $RCLONE_TARGET"
  rclone copy "$POSTGRES_FILE" "$RCLONE_TARGET/postgres" --transfers "${RCLONE_TRANSFERS:-4}"
  rclone copy "$UPLOADS_FILE" "$RCLONE_TARGET/uploads" --transfers "${RCLONE_TRANSFERS:-4}"
}

upload_with_aws() {
  require_command aws
  [ -n "$S3_URI" ] || fail "S3_URI is required when BACKUP_REMOTE_TOOL=aws"

  if to_bool "$DRY_RUN"; then
    log "dry-run: validating aws command availability; skipping remote upload to $S3_URI"
    return 0
  fi

  local endpoint_args=()
  if [ -n "$AWS_ENDPOINT_URL" ]; then
    endpoint_args=(--endpoint-url "$AWS_ENDPOINT_URL")
  fi

  log "uploading backups with aws-cli to $S3_URI"
  aws "${endpoint_args[@]}" s3 cp "$POSTGRES_FILE" "$S3_URI/postgres/$(basename "$POSTGRES_FILE")" --only-show-errors
  aws "${endpoint_args[@]}" s3 cp "$UPLOADS_FILE" "$S3_URI/uploads/$(basename "$UPLOADS_FILE")" --only-show-errors
}

upload_offsite() {
  case "$BACKUP_REMOTE_TOOL" in
    rclone) upload_with_rclone ;;
    aws) upload_with_aws ;;
    none) log "BACKUP_REMOTE_TOOL=none; keeping local artifacts only" ;;
    *) fail "BACKUP_REMOTE_TOOL must be one of: rclone, aws, none" ;;
  esac
}

retain_local_last_n() {
  local directory="$1"
  local pattern="$2"
  log "retaining latest $RETENTION_COUNT local backups in $directory"
  find "$directory" -type f -name "$pattern" -print | sort -r | tail -n +"$((RETENTION_COUNT + 1))" | while IFS= read -r old_file; do
    [ -n "$old_file" ] || continue
    log "deleting old local backup: $old_file"
    rm -f "$old_file"
  done
}

retain_remote_rclone_last_n() {
  if to_bool "$DRY_RUN" || [ "$BACKUP_REMOTE_TOOL" != "rclone" ] || [ -z "$RCLONE_TARGET" ]; then
    return 0
  fi

  log "retaining latest $RETENTION_COUNT remote rclone backups"
  for subdir in postgres uploads; do
    rclone lsf "$RCLONE_TARGET/$subdir" --files-only | sort -r | tail -n +"$((RETENTION_COUNT + 1))" | while IFS= read -r old_name; do
      [ -n "$old_name" ] || continue
      log "deleting old remote backup: $RCLONE_TARGET/$subdir/$old_name"
      rclone deletefile "$RCLONE_TARGET/$subdir/$old_name"
    done
  done
}

retain_remote_aws_last_n() {
  if to_bool "$DRY_RUN" || [ "$BACKUP_REMOTE_TOOL" != "aws" ] || [ -z "$S3_URI" ]; then
    return 0
  fi

  local endpoint_args=()
  if [ -n "$AWS_ENDPOINT_URL" ]; then
    endpoint_args=(--endpoint-url "$AWS_ENDPOINT_URL")
  fi

  log "retaining latest $RETENTION_COUNT remote aws backups"
  for subdir in postgres uploads; do
    aws "${endpoint_args[@]}" s3 ls "$S3_URI/$subdir/" | awk '{print $4}' | grep -E "^${APP_NAME}-(postgres|uploads)-.*\.(sql|tar)\.gz$" | sort -r | tail -n +"$((RETENTION_COUNT + 1))" | while IFS= read -r old_name; do
      [ -n "$old_name" ] || continue
      log "deleting old remote backup: $S3_URI/$subdir/$old_name"
      aws "${endpoint_args[@]}" s3 rm "$S3_URI/$subdir/$old_name" --only-show-errors
    done
  done
}

main() {
  require_positive_int RETENTION_COUNT "$RETENTION_COUNT"
  log "starting offsite backup; dry_run=$DRY_RUN remote_tool=$BACKUP_REMOTE_TOOL retention=$RETENTION_COUNT"
  run_pg_dump
  run_uploads_archive
  upload_offsite
  retain_local_last_n "$POSTGRES_DIR" "${APP_NAME}-postgres-*.sql.gz"
  retain_local_last_n "$UPLOADS_BACKUP_DIR" "${APP_NAME}-uploads-*.tar.gz"
  retain_remote_rclone_last_n
  retain_remote_aws_last_n
  notify_success
  log "completed successfully: postgres=$POSTGRES_FILE uploads=$UPLOADS_FILE"
}

trap 'fail "unexpected error at line $LINENO"' ERR
main "$@"
