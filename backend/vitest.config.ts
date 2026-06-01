import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    testTimeout: 10000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory: "coverage/vitest",
      include: [
        "src/interfaces/http/middlewares/auth.ts",
        "src/application/services/rental-pricing-service.ts",
        "src/application/services/billing-service.ts"
      ],
      thresholds: {
        lines: 70,
        functions: 75,
        branches: 65,
        "src/application/services/**": {
          lines: 90,
          functions: 90,
          branches: 90
        },
        "src/interfaces/http/middlewares/**": {
          lines: 90,
          functions: 90,
          branches: 90
        }
      }
    }
  }
});
