import { test, expect } from "@playwright/test";
import { hasTenantCredentials } from "./helpers/env";
import { createAuthenticatedApi, csrfHeaders, saveStorageStateFromApi } from "./helpers/auth";
import { createDemoDataset } from "./helpers/demo-data";

const tinySignaturePng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lZr0xQAAAABJRU5ErkJggg==";

test.describe("Fleetum critical flow: vehicle, booking, contract", () => {
  test.skip(!hasTenantCredentials(), "Set E2E_TENANT_EMAIL and E2E_TENANT_PASSWORD to run tenant E2E tests.");

  test("creates vehicle and booking, generates PDF and signs contract", async ({ page, context }, testInfo) => {
    let availabilityRequests = 0;
    let detailRequests = 0;
    let contractRequests = 0;
    const detailPaths = new Set<string>();
    const contractPaths = new Set<string>();
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (path === "/api/rental-bookings/availability/month") availabilityRequests += 1;
      if (detailPaths.has(path)) detailRequests += 1;
      if (contractPaths.has(path)) contractRequests += 1;
    });
    const auth = await createAuthenticatedApi();
    await saveStorageStateFromApi(context, auth);

    const dataset = await createDemoDataset(auth.api, auth.csrfToken);
    const secondDataset = await createDemoDataset(auth.api, auth.csrfToken);
    for (const { booking } of [dataset, secondDataset]) {
      detailPaths.add(`/api/rental-bookings/${booking.id}`);
      contractPaths.add(`/api/rental-bookings/${booking.id}/contract`);
    }

    const vehiclesResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === "GET" && url.pathname === "/api/master-data/vehicles"
        && url.searchParams.get("page") === "1" && url.searchParams.get("pageSize") === "20";
    });
    await page.goto("/anagrafiche/veicoli");
    const vehiclesResponse = await vehiclesResponsePromise;
    expect(vehiclesResponse.ok()).toBeTruthy();
    const vehiclesPayload = await vehiclesResponse.json();
    const syntheticVehicleIds = new Set([dataset.vehicle.id, secondDataset.vehicle.id]);
    const syntheticRecordCount = vehiclesPayload.data.filter((vehicle: { id: string }) => syntheticVehicleIds.has(vehicle.id)).length;
    await testInfo.attach("vehicle-list-count-contract", {
      contentType: "application/json",
      body: JSON.stringify({
        total: vehiclesPayload.total,
        page: vehiclesPayload.page,
        pageSize: vehiclesPayload.pageSize,
        syntheticRecordCount
      }, null, 2)
    });
    expect(vehiclesPayload.total, "the real API total must include both synthetic vehicles").toBeGreaterThanOrEqual(2);
    expect(syntheticRecordCount).toBe(2);
    await expect(page.getByText(dataset.vehicle.plate, { exact: true }).filter({ visible: true }).first()).toBeVisible({ timeout: 20_000 });
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
    const vehiclePagination = page.locator("main p").filter({ hasText: /Totale record|Total records/ }).filter({ visible: true });
    await expect(vehiclePagination).toBeVisible();
    await expect(vehiclePagination.locator("span").last(), "visible vehicle total must match the real API total").toHaveText(String(vehiclesPayload.total));
    const consentDialog = page.getByRole("dialog", { name: "Preferenze cookie Fleetum" });
    const consentVisible = await consentDialog.waitFor({ state: "visible", timeout: 2000 }).then(
      () => true,
      (error) => { if (error.name === "TimeoutError") return false; throw error; }
    );
    if (consentVisible) {
      await consentDialog.getByRole("button", { name: "Solo necessari", exact: true }).click();
    }

    await page.goto(`/booking?bookingId=${dataset.booking.id}`);
    await expect(page.getByText(dataset.booking.code, { exact: true }).filter({ visible: true }).first()).toBeVisible({ timeout: 20_000 });

    const selectedPanel = page.locator("aside").filter({ hasText: "Control Booking" });
    const expectSelectedBooking = async (booking: { id: string; code: string }) => {
      await expect(page).toHaveURL((url) => url.searchParams.get("bookingId") === booking.id);
      await expect(selectedPanel.getByText(booking.code, { exact: true })).toBeVisible();
    };
    const selectBooking = async (booking: { code: string; customerName: string }) => {
      await page.getByRole("button", { name: `Prenotazione ${booking.code} - ${booking.customerName}`, exact: true }).last().click();
    };

    await selectBooking(dataset.booking);
    await expectSelectedBooking(dataset.booking);
    await selectBooking(secondDataset.booking);
    await expectSelectedBooking(secondDataset.booking);
    await page.goBack();
    await expectSelectedBooking(dataset.booking);
    await page.goForward();
    await expectSelectedBooking(secondDataset.booking);

    const generate = await auth.api.post(`rental-bookings/${dataset.booking.id}/contract/generate`, {
      headers: csrfHeaders(auth.csrfToken)
    });
    expect(generate.ok()).toBeTruthy();

    const pdf = await auth.api.get(`rental-bookings/${dataset.booking.id}/contract/pdf`);
    expect(pdf.ok()).toBeTruthy();
    expect(pdf.headers()["content-type"]).toContain("application/pdf");
    expect((await pdf.body()).byteLength).toBeGreaterThan(1000);

    const sign = await auth.api.post(`rental-bookings/${dataset.booking.id}/contract/mark-signed`, {
      headers: csrfHeaders(auth.csrfToken),
      data: {
        signedAt: new Date().toISOString(),
        signatureDataUrl: tinySignaturePng
      }
    });
    expect(sign.ok()).toBeTruthy();
    const signedContract = await sign.json();
    expect(signedContract.status).toBe("SIGNED");

    const contract = await auth.api.get(`rental-bookings/${dataset.booking.id}/contract`);
    expect(contract.ok()).toBeTruthy();
    expect((await contract.json()).status).toBe("SIGNED");
    expect(availabilityRequests, "booking selection must preserve the mounted page and avoid a request loop").toBeGreaterThan(0);
    expect(availabilityRequests, "booking selection must preserve the mounted page and avoid a request loop").toBeLessThanOrEqual(3);
    expect(detailRequests, "switching bookings and browser history must load details without a request loop").toBeGreaterThanOrEqual(4);
    expect(detailRequests, "switching bookings and browser history must load details without a request loop").toBeLessThanOrEqual(6);
    expect(contractRequests, "switching bookings and browser history must load contracts without a request loop").toBeGreaterThanOrEqual(4);
    expect(contractRequests, "switching bookings and browser history must load contracts without a request loop").toBeLessThanOrEqual(6);

    await auth.api.dispose();
  });
});
