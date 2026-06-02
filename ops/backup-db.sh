#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-${ROOT_DIR}/backups}"
CONTAINER_NAME="fleetum_postgres"
DB_NAME="fleetum"
DB_USER="fleetum"
FORMAT="plain"
OUT_FILE=""

log() {
  printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

usage() {
  cat <<USAGE
Uso: $0 [--compress] [container=fleetum_postgres] [db=fleetum] [user=fleetum]

Opzioni:
  --compress    Usa pg_dump -Fc e crea un dump custom .dump.

Esempi:
  $0
  $0 --compress
  $0 fleetum_postgres fleetum fleetum
USAGE
}

cleanup_partial() {
  if [[ -n "${OUT_FILE}" && -f "${OUT_FILE}" ]]; then
    rm -f "${OUT_FILE}"
  fi
}

fail() {
  log "ERRORE: $*" >&2
  cleanup_partial
  exit 1
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

if [[ "${1:-}" == "--compress" ]]; then
  FORMAT="custom"
  shift
fi

CONTAINER_NAME="${1:-$CONTAINER_NAME}"
DB_NAME="${2:-$DB_NAME}"
DB_USER="${3:-$DB_USER}"

mkdir -p "${BACKUP_DIR}"
STAMP="$(date +%Y%m%d_%H%M%S)"
EXTENSION="sql"
PG_DUMP_ARGS=()
if [[ "${FORMAT}" == "custom" ]]; then
  EXTENSION="dump"
  PG_DUMP_ARGS=(-Fc)
fi
OUT_FILE="${BACKUP_DIR}/${DB_NAME}_${STAMP}.${EXTENSION}"

trap 'fail "backup interrotto o fallito"' ERR INT TERM

docker inspect "${CONTAINER_NAME}" >/dev/null 2>&1 || fail "container ${CONTAINER_NAME} non trovato"

log "Avvio backup PostgreSQL container=${CONTAINER_NAME} db=${DB_NAME} user=${DB_USER} format=${FORMAT}"
docker exec -i "${CONTAINER_NAME}" pg_dump "${PG_DUMP_ARGS[@]}" -U "${DB_USER}" -d "${DB_NAME}" > "${OUT_FILE}"

[[ -f "${OUT_FILE}" ]] || fail "file backup non creato: ${OUT_FILE}"
SIZE_BYTES="$(wc -c < "${OUT_FILE}" | tr -d ' ')"
if [[ "${SIZE_BYTES}" -le 1024 ]]; then
  fail "backup troppo piccolo (${SIZE_BYTES} bytes): ${OUT_FILE}"
fi

HEADER="$(LC_ALL=C head -c 512 "${OUT_FILE}" || true)"
if [[ "${FORMAT}" == "custom" ]]; then
  if [[ "$(LC_ALL=C head -c 5 "${OUT_FILE}")" != "PGDMP" ]]; then
    fail "header dump custom non valido: ${OUT_FILE}"
  fi
else
  if [[ "${HEADER}" != --* && "${HEADER}" != *PostgreSQL* ]]; then
    fail "header dump plain non valido: ${OUT_FILE}"
  fi
fi

SIZE_MB="$(awk -v bytes="${SIZE_BYTES}" 'BEGIN { printf "%.2f", bytes / 1024 / 1024 }')"
trap - ERR INT TERM
log "Backup creato file=${OUT_FILE} size_mb=${SIZE_MB} size_bytes=${SIZE_BYTES}"
