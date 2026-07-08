#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/backup/lib.sh
source "$SCRIPT_DIR/lib.sh"

BACKUP_FILE="${BACKUP_FILE:-}"
UPLOADS_BACKUP_FILE="${UPLOADS_BACKUP_FILE:-}"
BACKUP_SEARCH_DIR="${BACKUP_SEARCH_DIR:-/opt/fleetum/backups/postgres}"
UPLOADS_BACKUP_SEARCH_DIR="${UPLOADS_BACKUP_SEARCH_DIR:-/opt/fleetum/backups/uploads}"
LEGACY_BACKUP_SEARCH_DIR="${LEGACY_BACKUP_SEARCH_DIR:-/opt/fleetum/backups}"
RESTORE_DRILL_SOURCE="${RESTORE_DRILL_SOURCE:-local}"
RESTORE_DRILL_REPORT_DIR="${RESTORE_DRILL_REPORT_DIR:-/opt/fleetum/logs/restore-drills}"
RESTORE_DRILL_STRICT_COUNTS="${RESTORE_DRILL_STRICT_COUNTS:-true}"
ALLOW_EMPTY_UPLOADS_BACKUP="${ALLOW_EMPTY_UPLOADS_BACKUP:-false}"
VERIFY_TABLES="${VERIFY_TABLES:-Tenant User Vehicle RentalBooking RentalCustomer BookingContract StoredFileObject}"
POSTGRES_IMAGE="${POSTGRES_IMAGE:-postgres:16-alpine}"
POSTGRES_CONTAINER_NAME="${POSTGRES_CONTAINER_NAME:-fleetum_postgres}"
DB_USER="${POSTGRES_USER:-fleetum}"
DB_NAME="${POSTGRES_DB:-fleetum}"
PG_DUMP_DATABASE_URL="${PG_DUMP_DATABASE_URL:-${DIRECT_URL:-}}"
TEST_CONTAINER="${TEST_CONTAINER:-fleetum_restore_test_postgres}"
TEST_DB="${TEST_DB:-fleetum_restore_test}"
TEST_USER="${TEST_USER:-fleetum_restore_test}"
TEST_PASSWORD="${TEST_PASSWORD:-fleetum_restore_test_password}"
VERIFY_TABLE="${VERIFY_TABLE:-_prisma_migrations}"
KEEP_CONTAINER="${KEEP_CONTAINER:-false}"
COMPAT_ROLES="${COMPAT_ROLES:-fleetum}"

WORK_DIR=""
REPORT_TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
REPORT_JSON="$RESTORE_DRILL_REPORT_DIR/restore-drill-$REPORT_TIMESTAMP.json"
REPORT_MD="$RESTORE_DRILL_REPORT_DIR/restore-drill-$REPORT_TIMESTAMP.md"
LATEST_JSON="$RESTORE_DRILL_REPORT_DIR/latest.json"
LATEST_MD="$RESTORE_DRILL_REPORT_DIR/latest.md"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
STARTED_EPOCH="$(date -u +%s)"

cleanup() {
  if [ -n "$WORK_DIR" ]; then
    rm -rf "$WORK_DIR"
  fi

  if [ "$KEEP_CONTAINER" != "true" ]; then
    docker rm -f "$TEST_CONTAINER" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

validate_table_name() {
  local table="$1"
  if ! [[ "$table" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
    fail "invalid table name in VERIFY_TABLES: $table"
  fi
}

table_count_sql() {
  local table="$1"
  validate_table_name "$table"
  printf 'select count(*) from public."%s";' "$table"
}

latest_local_file() {
  local pattern="$1"
  shift

  find "$@" -maxdepth 1 -type f -name "$pattern" 2>/dev/null | sort | tail -1
}

download_latest_rclone() {
  local category="$1"
  local pattern="$2"
  local output_dir="$3"
  local rclone_bin target latest_name
  rclone_bin="$(resolve_rclone_bin)"
  target="${OFFSITE_RCLONE_TARGET%/}/$category"
  latest_name="$("$rclone_bin" lsf "$target" --files-only 2>/dev/null | grep -E "$pattern" | sort | tail -1 || true)"

  if [ -z "$latest_name" ]; then
    fail "no offsite $category backup found in $target"
  fi

  log "downloading latest offsite $category backup: $target/$latest_name"
  "$rclone_bin" copyto "$target/$latest_name" "$output_dir/$latest_name" --transfers 1 || \
    fail "offsite rclone download failed for $target/$latest_name"
  printf '%s\n' "$output_dir/$latest_name"
}

download_latest_s3() {
  local category="$1"
  local pattern="$2"
  local output_dir="$3"
  command -v aws >/dev/null 2>&1 || fail "RESTORE_DRILL_SOURCE=offsite with OFFSITE_S3_URI requires aws CLI"

  local endpoint_args=()
  if [ -n "${S3_ENDPOINT_URL:-}" ]; then
    endpoint_args=(--endpoint-url "$S3_ENDPOINT_URL")
  fi

  local prefix="${OFFSITE_S3_URI%/}/$category/"
  local latest_name
  latest_name="$(aws "${endpoint_args[@]}" s3 ls "$prefix" | awk '{print $4}' | grep -E "$pattern" | sort | tail -1 || true)"
  if [ -z "$latest_name" ]; then
    fail "no offsite $category backup found in $prefix"
  fi

  log "downloading latest offsite $category backup: $prefix$latest_name"
  aws "${endpoint_args[@]}" s3 cp "$prefix$latest_name" "$output_dir/$latest_name" --only-show-errors || \
    fail "offsite S3 download failed for $prefix$latest_name"
  printf '%s\n' "$output_dir/$latest_name"
}

resolve_backup_inputs() {
  WORK_DIR="$(mktemp -d)"

  if [ "$RESTORE_DRILL_SOURCE" = "offsite" ]; then
    require_offsite_config
    if [ -n "${OFFSITE_RCLONE_TARGET:-}" ]; then
      [ -n "$BACKUP_FILE" ] || BACKUP_FILE="$(download_latest_rclone "postgres" '^fleetum-postgres-.*\.sql\.gz$' "$WORK_DIR")"
      [ -n "$UPLOADS_BACKUP_FILE" ] || UPLOADS_BACKUP_FILE="$(download_latest_rclone "uploads" '^fleetum-uploads-.*\.tar\.gz$' "$WORK_DIR")"
    elif [ -n "${OFFSITE_S3_URI:-}" ]; then
      [ -n "$BACKUP_FILE" ] || BACKUP_FILE="$(download_latest_s3 "postgres" '^fleetum-postgres-.*\.sql\.gz$' "$WORK_DIR")"
      [ -n "$UPLOADS_BACKUP_FILE" ] || UPLOADS_BACKUP_FILE="$(download_latest_s3 "uploads" '^fleetum-uploads-.*\.tar\.gz$' "$WORK_DIR")"
    fi
  fi

  if [ -z "$BACKUP_FILE" ]; then
    BACKUP_FILE="$(latest_local_file 'fleetum-postgres-*.sql.gz' "$BACKUP_SEARCH_DIR" "$LEGACY_BACKUP_SEARCH_DIR")"
  fi

  if [ -z "$BACKUP_FILE" ]; then
    BACKUP_FILE="$(latest_local_file 'fleetum_*.sql.gz' "$BACKUP_SEARCH_DIR" "$LEGACY_BACKUP_SEARCH_DIR")"
  fi

  if [ -z "$UPLOADS_BACKUP_FILE" ]; then
    UPLOADS_BACKUP_FILE="$(latest_local_file 'fleetum-uploads-*.tar.gz' "$UPLOADS_BACKUP_SEARCH_DIR" "$LEGACY_BACKUP_SEARCH_DIR")"
  fi

  if [ -z "$BACKUP_FILE" ] || [ ! -f "$BACKUP_FILE" ]; then
    fail "restore drill PostgreSQL backup file not found. Set BACKUP_FILE=/path/to/dump.sql.gz"
  fi

  if [ -z "$UPLOADS_BACKUP_FILE" ] || [ ! -f "$UPLOADS_BACKUP_FILE" ]; then
    fail "restore drill uploads backup file not found. Set UPLOADS_BACKUP_FILE=/path/to/uploads.tar.gz"
  fi
}

backup_timestamp_epoch() {
  local file_name raw_date raw_time
  file_name="$(basename "$1")"
  if [[ "$file_name" =~ ([0-9]{8})T([0-9]{6})Z ]]; then
    raw_date="${BASH_REMATCH[1]}"
    raw_time="${BASH_REMATCH[2]}"
    date -u -d "${raw_date:0:4}-${raw_date:4:2}-${raw_date:6:2} ${raw_time:0:2}:${raw_time:2:2}:${raw_time:4:2} UTC" +%s
    return 0
  fi
  return 1
}

run_source_sql() {
  local sql="$1"
  if [ -n "$PG_DUMP_DATABASE_URL" ]; then
    docker run --rm "$POSTGRES_IMAGE" psql "$PG_DUMP_DATABASE_URL" -v ON_ERROR_STOP=1 -tAc "$sql"
    return 0
  fi

  if docker inspect "$POSTGRES_CONTAINER_NAME" >/dev/null 2>&1; then
    docker exec "$POSTGRES_CONTAINER_NAME" psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" -tAc "$sql"
    return 0
  fi

  return 1
}

run_restore_sql() {
  local sql="$1"
  docker exec "$TEST_CONTAINER" psql -v ON_ERROR_STOP=1 -U "$TEST_USER" -d "$TEST_DB" -tAc "$sql"
}

write_report() {
  local status="$1"
  local finished_at="$2"
  local rpo_seconds="$3"
  local rto_seconds="$4"
  local migrations_count="$5"
  local tables_count="$6"
  local counts_file="$7"
  local uploads_status="$8"
  local recovered_file="$9"
  local recovered_file_bytes="${10}"
  local recovered_file_sha256="${11}"

  mkdir -p "$RESTORE_DRILL_REPORT_DIR"

  local table_rows_json=""
  local markdown_rows=""
  while IFS=$'\t' read -r table source_count restored_count match_status; do
    [ -n "$table" ] || continue
    local item
    item="{\"table\":\"$(json_escape "$table")\",\"sourceCount\":$source_count,\"restoredCount\":$restored_count,\"status\":\"$(json_escape "$match_status")\"}"
    if [ -z "$table_rows_json" ]; then
      table_rows_json="$item"
    else
      table_rows_json="$table_rows_json,$item"
    fi
    markdown_rows="${markdown_rows}| ${table} | ${source_count} | ${restored_count} | ${match_status} |\n"
  done < "$counts_file"

  local postgres_file uploads_file recovered_json
  postgres_file="$(basename "$BACKUP_FILE")"
  uploads_file="$(basename "$UPLOADS_BACKUP_FILE")"
  recovered_json="null"
  if [ -n "$recovered_file" ]; then
    recovered_json="{\"relativePath\":\"$(json_escape "$recovered_file")\",\"sizeBytes\":$recovered_file_bytes,\"sha256\":\"$(json_escape "$recovered_file_sha256")\"}"
  fi

  cat > "$REPORT_JSON" <<EOF
{
  "status": "$(json_escape "$status")",
  "generatedAt": "$(json_escape "$finished_at")",
  "startedAt": "$(json_escape "$STARTED_AT")",
  "source": "$(json_escape "$RESTORE_DRILL_SOURCE")",
  "postgresBackupFile": "$(json_escape "$postgres_file")",
  "uploadsBackupFile": "$(json_escape "$uploads_file")",
  "rpoSeconds": $rpo_seconds,
  "rtoSeconds": $rto_seconds,
  "migrationsRestored": $migrations_count,
  "publicTablesRestored": $tables_count,
  "tableCounts": [$table_rows_json],
  "uploads": {
    "status": "$(json_escape "$uploads_status")",
    "recoveredFile": $recovered_json
  },
  "reportPath": "$(json_escape "$REPORT_MD")"
}
EOF

  {
    printf '# Fleetum Restore Drill - %s\n\n' "$finished_at"
    printf '## Esito\n\n'
    printf '| Campo | Valore |\n| --- | --- |\n'
    printf '| Stato | %s |\n' "$status"
    printf '| Fonte backup | %s |\n' "$RESTORE_DRILL_SOURCE"
    printf '| Backup PostgreSQL | %s |\n' "$postgres_file"
    printf '| Backup uploads | %s |\n' "$uploads_file"
    printf '| RPO osservato | %s secondi |\n' "$rpo_seconds"
    printf '| RTO tecnico osservato | %s secondi |\n' "$rto_seconds"
    printf '| Migrazioni restore | %s |\n' "$migrations_count"
    printf '| Tabelle pubbliche restore | %s |\n\n' "$tables_count"
    printf '## Conteggi tabelle critiche\n\n'
    printf '| Tabella | Sorgente | Restore isolato | Esito |\n| --- | ---: | ---: | --- |\n'
    printf '%b' "$markdown_rows"
    printf '\n## Uploads\n\n'
    printf '| Campo | Valore |\n| --- | --- |\n'
    printf '| Stato | %s |\n' "$uploads_status"
    if [ -n "$recovered_file" ]; then
      printf '| File recuperato | %s |\n' "$recovered_file"
      printf '| Dimensione | %s bytes |\n' "$recovered_file_bytes"
      printf '| SHA-256 | %s |\n' "$recovered_file_sha256"
    fi
    printf '\n## Note sicurezza\n\n'
    printf -- '- Restore eseguito in container PostgreSQL temporaneo isolato.\n'
    printf -- '- Upload estratti in directory temporanea privata e rimossi a fine script.\n'
    printf -- '- Nessun file e nessun URL firmato viene pubblicato dal drill.\n'
  } > "$REPORT_MD"

  cp "$REPORT_JSON" "$LATEST_JSON"
  cp "$REPORT_MD" "$LATEST_MD"
  chmod 600 "$REPORT_JSON" "$REPORT_MD" "$LATEST_JSON" "$LATEST_MD"
}

command -v docker >/dev/null 2>&1 || fail "docker command not found"
command -v gzip >/dev/null 2>&1 || fail "gzip command not found"
command -v tar >/dev/null 2>&1 || fail "tar command not found"

resolve_backup_inputs

log "restore drill using PostgreSQL backup: $BACKUP_FILE"
log "restore drill using uploads backup: $UPLOADS_BACKUP_FILE"
gzip -t "$BACKUP_FILE" || fail "backup gzip integrity check failed: $BACKUP_FILE"
tar -tzf "$UPLOADS_BACKUP_FILE" >/dev/null || fail "uploads tar integrity check failed: $UPLOADS_BACKUP_FILE"
verify_backup_file "$BACKUP_FILE" "${MIN_POSTGRES_BACKUP_BYTES:-1024}"
verify_backup_file "$UPLOADS_BACKUP_FILE" "${MIN_UPLOADS_BACKUP_BYTES:-128}"

docker rm -f "$TEST_CONTAINER" >/dev/null 2>&1 || true

docker run -d \
  --name "$TEST_CONTAINER" \
  -e POSTGRES_DB="$TEST_DB" \
  -e POSTGRES_USER="$TEST_USER" \
  -e POSTGRES_PASSWORD="$TEST_PASSWORD" \
  "$POSTGRES_IMAGE" >/dev/null

log "waiting for temporary PostgreSQL"
for _ in $(seq 1 60); do
  if run_restore_sql "select 1" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

run_restore_sql "select 1" >/dev/null

if [ -n "$COMPAT_ROLES" ]; then
  log "preparing compatibility roles: $COMPAT_ROLES"
  for role in $COMPAT_ROLES; do
    if ! [[ "$role" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      fail "invalid compatibility role name: $role"
    fi

    run_restore_sql "select 1 from pg_roles where rolname = '$role'" | grep -q '^1$' \
      || run_restore_sql "create role \"$role\";" >/dev/null
  done
fi

log "restoring dump into isolated database"
gunzip -c "$BACKUP_FILE" | docker exec -i "$TEST_CONTAINER" psql \
  -v ON_ERROR_STOP=1 \
  -U "$TEST_USER" \
  -d "$TEST_DB" \
  >/dev/null

log "verifying restored schema"
run_restore_sql "select to_regclass('public.\"$VERIFY_TABLE\"') is not null" | grep -q '^t$'

MIGRATIONS_COUNT="$(run_restore_sql 'select count(*) from "_prisma_migrations"')"
TABLES_COUNT="$(run_restore_sql "select count(*) from information_schema.tables where table_schema = 'public'")"

if [ "$TABLES_COUNT" -lt 1 ]; then
  fail "restore drill produced zero public tables"
fi

COUNTS_FILE="$WORK_DIR/table-counts.tsv"
: > "$COUNTS_FILE"
COUNT_MISMATCHES=0
SOURCE_COUNTS_AVAILABLE=true

for table in $VERIFY_TABLES; do
  validate_table_name "$table"
  sql="$(table_count_sql "$table")"
  restored_count="$(run_restore_sql "$sql")"
  source_count="0"
  match_status="PASS"

  if source_count="$(run_source_sql "$sql" 2>/dev/null)"; then
    if [ "$source_count" != "$restored_count" ]; then
      match_status="MISMATCH"
      COUNT_MISMATCHES=$((COUNT_MISMATCHES + 1))
    fi
  else
    SOURCE_COUNTS_AVAILABLE=false
    source_count="-1"
    match_status="SOURCE_UNAVAILABLE"
  fi

  printf '%s\t%s\t%s\t%s\n' "$table" "$source_count" "$restored_count" "$match_status" >> "$COUNTS_FILE"
done

if [ "$SOURCE_COUNTS_AVAILABLE" != "true" ] && [ "$RESTORE_DRILL_STRICT_COUNTS" = "true" ]; then
  fail "source database counts unavailable. Set PG_DUMP_DATABASE_URL/DIRECT_URL or ensure $POSTGRES_CONTAINER_NAME is reachable"
fi

if [ "$COUNT_MISMATCHES" -gt 0 ] && [ "$RESTORE_DRILL_STRICT_COUNTS" = "true" ]; then
  fail "restore drill count mismatch detected on $COUNT_MISMATCHES critical tables"
fi

UPLOADS_RESTORE_DIR="$WORK_DIR/uploads-restore"
mkdir -p "$UPLOADS_RESTORE_DIR"
tar -xzf "$UPLOADS_BACKUP_FILE" -C "$UPLOADS_RESTORE_DIR"

RECOVERED_FILE_ABS="$(find "$UPLOADS_RESTORE_DIR" -type f | sort | head -1 || true)"
UPLOADS_STATUS="PASS"
RECOVERED_FILE_REL=""
RECOVERED_FILE_BYTES=0
RECOVERED_FILE_SHA256=""

if [ -z "$RECOVERED_FILE_ABS" ]; then
  if [ "$ALLOW_EMPTY_UPLOADS_BACKUP" = "true" ]; then
    UPLOADS_STATUS="EMPTY_ALLOWED"
  else
    fail "uploads restore drill found no file in archive. Set ALLOW_EMPTY_UPLOADS_BACKUP=true only for empty bootstrap environments"
  fi
else
  RECOVERED_FILE_REL="${RECOVERED_FILE_ABS#"$UPLOADS_RESTORE_DIR"/}"
  RECOVERED_FILE_BYTES="$(file_size_bytes "$RECOVERED_FILE_ABS")"
  if command -v sha256sum >/dev/null 2>&1; then
    RECOVERED_FILE_SHA256="$(sha256sum "$RECOVERED_FILE_ABS" | awk '{print $1}')"
  else
    RECOVERED_FILE_SHA256="$(shasum -a 256 "$RECOVERED_FILE_ABS" | awk '{print $1}')"
  fi
fi

FINISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
FINISHED_EPOCH="$(date -u +%s)"
RTO_SECONDS=$((FINISHED_EPOCH - STARTED_EPOCH))
BACKUP_EPOCH="$(backup_timestamp_epoch "$BACKUP_FILE" || printf '0')"
if [ "$BACKUP_EPOCH" -gt 0 ]; then
  RPO_SECONDS=$((FINISHED_EPOCH - BACKUP_EPOCH))
else
  RPO_SECONDS=-1
fi

write_report "PASS" "$FINISHED_AT" "$RPO_SECONDS" "$RTO_SECONDS" "$MIGRATIONS_COUNT" "$TABLES_COUNT" "$COUNTS_FILE" "$UPLOADS_STATUS" "$RECOVERED_FILE_REL" "$RECOVERED_FILE_BYTES" "$RECOVERED_FILE_SHA256"

log "migrations restored: $MIGRATIONS_COUNT"
log "public tables restored: $TABLES_COUNT"
log "restore drill report: $REPORT_MD"
log "restore drill completed successfully"
notify_backup_success "Fleetum restore drill completed successfully. Report: $REPORT_MD"
