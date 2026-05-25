import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { VehicleProfitabilityReportService } from "../src/application/services/vehicle-profitability-report-service.js";
import { prisma } from "../src/infrastructure/database/prisma/client.js";

const original = {
  vehicleFindMany: prisma.vehicle.findMany,
  rentalBookingFindMany: prisma.rentalBooking.findMany,
  vehicleMaintenanceFindMany: prisma.vehicleMaintenance.findMany,
  vehicleCostFindMany: prisma.vehicleCost.findMany,
  stoppageFindMany: prisma.stoppage.findMany
};

afterEach(() => {
  (prisma.vehicle as any).findMany = original.vehicleFindMany;
  (prisma.rentalBooking as any).findMany = original.rentalBookingFindMany;
  (prisma.vehicleMaintenance as any).findMany = original.vehicleMaintenanceFindMany;
  (prisma.vehicleCost as any).findMany = original.vehicleCostFindMany;
  (prisma.stoppage as any).findMany = original.stoppageFindMany;
});

const baseParams = {
  dateFrom: new Date("2026-01-01T00:00:00.000Z"),
  dateTo: new Date("2026-01-10T00:00:00.000Z"),
  includeVat: true,
  includeCosts: true
};

test("vehicle profitability report calculates revenue, costs, utilization and ROI with tenant filters", async () => {
  (prisma.vehicle as any).findMany = async (input: any) => {
    assert.equal(input.where.tenantId, "tenant_a");
    assert.equal(input.where.deletedAt, null);
    return [
      {
        id: "veh_1",
        plate: "GF100AA",
        brand: "Fiat",
        model: "500",
        purchasePrice: 10000,
        purchaseDate: new Date("2025-12-15T00:00:00.000Z"),
        residualValue: 7000,
        monthlyFixedCost: 300,
        site: { id: "site_1", name: "Roma Centro", city: "Roma" }
      }
    ];
  };

  (prisma.rentalBooking as any).findMany = async (input: any) => {
    assert.equal(input.where.tenantId, "tenant_a");
    assert.deepEqual(input.where.vehicleId.in, ["veh_1"]);
    assert.equal(input.where.deletedAt, null);
    assert.ok(!input.where.status.in.includes("CANCELED"));
    return [
      {
        id: "book_1",
        tenantId: "tenant_a",
        vehicleId: "veh_1",
        customerName: "Cliente Demo",
        pickupAt: new Date("2026-01-02T09:00:00.000Z"),
        returnAt: new Date("2026-01-04T18:00:00.000Z"),
        status: "CONTRACT_SIGNED",
        finalTotal: 1000,
        expectedTotal: 1000,
        vehicle: { id: "veh_1", plate: "GF100AA", brand: "Fiat", model: "500" },
        contract: { id: "contract_1", status: "SIGNED" },
        pricingSnapshot: { finalTotal: 1000, finalSubtotal: 819.67, vatRate: 22, extraKmActualCost: 0 }
      }
    ];
  };

  (prisma.vehicleMaintenance as any).findMany = async (input: any) => {
    assert.equal(input.where.tenantId, "tenant_a");
    return [
      {
        vehicleId: "veh_1",
        cost: 100,
        performedAt: new Date("2026-01-03T00:00:00.000Z"),
        maintenanceType: "TAGLIANDO",
        description: "Tagliando"
      }
    ];
  };

  (prisma.vehicleCost as any).findMany = async (input: any) => {
    assert.equal(input.where.tenantId, "tenant_a");
    return [
      {
        vehicleId: "veh_1",
        amount: 200,
        type: "INSURANCE",
        description: "Assicurazione",
        date: new Date("2026-01-01T00:00:00.000Z"),
        recurring: false
      }
    ];
  };

  (prisma.stoppage as any).findMany = async (input: any) => {
    assert.equal(input.where.tenantId, "tenant_a");
    return [{ vehicleId: "veh_1", openedAt: new Date("2026-01-05T00:00:00.000Z"), closedAt: new Date("2026-01-06T00:00:00.000Z") }];
  };

  const service = new VehicleProfitabilityReportService();
  const report = await service.build("tenant_a", { ...baseParams, vehicleId: "veh_1" });

  assert.equal(report.summary.totalRevenue, 1000);
  assert.equal(report.summary.totalCosts, 400);
  assert.equal(report.summary.grossMargin, 600);
  assert.equal(report.summary.rentedDays, 3);
  assert.equal(report.summary.technicalStopDays, 2);
  assert.equal(report.summary.availableDays, 8);
  assert.equal(report.summary.utilizationRate, 37.5);
  assert.equal(report.investment.purchasePrice, 10000);
  assert.equal(report.investment.recoveredPercentage, 6);
  assert.equal(report.investment.remainingToBreakEven, 9400);
  assert.equal(report.investment.breakEvenReached, false);
  assert.equal(report.rows[0].source, "CONTRACT");
});

test("vehicle profitability report keeps ROI nullable when purchase price is missing", async () => {
  (prisma.vehicle as any).findMany = async () => [
    {
      id: "veh_2",
      plate: "GF200BB",
      brand: "Toyota",
      model: "Yaris",
      purchasePrice: null,
      purchaseDate: null,
      residualValue: null,
      monthlyFixedCost: null,
      site: null
    }
  ];
  (prisma.rentalBooking as any).findMany = async () => [];
  (prisma.vehicleMaintenance as any).findMany = async () => [];
  (prisma.vehicleCost as any).findMany = async () => [];
  (prisma.stoppage as any).findMany = async () => [];

  const report = await new VehicleProfitabilityReportService().build("tenant_a", { ...baseParams, vehicleId: "veh_2" });

  assert.equal(report.investment.purchasePrice, null);
  assert.equal(report.investment.recoveredPercentage, null);
  assert.equal(report.investment.remainingToBreakEven, null);
  assert.equal(report.investment.breakEvenReached, null);
  assert.equal(report.vehicles[0].recoveredPercentage, null);
});

test("vehicle profitability exports produce usable csv, xlsx and pdf payloads", async () => {
  const service = new VehicleProfitabilityReportService();
  const report = (service as any).empty({ ...baseParams, vehicleId: "veh_1" });
  const csv = await service.toCsv(report);
  const xlsx = await service.toXlsx(report);
  const pdf = await service.toPdf(report);

  assert.match(csv, /Report redditivita veicolo/);
  assert.ok(Buffer.from(xlsx as any).length > 1000);
  assert.equal(Buffer.from(pdf).subarray(0, 4).toString(), "%PDF");
});
