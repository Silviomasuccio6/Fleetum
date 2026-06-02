#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Uso: $0 <path-backup.sql|dump|pgdump> [container=fleetum_postgres] [target-db=fleetum_restore_test] [db-user=fleetum]"
  exit 1
fi

BACKUP_FILE="$1"
CONTAINER_NAME="${2:-fleetum_postgres}"
TARGET_DB="${3:-fleetum_restore_test}"
DB_USER="${4:-fleetum}"

log() {
  printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

fail() {
  log "ERRORE: $*" >&2
  exit 1
}

[[ -f "${BACKUP_FILE}" ]] || fail "backup non trovato: ${BACKUP_FILE}"
[[ -s "${BACKUP_FILE}" ]] || fail "backup vuoto: ${BACKUP_FILE}"

SIZE_BYTES="$(wc -c < "${BACKUP_FILE}" | tr -d ' ')"
if [[ "${SIZE_BYTES}" -le 1024 ]]; then
  fail "backup troppo piccolo (${SIZE_BYTES} bytes): ${BACKUP_FILE}"
fi

is_custom_dump=false
case "${BACKUP_FILE}" in
  *.dump|*.pgdump) is_custom_dump=true ;;
  *)
    if [[ "$(LC_ALL=C head -c 5 "${BACKUP_FILE}")" == "PGDMP" ]]; then
      is_custom_dump=true
    fi
    ;;
esac

if [[ "${is_custom_dump}" == false ]]; then
  HEADER="$(LC_ALL=C head -c 512 "${BACKUP_FILE}" || true)"
  if [[ "${HEADER}" != --* && "${HEADER}" != *PostgreSQL* ]]; then
    fail "header dump plain non valido: ${BACKUP_FILE}"
  fi
else
  if [[ "$(LC_ALL=C head -c 5 "${BACKUP_FILE}")" != "PGDMP" ]]; then
    fail "header dump custom non valido: ${BACKUP_FILE}"
  fi
fi

docker inspect "${CONTAINER_NAME}" >/dev/null 2>&1 || fail "container ${CONTAINER_NAME} non trovato"

log "Creo database test ${TARGET_DB} nel container ${CONTAINER_NAME}"
docker exec -i "${CONTAINER_NAME}" psql -U "${DB_USER}" -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"${TARGET_DB}\";"
docker exec -i "${CONTAINER_NAME}" psql -U "${DB_USER}" -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"${TARGET_DB}\";"

if [[ "${is_custom_dump}" == true ]]; then
  log "Restore custom dump con pg_restore"
  cat "${BACKUP_FILE}" | docker exec -i "${CONTAINER_NAME}" pg_restore -U "${DB_USER}" -d "${TARGET_DB}" --no-owner --no-privileges
else
  log "Restore plain dump con psql"
  cat "${BACKUP_FILE}" | docker exec -i "${CONTAINER_NAME}" psql -U "${DB_USER}" -d "${TARGET_DB}" -v ON_ERROR_STOP=1 >/dev/null
fi

TABLE_COUNT="$(docker exec -i "${CONTAINER_NAME}" psql -U "${DB_USER}" -d "${TARGET_DB}" -At -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';" | tr -d '[:space:]')"
if [[ -z "${TABLE_COUNT}" || "${TABLE_COUNT}" -eq 0 ]]; then
  fail "restore completato ma nessuna tabella trovata in ${TARGET_DB}"
fi

log "Restore completato target_db=${TARGET_DB} tables=${TABLE_COUNT}"
