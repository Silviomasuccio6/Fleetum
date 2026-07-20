import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { useEntitlementsStore } from "../src/application/stores/entitlements-store";
import type { EntitlementsSnapshot } from "../src/application/stores/entitlements-store";

const snapshot = (
  tenantId: string,
  overrides: Partial<EntitlementsSnapshot> = {}
): EntitlementsSnapshot => ({
  tenantId,
  plan: "PRO",
  licenseStatus: "ACTIVE",
  provider: "stripe",
  billingCycle: "yearly",
  expiresAt: "2027-07-20T00:00:00.000Z",
  daysRemaining: 365,
  expiringSoon: false,
  priceMonthly: 199,
  features: ["dashboard_overview", "export_csv"],
  ...overrides
});

beforeEach(() => {
  useEntitlementsStore.getState().reset();
});

test("deduplicates concurrent entitlement loads and commits one complete snapshot", async () => {
  let resolveLoad!: (value: EntitlementsSnapshot) => void;
  let calls = 0;
  const pending = new Promise<EntitlementsSnapshot>((resolve) => {
    resolveLoad = resolve;
  });
  const load = () => {
    calls += 1;
    return pending;
  };

  const first = useEntitlementsStore.getState().refreshEntitlements({ tenantId: "tenant-a", load });
  const second = useEntitlementsStore.getState().refreshEntitlements({ tenantId: "tenant-a", load });

  await Promise.resolve();
  assert.equal(calls, 1);
  resolveLoad(snapshot("tenant-a"));
  await Promise.all([first, second]);

  const state = useEntitlementsStore.getState();
  assert.equal(state.loaded, true);
  assert.equal(state.loading, false);
  assert.equal(state.tenantId, "tenant-a");
  assert.equal(state.plan, "PRO");
  assert.equal(state.licenseStatus, "ACTIVE");
  assert.equal(state.provider, "stripe");
  assert.equal(state.billingCycle, "yearly");
  assert.deepEqual(state.features, ["dashboard_overview", "export_csv"]);
});

test("a failed forced refresh preserves the last complete entitlement snapshot", async () => {
  const initial = snapshot("tenant-a");
  await useEntitlementsStore.getState().refreshEntitlements({
    tenantId: "tenant-a",
    load: async () => initial
  });

  await assert.rejects(
    useEntitlementsStore.getState().refreshEntitlements({
      tenantId: "tenant-a",
      force: true,
      load: async () => {
        throw new Error("backend unavailable");
      }
    }),
    /backend unavailable/
  );

  const state = useEntitlementsStore.getState();
  assert.equal(state.loaded, true);
  assert.equal(state.plan, initial.plan);
  assert.equal(state.licenseStatus, initial.licenseStatus);
  assert.equal(state.provider, initial.provider);
  assert.equal(state.billingCycle, initial.billingCycle);
  assert.equal(state.error, "backend unavailable");
});

test("an older tenant response cannot overwrite the current tenant", async () => {
  let resolveTenantA!: (value: EntitlementsSnapshot) => void;
  const tenantARequest = new Promise<EntitlementsSnapshot>((resolve) => {
    resolveTenantA = resolve;
  });

  const first = useEntitlementsStore.getState().refreshEntitlements({
    tenantId: "tenant-a",
    load: () => tenantARequest
  });
  const tenantB = snapshot("tenant-b", { plan: "ENTERPRISE", billingCycle: "monthly" });
  await useEntitlementsStore.getState().refreshEntitlements({
    tenantId: "tenant-b",
    load: async () => tenantB
  });

  resolveTenantA(snapshot("tenant-a", { plan: "STARTER" }));
  await first;

  const state = useEntitlementsStore.getState();
  assert.equal(state.tenantId, "tenant-b");
  assert.equal(state.plan, "ENTERPRISE");
  assert.equal(state.billingCycle, "monthly");
});
