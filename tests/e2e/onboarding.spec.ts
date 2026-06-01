import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers/auth";
import { installFleetumApiMocks } from "./helpers/mock-fleetum-api";

test("onboarding tenant: crea workspace, avvia trial e accede alla dashboard", async ({ page }) => {
  await installFleetumApiMocks(page);

  const companyName = "Fleetum Demo Rent";
  const email = "admin.e2e@fleetum.test";
  const password = "Fleetum!2026";

  await page.goto("/signup");
  await page.getByLabel("Nome azienda").fill(companyName);
  await page.getByLabel("Partita IVA").fill("00000000000");
  await page.getByLabel("Forma giuridica").fill("SRL");
  await page.getByLabel("Email aziendale").fill("info@fleetum-demo.test");
  await page.getByLabel("Telefono aziendale").fill("+390600000000");
  await page.getByLabel("Sede legale").fill("Via Demo 1");
  await page.getByLabel("Comune").fill("Roma");
  await page.getByLabel("Prov.").fill("RM");
  await page.getByLabel("CAP").fill("00100");
  await page.getByRole("button", { name: /continua con referente/i }).click();

  await page.getByLabel("Nome", { exact: true }).fill("Admin");
  await page.getByLabel("Cognome").fill("Fleetum");
  await page.getByLabel("Telefono referente").fill("+390612345678");
  await page.getByLabel("Ruolo in azienda").fill("Owner");
  await page.getByLabel("Email login").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.locator("button.premium-login-submit").last().click();

  await expect(page.getByText(companyName)).toBeVisible();
  await page.locator("#signup-privacy").check({ force: true });
  await page.locator("button.premium-login-submit").last().click();

  await expect(page.getByText(/workspace pronto/i)).toBeVisible();
  await page.getByRole("button", { name: /avvia prova gratuita/i }).click();
  await expect(page).toHaveURL(/\/login\?.*welcome=trial/);

  await loginAs(page, email, password);
  await expect(page.getByText(/dashboard/i).first()).toBeVisible();
  await page.getByRole("button", { name: /apri menu profilo/i }).click();
  await expect(page.getByText("Admin Fleetum").first()).toBeVisible();
});
