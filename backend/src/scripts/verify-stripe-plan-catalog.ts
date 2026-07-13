import Stripe from "stripe";
import {
  COMMERCIAL_PLAN_CATALOG,
  SAAS_PLAN_CODES,
  getCommercialPlanPriceCents
} from "@fleetum/commercial-plan-catalog";
import type { CommercialBillingCycle } from "@fleetum/commercial-plan-catalog";
import { env } from "../shared/config/env.js";

const cycles: readonly CommercialBillingCycle[] = ["monthly", "yearly"];

const main = async () => {
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY non configurata: verifica catalogo Stripe non eseguibile.");
  }

  const stripe = new Stripe(env.STRIPE_SECRET_KEY);
  const errors: string[] = [];

  for (const plan of SAAS_PLAN_CODES) {
    for (const cycle of cycles) {
      const envKey = COMMERCIAL_PLAN_CATALOG[plan].stripePriceEnv[cycle];
      const priceId = env[envKey];
      if (typeof priceId !== "string" || !priceId.trim()) {
        errors.push(`${plan}/${cycle}: variabile ${String(envKey)} mancante`);
        continue;
      }

      const price = await stripe.prices.retrieve(priceId);
      const expectedInterval = cycle === "yearly" ? "year" : "month";
      const expectedAmount = getCommercialPlanPriceCents(plan, cycle);
      const recurring = price.recurring;
      const valid =
        price.active &&
        price.currency.toUpperCase() === COMMERCIAL_PLAN_CATALOG[plan].currency &&
        price.unit_amount === expectedAmount &&
        recurring?.interval === expectedInterval &&
        recurring?.interval_count === 1 &&
        price.tax_behavior === "inclusive";

      if (!valid) {
        errors.push(
          `${plan}/${cycle}: atteso ${expectedAmount} cent, EUR, intervallo ${expectedInterval}, tax_behavior inclusive`
        );
        continue;
      }

      console.log(`${plan}/${cycle}: OK`);
    }
  }

  if (errors.length) {
    throw new Error(`Catalogo Stripe non allineato:\n- ${errors.join("\n- ")}`);
  }

  console.log("Catalogo commerciale Fleetum e sei Price Stripe allineati.");
};

main().catch((error) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});
