import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/security/**/*.test.ts"],
    testTimeout: 10000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: [
        "src/interfaces/http/middlewares/auth.ts",
        "src/interfaces/http/middlewares/platform-auth.ts",
        "tests/helpers/auth.ts"
      ],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
        perFile: true
      }
    }
  }
});
