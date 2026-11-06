import { test, expect, type Page } from "@playwright/test";
import { login, collectProblems } from "../../fixtures";

/**
 * Write-capable grading-mode verification. Runs only in the offline rig
 * (`*_test` database + loopback stubs) because it changes the stored mode.
 *
 * Seed contract: `seed-offline-fixtures.ts` creates two T1 grades:
 *   LRN ...001: IG 81.00 -> TRANSMUTED 84 / ZERO_BASED 81
 *   LRN ...002: IG 74.50 -> TRANSMUTED 78 / ZERO_BASED 75
 */

const RIG_YEAR = "2088-2089";

async function getAdminToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => sessionStorage.getItem("token_admin"));
  expect(token, "admin token should exist").toBeTruthy();
  return token!;
}

async function getCsrfToken(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  return cookies.find((c) => c.name === "x-csrf-token")?.value ?? "";
}

async function setModeViaApi(page: Page, token: string, mode: "TRANSMUTED" | "ZERO_BASED") {
  const csrf = await getCsrfToken(page);
  const res = await page.request.put("/api/admin/grading-mode", {
    headers: { Authorization: `Bearer ${token}`, "x-csrf-token": csrf },
    data: { mode },
  });
  return res;
}

async function getClassRecordForStudent(page: Page, token: string, lrn: string) {
  const classesRes = await page.request.get("/api/grades/my-classes", {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(classesRes.ok(), `my-classes failed: ${classesRes.status()}`).toBe(true);
  const classes = await classesRes.json();
  const assignment = classes.find((c: any) => c.subject?.code === "RIG-MATH7");
  expect(assignment, "RIG-MATH7 assignment should exist").toBeTruthy();

  const recordRes = await page.request.get(`/api/grades/class-record/${assignment.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(recordRes.ok(), `class-record failed: ${recordRes.status()}`).toBe(true);
  const body = await recordRes.json();
  const student = body.classRecord.find((r: any) => r.student.lrn === lrn);
  expect(student, `student ${lrn} should exist`).toBeTruthy();
  const grade = student.grades.find((g: any) => g.term === "T1");
  expect(grade, `student ${lrn} should have a T1 grade`).toBeTruthy();
  return { body, grade };
}

test.describe("offline grading mode (write)", () => {
  test.describe.configure({ mode: "serial" });

  test("toggles zero-based, updates teacher grades, and restores transmutation", async ({ page }) => {
    const problems = collectProblems(page);
    await login(page, "admin");
    await page.goto("/admin/transmutation", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("grading-mode-card")).toBeVisible({ timeout: 30_000 });

    const adminToken = await getAdminToken(page);
    const modeRes = await page.request.get("/api/admin/grading-mode", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(modeRes.ok()).toBe(true);
    const initialMode = await modeRes.json();
    expect(initialMode.schoolYear.label).toBe(RIG_YEAR);
    expect(initialMode.mode).toBe("TRANSMUTED");
    expect(initialMode.canChange).toBe(true);

    // Switch OFF through the UI.
    await page.getByTestId("grading-mode-switch").click();
    await expect(page.getByTestId("grading-mode-confirm-dialog")).toBeVisible();
    await page.getByTestId("grading-mode-confirm-submit").click();
    await expect(page.getByTestId("grading-mode-badge")).toHaveText("Zero-Based", { timeout: 30_000 });
    await expect(page.getByTestId("transmutation-table-readonly-banner")).toBeVisible();

    const afterOff = await page.request.get("/api/admin/grading-mode", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect((await afterOff.json()).mode).toBe("ZERO_BASED");

    // Verify the teacher API sees the zero-based values.
    const teacherPage = await page.context().newPage();
    try {
      await login(teacherPage, "teacher");
      const teacherToken = await teacherPage.evaluate(() => sessionStorage.getItem("token_teacher"));
      expect(teacherToken, "teacher token should exist").toBeTruthy();

      const first = await getClassRecordForStudent(teacherPage, teacherToken!, "990000000001");
      expect(first.body.gradingMode).toBe("ZERO_BASED");
      expect(first.grade.quarterlyGrade).toBe(81);

      const second = await getClassRecordForStudent(teacherPage, teacherToken!, "990000000002");
      expect(second.body.gradingMode).toBe("ZERO_BASED");
      expect(second.grade.quarterlyGrade).toBe(75);
    } finally {
      await teacherPage.close();
    }

    // Switch ON through the UI.
    await page.getByTestId("grading-mode-switch").click();
    await expect(page.getByTestId("grading-mode-confirm-dialog")).toBeVisible();
    await page.getByTestId("grading-mode-confirm-submit").click();
    await expect(page.getByTestId("grading-mode-badge")).toHaveText("Transmuted", { timeout: 30_000 });
    await expect(page.getByTestId("transmutation-table-readonly-banner")).toHaveCount(0);

    const afterOn = await page.request.get("/api/admin/grading-mode", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect((await afterOn.json()).mode).toBe("TRANSMUTED");

    const teacherPage2 = await page.context().newPage();
    try {
      await login(teacherPage2, "teacher");
      const teacherToken = await teacherPage2.evaluate(() => sessionStorage.getItem("token_teacher"));
      const first = await getClassRecordForStudent(teacherPage2, teacherToken!, "990000000001");
      expect(first.body.gradingMode).toBe("TRANSMUTED");
      expect(first.grade.quarterlyGrade).toBe(84);
    } finally {
      await teacherPage2.close();
    }

    expect(problems, problems.join("\n")).toEqual([]);
  });

  test.afterEach(async ({ page }) => {
    // Best-effort restore even if the test fails mid-toggle.
    try {
      const token = await page.evaluate(() => sessionStorage.getItem("token_admin"));
      if (!token) return;
      await setModeViaApi(page, token, "TRANSMUTED");
    } catch {
      // The next serial test still re-checks the initial mode.
    }
  });
});
