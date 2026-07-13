import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { COMMERCIAL_PLAN_CATALOG } from "@fleetum/commercial-plan-catalog";
import {
  PLAN_MONTHLY_PRICING_EUR,
  PLAN_YEARLY_PRICING_EUR
} from "../src/domain/constants/entitlements";

test("landing and application consume the shared commercial plan catalog", () => {
  assert.deepEqual(PLAN_MONTHLY_PRICING_EUR, { STARTER: 149, PRO: 199, ENTERPRISE: 249 });
  assert.deepEqual(PLAN_YEARLY_PRICING_EUR, { STARTER: 1519.8, PRO: 2029.8, ENTERPRISE: 2539.8 });
  assert.equal(COMMERCIAL_PLAN_CATALOG.STARTER.monthlyPriceCents, 14_900);

  const landingPath = fileURLToPath(new URL("../src/presentation/pages/landing/landing-page.tsx", import.meta.url));
  const landing = fs.readFileSync(landingPath, "utf8");
  assert.doesNotMatch(landing, /price:\s*["']\d+\s*€/);
  assert.doesNotMatch(landing, /129\s*€/);
});
