import { test, expect, type Page } from "@playwright/test";
import { collectProblems, login } from "./fixtures";

const TERMS = ["T1", "T2", "T3"] as const;

async function selectTerm(page: Page, term: (typeof TERMS)[number]): Promise<void> {
  await page.getByLabel("Term").click();
  await page.getByRole("option", { name: new RegExp(`^${term}`) }).click();
  await expect(page.getByLabel("Term")).toContainText(term);
  await expect(page.getByText("Loading term finalization status...")).toBeHidden({
    timeout: 30_000,
  });
}

async function assertRotationRow(
  page: Page,
  sectionName: string,
  expectedSectionDrafts: number,
  expectedBranchName: string,
  expectedCode: string,
): Promise<void> {
  const panel = page.getByTestId("term-finalization-page");
  await expect(panel).toBeVisible({ timeout: 30_000 });

  const section = page
    .getByTestId("term-finalization-section")
    .filter({ hasText: sectionName })
    .first();
  const hasSection = await section
    .waitFor({ state: "visible", timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  test.skip(!hasSection, `${sectionName} is not available in this environment`);

  const subjectRow = section.locator(
    '[data-testid="term-finalization-subject"][data-subject-name="Science 7"]',
  );
  if ((await subjectRow.count()) === 0) {
    await section.getByTestId("term-finalization-section-toggle").click();
  }

  await expect(subjectRow).toHaveCount(1);
  await expect(subjectRow).toHaveAttribute("data-draft", "5");
  await expect(subjectRow.getByTestId("term-finalization-subject-branch")).toHaveText(
    expectedBranchName,
  );
  await expect(subjectRow.getByTestId("term-finalization-subject-codes")).toContainText(
    expectedCode,
  );
  await expect(section).toContainText(`${expectedSectionDrafts} draft grades`);
}

/**
 * Read-only guard for the registrar Term Finalization page.
 * Opens the page, expands a section, and opens (then cancels) a finalize
 * confirmation. It never confirms an action, so grades are never mutated.
 */
test.describe("registrar term finalization (read-only)", () => {
  test("loads sections, expands a subject matrix, and cancels a finalize dialog", async ({ page }) => {
    const problems = collectProblems(page);
    await login(page, "registrar");
    await page.goto("/registrar/term-finalization", { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("term-finalization-page")).toBeVisible({ timeout: 30_000 });

    const firstSection = page.getByTestId("term-finalization-section").first();
    const hasSections = await firstSection
      .waitFor({ state: "visible", timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    test.skip(!hasSections, "No sections available in this environment");

    await firstSection.getByTestId("term-finalization-section-toggle").click();

    const subjectRow = page.getByTestId("term-finalization-subject").first();
    const hasSubjects = await subjectRow
      .waitFor({ state: "visible", timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    test.skip(!hasSubjects, "Section has no class assignments for the selected term");

    const viewGradesButton = firstSection.getByTestId("term-finalization-view-grades");
    if (await viewGradesButton.isEnabled().catch(() => false)) {
      await viewGradesButton.click();
      const preview = page.getByTestId("term-grades-preview");
      await expect(preview).toBeVisible();

      const studentRow = page.getByTestId("term-grades-student-row").first();
      const hasStudentRow = await studentRow
        .waitFor({ state: "visible", timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      if (hasStudentRow) {
        await expect(studentRow).toBeVisible();
      } else {
        await expect(preview).toContainText(/no grades to show/i);
      }

      await page.getByTestId("term-grades-close").click();
      await expect(preview).toBeHidden();
    }

    const finalizeButton = firstSection.getByTestId("term-finalization-finalize-section");
    if ((await finalizeButton.count()) > 0 && (await finalizeButton.isEnabled().catch(() => false))) {
      await finalizeButton.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(/Finalize .* grades for .+\?/i);
      await dialog.getByRole("button", { name: /cancel/i }).click();
      await expect(dialog).toBeHidden();
    }

    expect(page.url()).toContain("/registrar/term-finalization");
    expect(problems, problems.join("\n")).toEqual([]);
  });

  test("shows one Science row per term with the correct branch name and code", async ({ page }) => {
    const problems = collectProblems(page);
    await login(page, "registrar");
    await page.goto("/registrar/term-finalization", { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("term-finalization-page")).toBeVisible({ timeout: 30_000 });

    for (const term of TERMS) {
      await selectTerm(page, term);

      const expectedBranchName =
        term === "T1"
          ? "Science - Biology 7"
          : term === "T2"
            ? "Science - Chemistry 7"
            : "Science - Earth Science 7";
      const expectedCode =
        term === "T1" ? "SCI_BIO7" : term === "T2" ? "SCI_CHEM7" : "SCI_ES7";

      await assertRotationRow(page, "Aguinaldo", 40, expectedBranchName, expectedCode);
      await assertRotationRow(page, "Bonifacio", 50, expectedBranchName, expectedCode);
    }

    expect(problems, problems.join("\n")).toEqual([]);
  });
});

test.describe("registrar term finalization (mobile)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("uses stacked subject cards and a grade preview with no horizontal overflow", async ({ page }) => {
    const problems = collectProblems(page);
    await login(page, "registrar");
    await page.goto("/registrar/term-finalization", { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("term-finalization-page")).toBeVisible({ timeout: 30_000 });

    const firstSection = page.getByTestId("term-finalization-section").first();
    const hasSections = await firstSection
      .waitFor({ state: "visible", timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    test.skip(!hasSections, "No sections available in this environment");

    await firstSection.getByTestId("term-finalization-section-toggle").click();

    const mobileSubject = page.getByTestId("term-finalization-subject-mobile").first();
    await expect(mobileSubject).toBeVisible();

    await firstSection.getByTestId("term-finalization-view-grades").click();
    const preview = page.getByTestId("term-grades-preview");
    await expect(preview).toBeVisible();

    const pageOverflow = await page.evaluate(() => ({
      body: document.body.scrollWidth > document.body.clientWidth,
      document: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }));
    expect(pageOverflow.body, "page body must not scroll horizontally").toBe(false);
    expect(pageOverflow.document, "page document must not scroll horizontally").toBe(false);

    const previewOverflow = await preview.evaluate(
      (node) => node.scrollWidth > node.clientWidth,
    );
    expect(previewOverflow, "grade preview must not scroll horizontally").toBe(false);

    await page.getByTestId("term-grades-close").click();
    await expect(preview).toBeHidden();

    expect(problems, problems.join("\n")).toEqual([]);
  });
});
