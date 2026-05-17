#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/fleetum/app}"
BACKUP_DIR="${BACKUP_DIR:-/opt/fleetum/backups}"
CONTAINER_NAME="${CONTAINER_NAME:-fleetum_postgres}"
DB_NAME="${POSTGRES_DB:-fleetum}"
DB_USER="${POSTGRES_USER:-fleetum}"

mkdir -p "${BACKUP_DIR}"
STAMP="$(date +%Y%m%d_%H%M%S)"
OUT_FILE="${BACKUP_DIR}/${DB_NAME}_${STAMP}.sql.gz"

cd "${APP_DIR}"
docker exec -i "${CONTAINER_NAME}" pg_dump -U "${DB_USER}" -d "${DB_NAME}" | gzip -9 > "${OUT_FILE}"

find "${BACKUP_DIR}" -name "${DB_NAME}_*.sql.gz" -type f -mtime +14 -delete

echo "Backup creato: ${OUT_FILE}"
