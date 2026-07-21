import assert from "node:assert/strict";
import test from "node:test";
import {
  canManageTenantBilling,
  canReadTenantBilling,
  canUseStripeSelfService,
  isOperativeLicenseStatus
} from "../src/domain/policies/billing-access";

const user = (roles: string[], permissions: string[]) => ({ roles, permissions });

test("tenant administrators retain billing access even with an older permission token", () => {
  const admin = user(["ADMIN"], []);
  assert.equal(canReadTenantBilling(admin), true);
  assert.equal(canManageTenantBilling(admin), true);
});

test("non-admin billing permissions remain least-privilege", () => {
  assert.equal(canReadTenantBilling(user(["OPERATOR"], ["billing:read"])), true);
  assert.equal(canManageTenantBilling(user(["OPERATOR"], ["billing:read"])), false);
  assert.equal(canManageTenantBilling(user(["MANAGER"], ["billing:manage"])), true);
});

test("Stripe self-service is available only for a managed Stripe subscription", () => {
  for (const status of ["ACTIVE", "TRIAL", "PAST_DUE", "SUSPENDED"] as const) {
    assert.equal(canUseStripeSelfService("stripe", status), true);
    assert.equal(canUseStripeSelfService("local", status), false);
  }

  assert.equal(canUseStripeSelfService("stripe", "PENDING"), false);
  assert.equal(canUseStripeSelfService("stripe", "CANCELED"), false);
  assert.equal(canUseStripeSelfService(null, "ACTIVE"), false);
});

test("only ACTIVE and TRIAL licenses can enter the operational application", () => {
  assert.equal(isOperativeLicenseStatus("ACTIVE"), true);
  assert.equal(isOperativeLicenseStatus("TRIAL"), true);
  assert.equal(isOperativeLicenseStatus("PAST_DUE"), false);
  assert.equal(isOperativeLicenseStatus("SUSPENDED"), false);
  assert.equal(isOperativeLicenseStatus("PENDING"), false);
});
