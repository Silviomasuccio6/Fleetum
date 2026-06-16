#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/fleetum/app}"
COMPOSE_FILE="${COMPOSE_FILE:-$APP_DIR/docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-/opt/fleetum/env/compose.env}"
LAST_DEPLOY_FILE="${LAST_DEPLOY_FILE:-/opt/fleetum/last-deploy.txt}"
POSTGRES_BACKUP_DIR="${POSTGRES_BACKUP_DIR:-/opt/fleetum/backups/postgres}"
UPLOADS_BACKUP_DIR="${UPLOADS_BACKUP_DIR:-/opt/fleetum/backups/uploads}"
UPLOADS_DIR="${UPLOADS_DIR:-/opt/fleetum/uploads}"
HEALTH_URL="${HEALTH_URL:-https://api.fleetum.it/api/ready}"
HEALTH_RETRIES="${HEALTH_RETRIES:-12}"
HEALTH_SLEEP_SECONDS="${HEALTH_SLEEP_SECONDS:-5}"
DRY_RUN="${DRY_RUN:-false}"

: "${FLEETUM_BACKEND_IMAGE:?FLEETUM_BACKEND_IMAGE is required}"
: "${FLEETUM_FRONTEND_IMAGE:?FLEETUM_FRONTEND_IMAGE is required}"

log() {
  printf '[safe-production-deploy] %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

run() {
  log "+ $*"
  if [ "$DRY_RUN" = "true" ]; then
    return 0
  fi
  "$@"
}

current_container_image() {
  local container_name="$1"
  if [ "$DRY_RUN" = "true" ]; then
    printf 'dry-run/%s:previous\n' "$container_name"
    return 0
  fi

  docker inspect --format '{{.Config.Image}}' "$container_name" 2>/dev/null || true
}

save_current_release() {
  local current_backend current_frontend
  current_backend="$(current_container_image fleetum_backend)"
  current_frontend="$(current_container_image fleetum_caddy)"

  if [ -z "$current_backend" ]; then
    current_backend="ghcr.io/silviomasuccio6/fleetum-backend:latest"
  fi
  if [ -z "$current_frontend" ]; then
    current_frontend="ghcr.io/silviomasuccio6/fleetum-frontend:latest"
  fi

  log "saving current release to $LAST_DEPLOY_FILE"
  run mkdir -p "$(dirname "$LAST_DEPLOY_FILE")"

  if [ "$DRY_RUN" = "true" ]; then
    log "dry-run would write previous backend=$current_backend frontend=$current_frontend"
    return 0
  fi

  umask 077
  cat > "$LAST_DEPLOY_FILE" <<STATE
PREVIOUS_BACKEND_IMAGE=$current_backend
PREVIOUS_FRONTEND_IMAGE=$current_frontend
NEW_BACKEND_IMAGE=$FLEETUM_BACKEND_IMAGE
NEW_FRONTEND_IMAGE=$FLEETUM_FRONTEND_IMAGE
DEPLOY_STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
STATE
}

backup_before_migration() {
  log "running mandatory database backup"
  run env \
    COMPOSE_FILE="$COMPOSE_FILE" \
    ENV_FILE="$ENV_FILE" \
    BACKUP_DIR="$POSTGRES_BACKUP_DIR" \
    "$APP_DIR/deploy/backup/backup-postgres.sh"

  log "running mandatory uploads backup"
  run env \
    UPLOADS_DIR="$UPLOADS_DIR" \
    BACKUP_DIR="$UPLOADS_BACKUP_DIR" \
    "$APP_DIR/deploy/backup/backup-uploads.sh"
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

  return 1
}

rollback_after_failed_health() {
  log "post-deploy health failed, starting application rollback"
  APP_DIR="$APP_DIR" \
    COMPOSE_FILE="$COMPOSE_FILE" \
    ENV_FILE="$ENV_FILE" \
    LAST_DEPLOY_FILE="$LAST_DEPLOY_FILE" \
    HEALTH_URL="$HEALTH_URL" \
    HEALTH_RETRIES="$HEALTH_RETRIES" \
    HEALTH_SLEEP_SECONDS="$HEALTH_SLEEP_SECONDS" \
    DRY_RUN="$DRY_RUN" \
    "$APP_DIR/deploy/scripts/rollback-production.sh"
}

main() {
  cd "$APP_DIR"

  save_current_release

  export FLEETUM_BACKEND_IMAGE
  export FLEETUM_FRONTEND_IMAGE

  log "pulling target images"
  run docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" pull

  backup_before_migration

  log "running Prisma migrations"
  run docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" run --rm backend \
    sh -lc 'if [ -n "${DIRECT_URL:-}" ]; then export DATABASE_URL="$DIRECT_URL"; fi; npx prisma migrate deploy --schema prisma/schema.prisma'

  log "restarting production containers"
  run docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --no-build

  if ! check_health; then
    rollback_after_failed_health
    exit 1
  fi

  log "deploy completed successfully"
}

main "$@"
