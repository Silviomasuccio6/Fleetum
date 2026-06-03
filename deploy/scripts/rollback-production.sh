#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/fleetum/app}"
COMPOSE_FILE="${COMPOSE_FILE:-$APP_DIR/docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-/opt/fleetum/env/compose.env}"
LAST_DEPLOY_FILE="${LAST_DEPLOY_FILE:-/opt/fleetum/last-deploy.txt}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:4000/api/ready}"
HEALTH_RETRIES="${HEALTH_RETRIES:-12}"
HEALTH_SLEEP_SECONDS="${HEALTH_SLEEP_SECONDS:-5}"
DRY_RUN="${DRY_RUN:-false}"

log() {
  printf '[rollback-production] %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

run() {
  log "+ $*"
  if [ "$DRY_RUN" = "true" ]; then
    return 0
  fi
  "$@"
}

load_last_deploy() {
  if [ ! -f "$LAST_DEPLOY_FILE" ]; then
    log "last deploy file not found: $LAST_DEPLOY_FILE"
    exit 2
  fi

  # shellcheck disable=SC1090
  . "$LAST_DEPLOY_FILE"

  if [ -z "${PREVIOUS_BACKEND_IMAGE:-}" ] || [ -z "${PREVIOUS_FRONTEND_IMAGE:-}" ]; then
    log "last deploy file is missing PREVIOUS_BACKEND_IMAGE or PREVIOUS_FRONTEND_IMAGE"
    exit 2
  fi
}

check_health() {
  local attempt
  for attempt in $(seq 1 "$HEALTH_RETRIES"); do
    if [ "$DRY_RUN" = "true" ]; then
      log "dry-run health check skipped: $HEALTH_URL"
      return 0
    fi

    if curl -fsS --max-time 20 "$HEALTH_URL" >/dev/null; then
      log "health check passed: $HEALTH_URL"
      return 0
    fi

    log "health check attempt $attempt/$HEALTH_RETRIES failed"
    sleep "$HEALTH_SLEEP_SECONDS"
  done

  log "health check failed after rollback"
  return 1
}

main() {
  load_last_deploy
  cd "$APP_DIR"

  export FLEETUM_BACKEND_IMAGE="$PREVIOUS_BACKEND_IMAGE"
  export FLEETUM_FRONTEND_IMAGE="$PREVIOUS_FRONTEND_IMAGE"

  log "rolling back backend image to $FLEETUM_BACKEND_IMAGE"
  log "rolling back frontend image to $FLEETUM_FRONTEND_IMAGE"

  run docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" pull
  run docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --no-build
  check_health

  log "rollback completed"
}

main "$@"
