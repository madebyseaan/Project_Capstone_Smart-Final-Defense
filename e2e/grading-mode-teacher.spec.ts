import { test, expect } from "@playwright/test";
import { collectProblems, login } from "./fixtures";

/**
 * Read-only guard: the teacher ledger preview must use the same grading mode
 * as the server-stored term grade.
 */
test("teacher ledger term grade matches the active grading mode", async ({ page }) => {
  const problems = collectProblems(page);
  await login(page, "teacher");

  const token = await page.evaluate(() => sessionStorage.getItem("token_teacher"));
  expect(token, "teacher token should exist").toBeTruthy();

  const classesRes = await page.request.get("/api/grades/my-classes", {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(classesRes.ok(), `my-classes failed: ${classesRes.status()}`).toBe(true);
  const classes = await classesRes.json();
  test.skip(!Array.isArray(classes) || classes.length === 0, "No teacher classes in this environment");

  const assignment = classes.find((c: any) => c.isActive !== false) ?? classes[0];
  await page.goto(`/teacher/records/${assignment.id}`, { waitUntil: "domcontentloaded" });

  const firstCell = page.getByTestId("ledger-term-grade").first();
  await expect(firstCell).toBeVisible({ timeout: 30_000 });
  const term = await firstCell.getAttribute("data-term");
  const studentId = await firstCell.getAttribute("data-student-id");
  expect(term, "ledger term should be present").toBeTruthy();
  expect(studentId, "ledger student id should be present").toBeTruthy();

  const recordRes = await page.request.get(`/api/grades/class-record/${assignment.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(recordRes.ok(), `class-record failed: ${recordRes.status()}`).toBe(true);
  const recordBody = await recordRes.json();
  const grade = recordBody.classRecord
    .find((r: any) => r.student.id === studentId)
    ?.grades.find((g: any) => g.term === term);
  test.skip(!grade || grade.initialGrade === null, "Selected ledger row has no initial grade");

  let expected: number;
  if (recordBody.gradingMode === "ZERO_BASED") {
    expected = Math.min(100, Math.max(60, Math.round(Math.round(grade.initialGrade * 100) / 100)));
  } else {
    const tableRes = await page.request.get("/api/grades/transmutation-table");
    expect(tableRes.ok()).toBe(true);
    const table = await tableRes.json();
    const initial = Math.round(grade.initialGrade * 100) / 100;
    const row = table.find((entry: any) => initial >= entry.minGrade && initial <= entry.maxGrade);
    expect(row, `No transmutation row for IG ${initial}`).toBeTruthy();
    expected = row.transmutedGrade;
  }

  const cell = page.locator(`[data-testid="ledger-term-grade"][data-student-id="${studentId}"][data-term="${term}"]`);
  await expect(cell).toHaveAttribute("data-term-grade", String(expected));
  expect(problems, problems.join("\n")).toEqual([]);
});
