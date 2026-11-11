import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { readUiPreviewHealth } from "./ui-preview-health.mjs";

// Synthetic UI rehearsal only. Provider status is intercepted explicitly;
// this is not a backend, merchant-account or live-environment verification.
const base = new URL(process.env.FLEETUM_CONFIGURATION_UI_URL ?? "http://127.0.0.1:5180");
assert.ok(["127.0.0.1", "localhost"].includes(base.hostname) && base.protocol === "http:" && !base.username && !base.password && !base.search && !base.hash);
const output = fileURLToPath(new URL("../output/playwright/rental-configuration/", import.meta.url));
await readUiPreviewHealth(base.href);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
const external = [], errors = [];
const summary = {
  booking: { id: "demo-booking-1", code: "QA-CONFIG", customerId: "demo-customer-1" },
  paymentMethods: [{ id: "synthetic-method", rentalCustomerId: "demo-customer-1", status: "ACTIVE", cardBrand: "visa", cardLast4: "4242", mandateAccepted: true }],
  deposits: [{ id: "synthetic-deposit", bookingId: "demo-booking-1", rentalCustomerId: "demo-customer-1", paymentMethodId: "synthetic-method", amountCents: 10000, capturedAmountCents: 0, currency: "EUR", status: "AUTHORIZED" }],
  extraCharges: [{ id: "synthetic-extra", bookingId: "demo-booking-1", rentalCustomerId: "demo-customer-1", type: "OTHER", description: "Synthetic configuration check", amountCents: 1000, adminFeeCents: 0, totalAmountCents: 1000, currency: "EUR", status: "APPROVED" }]
};
try {
  for (const status of ["disabled_for_environment", "not_configured", "configuration_present", "legacy_unknown"]) {
    for (const width of [320, 1440]) for (const [theme, language] of [["light", "it"], ["dark", "en"]]) {
      const context = await browser.newContext({ viewport: { width, height: 1100 }, reducedMotion: "reduce", locale: language === "it" ? "it-IT" : "en-GB" });
      const page = await context.newPage();
      console.log("CHECK", status, width, theme, language);
      const writes = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.addInitScript(({ theme, language }) => {
        localStorage.setItem("fermi_theme_mode", theme);
        localStorage.setItem("fleetum-language", language);
      }, { theme, language });
      await page.route("**/*", async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== base.origin) { external.push(url.origin); return route.abort(); }
        if (url.pathname.startsWith("/api/rental-payments/") && request.method() !== "GET") { writes.push(url.pathname); return route.abort(); }
        if (/^\/api\/rental-payments\/bookings\/[^/]+\/summary$/.test(url.pathname)) {
          const capabilities = status === "legacy_unknown" ? {} : { capabilities: { stripe: { status, operationsEnabled: status === "configuration_present", verification: "not_performed" } } };
          // Preserve the laboratory's site-revision/view headers. A fixture
          // without them correctly invalidates the current authorized view.
          const response = await route.fetch();
          assert.equal(response.status(), 200);
          return route.fulfill({ response, json: { ...summary, ...capabilities } });
        }
        return route.continue();
      });
      await page.goto(new URL("/booking?bookingId=demo-booking-1", base).href);
      const cookies = page.getByRole("button", { name: /^(Solo necessari|Necessary only|Only necessary)$/ });
      await cookies.waitFor({ state: "visible" });
      await cookies.click();
      await cookies.waitFor({ state: "hidden" });
      const section = page.locator("details.booking-detail-section").filter({ has: page.getByRole("heading", { name: /^(Pagamenti e garanzie|Payments and guarantees)$/ }) });
      await section.waitFor({ state: "attached" });
      try { await section.locator("summary").click(); }
      catch (error) {
        await page.screenshot({ path: `${output}/failure.png`, fullPage: true });
        await writeFile(`${output}/failure.txt`, JSON.stringify({ status, width, theme, language, url: page.url(), errors, snapshot: await page.locator("body").innerText() }, null, 2));
        throw error;
      }
      const stripeButtons = [
        /^(Sostituisci carta|Replace card)$/, /^(Crea deposito|Create deposit)$/,
        /^(Cattura totale|Capture full amount)$/, /^(Cattura parziale|Capture partial amount)$/,
        /^(Rilascia|Release)$/, /^(Addebita|Charge)$/
      ];
      const enabled = status === "configuration_present";
      for (const name of stripeButtons) {
        const button = section.getByRole("button", { name });
        await button.waitFor({ state: "visible" });
        assert.equal(await button.isEnabled(), enabled, `${status}, ${name}, ${width}, ${language}`);
        if (!enabled) await button.evaluate(node => node.click());
      }
      assert.equal(await section.getByRole("button", { name: /^(Nuovo addebito extra|New extra charge)$/ }).isEnabled(), true);
      if (!enabled) {
        const notice = section.getByRole("status");
        const text = await notice.innerText();
        assert.ok(text.includes("Stripe"));
        assert.ok(status !== "disabled_for_environment" || text.includes(language === "it" ? "disabilitate" : "disabled"));
        assert.ok(status !== "not_configured" || text.includes(language === "it" ? "non è configurato" : "not configured"));
        assert.ok(status !== "legacy_unknown" || text.includes(language === "it" ? "non verificata" : "not been checked"));
        assert.equal(await notice.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
      }
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains("dark")), theme === "dark");
      assert.deepEqual(writes, []);
      const name = `${status}-${width}-${theme}-${language}`;
      if (status !== "configuration_present") await section.screenshot({ path: `${output}/${name}.png`, animations: "disabled" });
      results.push({ name, passed: true, stripeButtonsChecked: stripeButtons.length, providerWrites: writes.length });
      await context.close();
    }
  }
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  await writeFile(`${output}/results.json`, JSON.stringify({ scope: "synthetic UI only", results, external, errors }, null, 2));
  console.log(`Configuration UI: ${results.length}/${results.length} passed; 96 Stripe button states; no provider writes or external requests.`);
} finally { await browser.close(); }
