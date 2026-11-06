import { test, expect } from "@playwright/test";
import { collectProblems, login } from "./fixtures";

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

      await preview.getByRole("button", { name: /^close$/i }).click();
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

    await preview.getByRole("button", { name: /^close$/i }).click();
    await expect(preview).toBeHidden();

    expect(problems, problems.join("\n")).toEqual([]);
  });
});
