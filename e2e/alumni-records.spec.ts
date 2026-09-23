import { test, expect } from "@playwright/test";
import { login, collectProblems } from "./fixtures";

/**
 * Records Vault (Former Students → per-learner documents).
 *
 * Anti-regression for the old dead redirect: clicking SF10 must render the
 * document in-page and must never send the registrar back to School Forms.
 * collectProblems() fails the test on any console error or API >= 400.
 */
test.describe("registrar records vault (former students)", () => {
  test("opens SF10 and document tabs in-page with no console/API errors", async ({ page }) => {
    const problems = collectProblems(page);

    await login(page, "registrar");
    await page.goto("/registrar/alumni", { waitUntil: "domcontentloaded" });

    const sf10Button = page.locator('button[aria-label^="Open SF10"]').first();
    const hasRows = await sf10Button
      .waitFor({ state: "visible", timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    test.skip(!hasRows, "No former students available in this environment");

    await sf10Button.click();

    const dialog = page.locator('[role="dialog"][aria-label^="Records for"]');
    await expect(dialog).toBeVisible({ timeout: 15_000 });

    // Stay on the Former Students page — the old flow redirected to School Forms.
    await expect(page).not.toHaveURL(/\/registrar\/forms/);

    // SF10 tab is active by default and either renders the form or a clear empty state.
    const sf10Tab = dialog.locator("nav button", { hasText: "SF10" }).first();
    await expect(sf10Tab).toBeVisible();
    await page.waitForTimeout(3000);
    await expect(dialog).toBeVisible();

    // Every document tab opens without breaking the drawer.
    for (const label of ["Overview", "Report Cards", "Prior School", "Remedial"]) {
      const tab = dialog.locator("nav button", { hasText: label }).first();
      if (await tab.count()) {
        await tab.click();
        await page.waitForTimeout(1200);
        await expect(dialog).toBeVisible();
      }
    }

    // Report Cards year pills must actually switch the year. Guards the bug
    // where the shared Select rendered behind the drawer (z-index portal).
    const reportTab = dialog.locator("nav button", { hasText: "Report Cards" }).first();
    if (await reportTab.count()) {
      await reportTab.click();
      await page.waitForTimeout(2500);
      const pills = dialog.locator("button.tabular-nums");
      if ((await pills.count()) > 1) {
        const first = (await pills.first().innerText()).trim();
        await pills.nth(1).click();
        await page.waitForTimeout(2500);
        const active = (await pills.filter({ hasText: first }).first().getAttribute("class")) ?? "";
        expect(active, "first year pill should no longer be active").not.toContain("bg-primary");
        await expect(dialog).toBeVisible();
      }
    }

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0, { timeout: 10_000 });

    expect(problems, problems.join("\n")).toEqual([]);
  });
});
