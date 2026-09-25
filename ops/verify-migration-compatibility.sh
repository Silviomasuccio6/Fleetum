#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PREVIOUS_RELEASE_REF="${PREVIOUS_RELEASE_REF:-origin/main}"
CONTAINER_NAME="fleetum_migration_compat_${$}"
DB_USER="fleetum_compat"
DB_NAME="fleetum_compat"
DB_PASSWORD="fleetum_compat_local"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/fleetum-migration-compat.XXXXXX")"
PREVIOUS_DIR="$WORK_DIR/previous"
UPLOAD_DIR="$WORK_DIR/uploads"
STARTED_AT="$(date +%s)"

cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  rm -rf -- "$WORK_DIR"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

cd "$ROOT_DIR"

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  echo "ERROR: Docker is required for the isolated migration compatibility gate." >&2
  exit 1
fi

PREVIOUS_RELEASE_SHA="$(git rev-parse "${PREVIOUS_RELEASE_REF}^{commit}")"
CURRENT_RELEASE_SHA="$(git rev-parse HEAD)"
if ! [[ "$PREVIOUS_RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || ! [[ "$CURRENT_RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "ERROR: both release identities must resolve to full Git SHAs." >&2
  exit 1
fi
if ! git merge-base --is-ancestor "$PREVIOUS_RELEASE_SHA" "$CURRENT_RELEASE_SHA"; then
  echo "ERROR: previous release $PREVIOUS_RELEASE_SHA is not an ancestor of $CURRENT_RELEASE_SHA." >&2
  exit 1
fi

NON_ADDITIVE_MIGRATIONS="$(
  git diff --name-status "$PREVIOUS_RELEASE_SHA" "$CURRENT_RELEASE_SHA" -- backend/prisma/migrations \
    | awk '$1 != "A" { print }'
)"
if [ -n "$NON_ADDITIVE_MIGRATIONS" ]; then
  echo "ERROR: existing Prisma migrations are immutable; the candidate contains a non-additive migration change:" >&2
  printf '%s\n' "$NON_ADDITIVE_MIGRATIONS" >&2
  exit 1
fi

CHANGED_MIGRATIONS="$(
  git diff --name-only --diff-filter=A "$PREVIOUS_RELEASE_SHA" "$CURRENT_RELEASE_SHA" -- backend/prisma/migrations \
    | sed -n 's#^backend/prisma/migrations/\([^/]*\)/migration\.sql$#\1#p' \
    | sort -u \
    | tr '\n' ' '
)"

if [ -z "$CHANGED_MIGRATIONS" ]; then
  echo "[migration-compat] No migration delta between $PREVIOUS_RELEASE_SHA and $CURRENT_RELEASE_SHA; gate not required."
  exit 0
fi

echo "[migration-compat] Previous release: $PREVIOUS_RELEASE_SHA"
echo "[migration-compat] Candidate release: $CURRENT_RELEASE_SHA"
printf '[migration-compat] Migration delta: %s\n' "$CHANGED_MIGRATIONS"

mkdir -p "$PREVIOUS_DIR" "$UPLOAD_DIR"
git archive "$PREVIOUS_RELEASE_SHA" | tar -x -C "$PREVIOUS_DIR"

echo "[migration-compat] Installing the exact previous release dependency graph"
(
  cd "$PREVIOUS_DIR"
  npm ci --ignore-scripts --no-audit --no-fund --prefer-offline
)

echo "[migration-compat] Starting isolated PostgreSQL 16"
docker run --rm -d \
  --name "$CONTAINER_NAME" \
  -e "POSTGRES_USER=$DB_USER" \
  -e "POSTGRES_PASSWORD=$DB_PASSWORD" \
  -e "POSTGRES_DB=$DB_NAME" \
  -p 127.0.0.1::5432 \
  postgres:16-alpine >/dev/null

for attempt in $(seq 1 40); do
  if docker exec "$CONTAINER_NAME" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then
    break
  fi
  if [ "$attempt" -eq 40 ]; then
    echo "ERROR: isolated PostgreSQL did not become ready." >&2
    docker logs "$CONTAINER_NAME" --tail 40 >&2 || true
    exit 1
  fi
  sleep 1
done

HOST_PORT="$(docker port "$CONTAINER_NAME" 5432/tcp | head -n 1 | awk -F: '{print $NF}')"
if ! [[ "$HOST_PORT" =~ ^[0-9]+$ ]]; then
  echo "ERROR: unable to resolve the isolated PostgreSQL port." >&2
  exit 1
fi
DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:${HOST_PORT}/${DB_NAME}?schema=public"

echo "[migration-compat] Applying the previous release migrations and synthetic seed"
(
  cd "$PREVIOUS_DIR"
  DATABASE_URL="$DATABASE_URL" npx prisma generate --schema backend/prisma/schema.prisma
  DATABASE_URL="$DATABASE_URL" npx prisma migrate deploy --schema backend/prisma/schema.prisma
  env -i \
    PATH="$PATH" \
    HOME="${HOME:-$WORK_DIR}" \
    NODE_ENV=test \
    DATABASE_URL="$DATABASE_URL" \
    DEMO_ADMIN_PASSWORD='CompatOnly-2026!' \
    npm run prisma:seed -w backend
)

cat > "$PREVIOUS_DIR/compat-fixture.mjs" <<'FIXTURE'
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
try {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: "demo_tenant" } });
  const user = await prisma.user.findFirstOrThrow({
    where: { tenantId: tenant.id, email: "admin@demo.local" },
  });

  await prisma.tenantSubscription.upsert({
    where: { tenantId: tenant.id },
    update: { status: "ACTIVE", plan: "ENTERPRISE" },
    create: {
      id: "compat_subscription",
      tenantId: tenant.id,
      provider: "test",
      plan: "ENTERPRISE",
      billingCycle: "monthly",
      status: "ACTIVE",
      seats: 10,
      priceMonthly: 0,
    },
  });

  const site = await prisma.site.upsert({
    where: { id: "compat_site" },
    update: {},
    create: {
      id: "compat_site",
      tenantId: tenant.id,
      name: "Compatibility Site",
      address: "Synthetic address",
      city: "Roma",
    },
  });
  const vehicle = await prisma.vehicle.upsert({
    where: { id: "compat_vehicle" },
    update: {},
    create: {
      id: "compat_vehicle",
      tenantId: tenant.id,
      siteId: site.id,
      plate: "COMPAT26",
      brand: "Compatibility",
      model: "Historical fixture",
      year: 2024,
    },
  });
  const customer = await prisma.rentalCustomer.upsert({
    where: { id: "compat_customer" },
    update: {},
    create: {
      id: "compat_customer",
      tenantId: tenant.id,
      firstName: "Synthetic",
      lastName: "Customer",
      drivingLicenseNumber: "COMPAT-LICENSE",
      email: "compat-customer@example.test",
    },
  });
  const booking = await prisma.rentalBooking.upsert({
    where: { id: "compat_booking" },
    update: {},
    create: {
      id: "compat_booking",
      tenantId: tenant.id,
      vehicleId: vehicle.id,
      customerId: customer.id,
      createdByUserId: user.id,
      code: "COMPAT-BOOKING",
      status: "CONFIRMED",
      customerName: "Synthetic Customer",
      pickupAt: new Date("2026-01-10T10:00:00.000Z"),
      returnAt: new Date("2026-01-12T10:00:00.000Z"),
      expectedTotal: 240,
    },
  });
  const profile = await prisma.rentalCustomerPaymentProfile.upsert({
    where: { tenantId_rentalCustomerId: { tenantId: tenant.id, rentalCustomerId: customer.id } },
    update: {},
    create: {
      id: "compat_payment_profile",
      tenantId: tenant.id,
      rentalCustomerId: customer.id,
      stripeCustomerId: "cus_compat_synthetic",
    },
  });
  const paymentMethod = await prisma.rentalCustomerPaymentMethod.upsert({
    where: { stripePaymentMethodId: "pm_compat_synthetic" },
    update: {},
    create: {
      id: "compat_payment_method",
      tenantId: tenant.id,
      paymentProfileId: profile.id,
      rentalCustomerId: customer.id,
      bookingId: booking.id,
      stripeCustomerId: profile.stripeCustomerId,
      stripePaymentMethodId: "pm_compat_synthetic",
      status: "ACTIVE",
      mandateAccepted: true,
      mandateAcceptedAt: new Date("2026-01-09T10:00:00.000Z"),
    },
  });
  await prisma.rentalDeposit.upsert({
    where: { id: "compat_deposit" },
    update: {},
    create: {
      id: "compat_deposit",
      tenantId: tenant.id,
      bookingId: booking.id,
      rentalCustomerId: customer.id,
      vehicleId: vehicle.id,
      paymentMethodId: paymentMethod.id,
      stripePaymentIntentId: "pi_compat_synthetic",
      amountCents: 50000,
      status: "AUTHORIZED",
      authorizedAt: new Date("2026-01-09T10:05:00.000Z"),
      createdByUserId: user.id,
    },
  });
  await prisma.emailQueue.upsert({
    where: { id: "compat_email" },
    update: {},
    create: {
      id: "compat_email",
      tenantId: tenant.id,
      type: "COMPATIBILITY_FIXTURE",
      recipient: "synthetic@example.test",
      subject: "Synthetic compatibility fixture",
      body: "synthetic historical payload",
      status: "SENT",
    },
  });
  await prisma.demoLead.upsert({
    where: { id: "compat_demo_lead" },
    update: {},
    create: {
      id: "compat_demo_lead",
      companyName: "Compatibility Demo",
      fullName: "Synthetic Lead",
      email: "compat-demo@example.test",
      source: "compatibility-gate",
    },
  });
} finally {
  await prisma.$disconnect();
}
FIXTURE

(
  cd "$PREVIOUS_DIR"
  DATABASE_URL="$DATABASE_URL" node compat-fixture.mjs
)

echo "[migration-compat] Applying candidate migrations over historical synthetic data"
DATABASE_URL="$DATABASE_URL" npx prisma migrate deploy --schema backend/prisma/schema.prisma

docker exec "$CONTAINER_NAME" psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" <<'SQL' >/dev/null
DO $$
BEGIN
  IF to_regclass('public."OauthFlow"') IS NULL THEN
    RAISE EXCEPTION 'OauthFlow table missing after candidate migrations';
  END IF;
  IF to_regclass('public."RentalDeposit_one_active_per_booking_uidx"') IS NULL THEN
    RAISE EXCEPTION 'rental deposit active-claim index missing after candidate migrations';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'EmailQueue' AND column_name = 'payloadPurgedAt'
  ) THEN
    RAISE EXCEPTION 'EmailQueue.payloadPurgedAt missing after candidate migrations';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'EmailQueue'
      AND column_name IN ('processingToken', 'processingStartedAt', 'leaseExpiresAt')
    GROUP BY table_schema, table_name
    HAVING COUNT(*) = 3
  ) THEN
    RAISE EXCEPTION 'EmailQueue lease columns missing after candidate migrations';
  END IF;
  IF to_regclass('public."EmailQueue_status_nextAttemptAt_leaseExpiresAt_idx"') IS NULL THEN
    RAISE EXCEPTION 'EmailQueue lease index missing after candidate migrations';
  END IF;
  IF to_regclass('public."RentalBookingCreateRequest"') IS NULL THEN
    RAISE EXCEPTION 'RentalBookingCreateRequest table missing after candidate migrations';
  END IF;
  IF to_regclass('public."RentalBookingCreateRequest_tenantId_idempotencyKey_key"') IS NULL THEN
    RAISE EXCEPTION 'rental booking idempotency constraint missing after candidate migrations';
  END IF;
  IF to_regclass('public."BookingContractEmailRequest"') IS NULL
    OR to_regclass('public."BookingContractEmailRequest_tenantId_idempotencyKey_key"') IS NULL
    OR to_regclass('public."BookingContractEmailRequest_queueEmailId_key"') IS NULL THEN
    RAISE EXCEPTION 'contract email command ledger missing after candidate migrations';
  END IF;
  IF to_regclass('public."InvoiceEmailRequest"') IS NULL
    OR to_regclass('public."InvoiceEmailRequest_tenantId_idempotencyKey_key"') IS NULL
    OR to_regclass('public."InvoiceEmailRequest_queueEmailId_key"') IS NULL THEN
    RAISE EXCEPTION 'invoice email command ledger missing after candidate migrations';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'DemoLead'
      AND column_name IN ('idempotencyKey', 'requestHash')
    GROUP BY table_schema, table_name
    HAVING COUNT(*) = 2
  ) THEN
    RAISE EXCEPTION 'demo idempotency columns missing after candidate migrations';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "RentalDeposit" WHERE "id" = 'compat_deposit' AND "status" = 'AUTHORIZED') THEN
    RAISE EXCEPTION 'historical rental deposit was not preserved';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "EmailQueue"
    WHERE "id" = 'compat_email'
      AND "body" = 'synthetic historical payload'
      AND "processingToken" IS NULL
      AND "processingStartedAt" IS NULL
      AND "leaseExpiresAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'historical email queue payload was not preserved';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "DemoLead"
    WHERE "id" = 'compat_demo_lead'
      AND "idempotencyKey" IS NULL
      AND "requestHash" IS NULL
  ) THEN
    RAISE EXCEPTION 'historical demo lead was not preserved';
  END IF;
END $$;
SQL

cat > "$PREVIOUS_DIR/compat-http-smoke.mjs" <<'SMOKE'
import assert from "node:assert/strict";
import { createApp } from "./backend/src/app.ts";
import { prisma } from "./backend/src/infrastructure/database/prisma/client.ts";

const server = createApp().listen(0, "127.0.0.1");
await new Promise((resolve, reject) => {
  server.once("listening", resolve);
  server.once("error", reject);
});

try {
  const address = server.address();
  assert(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}/api`;

  const ready = await fetch(`${baseUrl}/ready`);
  assert.equal(ready.status, 200, "previous release readiness must pass on the migrated schema");
  const readyBody = await ready.json();
  assert.equal(readyBody.db, "up");

  const login = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "admin@demo.local", password: "CompatOnly-2026!" }),
  });
  assert.equal(login.status, 200, "previous release login must pass on the migrated schema");
  const loginBody = await login.json();
  const setCookies = typeof login.headers.getSetCookie === "function"
    ? login.headers.getSetCookie()
    : [login.headers.get("set-cookie")].filter(Boolean);
  const requestHeaders = {};
  if (typeof loginBody.token === "string") {
    requestHeaders.authorization = `Bearer ${loginBody.token}`;
  } else {
    requestHeaders.cookie = setCookies.map((cookie) => cookie.split(";", 1)[0]).join("; ");
  }
  assert(requestHeaders.authorization || requestHeaders.cookie, "login must return an access credential");

  const vehicles = await fetch(`${baseUrl}/master-data/vehicles?page=1&pageSize=20`, {
    headers: requestHeaders,
  });
  assert.equal(vehicles.status, 200, "previous release must serve an authenticated business read");
  const vehiclesBody = await vehicles.json();
  assert.match(JSON.stringify(vehiclesBody), /COMPAT26/);
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await prisma.$disconnect();
}
SMOKE

echo "[migration-compat] Starting the previous application against the migrated schema"
(
  cd "$PREVIOUS_DIR"
  env -i \
    PATH="$PATH" \
    HOME="${HOME:-$WORK_DIR}" \
    NODE_ENV=test \
    DATABASE_URL="$DATABASE_URL" \
    UPLOAD_DIR="$UPLOAD_DIR" \
    BILLING_DUNNING_CRON_ENABLED=false \
    PRIVACY_RETENTION_CRON_ENABLED=false \
    node --import tsx compat-http-smoke.mjs
)

ELAPSED="$(( $(date +%s) - STARTED_AT ))"
echo "[migration-compat] PASS in ${ELAPSED}s; previous release served ready, login and tenant data after candidate migrations"
