#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${FLEETUM_APP_DIR:-/opt/fleetum}"
COMPOSE_FILE="${FLEETUM_COMPOSE_FILE:-$APP_DIR/docker-compose.prod.yml}"
COMPOSE_ENV_FILE="${FLEETUM_COMPOSE_ENV_FILE:-/opt/fleetum/env/compose.env}"
HEALTH_URL="${FLEETUM_HEALTH_URL:-http://127.0.0.1:4000/api/health}"
LOG_FILE="${FLEETUM_ROLLBACK_LOG:-/opt/fleetum/logs/rollback.log}"
BACKEND_IMAGE="${1:-}"
FRONTEND_IMAGE="${2:-}"

if [[ -z "$BACKEND_IMAGE" || -z "$FRONTEND_IMAGE" ]]; then
  echo "Usage: $0 <backend-image> <frontend-image>" >&2
  exit 64
fi

mkdir -p "$(dirname "$COMPOSE_ENV_FILE")" "$(dirname "$LOG_FILE")"
touch "$COMPOSE_ENV_FILE"

log() {
  printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$LOG_FILE"
}

upsert_env() {
  local key="$1"
  local value="$2"
  local tmp
  tmp="$(mktemp)"
  if grep -q "^${key}=" "$COMPOSE_ENV_FILE"; then
    sed "s|^${key}=.*|${key}=${value}|" "$COMPOSE_ENV_FILE" > "$tmp"
  else
    cat "$COMPOSE_ENV_FILE" > "$tmp"
    printf '%s=%s\n' "$key" "$value" >> "$tmp"
  fi
  cat "$tmp" > "$COMPOSE_ENV_FILE"
  rm -f "$tmp"
}

log "Starting rollback to backend=$BACKEND_IMAGE frontend=$FRONTEND_IMAGE"
upsert_env "FLEETUM_BACKEND_IMAGE" "$BACKEND_IMAGE"
upsert_env "FLEETUM_FRONTEND_IMAGE" "$FRONTEND_IMAGE"

cd "$APP_DIR"
docker compose --env-file "$COMPOSE_ENV_FILE" -f "$COMPOSE_FILE" pull backend caddy
docker compose --env-file "$COMPOSE_ENV_FILE" -f "$COMPOSE_FILE" up -d --no-build backend caddy
sleep 15
curl -sf "$HEALTH_URL" >/dev/null
log "Rollback completed and health check passed"
