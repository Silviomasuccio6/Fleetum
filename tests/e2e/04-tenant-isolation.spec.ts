import { test, expect } from "@playwright/test";
import { hasOtherTenantCredentials, hasTenantCredentials } from "./helpers/env";
import { createAuthenticatedApi, csrfHeaders } from "./helpers/auth";
import { createDemoDataset } from "./helpers/demo-data";
import { e2eEnv } from "./helpers/env";

// Stable business fields, relationship identities and visible ledger identities.
// Exclude generated URLs/tokens so failure reports cannot publish credentials.
const bookingState = (booking: any) => ({
  id: booking.id,
  tenantId: booking.tenantId,
  status: booking.status,
  contractStatus: booking.contractStatus,
  vehicleId: booking.vehicleId ?? booking.vehicle?.id,
  customerId: booking.customerId ?? booking.customer?.id,
  pickupAt: booking.pickupAt,
  returnAt: booking.returnAt,
  pickupKm: booking.pickupKm,
  returnKm: booking.returnKm,
  expectedTotal: booking.expectedTotal,
  finalTotal: booking.finalTotal,
  internalNotes: booking.internalNotes,
  noteIds: booking.notes?.map((note: any) => note.id).sort(),
  contractId: booking.contract?.id,
  eventIds: booking.contract?.events?.map((event: any) => event.id).sort()
});

test.describe("Fleetum critical flow: tenant isolation", () => {
  test.skip(!hasTenantCredentials(), "Set E2E_TENANT_EMAIL and E2E_TENANT_PASSWORD to run tenant E2E tests.");

  test("unauthenticated users cannot read tenant booking details", async ({ playwright }) => {
    const auth = await createAuthenticatedApi();
    const dataset = await createDemoDataset(auth.api, auth.csrfToken);

    const unauthenticatedApi = await playwright.request.newContext({ baseURL: e2eEnv.apiUrl });
    const unauthenticated = await unauthenticatedApi.get(`rental-bookings/${dataset.booking.id}`);
    expect([401, 403]).toContain(unauthenticated.status());
    await unauthenticatedApi.dispose();
    await auth.api.dispose();
  });

  test("another tenant cannot read or mutate this tenant booking", async () => {
    test.skip(!hasOtherTenantCredentials(), "Set E2E_OTHER_TENANT_EMAIL and E2E_OTHER_TENANT_PASSWORD for cross-tenant E2E isolation.");

    const tenantA = await createAuthenticatedApi();
    const dataset = await createDemoDataset(tenantA.api, tenantA.csrfToken);
    const tenantB = await createAuthenticatedApi(process.env.E2E_OTHER_TENANT_EMAIL!, process.env.E2E_OTHER_TENANT_PASSWORD!);
    const otherDataset = await createDemoDataset(tenantB.api, tenantB.csrfToken);
    const beforeA = await tenantA.api.get(`rental-bookings/${dataset.booking.id}`);
    const beforeB = await tenantB.api.get(`rental-bookings/${otherDataset.booking.id}`);
    expect(beforeA.ok()).toBe(true);
    expect(beforeB.ok()).toBe(true);
    const ownedA = bookingState(await beforeA.json());
    const ownedB = bookingState(await beforeB.json());
    expect(ownedA.vehicleId).toBe(dataset.vehicle.id);
    expect(ownedB.vehicleId).toBe(otherDataset.vehicle.id);

    const read = await tenantB.api.get(`rental-bookings/${dataset.booking.id}`);
    expect([403, 404]).toContain(read.status());

    const mutate = await tenantB.api.post(`rental-bookings/${dataset.booking.id}/transition`, {
      headers: csrfHeaders(tenantB.csrfToken),
      data: { toStatus: "CLOSED", reason: "Cross tenant mutation attempt from E2E" }
    });
    expect([403, 404]).toContain(mutate.status());

    const crossTenantAssignment = await tenantA.api.patch(`rental-bookings/${dataset.booking.id}`, {
      headers: csrfHeaders(tenantA.csrfToken),
      data: { vehicleId: otherDataset.vehicle.id }
    });
    expect([403, 404]).toContain(crossTenantAssignment.status());
    const deniedBody = await crossTenantAssignment.text();
    for (const marker of [otherDataset.vehicle.id, otherDataset.vehicle.plate, otherDataset.customer.id]) {
      expect(deniedBody.includes(marker), "ownership refusal does not return foreign data").toBe(false);
    }
    const afterA = await tenantA.api.get(`rental-bookings/${dataset.booking.id}`);
    const afterB = await tenantB.api.get(`rental-bookings/${otherDataset.booking.id}`);
    expect(afterA.ok()).toBe(true);
    expect(afterB.ok()).toBe(true);
    expect(bookingState(await afterA.json())).toEqual(ownedA);
    expect(bookingState(await afterB.json())).toEqual(ownedB);

    await tenantA.api.dispose();
    await tenantB.api.dispose();
  });
});
