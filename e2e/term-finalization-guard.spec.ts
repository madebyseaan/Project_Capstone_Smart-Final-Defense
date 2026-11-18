import { test, expect, type Page } from "@playwright/test";
import { collectProblems, login } from "./fixtures";

async function firstClassRecordHref(page: Page): Promise<string | null> {
  await page.goto("/teacher/classes", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => !!document.querySelector('a[href*="/teacher/records/"]'),
    null,
    { timeout: 60_000 },
  );
  return page.locator('a[href*="/teacher/records/"]').first().getAttribute("href");
}

async function stubClassRecordStatus(
  page: Page,
  status: "FINALIZED" | "DRAFT",
): Promise<{ getMarked: () => number }> {
  let marked = 0;
  await page.route(/\/api\/grades\/class-record\//, async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    const term = json.currentTerm ?? json.classRecord?.[0]?.grades?.[0]?.term;
    for (const record of json.classRecord ?? []) {
      for (const grade of record.grades ?? []) {
        if (grade.term === term) {
          grade.status = status;
          marked += 1;
        }
      }
    }
    await route.fulfill({ response, json });
  });
  return { getMarked: () => marked };
}

function trackWrites(page: Page): string[] {
  const writes: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/api/grades/") && req.method() !== "GET") {
      writes.push(`${req.method()} ${req.url()}`);
    }
  });
  return writes;
}

test.describe("teacher finalized read-only guard", () => {
  test("finalized class shows a read-only banner and disables editing", async ({ page }) => {
    const problems = collectProblems(page);
    const writes = trackWrites(page);
    await login(page, "teacher");
    const href = await firstClassRecordHref(page);
    expect(href, `no record link at ${page.url()}`).not.toBeNull();

    await page.route("**/api/grades/edit-requests", (route) =>
      route.fulfill({ json: { requests: [] } }),
    );

    const recordRequests: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("class-record")) recordRequests.push(req.url());
    });
    const marked = await stubClassRecordStatus(page, "FINALIZED");

    await page.goto(href!, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6000);
    expect(marked.getMarked(), `stub should mark grade rows; requests=${recordRequests.join(",")}`).toBeGreaterThan(0);
    await expect(page.getByTestId("grade-finalized-banner")).toBeVisible({ timeout: 30_000 });

    const scoreInput = page.locator('input[aria-label*="score for student"][data-row-index]:not([data-row-index="-1"])').first();
    if ((await scoreInput.count()) > 0) {
      await expect(scoreInput).toBeDisabled();
    }
    await expect(page.getByRole("button", { name: /Import filled Excel/i })).toBeDisabled();

    expect(writes, writes.join("\n")).toEqual([]);
    expect(problems, problems.join("\n")).toEqual([]);
  });

  test("draft class remains editable", async ({ page }) => {
    const problems = collectProblems(page);
    await login(page, "teacher");
    const href = await firstClassRecordHref(page);
    test.skip(!href, "Teacher has no class records in this environment");

    await page.route("**/api/grades/edit-requests", (route) =>
      route.fulfill({ json: { requests: [] } }),
    );

    const marked = await stubClassRecordStatus(page, "DRAFT");
    await page.goto(href!, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6000);
    test.skip(marked.getMarked() === 0, "Class record has no grade rows to mark draft");

    await expect(page.getByTestId("grade-finalized-banner")).toHaveCount(0);

    const scoreInput = page.locator('input[aria-label*="score for student"][data-row-index]:not([data-row-index="-1"])').first();
    await expect(scoreInput).toBeVisible({ timeout: 30_000 });
    await expect(scoreInput).toBeEnabled();
    expect(problems, problems.join("\n")).toEqual([]);
  });
});

test.describe("registrar correction window surfaces", () => {
  test("dashboard shows the correction windows card", async ({ page }) => {
    const problems = collectProblems(page);
    await login(page, "registrar");
    await page.goto("/registrar", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("registrar-correction-windows")).toBeVisible({ timeout: 30_000 });
    expect(problems, problems.join("\n")).toEqual([]);
  });

  test("term finalization shows the correction windows card", async ({ page }) => {
    const problems = collectProblems(page);
    await login(page, "registrar");
    await page.goto("/registrar/term-finalization", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("registrar-correction-windows")).toBeVisible({ timeout: 30_000 });
    expect(problems, problems.join("\n")).toEqual([]);
  });
});
