import { APIRequestContext, BrowserContext, Page, expect, request } from "@playwright/test";
import { e2eEnv } from "./env";

type LoginResult = {
  api: APIRequestContext;
  csrfToken: string;
  user: any;
};

export const loginAs = async (page: Page, email = e2eEnv.email, password = e2eEnv.password) => {
  await page.goto("/login");
  await page.getByLabel(/indirizzo email/i).fill(email);
  await page.getByLabel(/^password$/i).fill(password);
  await page.getByRole("button", { name: /accedi|entra|login/i }).click();
  await expect(page).toHaveURL(/dashboard|booking|anagrafiche|statistiche/, { timeout: 20_000 });
};

export const createAuthenticatedApi = async (email = e2eEnv.email, password = e2eEnv.password): Promise<LoginResult> => {
  const api = await request.newContext({
    baseURL: e2eEnv.apiUrl,
    extraHTTPHeaders: { Accept: "application/json" }
  });

  const response = await api.post("/auth/login", { data: { email, password } });
  expect(response.ok(), `login API failed with ${response.status()}`).toBeTruthy();
  const payload = await response.json();
  const csrfToken = String(payload.csrfToken ?? "");
  expect(csrfToken, "csrfToken returned by /auth/login").toBeTruthy();
  return { api, csrfToken, user: payload.user };
};

export const saveStorageStateFromApi = async (context: BrowserContext, auth: LoginResult) => {
  const state = await auth.api.storageState();
  await context.addCookies(state.cookies);
};

export const csrfHeaders = (csrfToken: string) => ({ "X-CSRF-Token": csrfToken });
