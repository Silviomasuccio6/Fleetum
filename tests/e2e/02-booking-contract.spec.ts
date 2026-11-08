import { test, expect } from "@playwright/test";
import { e2eEnv, hasTenantCredentials } from "./helpers/env";
import { createAuthenticatedApi, csrfHeaders, saveStorageStateFromApi } from "./helpers/auth";
import { createDemoDataset } from "./helpers/demo-data";
import { openBookingMonth } from "./helpers/calendar.mjs";
import { vehiclePaginationStatus, vehiclePaginationTextPattern, bookingDetailsPanel, bookingCalendarButtonNamePattern, bookingCodeTextPattern } from "./helpers/workspace-locators.mjs";


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

    // A host-only API CSRF cookie is unreadable on the frontend host. Its first
    // write may refresh the session, so follow-up API calls must share the
    // browser's live cookie jar instead of the earlier cloned request context.
    const browserApi = context.request;
    const apiUrl = (endpoint: string) => new URL(endpoint, e2eEnv.apiUrl).href;
    const browserCsrfHeaders = async () => {
      const cookie = (await context.cookies(e2eEnv.apiUrl)).find((entry) => entry.name === "fermi_csrf");
      if (!cookie?.value) throw new Error("Current browser CSRF cookie is missing");
      return csrfHeaders(cookie.value);
    };

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
    const vehiclePagination = vehiclePaginationStatus(page);
    await expect(vehiclePagination).toBeVisible();
    await expect(vehiclePagination, "visible page, page count and vehicle total must match the real API")
      .toHaveText(vehiclePaginationTextPattern(vehiclesPayload));
    const consentDialog = page.getByRole("dialog", { name: "Preferenze cookie Fleetum" });
    const consentVisible = await consentDialog.waitFor({ state: "visible", timeout: 2000 }).then(
      () => true,
      (error) => { if (error.name === "TimeoutError") return false; throw error; }
    );
    if (consentVisible) {
      await consentDialog.getByRole("button", { name: "Solo necessari", exact: true }).click();
    }

    // A fresh browser must follow the application's first-access notice before
    // interacting with calendar controls underneath it. Verify persistence so
    // the UI's local network-error fallback cannot make this test pass.
    const privacyBefore = await browserApi.get(apiUrl("auth/privacy/current"));
    expect(privacyBefore.ok(), `privacy read failed with HTTP ${privacyBefore.status()}`).toBe(true);
    const privacy = await privacyBefore.json();
    if (!privacy.accepted) {
      const acknowledge = page.getByRole("button", { name: "Accetto", exact: true });
      await expect(acknowledge).toBeVisible();
      const acceptedResponse = page.waitForResponse(response =>
        response.request().method() === "POST"
        && new URL(response.url()).pathname === "/api/auth/privacy/accept");
      await acknowledge.click();
      const accepted = await acceptedResponse;
      expect(accepted.ok()).toBe(true);
      expect((await accepted.json()).accepted).toBe(true);
      await expect(acknowledge).not.toBeVisible();
    }
    const privacyAfter = await browserApi.get(apiUrl("auth/privacy/current"));
    expect(privacyAfter.ok(), `privacy reread failed with HTTP ${privacyAfter.status()}`).toBe(true);
    const persistedPrivacy = await privacyAfter.json();
    expect(persistedPrivacy.accepted).toBe(true);
    expect(persistedPrivacy.notice.version).toBe(privacy.notice.version);

    const initialAvailabilityPromise = page.waitForResponse((response) => {
      return response.request().method() === "GET"
        && new URL(response.url()).pathname === "/api/rental-bookings/availability/month";
    });
    const selectedPanel = bookingDetailsPanel(page);
    await page.goto(`/booking?bookingId=${dataset.booking.id}`);
    await expect(page).toHaveURL((url) => url.searchParams.get("bookingId") === dataset.booking.id);
    await expect(selectedPanel.getByText(bookingCodeTextPattern(dataset.booking))).toBeVisible({ timeout: 20_000 });
    const initialAvailability = await initialAvailabilityPromise;
    expect(initialAvailability.ok()).toBeTruthy();
    await openBookingMonth(page, dataset.booking.pickupAt, (await initialAvailability.json()).month);

    const expectSelectedBooking = async (booking: { id: string; code: string }) => {
      await expect(page).toHaveURL((url) => url.searchParams.get("bookingId") === booking.id);
      await expect(selectedPanel.getByText(bookingCodeTextPattern(booking))).toBeVisible();
    };
    const selectBooking = async (booking: { code: string; customerName: string }) => {
      await page.getByRole("button", { name: bookingCalendarButtonNamePattern(booking) }).last().click();
    };

    await selectBooking(dataset.booking);
    await expectSelectedBooking(dataset.booking);
    await selectBooking(secondDataset.booking);
    await expectSelectedBooking(secondDataset.booking);
    await page.goBack();
    await expectSelectedBooking(dataset.booking);
    await page.goForward();
    await expectSelectedBooking(secondDataset.booking);

    const generate = await browserApi.post(apiUrl(`rental-bookings/${dataset.booking.id}/contract/generate`), {
      headers: await browserCsrfHeaders()
    });
    expect(generate.ok()).toBeTruthy();

    const pdf = await browserApi.get(apiUrl(`rental-bookings/${dataset.booking.id}/contract/pdf`));
    expect(pdf.ok()).toBeTruthy();
    expect(pdf.headers()["content-type"]).toContain("application/pdf");
    expect((await pdf.body()).byteLength).toBeGreaterThan(1000);

    // Exercise the real manual issuance and document-bound in-person flow.
    // No fake receipt or status-only signature is used to satisfy the workflow.
    for (const toStatus of ["QUOTED", "CONFIRMED"]) {
      const transitioned=await browserApi.post(apiUrl(`rental-bookings/${dataset.booking.id}/transition`),{headers:await browserCsrfHeaders(),data:{toStatus}});
      expect(transitioned.ok(),await transitioned.text()).toBe(true);
    }
    const terms={version:1,primaryDriverId:dataset.customer.id,additionalDriverIds:[],depositCents:0,damageDeductibleCents:0,theftDeductibleCents:0,paymentTerms:"[E2E] Saldo aperto, nessun pagamento reale",insuranceSummary:"[E2E] Condizioni sintetiche",fuelPolicy:"[E2E] Pieno/pieno",territory:"[E2E] Italia",assistance:"[E2E] Contatto sintetico",cancellation:"[E2E] Condizioni sintetiche",lateReturn:"[E2E] Contattare il locatore",damageProcedure:"[E2E] Verbale e foto sintetici",annexes:[]};
    const savedTerms=await browserApi.patch(apiUrl(`rental-bookings/${dataset.booking.id}/contract/rental-details`),{headers:await browserCsrfHeaders(),data:{revision:0,terms}});
    expect(savedTerms.ok(),await savedTerms.text()).toBe(true);
    const review=await browserApi.get(apiUrl(`rental-bookings/${dataset.booking.id}/contract/conversion`));expect(review.ok()).toBe(true);
    const reviewData=await review.json();expect(reviewData.balance.receivedCents).toBe(0);
    const issued=await browserApi.post(apiUrl(`rental-bookings/${dataset.booking.id}/contract/convert`),{headers:await browserCsrfHeaders(),data:{reviewHash:reviewData.reviewHash}});expect(issued.ok(),await issued.text()).toBe(true);
    const signing=await browserApi.post(apiUrl(`rental-bookings/${dataset.booking.id}/contract/signing/in-person`),{headers:{...await browserCsrfHeaders(),"X-Idempotency-Key":`e2e-presence:${dataset.booking.id}`},data:{}});expect(signing.ok(),await signing.text()).toBe(true);
    const request=await signing.json();
    const document=await browserApi.post(apiUrl(`rental-bookings/${dataset.booking.id}/contract/signing/in-person/document`),{headers:await browserCsrfHeaders(),data:{requestId:request.id}});expect(document.ok()).toBe(true);
    const signatureDataUrl=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=800;canvas.height=200;const ctx=canvas.getContext('2d')!;ctx.strokeStyle='#182438';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(40,130);ctx.bezierCurveTo(90,20,150,160,250,80);ctx.lineTo(380,120);ctx.stroke();return canvas.toDataURL('image/png');});
    const sign=await browserApi.post(apiUrl(`rental-bookings/${dataset.booking.id}/contract/signing/in-person/confirm`),{headers:await browserCsrfHeaders(),data:{requestId:request.id,documentHash:request.documentSha256,confirmationId:crypto.randomUUID(),signatureDataUrl,consent:true,consentVersion:"in-person-v1"}});expect(sign.ok(),await sign.text()).toBe(true);expect((await sign.json()).status).toBe("SIGNED");

    const contract = await browserApi.get(apiUrl(`rental-bookings/${dataset.booking.id}/contract`));
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
