#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

echo "[1/6] Lint"
npm run lint

echo "[2/6] Build"
npm run build

echo "[3/6] Backend tests"
npm run test -w backend

echo "[4/6] Frontend tests"
npx tsx --test frontend/tests/**/*.test.ts

echo "[5/6] Security audit (prod deps)"
npm audit --omit=dev --audit-level=high

echo "[6/6] Production proxy configuration smoke"
grep -q "TRUST_PROXY=1" /opt/fleetum/env/backend.env || echo "WARNING: TRUST_PROXY non impostato"

echo "Preflight completato con successo."
