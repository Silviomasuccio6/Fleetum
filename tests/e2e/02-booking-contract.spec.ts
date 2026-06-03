import { test, expect } from "@playwright/test";
import { hasTenantCredentials } from "./helpers/env";
import { createAuthenticatedApi, csrfHeaders, saveStorageStateFromApi } from "./helpers/auth";
import { createDemoDataset } from "./helpers/demo-data";

const tinySignaturePng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lZr0xQAAAABJRU5ErkJggg==";

test.describe("Fleetum critical flow: vehicle, booking, contract", () => {
  test.skip(!hasTenantCredentials(), "Set E2E_TENANT_EMAIL and E2E_TENANT_PASSWORD to run tenant E2E tests.");

  test("creates vehicle and booking, generates PDF and signs contract", async ({ page, context }) => {
    const auth = await createAuthenticatedApi();
    await saveStorageStateFromApi(context, auth);

    const dataset = await createDemoDataset(auth.api, auth.csrfToken);

    await page.goto("/anagrafiche/veicoli");
    await expect(page.getByText(dataset.vehicle.plate).first()).toBeVisible({ timeout: 20_000 });

    await page.goto("/booking");
    await expect(page.getByText(dataset.booking.code).first()).toBeVisible({ timeout: 20_000 });

    const generate = await auth.api.post(`/rental-bookings/${dataset.booking.id}/contract/generate`, {
      headers: csrfHeaders(auth.csrfToken)
    });
    expect(generate.ok()).toBeTruthy();

    const pdf = await auth.api.get(`/rental-bookings/${dataset.booking.id}/contract/pdf`);
    expect(pdf.ok()).toBeTruthy();
    expect(pdf.headers()["content-type"]).toContain("application/pdf");
    expect((await pdf.body()).byteLength).toBeGreaterThan(1000);

    const sign = await auth.api.post(`/rental-bookings/${dataset.booking.id}/contract/mark-signed`, {
      headers: csrfHeaders(auth.csrfToken),
      data: {
        signedAt: new Date().toISOString(),
        signatureDataUrl: tinySignaturePng
      }
    });
    expect(sign.ok()).toBeTruthy();
    const signedContract = await sign.json();
    expect(signedContract.status).toBe("SIGNED");

    const contract = await auth.api.get(`/rental-bookings/${dataset.booking.id}/contract`);
    expect(contract.ok()).toBeTruthy();
    expect((await contract.json()).status).toBe("SIGNED");

    await auth.api.dispose();
  });
});
