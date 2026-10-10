#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 4 ]]; then
  echo "Uso: $0 <path-backup.sql> <container> <target-db=fleetum_restore_...> <db-user>" >&2
  exit 1
fi

BACKUP_FILE="$1"
CONTAINER_NAME="$2"
TARGET_DB="$3"
DB_USER="$4"
export LC_ALL=C

if [[ ${#CONTAINER_NAME} -gt 63 || ! "${CONTAINER_NAME}" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]]; then
  echo "Nome container non valido (1-63 caratteri ASCII sicuri)." >&2
  exit 1
fi

if [[ ${#TARGET_DB} -gt 63 || ! "${TARGET_DB}" =~ ^fleetum_restore_[a-z0-9_]+$ ]]; then
  echo "Target non valido: richiesto fleetum_restore_... (massimo 63 caratteri)." >&2
  exit 1
fi

if [[ ${#DB_USER} -gt 63 || ! "${DB_USER}" =~ ^[a-z_][a-z0-9_]*$ ]]; then
  echo "Utente DB non valido (1-63 caratteri ASCII minuscoli sicuri)." >&2
  exit 1
fi

if [[ ! -f "${BACKUP_FILE}" || ! -r "${BACKUP_FILE}" || ! -s "${BACKUP_FILE}" ]]; then
  echo "Backup richiesto: file regolare, leggibile e non vuoto." >&2
  exit 1
fi

# CREATE alone fails atomically if the target already exists, including a race.
# The caller owns the disposable container and is responsible for its cleanup.
docker exec -i "${CONTAINER_NAME}" psql -X --set ON_ERROR_STOP=1 \
  -U "${DB_USER}" -d postgres -c "CREATE DATABASE \"${TARGET_DB}\";" </dev/null

# SQL backups are trusted input, not parsed or sandboxed by this helper. Supply
# a plain SQL dump without database switching or transaction-control commands.
# -X ignores psqlrc; ON_ERROR_STOP and one transaction fail closed on SQL errors.
docker exec -i "${CONTAINER_NAME}" psql -X --set ON_ERROR_STOP=1 --single-transaction \
  -U "${DB_USER}" -d "${TARGET_DB}" --file=- < "${BACKUP_FILE}" >/dev/null

echo "Restore completato su database: ${TARGET_DB}"
