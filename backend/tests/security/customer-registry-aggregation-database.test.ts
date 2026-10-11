import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { after, before, describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import { prisma } from "../../src/infrastructure/database/prisma/client.js";
import {
  buildCustomerBookingStatsQuery,
  RentalBookingsController
} from "../../src/interfaces/http/controllers/rental-bookings-controller.js";

const runId = `customer-registry-aggregation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const volume = 100_000;

let tenantAId = "";
let tenantBId = "";
let primaryCustomerId = "";
let deletedOnlyCustomerId = "";
let primaryVehicleId = "";
let tenantBVehicleId = "";

const response = () => ({
  statusCode: 200,
  body: null as any,
  status(code: number) {
    this.statusCode = code;
    return this;
  },
  json(payload: unknown) {
    this.body = payload;
    return this;
  }
});

const percentile = (values: number[], quantile: number) => {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(ordered.length * quantile) - 1)] ?? 0;
};

const legacyStats = async (tenantId: string, customerIds: string[]) => {
  const bookings = await prisma.rentalBooking.findMany({
    where: { tenantId, deletedAt: null, customerId: { in: customerIds } },
    orderBy: [{ pickupAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      customerId: true,
      code: true,
      status: true,
      contractStatus: true,
      pickupAt: true,
      createdAt: true,
      contract: { select: { id: true } }
    }
  });
  const allCounts = await prisma.rentalBooking.groupBy({
    by: ["customerId"],
    where: { tenantId, customerId: { in: customerIds } },
    _count: { _all: true }
  });
  const allByCustomer = new Map(
    allCounts.flatMap((row) => (row.customerId ? [[row.customerId, row._count._all] as const] : []))
  );
  const result = new Map<
    string,
    {
      bookingsTotal: number;
      contractsTotal: number;
      lastRentalAt: Date | null;
      lastRentalCode: string | null;
      lastRentalStatus: string | null;
      lastRentalContractStatus: string | null;
    }
  >();

  for (const customerId of customerIds) {
    result.set(customerId, {
      bookingsTotal: allByCustomer.get(customerId) ?? 0,
      contractsTotal: 0,
      lastRentalAt: null,
      lastRentalCode: null,
      lastRentalStatus: null,
      lastRentalContractStatus: null
    });
  }

  for (const booking of bookings) {
    if (!booking.customerId) continue;
    const current = result.get(booking.customerId)!;
    if (current.lastRentalAt === null) {
      current.bookingsTotal = 0;
      current.lastRentalAt = booking.pickupAt;
      current.lastRentalCode = booking.code;
      current.lastRentalStatus = booking.status;
      current.lastRentalContractStatus = booking.contractStatus;
    }
    current.bookingsTotal += 1;
    if (booking.contract?.id) current.contractsTotal += 1;
  }

  return result;
};

const cleanup = async () => {
  const tenantIds = [tenantAId, tenantBId].filter(Boolean);
  if (tenantIds.length === 0) return;
  await prisma.rentalCustomerAttachment.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.bookingContract.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.rentalBooking.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.rentalCustomer.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.vehicle.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.site.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
};

describe("customer registry database aggregation", () => {
  before(async () => {
    await prisma.$connect();

    const [tenantA, tenantB] = await Promise.all([
      prisma.tenant.create({ data: { name: `${runId}-tenant-a` } }),
      prisma.tenant.create({ data: { name: `${runId}-tenant-b` } })
    ]);
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;

    const [siteA, siteB] = await Promise.all([
      prisma.site.create({
        data: { tenantId: tenantAId, name: `${runId}-site-a`, address: "Via Sintetica 1", city: "Roma" }
      }),
      prisma.site.create({
        data: { tenantId: tenantBId, name: `${runId}-site-b`, address: "Via Sintetica 2", city: "Milano" }
      })
    ]);
    const [vehicleA, vehicleB] = await Promise.all([
      prisma.vehicle.create({
        data: { tenantId: tenantAId, siteId: siteA.id, plate: `A${Date.now()}`.slice(-12), brand: "Test", model: "A" }
      }),
      prisma.vehicle.create({
        data: { tenantId: tenantBId, siteId: siteB.id, plate: `B${Date.now()}`.slice(-12), brand: "Test", model: "B" }
      })
    ]);
    primaryVehicleId = vehicleA.id;
    tenantBVehicleId = vehicleB.id;

    const [primaryCustomer, deletedOnlyCustomer] = await Promise.all([
      prisma.rentalCustomer.create({
        data: {
          tenantId: tenantAId,
          firstName: "Volume",
          lastName: "Cliente",
          drivingLicenseNumber: `${runId}-primary`
        }
      }),
      prisma.rentalCustomer.create({
        data: {
          tenantId: tenantAId,
          firstName: "Solo",
          lastName: "Eliminati",
          drivingLicenseNumber: `${runId}-deleted`
        }
      })
    ]);
    primaryCustomerId = primaryCustomer.id;
    deletedOnlyCustomerId = deletedOnlyCustomer.id;

    const bookingPrefix = `${runId}-booking-`;
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "RentalBooking" (
        "id", "tenantId", "vehicleId", "customerId", "code", "customerName",
        "pickupAt", "returnAt", "createdAt", "updatedAt"
      )
      SELECT
        ${bookingPrefix} || lpad(series::text, 6, '0'),
        ${tenantAId},
        ${primaryVehicleId},
        ${primaryCustomerId},
        'VOL-' || ${runId} || '-' || lpad(series::text, 6, '0'),
        'Volume Cliente',
        CASE
          WHEN series >= ${volume - 1} THEN TIMESTAMP '2035-01-01 12:00:00'
          ELSE TIMESTAMP '2030-01-01 00:00:00' + series * INTERVAL '1 minute'
        END,
        CASE
          WHEN series >= ${volume - 1} THEN TIMESTAMP '2035-01-02 12:00:00'
          ELSE TIMESTAMP '2030-01-02 00:00:00' + series * INTERVAL '1 minute'
        END,
        CASE
          WHEN series >= ${volume - 1} THEN TIMESTAMP '2035-01-01 10:00:00'
          ELSE TIMESTAMP '2030-01-01 00:00:00' + series * INTERVAL '1 minute'
        END,
        CURRENT_TIMESTAMP
      FROM generate_series(1, ${volume}) AS series
    `);

    const contractPrefix = `${runId}-contract-`;
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "BookingContract" (
        "id", "tenantId", "bookingId", "title", "content", "createdAt", "updatedAt"
      )
      SELECT
        ${contractPrefix} || lpad(series::text, 6, '0'),
        ${tenantAId},
        ${bookingPrefix} || lpad(series::text, 6, '0'),
        'Contratto sintetico',
        'Contenuto sintetico',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      FROM generate_series(10, ${volume}, 10) AS series
    `);

    const deletedPrimary = await prisma.rentalBooking.create({
      data: {
        tenantId: tenantAId,
        vehicleId: primaryVehicleId,
        customerId: primaryCustomerId,
        code: `${runId}-deleted-primary`,
        customerName: "Volume Cliente",
        pickupAt: new Date("2099-01-01T00:00:00.000Z"),
        returnAt: new Date("2099-01-02T00:00:00.000Z"),
        deletedAt: new Date("2036-01-01T00:00:00.000Z")
      }
    });
    const deletedOnly = await prisma.rentalBooking.create({
      data: {
        tenantId: tenantAId,
        vehicleId: primaryVehicleId,
        customerId: deletedOnlyCustomerId,
        code: `${runId}-deleted-only`,
        customerName: "Solo Eliminati",
        pickupAt: new Date("2099-02-01T00:00:00.000Z"),
        returnAt: new Date("2099-02-02T00:00:00.000Z"),
        deletedAt: new Date("2036-01-01T00:00:00.000Z")
      }
    });
    await prisma.bookingContract.createMany({
      data: [deletedPrimary, deletedOnly].map((booking) => ({
        tenantId: tenantAId,
        bookingId: booking.id,
        title: "Contratto eliminato",
        content: "Il booking associato e soft-deleted"
      }))
    });

    // The schema only has a global customer FK. This deliberately corrupt-looking
    // row proves every aggregate still scopes by tenant before using customerId.
    const foreignBooking = await prisma.rentalBooking.create({
      data: {
        tenantId: tenantBId,
        vehicleId: tenantBVehicleId,
        customerId: primaryCustomerId,
        code: `${runId}-foreign`,
        customerName: "Tenant estraneo",
        pickupAt: new Date("2100-01-01T00:00:00.000Z"),
        returnAt: new Date("2100-01-02T00:00:00.000Z")
      }
    });
    await prisma.bookingContract.create({
      data: {
        tenantId: tenantBId,
        bookingId: foreignBooking.id,
        title: "Contratto tenant estraneo",
        content: "Non deve influire sulle statistiche del tenant A"
      }
    });
    await prisma.rentalCustomerAttachment.createMany({
      data: [
        {
          tenantId: tenantAId,
          customerId: primaryCustomerId,
          filePath: `/synthetic/${runId}/tenant-a-license.pdf`,
          fileName: "tenant-a-license.pdf",
          mimeType: "application/pdf",
          sizeBytes: 128,
          category: "LICENSE"
        },
        {
          tenantId: tenantBId,
          customerId: primaryCustomerId,
          bookingId: foreignBooking.id,
          filePath: `/synthetic/${runId}/tenant-b-private.pdf`,
          fileName: "tenant-b-private.pdf",
          mimeType: "application/pdf",
          sizeBytes: 256,
          category: "PRIVATE"
        }
      ]
    });

    // Refresh planner statistics after the synthetic bulk load so EXPLAIN and
    // latency evidence reflect the fixture instead of stale empty-table stats.
    await prisma.$executeRaw(Prisma.sql`ANALYZE "RentalBooking"`);
    await prisma.$executeRaw(Prisma.sql`ANALYZE "BookingContract"`);
  });

  after(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("matches the legacy response semantics while keeping tenant and soft-delete boundaries", async () => {
    const customerIds = [primaryCustomerId, deletedOnlyCustomerId];
    const expected = await legacyStats(tenantAId, customerIds);
    const controller = new RentalBookingsController();
    const listResponse = response();

    await controller.listCustomerRegistry(
      { auth: { tenantId: tenantAId }, query: { page: "1", pageSize: "200" } } as any,
      listResponse as any
    );

    assert.equal(listResponse.statusCode, 200);
    assert.equal(listResponse.body.total, 2);
    assert.equal(listResponse.body.data.length, 2);
    for (const row of listResponse.body.data) {
      const baseline = expected.get(row.id)!;
      assert.equal(row.bookingsTotal, baseline.bookingsTotal);
      assert.equal(row.contractsTotal, baseline.contractsTotal);
      assert.equal(row.lastRentalAt?.toISOString() ?? null, baseline.lastRentalAt?.toISOString() ?? null);
      assert.equal(row.lastRentalCode, baseline.lastRentalCode);
      assert.equal(row.lastRentalStatus, baseline.lastRentalStatus);
      assert.equal(row.lastRentalContractStatus, baseline.lastRentalContractStatus);
    }

    const primary = listResponse.body.data.find((row: any) => row.id === primaryCustomerId);
    assert.equal(primary.bookingsTotal, volume);
    assert.equal(primary.contractsTotal, volume / 10);
    assert.equal(primary.lastRentalCode, `VOL-${runId}-${String(volume).padStart(6, "0")}`);
    assert.equal(primary._count.bookings, volume + 1, "tenant B must not leak through relation counts");

    const deletedOnly = listResponse.body.data.find((row: any) => row.id === deletedOnlyCustomerId);
    assert.equal(deletedOnly.bookingsTotal, 1, "legacy fallback counts all bookings when none are active");
    assert.equal(deletedOnly.contractsTotal, 0);
    assert.equal(deletedOnly.lastRentalAt, null);

    const profileResponse = response();
    await controller.getCustomerProfile(
      { auth: { tenantId: tenantAId }, params: { customerId: primaryCustomerId } } as any,
      profileResponse as any
    );
    assert.equal(profileResponse.body.stats.bookingsTotal, volume + 1);
    assert.equal(profileResponse.body.stats.contractsTotal, volume / 10);
    assert.equal(profileResponse.body.stats.attachmentsTotal, 1);
    assert.deepEqual(profileResponse.body.attachments.map((attachment: any) => attachment.fileName), ["tenant-a-license.pdf"]);
    assert.equal(profileResponse.body.stats.lastRentalCode, `VOL-${runId}-${String(volume).padStart(6, "0")}`);
  });

  it("returns one aggregate row per requested customer and records plan plus p50/p95 on 100,000 bookings", async () => {
    const query = buildCustomerBookingStatsQuery(tenantAId, [primaryCustomerId, deletedOnlyCustomerId]);
    const aggregateRows = await prisma.$queryRaw<any[]>(query);
    assert.equal(aggregateRows.length, 2);

    const explain = await prisma.$queryRaw<Array<{ "QUERY PLAN": unknown }>>(
      Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`
    );
    const samples: number[] = [];
    for (let index = 0; index < 12; index += 1) {
      const startedAt = performance.now();
      const rows = await prisma.$queryRaw<any[]>(query);
      samples.push(performance.now() - startedAt);
      assert.equal(rows.length, 2);
    }

    const evidence = {
      datasetBookings: volume,
      aggregateRowsReturned: aggregateRows.length,
      samples: samples.length,
      p50Ms: Number(percentile(samples, 0.5).toFixed(2)),
      p95Ms: Number(percentile(samples, 0.95).toFixed(2)),
      explain: explain[0]?.["QUERY PLAN"] ?? null
    };
    console.info(`[BE-09 evidence] ${JSON.stringify(evidence)}`);
    assert.equal(evidence.datasetBookings, 100_000);
    assert.equal(evidence.aggregateRowsReturned, 2);
    assert.ok(evidence.explain);
  });
});
