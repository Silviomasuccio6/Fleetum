#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

echo "[1/6] Lint"
npm run lint

echo "[2/6] Build"
npm run build

echo "[3/6] Backend test env fallback smoke"
env \
  -u DATABASE_URL \
  -u JWT_SECRET \
  -u PLATFORM_JWT_SECRET \
  -u PLATFORM_ADMIN_PASSWORD_HASH \
  -u PLATFORM_ADMIN_EMAIL \
  -u SMTP_HOST \
  -u SMTP_USER \
  -u SMTP_PASS \
  NODE_ENV=test \
  npx tsx -e 'import("./backend/src/shared/config/env.ts").then(({ env }) => {
    if (env.NODE_ENV !== "test") throw new Error("NODE_ENV test non applicato");
    if (!env.DATABASE_URL.includes("fleetum_ci")) throw new Error("DATABASE_URL test fallback non applicato");
    if (!env.JWT_SECRET.includes("test-jwt-secret")) throw new Error("JWT_SECRET test fallback non applicato");
    if (!env.PLATFORM_JWT_SECRET.includes("test-platform-jwt-secret")) throw new Error("PLATFORM_JWT_SECRET test fallback non applicato");
    if (env.PLATFORM_ADMIN_EMAIL !== "ci-admin@example.local") throw new Error("PLATFORM_ADMIN_EMAIL test fallback non applicato");
    console.log("Backend test env fallback OK: nessun env reale richiesto");
  })'

echo "[3/6] Backend tests"
NODE_ENV=test npm run test -w backend

echo "[4/6] Frontend tests"
npx tsx --test frontend/tests/**/*.test.ts

echo "[5/6] Security audit (prod deps)"
npm audit --omit=dev --audit-level=high

echo "[6/6] Production proxy configuration smoke"
grep -q "TRUST_PROXY=1" /opt/fleetum/env/backend.env || echo "WARNING: TRUST_PROXY non impostato"

echo "Preflight completato con successo."
