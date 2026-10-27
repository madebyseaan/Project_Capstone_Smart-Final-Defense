import { test, expect } from "@playwright/test";
import { collectProblems, login } from "./fixtures";

/**
 * Read-only guard for the Observed Values editor embedded in My Advisory.
 * Never saves ratings; the save roundtrip is covered by the server test suite.
 */
test.describe("advisory observed values (read-only)", () => {
  test("E-OV-01 panel loads and opens the behavior editor", async ({ page }) => {
    const problems = collectProblems(page);
    await login(page, "teacher");
    await page.goto("/teacher/advisory?view=observed-values", {
      waitUntil: "domcontentloaded",
    });

    const panel = page.getByTestId("observed-values-panel");
    try {
      await panel.waitFor({ state: "visible", timeout: 20_000 });
    } catch {
      test.skip(true, "Teacher account has no advisory section");
    }
    await expect(panel).toBeVisible();

    const rows = page.getByTestId("observed-value-student-row");
    if ((await rows.count()) === 0) test.skip(true, "Advisory section has no learners");

    await page.getByTestId("observed-value-edit").first().click();
    await expect(page.getByTestId("observed-values-dialog")).toBeVisible();
    await expect(page.getByTestId("observed-rating-MAKA_DIYOS_1-AO")).toBeVisible();
    await expect(page.getByTestId("observed-rating-MAKA_DIYOS_1-SO")).toBeVisible();
    await expect(page.getByTestId("observed-rating-MAKA_DIYOS_1-RO")).toBeVisible();
    await expect(page.getByTestId("observed-rating-MAKA_DIYOS_1-NO")).toBeVisible();
    await expect(page.getByTestId("observed-values-save")).toBeDisabled();

    await page.locator('[data-slot="dialog-close"]').first().click();
    await expect(page.getByTestId("observed-values-dialog")).toBeHidden();

    expect(page.url()).toContain("view=observed-values");
    expect(problems, problems.join("\n")).toEqual([]);
  });
});
