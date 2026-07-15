#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER_NAME="fleetum_verify_db_${$}"
DB_USER="fleetum"
DB_NAME="fleetum_ci"
DB_PASSWORD="fleetum_verify_local"
UPLOAD_DIR="${TMPDIR:-/tmp}/fleetum-verify-uploads-${$}"
STARTED_AT="$(date +%s)"

cleanup() {
  docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
  rm -rf -- "${UPLOAD_DIR:?}"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

cd "${ROOT_DIR}"

if ! command -v docker >/dev/null 2>&1; then
  echo "ERRORE: Docker e richiesto per la verifica database isolata." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "ERRORE: Docker non e in esecuzione o non e accessibile." >&2
  exit 1
fi

mkdir -p "${UPLOAD_DIR}"

echo "[verify:database] Avvio PostgreSQL 16 temporaneo e isolato"
docker run --rm -d \
  --name "${CONTAINER_NAME}" \
  -e "POSTGRES_USER=${DB_USER}" \
  -e "POSTGRES_PASSWORD=${DB_PASSWORD}" \
  -e "POSTGRES_DB=${DB_NAME}" \
  -p 127.0.0.1::5432 \
  postgres:16-alpine >/dev/null

for attempt in $(seq 1 40); do
  if docker exec "${CONTAINER_NAME}" pg_isready -U "${DB_USER}" -d "${DB_NAME}" >/dev/null 2>&1; then
    break
  fi

  if [ "${attempt}" -eq 40 ]; then
    echo "ERRORE: PostgreSQL temporaneo non e pronto entro il timeout." >&2
    docker logs "${CONTAINER_NAME}" --tail 40 >&2 || true
    exit 1
  fi

  sleep 1
done

HOST_PORT="$(docker port "${CONTAINER_NAME}" 5432/tcp | head -n 1 | awk -F: '{print $NF}')"
if ! [[ "${HOST_PORT}" =~ ^[0-9]+$ ]]; then
  echo "ERRORE: impossibile determinare la porta del database temporaneo." >&2
  exit 1
fi

export NODE_ENV=test
export DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:${HOST_PORT}/${DB_NAME}?schema=public"
export UPLOAD_DIR

echo "[verify:database] Generazione Prisma e applicazione migration"
npx prisma generate --schema backend/prisma/schema.prisma
npx prisma migrate deploy --schema backend/prisma/schema.prisma

echo "[verify:database] Verifica riconciliazione monetaria"
npm run money:reconcile -w backend
npm run money:verify-dual-write -w backend

echo "[verify:database] Test HTTP di isolamento multi-tenant"
npm run test:tenant-isolation -w backend

ELAPSED="$(( $(date +%s) - STARTED_AT ))"
echo "[verify:database] PASS in ${ELAPSED}s; ambiente temporaneo rimosso automaticamente"
