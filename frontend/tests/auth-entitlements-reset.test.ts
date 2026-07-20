import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { useAuthStore } from "../src/application/stores/auth-store";
import { useEntitlementsStore } from "../src/application/stores/entitlements-store";
import type { EntitlementsSnapshot } from "../src/application/stores/entitlements-store";
import type { User } from "../src/domain/entities/models";

const createStorage = () => {
  const values = new Map<string, string>();
  return {
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size;
    },
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value)
  } satisfies Storage;
};

Object.defineProperty(globalThis, "localStorage", { configurable: true, value: createStorage() });
Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: createStorage() });

const user = (tenantId: string): User => ({
  id: `user-${tenantId}`,
  tenantId,
  email: `${tenantId}@example.test`,
  firstName: "Demo",
  lastName: "Admin",
  roles: ["ADMIN"],
  permissions: []
});

const entitlement = (tenantId: string): EntitlementsSnapshot => ({
  tenantId,
  plan: "PRO",
  licenseStatus: "ACTIVE",
  provider: "stripe",
  billingCycle: "monthly",
  expiresAt: null,
  daysRemaining: null,
  expiringSoon: false,
  priceMonthly: 199,
  features: ["dashboard_overview"]
});

beforeEach(() => {
  useEntitlementsStore.getState().reset();
  useAuthStore.setState({ user: null, isAuthenticated: false, authChecked: false });
  localStorage.clear();
  sessionStorage.clear();
});

test("changing tenant clears the previous tenant entitlement snapshot synchronously", () => {
  useAuthStore.getState().setSession(user("tenant-a"));
  useEntitlementsStore.getState().setEntitlements(entitlement("tenant-a"));

  useAuthStore.getState().setSession(user("tenant-b"));

  const state = useEntitlementsStore.getState();
  assert.equal(state.loaded, false);
  assert.equal(state.tenantId, "");
  assert.equal(state.licenseStatus, null);
});

test("logout clears the current entitlement snapshot", () => {
  useAuthStore.getState().setSession(user("tenant-a"));
  useEntitlementsStore.getState().setEntitlements(entitlement("tenant-a"));

  useAuthStore.getState().logout();

  assert.equal(useAuthStore.getState().isAuthenticated, false);
  assert.equal(useEntitlementsStore.getState().loaded, false);
  assert.equal(useEntitlementsStore.getState().provider, null);
});
