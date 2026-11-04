import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { readUiPreviewHealth } from "./ui-preview-health.mjs";

// Browser regression checks against the synthetic, loopback-only UI laboratory.
// This does not exercise a real backend, database, provider or tenant session.
const base = "http://127.0.0.1:5180";
const output = fileURLToPath(new URL("../output/playwright/ui-booking/", import.meta.url));
await mkdir(output, { recursive: true });
await readUiPreviewHealth(base);
const results = [];
const accessibility = [];
const errors = [];
const external = [];
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "it-IT", timezoneId: "Europe/Rome", reducedMotion: "reduce" });
await context.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  if (url.origin !== base && !["data:", "blob:"].includes(url.protocol)) { external.push(url.origin); await route.abort(); }
  else await route.continue();
});
context.on("page", (page) => page.on("pageerror", (error) => errors.push(error.message)));
const page = await context.newPage();
const check = async (name, callback) => {
  try { await callback(); results.push({ name, status: "PASS" }); console.log("PASS", name); }
  catch (error) { results.push({ name, status: "FAIL", message: error.message }); console.log("FAIL", name, error.message); }
};
const waitRows = async (count) => page.waitForFunction((wanted) => document.querySelectorAll(".booking-calendar-row").length === wanted, count);
const waitList = async (count) => page.waitForFunction((wanted) => document.querySelectorAll(".booking-list-row").length === wanted, count);
const screenshot = (name) => page.screenshot({ path: `${output}/${name}.png`, animations: "disabled" });
const changeScenario = async (value) => {
  // The laboratory reloads only after the scenario request completes. Wait for
  // that new document so an old result cannot satisfy the next assertion.
  await Promise.all([page.waitForEvent("domcontentloaded"), page.getByLabel("Scenario anteprima").selectOption(value)]);
};

try {
  await page.goto(`${base}/booking`);
  await page.getByRole("heading", { name: "Prenotazioni", exact: true }).waitFor();
  const cookie = page.getByRole("button", { name: "Solo necessari", exact: true });
  if (await cookie.isVisible()) await cookie.click();
  await waitRows(12);
  await check("Desktop calendar and common navigation", async () => {
    assert.equal(await page.locator(".booking-calendar-bar").count(), 8);
    assert.ok(await page.getByRole("navigation", { name: "Navigazione principale", exact: true }).isVisible());
    await screenshot("booking-desktop");
  });
  await check("Search, location, status and reset", async () => {
    await page.getByLabel("Ricerca booking", { exact: true }).fill("QA101");
    await waitRows(1);
    assert.match(await page.locator(".booking-calendar-vehicle").innerText(), /QA101AA/);
    await page.getByRole("button", { name: "Azzera filtri", exact: true }).click(); await waitRows(12);
    await page.getByRole("button", { name: "Elenco", exact: true }).click(); await waitList(8);
    await page.getByLabel("Filtra stato prenotazione", { exact: true }).selectOption("CONFIRMED"); await waitList(2);
    await page.getByLabel("Filtra sede booking", { exact: true }).selectOption("demo-site-1"); await waitList(1);
    assert.match(await page.locator(".booking-list-row").innerText(), /Milano Centrale/);
    await page.getByRole("button", { name: "Azzera filtri", exact: true }).click(); await waitList(8);
    await screenshot("booking-list");
  });
  await check("Monthly navigation and Today", async () => {
    await page.getByRole("button", { name: "Mese successivo", exact: true }).click();
    await page.getByText("Nessuna prenotazione da mostrare", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Oggi", exact: true }).click(); await waitList(8);
  });
  await check("Selected booking opens the existing detail operations", async () => {
    await page.locator(".booking-list-row").nth(1).click();
    await page.getByRole("heading", { name: "Dettaglio prenotazione", exact: true }).waitFor();
    await page.waitForFunction(() => new URL(location.href).searchParams.get("bookingId") === "demo-booking-5");
    assert.ok(await page.getByRole("button", { name: "Modifica prenotazione", exact: true }).isVisible());
  });
  await check("Booking dialog keyboard focus and return to opener", async () => {
    await page.getByRole("button", { name: "Nuova prenotazione", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Nuova prenotazione", exact: true });
    await dialog.waitFor();
    await dialog.getByLabel("Ricerca veicolo", { exact: true }).focus();
    await page.keyboard.press("Shift+Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]')?.getAttribute("aria-label")), "Nuova prenotazione");
    await page.keyboard.press("Escape");
    if (await dialog.isVisible()) await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    assert.match(await page.evaluate(() => document.activeElement?.textContent), /Nuova prenotazione/);
  });
  await check("Late search response cannot replace the newest results", async () => {
    await page.getByRole("button", { name: "Calendario", exact: true }).click(); await waitRows(12);
    let oldStarted;
    let oldFinished;
    const started = new Promise((resolve) => { oldStarted = resolve; });
    const finished = new Promise((resolve) => { oldFinished = resolve; });
    const pattern = "**/api/rental-bookings/availability/month?**";
    const handler = async (route) => {
      const query = new URL(route.request().url()).searchParams.get("search");
      if (query !== "QA101") return route.continue();
      const response = await route.fetch(); oldStarted();
      await new Promise((resolve) => setTimeout(resolve, 650));
      await route.fulfill({ response }); oldFinished();
    };
    await page.route(pattern, handler);
    await page.getByLabel("Ricerca booking", { exact: true }).fill("QA101"); await started;
    await page.getByLabel("Ricerca booking", { exact: true }).fill("QA102"); await waitRows(1);
    await page.waitForFunction(() => document.querySelector(".booking-calendar-vehicle")?.textContent.includes("QA102AA"));
    await finished;
    assert.match(await page.locator(".booking-calendar-vehicle").innerText(), /QA102AA/);
    await page.unroute(pattern, handler);
    await page.getByRole("button", { name: "Azzera filtri", exact: true }).click(); await waitRows(12);
  });
  await check("Empty and failed loading states, then retry", async () => {
    await changeScenario("empty");
    await page.getByText("Nessun veicolo visibile", { exact: true }).waitFor(); await screenshot("booking-empty");
    await changeScenario("error");
    await page.getByText("Calendario non disponibile", { exact: true }).waitFor(); await screenshot("booking-error");
    await page.request.post(`${base}/__ui/scenario`, { data: { scenario: "normal" } });
    await page.getByRole("button", { name: "Riprova", exact: true }).click(); await waitRows(12);
  });
  await check("No overflow at desktop, tablet and phone widths", async () => {
    for (const width of [1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
      const dimensions = await page.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth }));
      assert.ok(dimensions.content <= dimensions.width + 1, `Horizontal overflow at ${width}: ${dimensions.content}`);
    }
  });
  await check("Phone list, collapsed metrics and complete menu", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/booking`);
    await page.getByRole("heading", { name: "Prenotazioni", exact: true }).waitFor(); await waitList(8);
    assert.equal(await page.locator(".workspace-summary").getAttribute("open"), null);
    assert.equal(await page.locator(".workspace-filter-group").getAttribute("open"), null);
    await page.locator(".workspace-filter-group > summary").click();
    assert.ok(await page.getByLabel("Filtra sede booking", { exact: true }).isVisible());
    await page.locator(".workspace-filter-group > summary").click();
    assert.equal(await page.getByRole("navigation", { name: "Navigazione rapida" }).locator("a,button").count(), 5);
    await screenshot("booking-phone");
    await page.getByRole("button", { name: "Altro", exact: true }).click();
    const menu = page.getByRole("dialog", { name: "Menu principale", exact: true }); await menu.waitFor();
    assert.ok(await menu.getByRole("link", { name: "Scadenziario", exact: true }).isVisible());
    assert.ok(await menu.getByRole("link", { name: "Manutenzioni", exact: true }).isVisible());
    await page.keyboard.press("Escape"); await menu.waitFor({ state: "hidden" });
  });
  await check("Dark theme preserves the main controls", async () => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: "Cambia tema", exact: true }).click();
    assert.ok(await page.locator("html").evaluate((element) => element.classList.contains("dark")));
    await page.getByRole("button", { name: "Calendario", exact: true }).click(); await waitRows(12);
    await page.evaluate(() => window.scrollTo(0, 0)); await screenshot("booking-dark");
    await page.getByRole("button", { name: "Cambia tema", exact: true }).click();
  });
  await check("English labels and month; switching back keeps values", async () => {
    await page.getByRole("button", { name: "EN", exact: true }).click();
    await page.getByRole("heading", { name: "Bookings", exact: true }).waitFor();
    assert.match(await page.locator(".booking-month").innerText(), /October|November|December|January|February|March|April|May|June|July|August|September/i);
    assert.ok(await page.getByRole("button", { name: "Clear filters", exact: true }).isVisible());
    await page.getByRole("button", { name: "IT", exact: true }).click();
    await page.getByRole("heading", { name: "Prenotazioni", exact: true }).waitFor();
  });
  await check("Calendar cells support keyboard navigation", async () => {
    await page.getByRole("button", { name: "Calendario", exact: true }).click(); await waitRows(12);
    const cell = page.locator('[data-calendar-cell="0-4"]');
    await cell.focus(); await page.keyboard.press("ArrowRight");
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-calendar-cell")), "0-5");
    await page.keyboard.press("ArrowDown");
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-calendar-cell")), "1-5");
    await page.keyboard.press("Home");
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-calendar-cell")), "1-0");
  });
  await check("Two bookings sharing a calendar day stay individually visible", async () => {
    const pattern = "**/api/rental-bookings/availability/month?**";
    const handler = async (route) => {
      const response = await route.fetch(); const body = await response.json();
      const booking = body.data[0].bookings[0];
      const start = new Date(booking.pickupAt);
      const middle = new Date(start.getTime() + 60 * 60 * 1000);
      const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
      body.data[0].bookings = [{ ...booking, returnAt: middle.toISOString() }, { ...booking, id: "demo-same-day", code: "DEMO-SECOND", pickupAt: middle.toISOString(), returnAt: end.toISOString() }];
      await route.fulfill({ response, json: body });
    };
    await page.route(pattern, handler); await page.reload(); await waitRows(12);
    const bars = page.locator(".booking-calendar-row").first().locator(".booking-calendar-bar");
    assert.equal(await bars.count(), 2);
    const positions = await bars.evaluateAll((elements) => elements.map((element) => ({ row: element.style.gridRow, top: element.getBoundingClientRect().top })));
    assert.notEqual(positions[0].row, positions[1].row);
    assert.ok(Math.abs(positions[0].top - positions[1].top) >= 28);
    await page.unroute(pattern, handler); await page.reload(); await waitRows(12);
  });
  await check("Loading has explicit feedback before results", async () => {
    await changeScenario("slow");
    await page.getByLabel("Caricamento calendario booking", { exact: true }).waitFor();
    await screenshot("booking-loading"); await waitRows(12);
    await changeScenario("normal"); await waitRows(12);
  });
  await check("Component gallery has a usable dialog and focus restoration", async () => {
    await page.goto(`${base}/ui-preview.html`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Componenti e regole", exact: true }).waitFor();
    const opener = page.getByRole("button", { name: "Apri finestra di esempio", exact: true });
    await opener.click(); await page.getByRole("dialog", { name: "Esempio di finestra", exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("dialog", { name: "Esempio di finestra", exact: true }).waitFor({ state: "hidden" });
    assert.equal(await opener.evaluate((element) => element === document.activeElement), true);
    await screenshot("components");
    await page.goto(`${base}/booking`); await waitRows(12);
  });
  if (process.env.FLEETUM_UI_AXE_SCRIPT) await check("Automated WCAG rules on desktop, phone and dark theme", async () => {
    await page.goto(`${base}/booking`); await waitRows(12);
    const source = await readFile(process.env.FLEETUM_UI_AXE_SCRIPT, "utf8");
    await page.addScriptTag({ content: source });
    for (const mode of ["desktop", "phone", "dark"]) {
      await page.setViewportSize({ width: mode === "phone" ? 390 : 1440, height: 1000 });
      if (mode === "dark") await page.getByRole("button", { name: "Cambia tema", exact: true }).click();
      const audit = await page.evaluate(async () => {
        const result = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } });
        return { version: result.testEngine.version, violations: result.violations.map(({ id, impact, nodes }) => ({ id, impact, nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })) })), incomplete: result.incomplete.map(({ id, nodes }) => ({ id, count: nodes.length, targets: nodes.map(({ target }) => target) })) };
      });
      accessibility.push({ mode, ...audit });
    }
    await page.getByRole("button", { name: "Cambia tema", exact: true }).click();
    await writeFile(`${output}/accessibility.json`, JSON.stringify(accessibility, null, 2));
    assert.equal(accessibility.reduce((sum, audit) => sum + audit.violations.length, 0), 0, "See accessibility.json for exact nodes; automated rules do not establish full compliance.");
  });
  await check("Local preview refuses saves and uses no external service", async () => {
    const response = await page.request.post(`${base}/api/rental-bookings`, { data: {} });
    assert.equal(response.status(), 501); assert.equal((await response.json()).error, "UI_PREVIEW_READ_ONLY");
    assert.deepEqual(external, []); assert.deepEqual(errors, []);
  });
} finally {
  await page.request.post(`${base}/__ui/scenario`, { data: { scenario: "normal" } }).catch(() => {});
  const report = { date: new Date().toISOString(), base, environment: "local synthetic, no database or provider", checks: results, accessibility, accessibilityStatus: process.env.FLEETUM_UI_AXE_SCRIPT ? "EXECUTED" : "NOT_RUN_NO_ENGINE", manualScreenReaderAudit: "NOT_RUN", externalOriginsBlocked: external, pageErrors: errors };
  await writeFile(`${output}/verification.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
if (results.some((result) => result.status === "FAIL")) process.exitCode = 1;
