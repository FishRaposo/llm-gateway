import { test, expect } from "@playwright/test";

/**
 * Dashboard production-build smoke (connected-failure journey).
 *
 * Built without NEXT_PUBLIC_DEMO_MODE and with no gateway backend running,
 * so the dashboard exercises its real degradation path: SWR fetch failures
 * surface the "Gateway unreachable" fixture banner rather than a broken page.
 */
test.describe("LLM Gateway dashboard — offline preview", () => {
  test("renders the console shell and connected-failure banner", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByText("LLM Gateway Console")).toBeVisible();
    await expect(page.getByTestId("demo-banner")).toBeVisible();
    await expect(page.getByText(/Gateway unreachable/)).toBeVisible();

    // Core panels render against fixture data.
    await expect(page.getByText("Latency Timeline")).toBeVisible();
    await expect(page.getByText("Budget Allocation")).toBeVisible();
    await expect(page.getByText("Audit Logs buffer")).toBeVisible();
    await expect(page.getByText("Core Adapter Status")).toBeVisible();
    await expect(page.getByText("Accumulated Cost")).toBeVisible();
    await expect(page.getByText("Total Violations")).toBeVisible();
  });

  test("guided scenario journey updates all panels from one state", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("demo-banner")).toBeVisible();

    // Provider outage: health panel goes down + error row lands in the audit log.
    await page.getByTestId("simulate-provider_outage").click();
    await expect(page.getByTestId("audit-row-sim-provider_outage-0")).toBeVisible();
    await expect(page.getByText("down").first()).toBeVisible();

    // Recover restores health without rewriting the audit ledger.
    await page.getByTestId("simulate-recover").click();
    await expect(page.getByTestId("audit-row-sim-provider_outage-0")).toBeVisible();

    // Budget-exceeded scenario pins a blocked row.
    await page.getByTestId("simulate-budget_exceeded").click();
    await expect(page.getByTestId("audit-row-sim-budget_exceeded-1")).toBeVisible();

    // Reset clears simulated rows but keeps the fixture base.
    await page.getByTestId("simulate-reset").click();
    await expect(page.getByTestId("audit-row-sim-provider_outage-0")).not.toBeVisible();
    await expect(page.getByText("Audit Logs buffer")).toBeVisible();
  });

  test("scenario buttons are keyboard-operable", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("demo-banner")).toBeVisible();
    const btn = page.getByTestId("simulate-guardrail_blocked");
    await btn.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("audit-row-sim-guardrail_blocked-0")).toBeVisible();
  });
});
