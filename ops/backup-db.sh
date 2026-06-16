#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${ROOT_DIR}/backups"
CONTAINER_NAME="${1:-fleetum_postgres}"
DB_NAME="${2:-fleetum}"
DB_USER="${3:-fleetum}"

mkdir -p "${BACKUP_DIR}"
STAMP="$(date +%Y%m%d_%H%M%S)"
OUT_FILE="${BACKUP_DIR}/${DB_NAME}_${STAMP}.sql"

docker exec -i "${CONTAINER_NAME}" pg_dump -U "${DB_USER}" -d "${DB_NAME}" > "${OUT_FILE}"
echo "Backup creato: ${OUT_FILE}"
