import { test, expect } from "@playwright/test";
import { collectProblems, login } from "./fixtures";

/**
 * Read-only guard for the admin grading-mode switch. It never confirms a mode
 * change, so the database is not mutated.
 */
test.describe("admin grading mode (read-only)", () => {
  test("shows the switch, reflects the server mode, and cancels without writing", async ({ page }) => {
    const problems = collectProblems(page);
    await login(page, "admin");
    await page.goto("/admin/transmutation", { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("grading-mode-card")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("grading-mode-sy-label")).toBeVisible();

    const switchEl = page.getByTestId("grading-mode-switch");
    const badge = page.getByTestId("grading-mode-badge");
    await expect(switchEl).toBeVisible();
    await expect(badge).toBeVisible();

    const token = await page.evaluate(() => sessionStorage.getItem("token_admin"));
    expect(token, "admin token should exist").toBeTruthy();
    const modeRes = await page.request.get("/api/admin/grading-mode", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(modeRes.ok()).toBe(true);
    const modeInfo = await modeRes.json();

    const isTransmuted = modeInfo.mode === "TRANSMUTED";
    await expect(switchEl).toHaveAttribute("aria-checked", String(isTransmuted));
    await expect(badge).toHaveText(isTransmuted ? "Transmuted" : "Zero-Based");

    if (isTransmuted) {
      await expect(page.getByTestId("transmutation-table-row").first().locator("input").first()).toBeEnabled();
    } else {
      await expect(page.getByTestId("transmutation-table-readonly-banner")).toBeVisible();
      await expect(page.getByTestId("transmutation-table-row").first().locator("input").first()).toBeDisabled();
    }

    if (modeInfo.canChange) {
      let putCalls = 0;
      page.on("request", (request) => {
        if (request.method() === "PUT" && request.url().includes("/api/admin/grading-mode")) {
          putCalls += 1;
        }
      });

      await switchEl.click();
      const dialog = page.getByTestId("grading-mode-confirm-dialog");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: /cancel/i }).click();
      await expect(dialog).toBeHidden();
      await page.waitForTimeout(500);
      expect(putCalls, "cancel must not send a mode-change request").toBe(0);

      const afterRes = await page.request.get("/api/admin/grading-mode", {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect((await afterRes.json()).mode).toBe(modeInfo.mode);
    } else {
      await expect(page.getByTestId("grading-mode-blocked")).toBeVisible();
    }

    expect(problems, problems.join("\n")).toEqual([]);
  });

  test("teacher cannot see the admin grading-mode card", async ({ page }) => {
    await login(page, "teacher");
    await page.goto("/admin/transmutation", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1_000);
    await expect(page.getByTestId("grading-mode-card")).toHaveCount(0);
  });
});

test.describe("admin grading mode (mobile)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("switch is usable without horizontal page overflow", async ({ page }) => {
    await login(page, "admin");
    await page.goto("/admin/transmutation", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("grading-mode-card")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("grading-mode-switch")).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(overflow, "page should not overflow horizontally").toBe(false);
  });
});
