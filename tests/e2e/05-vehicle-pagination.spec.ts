import { test, expect, type APIRequestContext, type Page, type Response } from "@playwright/test";
import { createAuthenticatedApi, csrfHeaders, saveStorageStateFromApi } from "./helpers/auth";
import { ensureDemoSite } from "./helpers/demo-data";
import { e2eEnv, hasOtherTenantCredentials, hasTenantCredentials } from "./helpers/env";

type SyntheticVehicle = { id: string; plate: string; brand: string; model: string };
type VehicleList = { data: SyntheticVehicle[]; total: number; page: number; pageSize: number };

const waitForVehicleList = (page: Page, targetPage: number, search: string) => page.waitForResponse((response) => {
  const url = new URL(response.url());
  return response.request().method() === "GET" && url.pathname === "/api/master-data/vehicles"
    && url.searchParams.get("page") === String(targetPage)
    && url.searchParams.get("pageSize") === "20"
    && (url.searchParams.get("search") ?? "") === search;
});

const readVehicleList = async (response: Response): Promise<VehicleList> => {
  expect(response.ok(), `vehicle list API failed with ${response.status()}`).toBeTruthy();
  return response.json();
};

const createSyntheticVehicle = async (
  api: APIRequestContext,
  csrfToken: string,
  siteId: string,
  brand: string,
  plate: string
): Promise<SyntheticVehicle> => {
  const response = await api.post("master-data/vehicles", {
    headers: csrfHeaders(csrfToken),
    data: {
      siteId,
      plate,
      brand,
      model: "Pagination E2E",
      year: 2024,
      currentKm: 12000,
      maintenanceIntervalKm: 20000,
      notes: "[E2E DATA] Synthetic vehicle for pagination and tenant isolation",
      isActive: true
    }
  });
  expect(response.ok(), `synthetic vehicle creation failed with ${response.status()}`).toBeTruthy();
  return response.json();
};

test.describe("Fleetum critical flow: vehicle pagination", () => {
  test.skip(!hasTenantCredentials() || !hasOtherTenantCredentials(),
    "Set both tenant credential pairs to run vehicle pagination with mandatory cross-tenant isolation.");

  test("keeps API totals and page rows accurate through search and IT/EN language changes", async ({ page, context }, testInfo) => {
    const tenantA = await createAuthenticatedApi();
    const tenantB = await createAuthenticatedApi(e2eEnv.otherEmail, e2eEnv.otherPassword);

    try {
      expect(tenantA.user.tenantId).toBeTruthy();
      expect(tenantB.user.tenantId).toBeTruthy();
      expect(tenantB.user.tenantId).not.toBe(tenantA.user.tenantId);
      await saveStorageStateFromApi(context, tenantA);

      const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
      const brandMarker = `E2E-PAGINATION-${runId}`;
      const siteA = await ensureDemoSite(tenantA.api, tenantA.csrfToken, `${runId}A`);
      const siteB = await ensureDemoSite(tenantB.api, tenantB.csrfToken, `${runId}B`);
      const tenantAVehicles: SyntheticVehicle[] = [];
      for (let index = 1; index <= 23; index += 1) {
        tenantAVehicles.push(await createSyntheticVehicle(
          tenantA.api, tenantA.csrfToken, siteA.id, brandMarker, `E2E${runId}A${String(index).padStart(2, "0")}`
        ));
      }
      const tenantBVehicle = await createSyntheticVehicle(
        tenantB.api, tenantB.csrfToken, siteB.id, brandMarker, `E2E${runId}B01`
      );
      const tenantAVehicleIds = new Set(tenantAVehicles.map((vehicle) => vehicle.id));

      const tenantBListResponse = await tenantB.api.get("master-data/vehicles", {
        params: { page: 1, pageSize: 20, search: brandMarker }
      });
      expect(tenantBListResponse.ok()).toBeTruthy();
      const tenantBList: VehicleList = await tenantBListResponse.json();
      expect(tenantBList.total).toBe(1);
      expect(tenantBList.data.map((vehicle) => vehicle.id)).toEqual([tenantBVehicle.id]);

      const initialResponsePromise = waitForVehicleList(page, 1, "");
      await page.goto("/anagrafiche/veicoli");
      await readVehicleList(await initialResponsePromise);
      const consentDialog = page.getByRole("dialog", { name: "Preferenze cookie Fleetum" });
      const consentVisible = await consentDialog.waitFor({ state: "visible", timeout: 2000 }).then(
        () => true,
        (error) => { if (error.name === "TimeoutError") return false; throw error; }
      );
      if (consentVisible) {
        await consentDialog.getByRole("button", { name: "Solo necessari", exact: true }).click();
      }

      const search = page.getByRole("textbox").and(page.getByPlaceholder(/Cerca per targa, marca, modello, sede|Search by plate, brand, model, site/));
      const pagination = page.locator("main p").filter({ hasText: /Totale record|Total records/ }).filter({ visible: true });
      const tableRows = page.getByRole("table").filter({ visible: true }).locator("tbody tr");
      const previous = page.getByRole("button", { name: /^(Precedente|Previous)$/ });
      const next = page.getByRole("button", { name: /^(Successiva|Next)$/ });

      const expectVisiblePage = async (payload: VehicleList) => {
        await expect(tableRows).toHaveCount(payload.data.length);
        await expect(tableRows.locator("td:first-child")).toHaveText(payload.data.map((vehicle) => vehicle.plate));
        // Allow the language observer to finish, so a transient React update cannot hide stale counters.
        await page.evaluate(() => new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }));
        await expect(pagination).toBeVisible();
        await expect(pagination.locator("span"), "visible page, page count and total must match the real API contract").toHaveText([
          String(payload.page),
          String(Math.max(1, Math.ceil(payload.total / payload.pageSize))),
          String(payload.total)
        ]);
        await expect(page.getByText(tenantBVehicle.plate, { exact: true })).toHaveCount(0);
        if (payload.page === 1) await expect(previous).toBeDisabled();
        else await expect(previous).toBeEnabled();
        if (payload.page >= Math.max(1, Math.ceil(payload.total / payload.pageSize))) await expect(next).toBeDisabled();
        else await expect(next).toBeEnabled();
      };

      const capturePage = async (
        action: () => Promise<unknown>,
        targetPage: number,
        query: string,
        expectedTotal: number,
        expectedRows: number,
        label: string
      ) => {
        const responsePromise = waitForVehicleList(page, targetPage, query);
        await action();
        const payload = await readVehicleList(await responsePromise);
        expect(payload.page).toBe(targetPage);
        expect(payload.pageSize).toBe(20);
        expect(payload.total).toBe(expectedTotal);
        expect(payload.data).toHaveLength(expectedRows);
        expect(payload.data.every((vehicle) => tenantAVehicleIds.has(vehicle.id) && vehicle.brand === brandMarker)).toBe(true);
        expect(payload.data.map((vehicle) => vehicle.id)).not.toContain(tenantBVehicle.id);
        await testInfo.attach(`vehicle-pagination-${label}`, {
          contentType: "application/json",
          body: JSON.stringify({
            total: payload.total,
            page: payload.page,
            pageSize: payload.pageSize,
            syntheticRecordCount: payload.data.length,
            plates: payload.data.map((vehicle) => vehicle.plate)
          }, null, 2)
        });
        await expectVisiblePage(payload);
        return payload;
      };

      const firstPage = await capturePage(() => search.fill(brandMarker), 1, brandMarker, 23, 20, "it-page-1");
      const secondPage = await capturePage(() => next.click(), 2, brandMarker, 23, 3, "it-page-2");
      expect(new Set([...firstPage.data, ...secondPage.data].map((vehicle) => vehicle.id))).toEqual(tenantAVehicleIds);

      const missingQuery = `${brandMarker}-NO-MATCH`;
      await capturePage(() => search.fill(missingQuery), 1, missingQuery, 0, 0, "it-no-results");
      const restoredPage = await capturePage(() => search.fill(brandMarker), 1, brandMarker, 23, 20, "it-restored-page-1");
      expect(restoredPage.data.map((vehicle) => vehicle.id)).toEqual(firstPage.data.map((vehicle) => vehicle.id));

      await page.getByRole("button", { name: "EN", exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
      await expectVisiblePage(restoredPage);
      const englishSecondPage = await capturePage(() => next.click(), 2, brandMarker, 23, 3, "en-page-2");
      expect(englishSecondPage.data.map((vehicle) => vehicle.id)).toEqual(secondPage.data.map((vehicle) => vehicle.id));
      await capturePage(() => previous.click(), 1, brandMarker, 23, 20, "en-page-1");
      await capturePage(() => search.fill(missingQuery), 1, missingQuery, 0, 0, "en-no-results");
      const englishRestoredPage = await capturePage(() => search.fill(brandMarker), 1, brandMarker, 23, 20, "en-restored-page-1");
      await page.getByRole("button", { name: "IT", exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("lang", "it");
      await expectVisiblePage(englishRestoredPage);
    } finally {
      await tenantA.api.dispose();
      await tenantB.api.dispose();
    }
  });
});
