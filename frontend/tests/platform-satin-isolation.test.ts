import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import postcss from "postcss";

const src = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

test("Platform material rules cannot style tenant, public or login surfaces", () => {
  const sheet = postcss.parse(src("presentation/styles/platform-satin.css"));
  let selectors = 0;
  sheet.walkRules((rule) => {
    if (rule.parent?.type === "atrule" && /keyframes$/.test(rule.parent.name)) return;
    for (const selector of rule.selectors) {
      assert.match(selector, /^(?:\.dark )?\.platform-satin(?:\s|\b)/, selector);
      assert.doesNotMatch(selector, /\b(?:html|body|:root)\b/, selector);
      selectors++;
    }
  });
  assert.ok(selectors > 50, "parse the complete shipped sheet, including media queries");
  const platform = src("platform-main.tsx");
  assert.match(platform, /import ".\/presentation\/styles\/platform-satin.css"/);
  assert.doesNotMatch(src("main.tsx"), /platform-satin/);
});

test("Platform navigation retains every operation area and validates incoming sections", async () => {
  const { platformSections, isPlatformSectionId, platformSectionLabel } = await import("../src/presentation/components/platform/platform-navigation");
  assert.deepEqual(new Set(platformSections.map((s) => s.id)), new Set([
    "overview", "tenants", "plans", "billing", "users", "analytics", "leads", "audit", "health", "security", "settings"
  ]));
  assert.equal(new Set(platformSections.map((s) => s.id)).size, 11);
  for (const section of platformSections) {
    assert.equal(isPlatformSectionId(section.id), true);
    assert.equal(platformSectionLabel(section.id), section.label);
  }
  for (const invalid of [undefined, null, "__proto__", "constructor", "billing/delete-all", 0, {}]) {
    assert.equal(isPlatformSectionId(invalid), false);
  }
});
