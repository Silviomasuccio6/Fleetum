#!/usr/bin/env bash
set -euo pipefail

BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-/opt/fleetum/env/backup.env}"
if [ -f "$BACKUP_ENV_FILE" ]; then
  # shellcheck disable=SC1090
  source "$BACKUP_ENV_FILE"
fi

log() {
  printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

fail() {
  local message="$1"
  log "ERROR: $message" >&2
  notify_backup_failure "$message" || true
  exit 1
}

require_positive_int() {
  local name="$1"
  local value="$2"
  if ! [[ "$value" =~ ^[0-9]+$ ]] || [ "$value" -lt 1 ]; then
    fail "$name must be a positive integer"
  fi
}

file_size_bytes() {
  if stat -f%z "$1" >/dev/null 2>&1; then
    stat -f%z "$1"
  else
    stat -c%s "$1"
  fi
}

json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/}"
  printf '%s' "$value"
}

verify_backup_file() {
  local file="$1"
  local min_bytes="${2:-1024}"
  [ -f "$file" ] || fail "backup file not found: $file"
  local size
  size="$(file_size_bytes "$file")"
  if [ "$size" -lt "$min_bytes" ]; then
    fail "backup file too small: $file (${size} bytes)"
  fi
}

notify_backup_failure() {
  local message="$1"
  local subject="${BACKUP_ALERT_SUBJECT:-Fleetum backup failure}"
  local recipient="${BACKUP_ALERT_EMAIL:-${PLATFORM_ALERT_EMAILS:-}}"
  recipient="${recipient%%,*}"
  local resend_key="${RESEND_API_KEY:-}"
  local resend_from="${RESEND_FROM:-Fleetum Backups <no-reply@fleetum.it>}"
  local webhook_url="${BACKUP_ALERT_WEBHOOK_URL:-}"

  if [ -n "$webhook_url" ] && command -v curl >/dev/null 2>&1; then
    local webhook_text
    webhook_text="$(json_escape "${subject}: ${message}")"
    curl -fsS -X POST "$webhook_url" \
      -H 'Content-Type: application/json' \
      --data "{\"text\":\"$webhook_text\"}" >/dev/null || true
  fi

  if [ -n "$resend_key" ] && [ -n "$recipient" ] && command -v curl >/dev/null 2>&1; then
    local resend_from_json recipient_json subject_json message_json
    resend_from_json="$(json_escape "$resend_from")"
    recipient_json="$(json_escape "$recipient")"
    subject_json="$(json_escape "$subject")"
    message_json="$(json_escape "$message")"
    curl -fsS -X POST 'https://api.resend.com/emails' \
      -H "Authorization: Bearer $resend_key" \
      -H 'Content-Type: application/json' \
      --data "{\"from\":\"$resend_from_json\",\"to\":[\"$recipient_json\"],\"subject\":\"$subject_json\",\"text\":\"$message_json\"}" >/dev/null || true
  fi
}

notify_backup_success() {
  local message="$1"
  if [ "${BACKUP_NOTIFY_SUCCESS:-false}" != "true" ]; then
    return 0
  fi
  local subject="${BACKUP_SUCCESS_SUBJECT:-Fleetum backup success}"
  local recipient="${BACKUP_ALERT_EMAIL:-${PLATFORM_ALERT_EMAILS:-}}"
  recipient="${recipient%%,*}"
  local resend_key="${RESEND_API_KEY:-}"
  local resend_from="${RESEND_FROM:-Fleetum Backups <no-reply@fleetum.it>}"
  if [ -n "$resend_key" ] && [ -n "$recipient" ] && command -v curl >/dev/null 2>&1; then
    local resend_from_json recipient_json subject_json message_json
    resend_from_json="$(json_escape "$resend_from")"
    recipient_json="$(json_escape "$recipient")"
    subject_json="$(json_escape "$subject")"
    message_json="$(json_escape "$message")"
    curl -fsS -X POST 'https://api.resend.com/emails' \
      -H "Authorization: Bearer $resend_key" \
      -H 'Content-Type: application/json' \
      --data "{\"from\":\"$resend_from_json\",\"to\":[\"$recipient_json\"],\"subject\":\"$subject_json\",\"text\":\"$message_json\"}" >/dev/null || true
  fi
}

require_offsite_config() {
  if [ "${BACKUP_OFFSITE_REQUIRED:-true}" != "true" ]; then
    return 0
  fi

  if [ -n "${OFFSITE_RCLONE_TARGET:-}" ]; then
    return 0
  fi

  if [ -n "${OFFSITE_S3_URI:-}" ]; then
    return 0
  fi

  fail "offsite backup is required: set OFFSITE_RCLONE_TARGET or OFFSITE_S3_URI"
}

resolve_rclone_bin() {
  local candidate="${RCLONE_BIN:-}"

  if [ -n "$candidate" ] && [ -x "$candidate" ]; then
    printf '%s\n' "$candidate"
    return 0
  fi

  if command -v rclone >/dev/null 2>&1; then
    command -v rclone
    return 0
  fi

  candidate="$HOME/bin/rclone"
  if [ -x "$candidate" ]; then
    printf '%s\n' "$candidate"
    return 0
  fi

  fail "OFFSITE_RCLONE_TARGET is set but rclone was not found in PATH or $HOME/bin/rclone"
}

copy_to_offsite() {
  local file="$1"
  local category="$2"
  require_offsite_config

  if [ -n "${OFFSITE_RCLONE_TARGET:-}" ]; then
    local rclone_bin target
    rclone_bin="$(resolve_rclone_bin)"
    target="${OFFSITE_RCLONE_TARGET%/}/$category"
    log "copying $file to offsite rclone target: $target"
    "$rclone_bin" copyto "$file" "$target/$(basename "$file")" --transfers "${RCLONE_TRANSFERS:-4}" || fail "offsite rclone upload failed for $file"
    return 0
  fi

  if [ -n "${OFFSITE_S3_URI:-}" ]; then
    command -v aws >/dev/null 2>&1 || fail "OFFSITE_S3_URI set but aws CLI is not installed"
    local target="${OFFSITE_S3_URI%/}/$category/$(basename "$file")"
    log "copying $file to offsite S3 target: $target"
    local endpoint_args=()
    if [ -n "${S3_ENDPOINT_URL:-}" ]; then
      endpoint_args=(--endpoint-url "$S3_ENDPOINT_URL")
    fi
    aws "${endpoint_args[@]}" s3 cp "$file" "$target" --only-show-errors || fail "offsite S3 upload failed for $file"
    return 0
  fi
}

prune_local_backups() {
  local dir="$1"
  local pattern="$2"
  local retention_days="$3"
  find "$dir" -type f -name "$pattern" -mtime +"$retention_days" -delete
}

prune_offsite_backups() {
  local category="$1"
  local retention_days="$2"

  if [ -n "${OFFSITE_RCLONE_TARGET:-}" ]; then
    local rclone_bin target
    rclone_bin="$(resolve_rclone_bin)"
    target="${OFFSITE_RCLONE_TARGET%/}/$category"
    log "pruning offsite rclone target older than ${retention_days}d: $target"
    "$rclone_bin" delete "$target" --min-age "${retention_days}d" || fail "offsite rclone retention failed for $target"
    "$rclone_bin" rmdirs "$target" --leave-root >/dev/null 2>&1 || true
    return 0
  fi

  if [ -n "${OFFSITE_S3_URI:-}" ]; then
    # Retention for aws-cli targets is intentionally conservative: local retention is enforced here,
    # bucket lifecycle rules must enforce remote 30-day expiry for S3/R2/B2.
    log "OFFSITE_S3_URI configured. Ensure bucket lifecycle expires $category objects after ${retention_days} days."
  fi
}
