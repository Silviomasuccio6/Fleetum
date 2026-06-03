import { test, expect } from "@playwright/test";
import { hasOtherTenantCredentials, hasTenantCredentials } from "./helpers/env";
import { createAuthenticatedApi, csrfHeaders } from "./helpers/auth";
import { createDemoDataset } from "./helpers/demo-data";
import { e2eEnv } from "./helpers/env";

test.describe("Fleetum critical flow: tenant isolation", () => {
  test.skip(!hasTenantCredentials(), "Set E2E_TENANT_EMAIL and E2E_TENANT_PASSWORD to run tenant E2E tests.");

  test("unauthenticated users cannot read tenant booking details", async ({ playwright }) => {
    const auth = await createAuthenticatedApi();
    const dataset = await createDemoDataset(auth.api, auth.csrfToken);

    const unauthenticatedApi = await playwright.request.newContext({ baseURL: e2eEnv.apiUrl });
    const unauthenticated = await unauthenticatedApi.get(`/rental-bookings/${dataset.booking.id}`);
    expect([401, 403]).toContain(unauthenticated.status());
    await unauthenticatedApi.dispose();
    await auth.api.dispose();
  });

  test("another tenant cannot read or mutate this tenant booking", async () => {
    test.skip(!hasOtherTenantCredentials(), "Set E2E_OTHER_TENANT_EMAIL and E2E_OTHER_TENANT_PASSWORD for cross-tenant E2E isolation.");

    const tenantA = await createAuthenticatedApi();
    const dataset = await createDemoDataset(tenantA.api, tenantA.csrfToken);
    const tenantB = await createAuthenticatedApi(process.env.E2E_OTHER_TENANT_EMAIL!, process.env.E2E_OTHER_TENANT_PASSWORD!);

    const read = await tenantB.api.get(`/rental-bookings/${dataset.booking.id}`);
    expect([403, 404]).toContain(read.status());

    const mutate = await tenantB.api.post(`/rental-bookings/${dataset.booking.id}/transition`, {
      headers: csrfHeaders(tenantB.csrfToken),
      data: { toStatus: "CLOSED", reason: "Cross tenant mutation attempt from E2E" }
    });
    expect([403, 404]).toContain(mutate.status());

    await tenantA.api.dispose();
    await tenantB.api.dispose();
  });
});
