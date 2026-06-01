import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers/auth";
import { installFleetumApiMocks } from "./helpers/mock-fleetum-api";

test("booking noleggi: crea prenotazione confermata e aggiorna disponibilita veicolo", async ({ page }) => {
  await installFleetumApiMocks(page);
  await loginAs(page, "admin.e2e@fleetum.test", "Fleetum!2026");

  await page.getByRole("link", { name: /veicoli/i }).click();
  await expect(page).toHaveURL(/\/anagrafiche\/veicoli/);
  await expect(page.getByRole("cell", { name: "FT100AA" })).toBeVisible();

  await page.getByRole("link", { name: /booking noleggi/i }).click();
  await expect(page.getByRole("heading", { name: /booking noleggi/i })).toBeVisible();
  await expect(page.getByText("Fiat Panda").first()).toBeVisible();

  await page.getByRole("button", { name: /nuova prenotazione/i }).click();
  const vehicleSearch = page.getByLabel("Ricerca veicolo");
  await vehicleSearch.fill("FT100AA");
  const vehicleOption = page.locator(
    "xpath=//input[@aria-label='Ricerca veicolo']/ancestor::div[contains(@class,'relative')][1]//button[contains(., 'FT100AA')]"
  );
  await expect(vehicleOption).toBeVisible();
  await vehicleOption.click();
  const customerSearch = page.getByLabel("Ricerca cliente");
  await customerSearch.fill("Cliente Demo");
  const customerOption = page.locator(
    "xpath=//input[@aria-label='Ricerca cliente']/ancestor::div[contains(@class,'relative')][1]//button[contains(., 'DMOCLN90A01H501X')]"
  );
  await expect(customerOption).toBeVisible();
  await customerOption.click();
  await page.locator("xpath=//label[normalize-space()='Data/ora uscita']/following-sibling::input").fill("2026-06-10T09:00");
  await page.locator("xpath=//label[normalize-space()='Data/ora rientro']/following-sibling::input").fill("2026-06-13T18:00");
  await page.locator("xpath=//label[normalize-space()='Totale previsto (EUR)']/following-sibling::input").fill("420");
  await page.getByRole("button", { name: /salva prenotazione/i }).click();

  await expect(page.getByText(/prenotazione creata con successo/i)).toBeVisible();
  await expect(page.getByText("Cliente Demo").first()).toBeVisible();
  await page.getByRole("button", { name: /prenotazione E2E-BK-002 - Cliente Demo/i }).last().click();
  await expect(page.getByRole("complementary").last()).toContainText("Confermata");
  await expect(page.getByText(/liberi/i).first()).toBeVisible();
  await expect(page.getByText("0").first()).toBeVisible();
});
