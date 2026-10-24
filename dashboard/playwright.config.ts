import { defineConfig, devices } from "@playwright/test";

/**
 * Production-build e2e for the dashboard.
 *
 * The app is built and started by the webServer below (`next start` on the
 * build output). With no gateway backend running the dashboard exercises its
 * real connected-failure path — SWR fetch errors degrade to the "Gateway
 * unreachable" fixture banner, which is exactly the offline-preview journey.
 * The scenario panel then drives the same reducer the unit tests pin.
 *
 * CI runs the chromium project; mobile-chromium is available locally.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.DASHBOARD_URL || "http://localhost:3001",
    trace: "retain-on-failure",
  },
  webServer: {
    // `output: 'export'` builds a static site in dist/ — serve it directly.
    command: "node scripts/serve-dist.mjs",
    url: "http://localhost:3001",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
});
