#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/fleetum/app}"
COMPOSE_FILE="${COMPOSE_FILE:-$APP_DIR/docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-/opt/fleetum/env/compose.env}"
LAST_DEPLOY_FILE="${LAST_DEPLOY_FILE:-/opt/fleetum/last-deploy.txt}"
DEPLOY_LOCK_FILE="${DEPLOY_LOCK_FILE:-/opt/fleetum/deploy.lock}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:4000/api/ready}"
FRONTEND_HEALTH_URL="${FRONTEND_HEALTH_URL:-https://fleetum.it/}"
ROBOTS_HEALTH_URL="${ROBOTS_HEALTH_URL:-https://fleetum.it/robots.txt}"
SITEMAP_HEALTH_URL="${SITEMAP_HEALTH_URL:-https://fleetum.it/sitemap.xml}"
LLMS_HEALTH_URL="${LLMS_HEALTH_URL:-https://fleetum.it/llms.txt}"
SOCIAL_PREVIEW_HEALTH_URL="${SOCIAL_PREVIEW_HEALTH_URL:-https://fleetum.it/brand/fleetum-social-preview.png}"
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

  PREVIOUS_BACKEND_IMAGE="$(awk -F= '$1 == "PREVIOUS_BACKEND_IMAGE" { print substr($0, index($0, "=") + 1); exit }' "$LAST_DEPLOY_FILE")"
  PREVIOUS_FRONTEND_IMAGE="$(awk -F= '$1 == "PREVIOUS_FRONTEND_IMAGE" { print substr($0, index($0, "=") + 1); exit }' "$LAST_DEPLOY_FILE")"

  if [ -z "${PREVIOUS_BACKEND_IMAGE:-}" ] || [ -z "${PREVIOUS_FRONTEND_IMAGE:-}" ]; then
    log "last deploy file is missing PREVIOUS_BACKEND_IMAGE or PREVIOUS_FRONTEND_IMAGE"
    exit 2
  fi

  if ! [[ "$PREVIOUS_BACKEND_IMAGE" =~ ^ghcr\.io/silviomasuccio6/fleetum-backend:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$|^ghcr\.io/silviomasuccio6/fleetum-backend@sha256:[0-9a-f]{64}$ ]]; then
    log "last deploy file contains an invalid previous backend image"
    exit 2
  fi

  if ! [[ "$PREVIOUS_FRONTEND_IMAGE" =~ ^ghcr\.io/silviomasuccio6/fleetum-frontend:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$|^ghcr\.io/silviomasuccio6/fleetum-frontend@sha256:[0-9a-f]{64}$ ]]; then
    log "last deploy file contains an invalid previous frontend image"
    exit 2
  fi
}

acquire_rollback_lock() {
  if [ "$DRY_RUN" = "true" ]; then
    return 0
  fi

  if [ "${DEPLOY_LOCK_HELD:-false}" = "true" ]; then
    if ! flock -n 9; then
      log "ERROR: inherited deploy lock is missing or invalid"
      exit 3
    fi
    return 0
  fi

  mkdir -p "$(dirname "$DEPLOY_LOCK_FILE")"
  exec 9>"$DEPLOY_LOCK_FILE"
  if ! flock -n 9; then
    log "ERROR: another Fleetum deploy or rollback is already running"
    exit 3
  fi
}

main() {
  acquire_rollback_lock
  load_last_deploy
  cd "$APP_DIR"

  export FLEETUM_BACKEND_IMAGE="$PREVIOUS_BACKEND_IMAGE"
  export FLEETUM_FRONTEND_IMAGE="$PREVIOUS_FRONTEND_IMAGE"

  log "rolling back backend image to $FLEETUM_BACKEND_IMAGE"
  log "rolling back frontend image to $FLEETUM_FRONTEND_IMAGE"

  run docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" pull
  run docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --no-build
  HEALTH_URL="$HEALTH_URL" \
    FRONTEND_HEALTH_URL="$FRONTEND_HEALTH_URL" \
    ROBOTS_HEALTH_URL="$ROBOTS_HEALTH_URL" \
    SITEMAP_HEALTH_URL="$SITEMAP_HEALTH_URL" \
    LLMS_HEALTH_URL="$LLMS_HEALTH_URL" \
    SOCIAL_PREVIEW_HEALTH_URL="$SOCIAL_PREVIEW_HEALTH_URL" \
    HEALTH_RETRIES="$HEALTH_RETRIES" \
    HEALTH_SLEEP_SECONDS="$HEALTH_SLEEP_SECONDS" \
    DRY_RUN="$DRY_RUN" \
    "$APP_DIR/deploy/scripts/check-production-health.sh"

  log "rollback completed"
}

main "$@"
