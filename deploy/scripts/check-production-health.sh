#!/usr/bin/env bash
set -euo pipefail

HEALTH_URL="${HEALTH_URL:-https://api.fleetum.it/api/ready}"
FRONTEND_HEALTH_URL="${FRONTEND_HEALTH_URL:-https://fleetum.it/}"
ROBOTS_HEALTH_URL="${ROBOTS_HEALTH_URL:-https://fleetum.it/robots.txt}"
SITEMAP_HEALTH_URL="${SITEMAP_HEALTH_URL:-https://fleetum.it/sitemap.xml}"
LLMS_HEALTH_URL="${LLMS_HEALTH_URL:-https://fleetum.it/llms.txt}"
SOCIAL_PREVIEW_HEALTH_URL="${SOCIAL_PREVIEW_HEALTH_URL:-https://fleetum.it/brand/fleetum-social-preview.png}"
HEALTH_RETRIES="${HEALTH_RETRIES:-12}"
HEALTH_SLEEP_SECONDS="${HEALTH_SLEEP_SECONDS:-5}"
DRY_RUN="${DRY_RUN:-false}"

log() {
  printf '[production-health] %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

check_backend() {
  local attempt
  for attempt in $(seq 1 "$HEALTH_RETRIES"); do
    if [ "$DRY_RUN" = "true" ]; then
      log "dry-run backend readiness check skipped: $HEALTH_URL"
      return 0
    fi

    if curl -fsS --max-time 20 "$HEALTH_URL" >/dev/null; then
      log "backend readiness check passed: $HEALTH_URL"
      return 0
    fi

    log "backend readiness check attempt $attempt/$HEALTH_RETRIES failed"
    sleep "$HEALTH_SLEEP_SECONDS"
  done
  return 1
}

check_body_contains() {
  local label="$1"
  local url="$2"
  local expected="$3"
  local attempt body

  for attempt in $(seq 1 "$HEALTH_RETRIES"); do
    if [ "$DRY_RUN" = "true" ]; then
      log "dry-run $label check skipped: $url"
      return 0
    fi

    if body="$(curl -fsS --max-time 20 "$url" 2>/dev/null)" && printf '%s' "$body" | grep -Fq -- "$expected"; then
      log "$label check passed: $url"
      return 0
    fi

    log "$label check attempt $attempt/$HEALTH_RETRIES failed"
    sleep "$HEALTH_SLEEP_SECONDS"
  done
  return 1
}

check_header_contains() {
  local label="$1"
  local url="$2"
  local expected="$3"
  local attempt headers

  for attempt in $(seq 1 "$HEALTH_RETRIES"); do
    if [ "$DRY_RUN" = "true" ]; then
      log "dry-run $label check skipped: $url"
      return 0
    fi

    if headers="$(curl -fsSI --max-time 20 "$url" 2>/dev/null)" && printf '%s' "$headers" | grep -Fiq -- "$expected"; then
      log "$label check passed: $url"
      return 0
    fi

    log "$label check attempt $attempt/$HEALTH_RETRIES failed"
    sleep "$HEALTH_SLEEP_SECONDS"
  done
  return 1
}

main() {
  check_backend &&
    check_body_contains "frontend" "$FRONTEND_HEALTH_URL" "Fleetum" &&
    check_body_contains "robots" "$ROBOTS_HEALTH_URL" "Sitemap" &&
    check_body_contains "sitemap" "$SITEMAP_HEALTH_URL" "fleetum.it/demo" &&
    check_body_contains "llms" "$LLMS_HEALTH_URL" "# Fleetum" &&
    check_header_contains "social preview" "$SOCIAL_PREVIEW_HEALTH_URL" "content-type: image/png"
}

main "$@"
