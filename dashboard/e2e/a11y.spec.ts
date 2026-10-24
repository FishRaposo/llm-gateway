import { test, expect } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";

/** Accessibility scan of the dashboard's offline-preview journey. */
test.describe("dashboard accessibility", () => {
  test("no serious/critical violations on the main console", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("demo-banner")).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    const serious = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical"
    );
    expect(serious, JSON.stringify(serious.map((v) => v.id))).toEqual([]);
  });

  test("interactive state changes keep the page accessible", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("demo-banner")).toBeVisible();
    await page.getByTestId("simulate-provider_fallback").click();
    await expect(page.getByTestId("audit-row-sim-provider_fallback-0")).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    const serious = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical"
    );
    expect(serious, JSON.stringify(serious.map((v) => v.id))).toEqual([]);
  });
});
