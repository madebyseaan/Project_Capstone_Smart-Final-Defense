import { test, expect } from "@playwright/test";
import { collectProblems, login } from "./fixtures";

/**
 * Read-only SF9 descriptor check. Opens the first available learner preview
 * from the registrar School Forms page and asserts the DO 015 bands.
 */
test("SF9 descriptor table uses DO 015 bands", async ({ page }) => {
  const problems = collectProblems(page);
  await login(page, "registrar");
  await page.goto("/registrar/forms", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2_000);

  const preview = page.getByRole("button", { name: /Preview SF9/i }).first();
  const hasPreview = await preview
    .waitFor({ state: "visible", timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  test.skip(!hasPreview, "No learner SF9 preview available in this environment");

  await preview.click();
  await expect(page.getByText("Descriptors", { exact: false }).first()).toBeVisible({ timeout: 30_000 });

  await expect(page.getByText("Benchmarking", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("80-89", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("Connecting", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("75-79", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("Developing", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("65-74", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("Emerging", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("0-64", { exact: false }).first()).toBeVisible();

  expect(problems, problems.join("\n")).toEqual([]);
});
