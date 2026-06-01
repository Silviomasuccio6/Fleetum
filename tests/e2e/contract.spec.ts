import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers/auth";
import { installFleetumApiMocks } from "./helpers/mock-fleetum-api";

test("contratti: scarica PDF e acquisisce firma digitale", async ({ page }) => {
  await installFleetumApiMocks(page);
  await loginAs(page, "admin.e2e@fleetum.test", "Fleetum!2026");

  await page.getByRole("link", { name: /contratti noleggio/i }).click();
  await expect(page).toHaveURL(/\/booking\/contratti/);
  await expect(page.getByText("Cliente Demo").first()).toBeVisible();

  await page.getByRole("button", { name: /azioni/i }).click();
  const pdfResponsePromise = page.waitForResponse((response) => {
    const contentType = response.headers()["content-type"] ?? "";
    return response.url().includes("/contract/pdf") && response.status() === 200 && contentType.includes("application/pdf");
  });
  await page.getByRole("button", { name: /scarica pdf/i }).click();
  await pdfResponsePromise;
  await expect(page.getByText(/pdf scaricato/i)).toBeVisible();

  await page.getByRole("button", { name: /firma con touchpad/i }).click();
  const canvas = page.getByLabel("Canvas firma contratto");
  await canvas.hover();
  await page.mouse.down();
  await page.mouse.move(430, 330);
  await page.mouse.move(520, 360);
  await page.mouse.up();
  await page.getByRole("button", { name: /conferma firma/i }).click();

  await expect(page.getByText("Contratto firmato (E2E-BK-001).")).toBeVisible();
  await expect(page.locator("tbody").getByText("Firmato").first()).toBeVisible();
});
