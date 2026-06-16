import { test, expect } from "@playwright/test";
import { hasTenantCredentials } from "./helpers/env";
import { createAuthenticatedApi, loginAs } from "./helpers/auth";

test.describe("Fleetum critical flow: tenant login", () => {
  test.skip(!hasTenantCredentials(), "Set E2E_TENANT_EMAIL and E2E_TENANT_PASSWORD to run tenant E2E tests.");

  test("tenant can login from UI and reach dashboard", async ({ page }) => {
    await loginAs(page);
    await expect(page).toHaveURL(/dashboard|booking|anagrafiche|statistiche/);
    await expect(page.getByText(/dashboard|booking|noleggi|veicoli/i).first()).toBeVisible();
  });

  test("tenant API session exposes authenticated profile", async () => {
    const auth = await createAuthenticatedApi();
    const me = await auth.api.get("/auth/me");
    expect(me.ok()).toBeTruthy();
    const payload = await me.json();
    expect(payload.email).toBeTruthy();
    await auth.api.dispose();
  });
});
