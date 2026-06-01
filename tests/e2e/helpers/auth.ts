import { expect, type Page } from "@playwright/test";

export const loginAs = async (page: Page, email: string, password: string) => {
  await page.goto("/login");
  await page.getByLabel("Indirizzo email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /accedi/i }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
};
