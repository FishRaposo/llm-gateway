import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The backend test suite lives in tests/. The optional Next.js dashboard
    // has its own vitest project (jsdom env) under dashboard/ and is run
    // separately, so it is excluded here to keep the two suites independent.
    include: ["tests/**/*.test.ts"],
    exclude: ["dashboard/**", "node_modules/**", "dist/**"],
    environment: "node",
  },
});
