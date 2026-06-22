#!/usr/bin/env bash
set -euo pipefail

# Sends a rate-limited capacity alert using the existing Resend backup channel.
# It never removes Docker data, volumes, uploads or backups.

APP_DIR="${APP_DIR:-/opt/fleetum/app}"
DISK_ALERT_ENV_FILE="${DISK_ALERT_ENV_FILE:-/opt/fleetum/env/backup.env}"
DISK_ALERT_WARNING_PERCENT="${DISK_ALERT_WARNING_PERCENT:-80}"
DISK_ALERT_CRITICAL_PERCENT="${DISK_ALERT_CRITICAL_PERCENT:-90}"
DISK_ALERT_COOLDOWN_HOURS="${DISK_ALERT_COOLDOWN_HOURS:-24}"
DISK_ALERT_STATE_FILE="${DISK_ALERT_STATE_FILE:-/opt/fleetum/disk-alert-state}"
DISK_USAGE_PERCENT_OVERRIDE="${DISK_USAGE_PERCENT_OVERRIDE:-}"
DRY_RUN="${DRY_RUN:-false}"

log() {
  printf '[disk-capacity-alert] %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

fail() {
  log "ERROR: $*"
  exit 2
}

validate_percent() {
  local name="$1"
  local value="$2"

  [[ "$value" =~ ^[1-9][0-9]?$|^100$ ]] || fail "$name must be an integer between 1 and 100"
}

validate_positive_integer() {
  local name="$1"
  local value="$2"

  [[ "$value" =~ ^[1-9][0-9]*$ ]] || fail "$name must be a positive integer"
}

load_notification_env() {
  local warning_percent="$DISK_ALERT_WARNING_PERCENT"
  local critical_percent="$DISK_ALERT_CRITICAL_PERCENT"
  local cooldown_hours="$DISK_ALERT_COOLDOWN_HOURS"

  if [ -f "$DISK_ALERT_ENV_FILE" ]; then
    # The production backup environment lives outside the repository and should
    # be mode 600. It contains the existing Resend credentials and is never
    # printed by this script.
    # shellcheck disable=SC1090
    . "$DISK_ALERT_ENV_FILE"
  fi

  # Deployment and cron pass these non-secret policy values explicitly. Do not
  # let a backup credential file silently change the capacity safety policy.
  DISK_ALERT_WARNING_PERCENT="$warning_percent"
  DISK_ALERT_CRITICAL_PERCENT="$critical_percent"
  DISK_ALERT_COOLDOWN_HOURS="$cooldown_hours"
}

current_usage_percent() {
  if [ -n "$DISK_USAGE_PERCENT_OVERRIDE" ]; then
    validate_percent "DISK_USAGE_PERCENT_OVERRIDE" "$DISK_USAGE_PERCENT_OVERRIDE"
    printf '%s\n' "$DISK_USAGE_PERCENT_OVERRIDE"
    return 0
  fi

  df -Pk "$APP_DIR" | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }'
}

json_escape() {
  # Alert inputs are single-line operational values. Keep escaping POSIX sed
  # compatible because local dry-runs may run on macOS while production is Linux.
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

read_state_value() {
  local key="$1"

  [ -f "$DISK_ALERT_STATE_FILE" ] || return 0
  sed -n "s/^${key}=//p" "$DISK_ALERT_STATE_FILE" | tail -n 1
}

should_notify() {
  local level="$1"
  local now last_level last_sent cooldown_seconds

  now="$(date +%s)"
  last_level="$(read_state_value level)"
  last_sent="$(read_state_value sent_at)"
  cooldown_seconds=$((DISK_ALERT_COOLDOWN_HOURS * 3600))

  if [ "$last_level" = "$level" ] && [[ "$last_sent" =~ ^[0-9]+$ ]] && [ $((now - last_sent)) -lt "$cooldown_seconds" ]; then
    return 1
  fi

  return 0
}

write_state() {
  local level="$1"
  local usage="$2"

  if [ "$DRY_RUN" = "true" ]; then
    return 0
  fi

  umask 077
  mkdir -p "$(dirname "$DISK_ALERT_STATE_FILE")"
  cat > "$DISK_ALERT_STATE_FILE" <<STATE
level=$level
usage_percent=$usage
sent_at=$(date +%s)
STATE
}

clear_state() {
  if [ "$DRY_RUN" != "true" ]; then
    rm -f "$DISK_ALERT_STATE_FILE"
  fi
}

send_resend_alert() {
  local level="$1"
  local usage="$2"
  local phase="$3"
  local recipient resend_key resend_from subject message

  recipient="${DISK_ALERT_EMAIL:-${BACKUP_ALERT_EMAIL:-${PLATFORM_ALERT_EMAILS:-}}}"
  resend_key="${RESEND_API_KEY:-}"
  resend_from="${RESEND_FROM:-Fleetum Infrastructure <no-reply@fleetum.it>}"
  subject="[Fleetum] ${level} disk capacity alert (${usage}% used)"
  message="Fleetum VPS filesystem is ${usage}% used during ${phase}. Review df -h and docker system df. The deploy guard stops deployments at ${DISK_ALERT_CRITICAL_PERCENT}% usage or below the configured free-space minimum."

  if [ -z "$recipient" ] || [ -z "$resend_key" ]; then
    log "WARNING: ${level} threshold reached but Resend alert configuration is incomplete"
    return 1
  fi

  if [ "$DRY_RUN" = "true" ]; then
    log "dry-run would send ${level} alert at ${usage}% usage"
    return 0
  fi

  curl -fsS --max-time 20 -X POST 'https://api.resend.com/emails' \
    -H "Authorization: Bearer $resend_key" \
    -H 'Content-Type: application/json' \
    --data "{\"from\":\"$(json_escape "$resend_from")\",\"to\":[\"$(json_escape "$recipient")\"],\"subject\":\"$(json_escape "$subject")\",\"text\":\"$(json_escape "$message")\"}" \
    >/dev/null
}

main() {
  local phase="${2:-manual-check}"
  local usage level

  [ "${1:-}" = "--check" ] || fail "usage: $0 --check [phase]"

  load_notification_env
  validate_percent "DISK_ALERT_WARNING_PERCENT" "$DISK_ALERT_WARNING_PERCENT"
  validate_percent "DISK_ALERT_CRITICAL_PERCENT" "$DISK_ALERT_CRITICAL_PERCENT"
  validate_positive_integer "DISK_ALERT_COOLDOWN_HOURS" "$DISK_ALERT_COOLDOWN_HOURS"

  if [ "$DISK_ALERT_WARNING_PERCENT" -ge "$DISK_ALERT_CRITICAL_PERCENT" ]; then
    fail "DISK_ALERT_WARNING_PERCENT must be lower than DISK_ALERT_CRITICAL_PERCENT"
  fi

  usage="$(current_usage_percent)"
  if [ "$usage" -ge "$DISK_ALERT_CRITICAL_PERCENT" ]; then
    level="CRITICAL"
  elif [ "$usage" -ge "$DISK_ALERT_WARNING_PERCENT" ]; then
    level="WARNING"
  else
    log "disk usage ${usage}% is below warning threshold ${DISK_ALERT_WARNING_PERCENT}%"
    clear_state
    return 0
  fi

  if ! should_notify "$level"; then
    log "${level} disk alert suppressed by cooldown at ${usage}% usage"
    return 0
  fi

  if ! send_resend_alert "$level" "$usage" "$phase"; then
    log "WARNING: ${level} disk alert could not be delivered; it will be retried on the next check"
    return 0
  fi

  write_state "$level" "$usage"
  log "${level} disk capacity alert processed at ${usage}% usage"
}

main "$@"
