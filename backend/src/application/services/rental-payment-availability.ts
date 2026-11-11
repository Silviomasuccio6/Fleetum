import type { FleetumEnvironment } from "../../shared/config/staging-safety.js";

// Configuration presence is deliberately not a claim that the merchant account,
// capabilities, webhook delivery or flow of funds has been verified.
export const rentalStripeAvailability = (environment: FleetumEnvironment, hasSecret: boolean, hasClient: boolean) => ({
  status: environment === "staging" ? "disabled_for_environment" as const
    : !hasSecret || !hasClient ? "not_configured" as const : "configuration_present" as const,
  operationsEnabled: environment !== "staging" && hasSecret && hasClient,
  verification: "not_performed" as const
});
