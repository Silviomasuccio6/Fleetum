import { test, expect } from "@playwright/test";
import { e2eEnv, hasTenantCredentials } from "./helpers/env";
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
    const me = await auth.api.get("auth/me");
    expect(me.ok()).toBeTruthy();
    const payload = await me.json();
    expect(payload.email).toBeTruthy();
    const state = await auth.api.storageState();
    const apiHost = new URL(e2eEnv.apiUrl).hostname;
    const localRehearsal = process.env.E2E_TARGET_MODE === "local-rehearsal"
      && ["127.0.0.1", "localhost"].includes(apiHost);
    for (const name of ["fermi_access", "fermi_refresh", "fermi_csrf"]) {
      const cookie = state.cookies.find(item => item.name === name);
      // Assert metadata only so failures cannot print authentication values.
      expect(Boolean(cookie), `${name} is present`).toBe(true);
      expect(cookie?.httpOnly, `${name} HttpOnly policy`).toBe(name !== "fermi_csrf");
      expect(cookie?.secure, `${name} Secure policy`).toBe(!localRehearsal);
      expect(cookie?.sameSite, `${name} SameSite policy`).toBe("Lax");
      expect(cookie?.path, `${name} path`).toBe("/");
      expect(cookie?.domain, `${name} host-only scope`).toBe(apiHost);
    }
    await auth.api.dispose();
  });
});
