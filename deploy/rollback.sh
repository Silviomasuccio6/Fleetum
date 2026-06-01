#!/usr/bin/env bash
set -Eeuo pipefail

# Roll back Fleetum backend to a previous Docker image tag.
# This script handles code-only rollbacks. It does not reverse Prisma migrations.

APP_DIR="${APP_DIR:-/opt/fleetum/app}"
COMPOSE_FILE="${COMPOSE_FILE:-$APP_DIR/docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-/opt/fleetum/env/compose.env}"
LOG_FILE="${ROLLBACK_LOG_FILE:-/opt/fleetum/logs/rollback.log}"
IMAGE_REPOSITORY="${FLEETUM_BACKEND_IMAGE_REPOSITORY:-ghcr.io/silviomasuccio6/fleetum-backend}"
HEALTH_URL="${HEALTH_URL:-https://api.fleetum.it/api/ready}"
MAX_HEALTH_ATTEMPTS="${MAX_HEALTH_ATTEMPTS:-12}"
HEALTH_SLEEP_SECONDS="${HEALTH_SLEEP_SECONDS:-5}"

usage() {
  cat <<USAGE
Usage:
  deploy/rollback.sh <docker-tag-or-full-image>

Examples:
  deploy/rollback.sh abc123def456
  deploy/rollback.sh ghcr.io/silviomasuccio6/fleetum-backend:abc123def456

Environment overrides:
  APP_DIR=$APP_DIR
  COMPOSE_FILE=$COMPOSE_FILE
  ENV_FILE=$ENV_FILE
  HEALTH_URL=$HEALTH_URL
USAGE
}

log() {
  local line="[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [rollback] $*"
  echo "$line" | tee -a "$LOG_FILE"
}

fail() {
  log "ERROR: $*"
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

resolve_image() {
  local tag_or_image="$1"
  if [[ "$tag_or_image" == *"/"*":"* ]]; then
    printf '%s\n' "$tag_or_image"
  else
    printf '%s:%s\n' "$IMAGE_REPOSITORY" "$tag_or_image"
  fi
}

healthcheck() {
  local attempt
  for attempt in $(seq 1 "$MAX_HEALTH_ATTEMPTS"); do
    if curl -fsS --max-time 20 "$HEALTH_URL" >/dev/null; then
      log "healthcheck passed: $HEALTH_URL"
      return 0
    fi
    log "healthcheck attempt $attempt/$MAX_HEALTH_ATTEMPTS failed; retrying in ${HEALTH_SLEEP_SECONDS}s"
    sleep "$HEALTH_SLEEP_SECONDS"
  done
  return 1
}

main() {
  if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ] || [ "$#" -ne 1 ]; then
    usage
    exit 2
  fi

  require_command docker
  require_command curl

  mkdir -p "$(dirname "$LOG_FILE")"
  [ -d "$APP_DIR" ] || fail "APP_DIR not found: $APP_DIR"
  [ -f "$COMPOSE_FILE" ] || fail "COMPOSE_FILE not found: $COMPOSE_FILE"
  [ -f "$ENV_FILE" ] || fail "ENV_FILE not found: $ENV_FILE"

  local target_image
  target_image="$(resolve_image "$1")"

  cd "$APP_DIR"

  local current_image
  current_image="$(docker inspect fleetum_backend --format '{{.Config.Image}}' 2>/dev/null || true)"

  log "starting code-only rollback"
  log "current backend image: ${current_image:-unknown}"
  log "target backend image: $target_image"
  log "compose file: $COMPOSE_FILE"
  log "env file: $ENV_FILE"

  export FLEETUM_BACKEND_IMAGE="$target_image"

  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" pull backend
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" stop backend
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --no-deps backend

  local running_image
  running_image="$(docker inspect fleetum_backend --format '{{.Config.Image}}')"
  if [ "$running_image" != "$target_image" ]; then
    fail "backend image mismatch after rollback: expected=$target_image actual=$running_image"
  fi

  healthcheck || fail "healthcheck failed after rollback"

  log "rollback completed successfully: $target_image"
  log "IMPORTANT: this was code-only rollback; Prisma migrations were not reversed"
}

trap 'fail "unexpected error at line $LINENO"' ERR
main "$@"
