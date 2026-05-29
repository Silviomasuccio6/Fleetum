#!/usr/bin/env bash
set -euo pipefail

BACKUP_FILE="${BACKUP_FILE:-}"
BACKUP_SEARCH_DIR="${BACKUP_SEARCH_DIR:-/opt/fleetum/backups/postgres}"
LEGACY_BACKUP_SEARCH_DIR="${LEGACY_BACKUP_SEARCH_DIR:-/opt/fleetum/backups}"
POSTGRES_IMAGE="${POSTGRES_IMAGE:-postgres:16-alpine}"
TEST_CONTAINER="${TEST_CONTAINER:-fleetum_restore_test_postgres}"
TEST_DB="${TEST_DB:-fleetum_restore_test}"
TEST_USER="${TEST_USER:-fleetum_restore_test}"
TEST_PASSWORD="${TEST_PASSWORD:-fleetum_restore_test_password}"
VERIFY_TABLE="${VERIFY_TABLE:-_prisma_migrations}"
KEEP_CONTAINER="${KEEP_CONTAINER:-false}"
COMPAT_ROLES="${COMPAT_ROLES:-fleetum}"
BACKUP_CANDIDATES=""

cleanup() {
  if [ -n "$BACKUP_CANDIDATES" ]; then
    rm -f "$BACKUP_CANDIDATES"
  fi

  if [ "$KEEP_CONTAINER" != "true" ]; then
    docker rm -f "$TEST_CONTAINER" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if [ -z "$BACKUP_FILE" ]; then
  BACKUP_CANDIDATES="$(mktemp)"

  find "$BACKUP_SEARCH_DIR" "$LEGACY_BACKUP_SEARCH_DIR" \
    -maxdepth 1 \
    -type f \
    \( -name 'fleetum-postgres-*.sql.gz' -o -name 'fleetum_*.sql.gz' \) \
    > "$BACKUP_CANDIDATES" 2>/dev/null || true

  BACKUP_FILE="$(sort "$BACKUP_CANDIDATES" | tail -1)"
fi

if [ -z "$BACKUP_FILE" ] || [ ! -f "$BACKUP_FILE" ]; then
  echo "[restore-test] backup file not found. Set BACKUP_FILE=/path/to/dump.sql.gz" >&2
  exit 2
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "[restore-test] docker command not found" >&2
  exit 2
fi

echo "[restore-test] using backup: $BACKUP_FILE"
gzip -t "$BACKUP_FILE"

docker rm -f "$TEST_CONTAINER" >/dev/null 2>&1 || true

docker run -d \
  --name "$TEST_CONTAINER" \
  -e POSTGRES_DB="$TEST_DB" \
  -e POSTGRES_USER="$TEST_USER" \
  -e POSTGRES_PASSWORD="$TEST_PASSWORD" \
  "$POSTGRES_IMAGE" >/dev/null

echo "[restore-test] waiting for temporary PostgreSQL"
for _ in $(seq 1 60); do
  if docker exec "$TEST_CONTAINER" psql \
    -v ON_ERROR_STOP=1 \
    -U "$TEST_USER" \
    -d "$TEST_DB" \
    -tAc "select 1" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

docker exec "$TEST_CONTAINER" psql \
  -v ON_ERROR_STOP=1 \
  -U "$TEST_USER" \
  -d "$TEST_DB" \
  -tAc "select 1" >/dev/null

if [ -n "$COMPAT_ROLES" ]; then
  echo "[restore-test] preparing compatibility roles: $COMPAT_ROLES"
  for role in $COMPAT_ROLES; do
    if ! [[ "$role" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      echo "[restore-test] invalid compatibility role name: $role" >&2
      exit 2
    fi

    docker exec "$TEST_CONTAINER" psql \
      -v ON_ERROR_STOP=1 \
      -U "$TEST_USER" \
      -d "$TEST_DB" \
      -tAc "select 1 from pg_roles where rolname = '$role'" \
      | grep -q '^1$' \
      || docker exec "$TEST_CONTAINER" psql \
        -v ON_ERROR_STOP=1 \
        -U "$TEST_USER" \
        -d "$TEST_DB" \
        -c "create role \"$role\";"
  done
fi

echo "[restore-test] restoring dump into isolated database"
gunzip -c "$BACKUP_FILE" | docker exec -i "$TEST_CONTAINER" psql \
  -v ON_ERROR_STOP=1 \
  -U "$TEST_USER" \
  -d "$TEST_DB" \
  >/dev/null

echo "[restore-test] verifying restored schema"
docker exec "$TEST_CONTAINER" psql \
  -v ON_ERROR_STOP=1 \
  -U "$TEST_USER" \
  -d "$TEST_DB" \
  -tAc "select to_regclass('public.\"$VERIFY_TABLE\"') is not null" \
  | grep -q '^t$'

MIGRATIONS_COUNT="$(
  docker exec "$TEST_CONTAINER" psql \
    -v ON_ERROR_STOP=1 \
    -U "$TEST_USER" \
    -d "$TEST_DB" \
    -tAc 'select count(*) from "_prisma_migrations"'
)"

TABLES_COUNT="$(
  docker exec "$TEST_CONTAINER" psql \
    -v ON_ERROR_STOP=1 \
    -U "$TEST_USER" \
    -d "$TEST_DB" \
    -tAc "select count(*) from information_schema.tables where table_schema = 'public'"
)"

echo "[restore-test] migrations restored: $MIGRATIONS_COUNT"
echo "[restore-test] public tables restored: $TABLES_COUNT"
echo "[restore-test] restore test completed successfully"
