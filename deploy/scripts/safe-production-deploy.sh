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
MIN_FREE_DISK_GB="${MIN_FREE_DISK_GB:-10}"
CLEANUP_DOCKER_IMAGES="${CLEANUP_DOCKER_IMAGES:-true}"
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

disk_available_kib() {
  df -Pk "$APP_DIR" | awk 'NR == 2 { print $4 }'
}

format_kib_as_gib() {
  awk -v kib="$1" 'BEGIN { printf "%.1f", kib / 1024 / 1024 }'
}

is_fleetum_application_image() {
  case "$1" in
    ghcr.io/silviomasuccio6/fleetum-backend:*|ghcr.io/silviomasuccio6/fleetum-frontend:*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

append_protected_image() {
  local image="$1"
  if [ -n "$image" ] && is_fleetum_application_image "$image"; then
    PROTECTED_IMAGES+=("$image")
  fi
}

is_protected_image() {
  local image="$1"
  local protected
  for protected in "${PROTECTED_IMAGES[@]}"; do
    if [ "$image" = "$protected" ]; then
      return 0
    fi
  done
  return 1
}

load_protected_images() {
  local release_image

  PROTECTED_IMAGES=()
  append_protected_image "$(current_container_image fleetum_backend)"
  append_protected_image "$(current_container_image fleetum_caddy)"
  append_protected_image "$FLEETUM_BACKEND_IMAGE"
  append_protected_image "$FLEETUM_FRONTEND_IMAGE"
  append_protected_image "ghcr.io/silviomasuccio6/fleetum-backend:latest"
  append_protected_image "ghcr.io/silviomasuccio6/fleetum-frontend:latest"

  if [ -f "$LAST_DEPLOY_FILE" ]; then
    while IFS= read -r release_image; do
      append_protected_image "$release_image"
    done < <(
      awk -F= '
        /^(PREVIOUS|NEW)_(BACKEND|FRONTEND)_IMAGE=ghcr\.io\/silviomasuccio6\/fleetum-(backend|frontend):/ {
          print $2
        }
      ' "$LAST_DEPLOY_FILE"
    )
  fi
}

cleanup_docker_storage() {
  local phase="$1"
  local image

  if [ "$CLEANUP_DOCKER_IMAGES" != "true" ]; then
    log "Docker image cleanup disabled for $phase"
    return 0
  fi

  if [ "$DRY_RUN" = "true" ]; then
    log "dry-run would prune Docker build cache, dangling layers and obsolete Fleetum images before $phase"
    return 0
  fi

  load_protected_images
  log "pruning unused Docker build cache before $phase"
  docker builder prune -af

  while IFS= read -r image; do
    if ! is_fleetum_application_image "$image" || is_protected_image "$image"; then
      continue
    fi

    log "removing obsolete Fleetum image tag: $image"
    if ! docker image rm "$image"; then
      log "unable to remove image tag (it may still be referenced): $image"
    fi
  done < <(docker image ls --format '{{.Repository}}:{{.Tag}}')

  log "pruning dangling Docker image layers before $phase"
  docker image prune -f
}

ensure_minimum_disk_space() {
  local phase="$1"
  local available_kib required_kib available_gib

  if ! [[ "$MIN_FREE_DISK_GB" =~ ^[1-9][0-9]*$ ]]; then
    log "MIN_FREE_DISK_GB must be a positive integer, received: $MIN_FREE_DISK_GB"
    exit 2
  fi

  available_kib="$(disk_available_kib)"
  required_kib=$((MIN_FREE_DISK_GB * 1024 * 1024))
  available_gib="$(format_kib_as_gib "$available_kib")"

  log "available disk before $phase: ${available_gib} GiB (minimum: ${MIN_FREE_DISK_GB} GiB)"
  if [ "$available_kib" -lt "$required_kib" ]; then
    log "ERROR: insufficient disk space before $phase. Free Docker storage or expand the VPS disk, then retry."
    docker system df || true
    exit 1
  fi
}

save_current_release() {
  local current_backend current_frontend
  current_backend="$(current_container_image fleetum_backend)"
  current_frontend="$(current_container_image fleetum_caddy)"

  if [ -z "$current_backend" ] || [ -z "$current_frontend" ]; then
    log "ERROR: cannot determine the currently deployed immutable images; refusing an unsafe deploy"
    return 1
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

  # Keep the active release, rollback release and target image while reclaiming stale layers.
  cleanup_docker_storage "image pull"
  ensure_minimum_disk_space "image pull"

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

  # A successful deploy is the safest point to remove stale Fleetum release images.
  cleanup_docker_storage "post-deploy maintenance"

  log "deploy completed successfully"
}

main "$@"
