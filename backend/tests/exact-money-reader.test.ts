import assert from "node:assert/strict";
import test from "node:test";
import {
  ExactMoneyReader,
  type ExactMoneyReadMode,
  type ExactMoneyModel
} from "../src/infrastructure/database/exact-money-reader.js";

type QueryCall = {
  sql: string;
  values: unknown[];
};

type Observation = {
  model: ExactMoneyModel;
  mode: ExactMoneyReadMode;
  recordsChecked: number;
  mismatchCount: number;
  fallbackCount: number;
};

const createReader = (
  mode: ExactMoneyReadMode,
  exactRows: Array<Record<string, string | null>>,
  queryCalls: QueryCall[],
  observations: Observation[],
  mismatchLogs: Array<Observation & { fieldsChecked: number }>
) =>
  new ExactMoneyReader(mode, {
    query: async <T>(sql: string, ...values: unknown[]) => {
      queryCalls.push({ sql, values });
      return exactRows as T;
    },
    observe: (input) => observations.push(input),
    logMismatch: (input) => mismatchLogs.push(input)
  });

test("legacy mode returns legacy values without querying exact columns", async () => {
  const queryCalls: QueryCall[] = [];
  const observations: Observation[] = [];
  const mismatchLogs: Array<Observation & { fieldsChecked: number }> = [];
  const reader = createReader("legacy", [], queryCalls, observations, mismatchLogs);
  const record = {
    id: "vehicle-1",
    purchasePrice: 10_000.005,
    residualValue: null,
    monthlyFixedCost: 125.555
  };

  const result = await reader.hydrate("Vehicle", [record], {
    tenantId: "tenant-a"
  });

  assert.deepEqual(result, [record]);
  assert.equal(queryCalls.length, 0);
  assert.equal(observations.length, 0);
  assert.equal(mismatchLogs.length, 0);
});

test("partial Prisma selections keep their original response shape", async () => {
  const queryCalls: QueryCall[] = [];
  const reader = createReader(
    "exact",
    [
      {
        id: "list-1",
        baseRateAmountExact: "149.0000",
        vatRateExact: "22.0000",
        discountPercentExact: "0.0000"
      }
    ],
    queryCalls,
    [],
    []
  );
  const record = { id: "list-1", name: "Standard" };

  const [result] = await reader.hydrate("RentalPriceList", [record], {
    tenantId: "tenant-a"
  });

  assert.deepEqual(result, record);
  assert.deepEqual(Object.keys(result).sort(), ["id", "name"]);
  assert.equal(queryCalls.length, 0);
});

test("compare mode detects drift but preserves the legacy API payload", async () => {
  const queryCalls: QueryCall[] = [];
  const observations: Observation[] = [];
  const mismatchLogs: Array<Observation & { fieldsChecked: number }> = [];
  const reader = createReader(
    "compare",
    [
      {
        id: "list-1",
        baseRateAmountExact: "150.0000",
        vatRateExact: "21.0000",
        discountPercentExact: "0.0000"
      }
    ],
    queryCalls,
    observations,
    mismatchLogs
  );
  const record = {
    id: "list-1",
    baseRateAmount: 149.99996,
    vatRate: 22,
    discountPercent: 0
  };

  const [result] = await reader.hydrate("RentalPriceList", [record], {
    tenantId: "tenant-a"
  });

  assert.deepEqual(result, record);
  assert.equal(queryCalls.length, 1);
  assert.match(queryCalls[0].sql, /FROM "RentalPriceList"/);
  assert.match(queryCalls[0].sql, /"tenantId" = \$2/);
  assert.deepEqual(queryCalls[0].values, [["list-1"], "tenant-a"]);
  assert.deepEqual(observations, [
    {
      model: "RentalPriceList",
      mode: "compare",
      recordsChecked: 1,
      mismatchCount: 1,
      fallbackCount: 0
    }
  ]);
  assert.equal(mismatchLogs[0].fieldsChecked, 3);
});

test("exact mode replaces legacy numbers while keeping the response shape", async () => {
  const queryCalls: QueryCall[] = [];
  const observations: Observation[] = [];
  const mismatchLogs: Array<Observation & { fieldsChecked: number }> = [];
  const reader = createReader(
    "exact",
    [
      {
        id: "vehicle-1",
        purchasePriceExact: "10000.01",
        residualValueExact: null,
        monthlyFixedCostExact: "123.46"
      }
    ],
    queryCalls,
    observations,
    mismatchLogs
  );
  const record = {
    id: "vehicle-1",
    purchasePrice: 10_000.004,
    residualValue: null,
    monthlyFixedCost: 123.455,
    plate: "DEMO"
  };

  const [result] = await reader.hydrate("Vehicle", [record], {
    tenantId: "tenant-a"
  });

  assert.deepEqual(result, {
    ...record,
    purchasePrice: 10_000.01,
    residualValue: null,
    monthlyFixedCost: 123.46
  });
  assert.equal(result.plate, "DEMO");
  assert.equal(observations[0].mismatchCount, 1);
  assert.equal(observations[0].fallbackCount, 0);
});

test("exact mode falls back to a populated legacy value when the exact row is missing", async () => {
  const queryCalls: QueryCall[] = [];
  const observations: Observation[] = [];
  const mismatchLogs: Array<Observation & { fieldsChecked: number }> = [];
  const reader = createReader("exact", [], queryCalls, observations, mismatchLogs);
  const record = {
    id: "subscription-1",
    priceMonthly: 149
  };

  const [result] = await reader.hydrate("TenantSubscription", [record], {
    tenantId: "tenant-a"
  });

  assert.deepEqual(result, record);
  assert.equal(observations[0].mismatchCount, 1);
  assert.equal(observations[0].fallbackCount, 1);
  assert.equal(mismatchLogs[0].fallbackCount, 1);
});

test("compare mode never blocks business reads when the shadow query fails", async () => {
  const observations: Observation[] = [];
  const mismatchLogs: Array<Observation & { fieldsChecked: number }> = [];
  const reader = new ExactMoneyReader("compare", {
    query: async <T>() => {
      throw new Error("simulated exact read failure");
    },
    observe: (input) => observations.push(input),
    logMismatch: (input) => mismatchLogs.push(input)
  });
  const record = {
    id: "invoice-1",
    subtotal: 100,
    taxRate: 22,
    taxAmount: 22,
    total: 122
  };

  const [result] = await reader.hydrate("Invoice", [record], {
    tenantId: "tenant-a"
  });

  assert.deepEqual(result, record);
  assert.deepEqual(observations, [
    {
      model: "Invoice",
      mode: "compare",
      recordsChecked: 1,
      mismatchCount: 0,
      fallbackCount: 1
    }
  ]);
  assert.equal(mismatchLogs[0].fallbackCount, 1);
  assert.equal(mismatchLogs[0].fieldsChecked, 4);
});

test("exact reads cover audited fields that currently have no production rows", async () => {
  const attachmentReader = createReader(
    "exact",
    [{ id: "attachment-1", invoiceTotalAmountExact: "42.50" }],
    [],
    [],
    []
  );
  const tierReader = createReader(
    "exact",
    [{ id: "tier-1", ratePerKmExact: "0.3750" }],
    [],
    [],
    []
  );

  const attachment = await attachmentReader.hydrateOne(
    "VehicleMaintenanceAttachment",
    { id: "attachment-1", invoiceTotalAmount: 42.499 },
    { tenantId: "tenant-a" }
  );
  const tier = await tierReader.hydrateOne(
    "RentalExtraKmTier",
    { id: "tier-1", ratePerKm: 0.37 },
    { tenantId: "tenant-a" }
  );

  assert.equal(attachment.invoiceTotalAmount, 42.5);
  assert.equal(tier.ratePerKm, 0.375);
});
