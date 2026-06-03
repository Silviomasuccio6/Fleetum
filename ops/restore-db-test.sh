#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Uso: $0 <path-backup.sql> [container=fleetum_postgres] [target-db=fleetum_restore_test] [db-user=fleetum]"
  exit 1
fi

BACKUP_FILE="$1"
CONTAINER_NAME="${2:-fleetum_postgres}"
TARGET_DB="${3:-fleetum_restore_test}"
DB_USER="${4:-fleetum}"

if [[ ! -f "${BACKUP_FILE}" ]]; then
  echo "Backup non trovato: ${BACKUP_FILE}"
  exit 1
fi

docker exec -i "${CONTAINER_NAME}" psql -U "${DB_USER}" -d postgres -c "DROP DATABASE IF EXISTS \"${TARGET_DB}\";"
docker exec -i "${CONTAINER_NAME}" psql -U "${DB_USER}" -d postgres -c "CREATE DATABASE \"${TARGET_DB}\";"
cat "${BACKUP_FILE}" | docker exec -i "${CONTAINER_NAME}" psql -U "${DB_USER}" -d "${TARGET_DB}" >/dev/null

echo "Restore completato su database: ${TARGET_DB}"
