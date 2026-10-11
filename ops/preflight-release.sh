#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[preflight-release 1/2] Application, operations and production-dependency gates"
npm run verify:release

echo "[preflight-release 2/2] Isolated PostgreSQL migration and tenant gate"
npm run verify:database

echo "[preflight-release] PASS: release and temporary-database gates completed"
