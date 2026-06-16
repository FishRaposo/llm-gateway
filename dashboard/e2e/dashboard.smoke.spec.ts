import { test, expect } from "@playwright/test";

/**
 * Dashboard smoke test (demo mode).
 *
 * Run with NEXT_PUBLIC_DEMO_MODE=true so the page renders sample data with no
 * gateway backend. See playwright.config.ts for the full run instructions.
 */
test.describe("LLM Gateway dashboard — demo mode smoke", () => {
  test("renders the console shell and demo data", async ({ page }) => {
    await page.goto("/");

    // The console title is always present.
    await expect(page.getByText("LLM Gateway Console")).toBeVisible();

    // In demo mode a visible banner explains the backend is not reachable.
    await expect(page.getByTestId("demo-banner")).toBeVisible();
    await expect(page.getByText(/DEMO MODE/)).toBeVisible();

    // Core panels render.
    await expect(page.getByText("Latency Timeline")).toBeVisible();
    await expect(page.getByText("Budget Allocation")).toBeVisible();
    await expect(page.getByText("Audit Logs buffer")).toBeVisible();
    await expect(page.getByText("Core Adapter Status")).toBeVisible();

    // Demo metric cards.
    await expect(page.getByText("Accumulated Cost")).toBeVisible();
    await expect(page.getByText("Total Violations")).toBeVisible();
  });
});
