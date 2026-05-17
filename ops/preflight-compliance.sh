#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

echo "[1/6] Documenti privacy minimi"
test -f docs/D13-privacy-pack.md
test -f docs/privacy/ropa.md
test -f docs/privacy/dpia.md
test -f docs/privacy/informativa-privacy.md
test -f docs/privacy/dpa-fornitori.md
test -f docs/privacy/local-compliance-controls.md

echo "[2/6] Backend build"
npm run build -w backend

echo "[3/6] Backend tests"
npm run test -w backend

echo "[4/6] Frontend build"
npm run build -w frontend

echo "[5/6] Retention dry-run"
npm run privacy:retention:dry-run -w backend

echo "[6/6] Audit dipendenze produzione"
npm audit --omit=dev --audit-level=high

echo "Preflight compliance completato."
