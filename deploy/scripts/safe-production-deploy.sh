#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/fleetum/app}"
COMPOSE_FILE="${COMPOSE_FILE:-$APP_DIR/docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-/opt/fleetum/env/compose.env}"
LAST_DEPLOY_FILE="${LAST_DEPLOY_FILE:-/opt/fleetum/last-deploy.txt}"
DEPLOY_LOCK_FILE="${DEPLOY_LOCK_FILE:-/opt/fleetum/deploy.lock}"
POSTGRES_BACKUP_DIR="${POSTGRES_BACKUP_DIR:-/opt/fleetum/backups/postgres}"
UPLOADS_BACKUP_DIR="${UPLOADS_BACKUP_DIR:-/opt/fleetum/backups/uploads}"
UPLOADS_DIR="${UPLOADS_DIR:-/opt/fleetum/uploads}"
HEALTH_URL="${HEALTH_URL:-https://api.fleetum.it/api/ready}"
FRONTEND_HEALTH_URL="${FRONTEND_HEALTH_URL:-https://fleetum.it/}"
ROBOTS_HEALTH_URL="${ROBOTS_HEALTH_URL:-https://fleetum.it/robots.txt}"
SITEMAP_HEALTH_URL="${SITEMAP_HEALTH_URL:-https://fleetum.it/sitemap.xml}"
LLMS_HEALTH_URL="${LLMS_HEALTH_URL:-https://fleetum.it/llms.txt}"
SOCIAL_PREVIEW_HEALTH_URL="${SOCIAL_PREVIEW_HEALTH_URL:-https://fleetum.it/brand/fleetum-social-preview.png}"
HEALTH_RETRIES="${HEALTH_RETRIES:-12}"
HEALTH_SLEEP_SECONDS="${HEALTH_SLEEP_SECONDS:-5}"
MIN_FREE_DISK_GB="${MIN_FREE_DISK_GB:-10}"
MAX_DISK_USAGE_PERCENT="${MAX_DISK_USAGE_PERCENT:-90}"
DISK_ALERT_WARNING_PERCENT="${DISK_ALERT_WARNING_PERCENT:-80}"
DISK_ALERT_CRITICAL_PERCENT="${DISK_ALERT_CRITICAL_PERCENT:-90}"
DISK_ALERT_COOLDOWN_HOURS="${DISK_ALERT_COOLDOWN_HOURS:-24}"
DISK_ALERT_ENV_FILE="${DISK_ALERT_ENV_FILE:-/opt/fleetum/env/backup.env}"
DISK_ALERT_SCRIPT="${DISK_ALERT_SCRIPT:-$APP_DIR/deploy/scripts/disk-capacity-alert.sh}"
CLEANUP_DOCKER_IMAGES="${CLEANUP_DOCKER_IMAGES:-true}"
DRY_RUN="${DRY_RUN:-false}"

: "${FLEETUM_BACKEND_IMAGE:?FLEETUM_BACKEND_IMAGE is required}"
: "${FLEETUM_FRONTEND_IMAGE:?FLEETUM_FRONTEND_IMAGE is required}"
: "${FLEETUM_RELEASE_SHA:?FLEETUM_RELEASE_SHA is required}"
FLEETUM_BACKEND_RELEASE_TAG="${FLEETUM_BACKEND_RELEASE_TAG:-ghcr.io/silviomasuccio6/fleetum-backend:${FLEETUM_RELEASE_SHA}}"
FLEETUM_FRONTEND_RELEASE_TAG="${FLEETUM_FRONTEND_RELEASE_TAG:-ghcr.io/silviomasuccio6/fleetum-frontend:${FLEETUM_RELEASE_SHA}}"

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

disk_used_percent() {
  df -Pk "$APP_DIR" | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }'
}

format_kib_as_gib() {
  awk -v kib="$1" 'BEGIN { printf "%.1f", kib / 1024 / 1024 }'
}

validate_positive_integer() {
  local name="$1"
  local value="$2"

  if ! [[ "$value" =~ ^[1-9][0-9]*$ ]]; then
    log "$name must be a positive integer, received: $value"
    exit 2
  fi
}

validate_percent() {
  local name="$1"
  local value="$2"

  if ! [[ "$value" =~ ^[1-9][0-9]?$|^100$ ]]; then
    log "$name must be an integer between 1 and 100, received: $value"
    exit 2
  fi
}

validate_release_identity() {
  if ! [[ "$FLEETUM_RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]]; then
    log "FLEETUM_RELEASE_SHA must be a full lowercase Git commit SHA"
    exit 2
  fi

  case "$FLEETUM_BACKEND_IMAGE" in
    "ghcr.io/silviomasuccio6/fleetum-backend:${FLEETUM_RELEASE_SHA}"|ghcr.io/silviomasuccio6/fleetum-backend@sha256:*) ;;
    *)
      log "FLEETUM_BACKEND_IMAGE must be the Fleetum backend image for the selected release"
      exit 2
      ;;
  esac

  case "$FLEETUM_FRONTEND_IMAGE" in
    "ghcr.io/silviomasuccio6/fleetum-frontend:${FLEETUM_RELEASE_SHA}"|ghcr.io/silviomasuccio6/fleetum-frontend@sha256:*) ;;
    *)
      log "FLEETUM_FRONTEND_IMAGE must be the Fleetum frontend image for the selected release"
      exit 2
      ;;
  esac

  if [[ "$FLEETUM_BACKEND_IMAGE" == *@sha256:* ]] && ! [[ "$FLEETUM_BACKEND_IMAGE" =~ @sha256:[0-9a-f]{64}$ ]]; then
    log "FLEETUM_BACKEND_IMAGE contains an invalid digest"
    exit 2
  fi

  if [[ "$FLEETUM_FRONTEND_IMAGE" == *@sha256:* ]] && ! [[ "$FLEETUM_FRONTEND_IMAGE" =~ @sha256:[0-9a-f]{64}$ ]]; then
    log "FLEETUM_FRONTEND_IMAGE contains an invalid digest"
    exit 2
  fi

  if [ "$FLEETUM_BACKEND_RELEASE_TAG" != "ghcr.io/silviomasuccio6/fleetum-backend:${FLEETUM_RELEASE_SHA}" ]; then
    log "FLEETUM_BACKEND_RELEASE_TAG must match the selected release SHA"
    exit 2
  fi

  if [ "$FLEETUM_FRONTEND_RELEASE_TAG" != "ghcr.io/silviomasuccio6/fleetum-frontend:${FLEETUM_RELEASE_SHA}" ]; then
    log "FLEETUM_FRONTEND_RELEASE_TAG must match the selected release SHA"
    exit 2
  fi
}

verify_image_matches_release_tag() {
  local deployment_image="$1"
  local release_tag="$2"
  local label="$3"
  local deployment_id release_tag_id

  if [ "$deployment_image" = "$release_tag" ]; then
    return 0
  fi

  run docker pull "$release_tag"
  if [ "$DRY_RUN" = "true" ]; then
    return 0
  fi

  deployment_id="$(docker image inspect --format '{{.Id}}' "$deployment_image" 2>/dev/null || true)"
  release_tag_id="$(docker image inspect --format '{{.Id}}' "$release_tag" 2>/dev/null || true)"
  if [ -z "$deployment_id" ] || [ "$deployment_id" != "$release_tag_id" ]; then
    log "ERROR: $label deployment digest does not match the image tagged for release $FLEETUM_RELEASE_SHA"
    return 1
  fi

  log "$label digest verified against release tag"
}

acquire_deploy_lock() {
  run mkdir -p "$(dirname "$DEPLOY_LOCK_FILE")"

  if [ "$DRY_RUN" = "true" ]; then
    log "dry-run would acquire deploy lock: $DEPLOY_LOCK_FILE"
    return 0
  fi

  if [ "${DEPLOY_LOCK_HELD:-false}" = "true" ]; then
    if ! flock -n 9; then
      log "ERROR: inherited deploy lock is missing or invalid"
      exit 3
    fi
    log "using inherited deploy lock: $DEPLOY_LOCK_FILE"
    return 0
  fi

  exec 9>"$DEPLOY_LOCK_FILE"
  if ! flock -n 9; then
    log "ERROR: another Fleetum deploy or rollback is already running"
    exit 3
  fi
}

report_disk_state() {
  local phase="$1"

  log "disk report: $phase"
  df -h "$APP_DIR" || true
  docker system df || true
}

check_disk_alert_thresholds() {
  local phase="$1"

  if [ ! -x "$DISK_ALERT_SCRIPT" ]; then
    log "WARNING: disk alert script is missing or not executable: $DISK_ALERT_SCRIPT"
    return 0
  fi

  if ! APP_DIR="$APP_DIR" \
    DISK_ALERT_ENV_FILE="$DISK_ALERT_ENV_FILE" \
    DISK_ALERT_WARNING_PERCENT="$DISK_ALERT_WARNING_PERCENT" \
    DISK_ALERT_CRITICAL_PERCENT="$DISK_ALERT_CRITICAL_PERCENT" \
    DISK_ALERT_COOLDOWN_HOURS="$DISK_ALERT_COOLDOWN_HOURS" \
    DRY_RUN="$DRY_RUN" \
    "$DISK_ALERT_SCRIPT" --check "$phase"; then
    log "WARNING: disk alert check failed; deploy safety checks remain active"
  fi
}

is_fleetum_application_image() {
  case "$1" in
    ghcr.io/silviomasuccio6/fleetum-backend:*|ghcr.io/silviomasuccio6/fleetum-frontend:*|ghcr.io/silviomasuccio6/fleetum-backend@sha256:*|ghcr.io/silviomasuccio6/fleetum-frontend@sha256:*)
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
  append_protected_image "$FLEETUM_BACKEND_RELEASE_TAG"
  append_protected_image "$FLEETUM_FRONTEND_RELEASE_TAG"
  append_protected_image "ghcr.io/silviomasuccio6/fleetum-backend:latest"
  append_protected_image "ghcr.io/silviomasuccio6/fleetum-frontend:latest"

  if [ -f "$LAST_DEPLOY_FILE" ]; then
    while IFS= read -r release_image; do
      append_protected_image "$release_image"
    done < <(
      awk -F= '
        /^(PREVIOUS|NEW)_(BACKEND|FRONTEND)_IMAGE=ghcr\.io\/silviomasuccio6\/fleetum-(backend|frontend)(:|@sha256:)/ {
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
  local available_kib required_kib available_gib used_percent

  validate_positive_integer "MIN_FREE_DISK_GB" "$MIN_FREE_DISK_GB"
  validate_percent "MAX_DISK_USAGE_PERCENT" "$MAX_DISK_USAGE_PERCENT"

  available_kib="$(disk_available_kib)"
  required_kib=$((MIN_FREE_DISK_GB * 1024 * 1024))
  available_gib="$(format_kib_as_gib "$available_kib")"
  used_percent="$(disk_used_percent)"

  log "disk before $phase: ${used_percent}% used, ${available_gib} GiB free (minimum: ${MIN_FREE_DISK_GB} GiB; maximum usage: ${MAX_DISK_USAGE_PERCENT}%)"
  if [ "$available_kib" -lt "$required_kib" ]; then
    log "ERROR: insufficient disk space before $phase. Free Docker storage or expand the VPS disk, then retry."
    report_disk_state "insufficient space before $phase"
    exit 1
  fi

  if [ "$used_percent" -ge "$MAX_DISK_USAGE_PERCENT" ]; then
    log "ERROR: filesystem usage is above the configured deployment limit before $phase. Free Docker storage or expand the VPS disk, then retry."
    report_disk_state "usage limit exceeded before $phase"
    exit 1
  fi
}

save_current_release() {
  local current_backend current_frontend state_tmp
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
  state_tmp="$(mktemp "${LAST_DEPLOY_FILE}.tmp.XXXXXX")"
  cat > "$state_tmp" <<STATE
PREVIOUS_BACKEND_IMAGE=$current_backend
PREVIOUS_FRONTEND_IMAGE=$current_frontend
NEW_BACKEND_IMAGE=$FLEETUM_BACKEND_IMAGE
NEW_FRONTEND_IMAGE=$FLEETUM_FRONTEND_IMAGE
RELEASE_SHA=$FLEETUM_RELEASE_SHA
CI_RUN_ID=${FLEETUM_CI_RUN_ID:-}
DEPLOY_RUN_ID=${FLEETUM_DEPLOY_RUN_ID:-}
DEPLOY_STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
STATE
  mv "$state_tmp" "$LAST_DEPLOY_FILE"
}

mark_release_completed() {
  local state_tmp

  if [ "$DRY_RUN" = "true" ]; then
    log "dry-run would record successful release completion"
    return 0
  fi

  state_tmp="$(mktemp "${LAST_DEPLOY_FILE}.tmp.XXXXXX")"
  cat "$LAST_DEPLOY_FILE" > "$state_tmp"
  printf 'DEPLOY_COMPLETED_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$state_tmp"
  mv "$state_tmp" "$LAST_DEPLOY_FILE"
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

check_release_health() {
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
}

rollback_after_failed_release() {
  local failure_phase="$1"

  log "$failure_phase, starting application rollback (database restore is never automatic)"
  APP_DIR="$APP_DIR" \
    COMPOSE_FILE="$COMPOSE_FILE" \
    ENV_FILE="$ENV_FILE" \
    LAST_DEPLOY_FILE="$LAST_DEPLOY_FILE" \
    DEPLOY_LOCK_FILE="$DEPLOY_LOCK_FILE" \
    DEPLOY_LOCK_HELD=true \
    HEALTH_URL="$HEALTH_URL" \
    FRONTEND_HEALTH_URL="$FRONTEND_HEALTH_URL" \
    ROBOTS_HEALTH_URL="$ROBOTS_HEALTH_URL" \
    SITEMAP_HEALTH_URL="$SITEMAP_HEALTH_URL" \
    LLMS_HEALTH_URL="$LLMS_HEALTH_URL" \
    SOCIAL_PREVIEW_HEALTH_URL="$SOCIAL_PREVIEW_HEALTH_URL" \
    HEALTH_RETRIES="$HEALTH_RETRIES" \
    HEALTH_SLEEP_SECONDS="$HEALTH_SLEEP_SECONDS" \
    DRY_RUN="$DRY_RUN" \
    "$APP_DIR/deploy/scripts/rollback-production.sh"
}

main() {
  cd "$APP_DIR"

  validate_release_identity
  acquire_deploy_lock

  # Keep the active release, rollback release and target image while reclaiming stale layers.
  cleanup_docker_storage "image pull"
  check_disk_alert_thresholds "pre-pull"
  ensure_minimum_disk_space "image pull"

  export FLEETUM_BACKEND_IMAGE
  export FLEETUM_FRONTEND_IMAGE

  log "pulling target images"
  if ! run docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" pull; then
    report_disk_state "failed image pull"
    check_disk_alert_thresholds "failed-image-pull"
    exit 1
  fi

  if ! verify_image_matches_release_tag "$FLEETUM_BACKEND_IMAGE" "$FLEETUM_BACKEND_RELEASE_TAG" "backend" ||
    ! verify_image_matches_release_tag "$FLEETUM_FRONTEND_IMAGE" "$FLEETUM_FRONTEND_RELEASE_TAG" "frontend"; then
    report_disk_state "release image identity mismatch"
    exit 1
  fi

  save_current_release

  check_disk_alert_thresholds "post-pull"
  ensure_minimum_disk_space "database and uploads backup"
  backup_before_migration
  # Backups can consume storage; never migrate if the remaining capacity is unsafe.
  check_disk_alert_thresholds "pre-migration"
  ensure_minimum_disk_space "Prisma migration"

  log "running Prisma migrations"
  run docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" run --rm backend \
    sh -lc 'if [ -n "${DIRECT_URL:-}" ]; then export DATABASE_URL="$DIRECT_URL"; fi; npx prisma migrate deploy --schema prisma/schema.prisma'

  log "reconciling exact monetary shadow columns"
  run docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" run --rm backend \
    sh -lc 'if [ -n "${DIRECT_URL:-}" ]; then export DATABASE_URL="$DIRECT_URL"; fi; npm run money:reconcile:prod'

  log "restarting production containers"
  if run docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --no-build; then
    log "production container restart command completed"
  else
    restart_status=$?
    log "ERROR: production container restart failed with status $restart_status"
    report_disk_state "failed container restart"
    if ! rollback_after_failed_release "container restart failed"; then
      log "CRITICAL: application rollback also failed; production requires operator intervention"
    fi
    exit "$restart_status"
  fi

  if ! check_release_health; then
    if ! rollback_after_failed_release "post-deploy release health checks failed"; then
      log "CRITICAL: application rollback also failed; production requires operator intervention"
    fi
    exit 1
  fi

  mark_release_completed

  # A successful deploy is the safest point to remove stale Fleetum release images.
  cleanup_docker_storage "post-deploy maintenance"
  report_disk_state "post-deploy"
  check_disk_alert_thresholds "post-deploy"

  log "deploy completed successfully"
}

main "$@"
