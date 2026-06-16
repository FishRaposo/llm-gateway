import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright smoke config for the dashboard.
 *
 * This is an OPTIONAL end-to-end smoke layer on top of the vitest component
 * tests. It is intentionally NOT part of the default verification gate
 * (`tsc + vitest + build`) so CI does not need to download browsers. To run it
 * locally:
 *
 *   cd dashboard
 *   npm i -D @playwright/test && npx playwright install chromium
 *   NEXT_PUBLIC_DEMO_MODE=true npm run build && npm start &
 *   npx playwright test
 *
 * `NEXT_PUBLIC_DEMO_MODE=true` makes the dashboard render its built-in demo
 * data with no gateway backend, so the smoke test is fully self-contained.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: process.env.DASHBOARD_URL || "http://localhost:3001",
    ...devices["Desktop Chrome"],
  },
});
