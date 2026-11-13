#!/usr/bin/env bash
# Separate fresh PostgreSQL 16 fixture: never shares the general tenant-test DB.
set -euo pipefail
staging_fixture_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
staging_fixture_container="fleetum_staging_bootstrap_verify_${$}"
staging_fixture_upload="$(mktemp -d "${TMPDIR:-/tmp}/fleetum-staging-bootstrap-upload.XXXXXX")"
cleanup() { docker rm -f "$staging_fixture_container" >/dev/null 2>&1 || true; rm -rf -- "$staging_fixture_upload"; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
cd "$staging_fixture_root"
docker info >/dev/null
docker run --rm -d --name "$staging_fixture_container" -e POSTGRES_USER=fleetum -e POSTGRES_PASSWORD=fleetum_synthetic_bootstrap -e POSTGRES_DB=fleetum_ci -p 127.0.0.1::5432 postgres:16-alpine >/dev/null
for staging_attempt in {1..40}; do
  if docker exec "$staging_fixture_container" pg_isready -U fleetum -d fleetum_ci >/dev/null 2>&1; then break; fi
  [ "$staging_attempt" != 40 ] || { echo 'Temporary PostgreSQL fixture did not become ready.' >&2; exit 1; }
  sleep 1
done
staging_fixture_port="$(docker port "$staging_fixture_container" 5432/tcp | awk -F: 'NR == 1 {print $NF}')"
[[ "$staging_fixture_port" =~ ^[0-9]+$ ]] || exit 1
export DATABASE_URL="postgresql://fleetum:fleetum_synthetic_bootstrap@127.0.0.1:${staging_fixture_port}/fleetum_ci?schema=public"
export NODE_ENV=test DOTENV_CONFIG_PATH=/dev/null RUN_STAGING_BOOTSTRAP_TESTS=1 STORAGE_PROVIDER=local
export UPLOAD_DIR="$staging_fixture_upload"
npx --no-install prisma generate --schema backend/prisma/schema.prisma
npx --no-install prisma migrate deploy --schema backend/prisma/schema.prisma
node --import tsx --test --test-concurrency=1 backend/tests/staging-bootstrap.postgres.mts
echo 'Temporary staging bootstrap PostgreSQL 16 verification completed; cleanup follows.'
