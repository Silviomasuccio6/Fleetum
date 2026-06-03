import { test, expect } from "@playwright/test";
import { hasTenantCredentials } from "./helpers/env";
import { createAuthenticatedApi, saveStorageStateFromApi } from "./helpers/auth";
import { createDemoDataset } from "./helpers/demo-data";

test.describe("Fleetum critical flow: vehicle profitability report", () => {
  test.skip(!hasTenantCredentials(), "Set E2E_TENANT_EMAIL and E2E_TENANT_PASSWORD to run tenant E2E tests.");

  test("exports vehicle profitability report as PDF, XLSX and CSV", async ({ page, context }) => {
    const auth = await createAuthenticatedApi();
    await saveStorageStateFromApi(context, auth);
    const dataset = await createDemoDataset(auth.api, auth.csrfToken);

    await page.goto(`/statistiche?vehicleId=${dataset.vehicle.id}`);
    await expect(page.getByText(/redditivita|fatturato|investimento|ROI/i).first()).toBeVisible({ timeout: 20_000 });

    const params = {
      vehicleId: dataset.vehicle.id,
      from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      to: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString(),
      includeVat: "true",
      includeCosts: "true"
    };

    const pdf = await auth.api.get("/stats/vehicles/profitability/export.pdf", { params });
    expect(pdf.ok()).toBeTruthy();
    expect(pdf.headers()["content-type"]).toContain("application/pdf");
    expect((await pdf.body()).byteLength).toBeGreaterThan(1000);

    const xlsx = await auth.api.get("/stats/vehicles/profitability/export.xlsx", { params });
    expect(xlsx.ok()).toBeTruthy();
    expect(xlsx.headers()["content-type"]).toMatch(/spreadsheet|octet-stream/i);
    expect((await xlsx.body()).byteLength).toBeGreaterThan(1000);

    const csv = await auth.api.get("/stats/vehicles/profitability/export.csv", { params });
    expect(csv.ok()).toBeTruthy();
    expect(await csv.text()).toContain(dataset.vehicle.plate);

    await auth.api.dispose();
  });
});
