import { test, expect } from "@playwright/test";
import { collectProblems, login } from "./fixtures";

test.describe("admin teacher archives (read-only)", () => {
  test("loads archived years, shows coverage, and never fetches payloads", async ({ page }) => {
    const problems = collectProblems(page);

    const listResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/admin/teacher-archives?") &&
        response.url().includes("schoolYearId=") &&
        response.request().method() === "GET",
      { timeout: 30_000 },
    );

    await login(page, "admin");
    await page.goto("/admin/teacher-archives", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { level: 1, name: "Teacher Archives" })).toBeVisible();

    const response = await listResponse;
    expect(response.status()).toBe(200);
    const bodyText = await response.text();
    expect(bodyText).not.toContain('"payload"');

    const yearSelect = page.getByLabel("School year");
    await expect(yearSelect).toBeVisible();
    const optionCount = await yearSelect.locator("option").count();
    expect(optionCount).toBeGreaterThan(0);

    const hasRows = (await page.locator("tbody tr").count()) > 0;
    if (!hasRows) {
      await expect(
        page.getByText(/No teacher archives yet|No archived school years|Use "Generate missing"/i).first(),
      ).toBeVisible();
    } else {
      await expect(page.getByRole("button", { name: /Excel/i }).first()).toBeVisible();
    }

    await expect(page.getByText("Teachers archived")).toBeVisible();
    await expect(page.getByText("Compressed size")).toBeVisible();

    expect(problems, problems.join("\n")).toEqual([]);
  });

  test("switching the archived year refetches without errors", async ({ page }) => {
    const problems = collectProblems(page);
    const initialList = page.waitForResponse(
      (response) =>
        response.url().includes("/api/admin/teacher-archives?") &&
        response.url().includes("schoolYearId=") &&
        response.request().method() === "GET",
      { timeout: 30_000 },
    );
    await login(page, "admin");
    await page.goto("/admin/teacher-archives", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1, name: "Teacher Archives" })).toBeVisible();
    await initialList;

    const yearSelect = page.getByLabel("School year");
    await expect(yearSelect.locator("option").first()).toBeAttached();
    const optionCount = await yearSelect.locator("option").count();
    if (optionCount < 2) test.skip(true, "Only one archived school year is available");

    const secondValue = await yearSelect.locator("option").nth(1).getAttribute("value");
    const refetched = page.waitForResponse(
      (response) =>
        response.url().includes("/api/admin/teacher-archives?") &&
        response.url().includes(`schoolYearId=${secondValue}`) &&
        response.request().method() === "GET",
      { timeout: 30_000 },
    );

    await yearSelect.selectOption(secondValue!);
    const response = await refetched;
    expect(response.status()).toBe(200);

    expect(problems, problems.join("\n")).toEqual([]);
  });
});

test.describe("teacher self-service archives (read-only)", () => {
  test("sees only the My Archives page and never fetches payloads", async ({ page }) => {
    const problems = collectProblems(page);
    const listResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/teacher-archives") &&
        response.request().method() === "GET",
      { timeout: 30_000 },
    );

    await login(page, "teacher");
    await page.goto("/teacher/archives", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { level: 1, name: "My Archives" })).toBeVisible();

    const response = await listResponse;
    expect(response.status()).toBe(200);
    const bodyText = await response.text();
    expect(bodyText).not.toContain('"payload"');

    const hasRows = (await page.locator("tbody tr").count()) > 0;
    if (!hasRows) {
      await expect(page.getByText(/No archives yet/i)).toBeVisible();
    } else {
      await page.getByRole("button", { name: /^Open$/ }).first().click();
      await expect(page.getByRole("heading", { level: 1, name: /Class Records/i })).toBeVisible();
      await expect(page.getByRole("button", { name: /Download Excel/i }).first()).toBeVisible();
    }

    expect(problems, problems.join("\n")).toEqual([]);
  });
});
