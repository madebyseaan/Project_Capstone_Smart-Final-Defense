import { test, expect, type Page } from "@playwright/test";
import { collectProblems, hasAccount, login } from "./fixtures";

/**
 * Read-only grade pipeline parity:
 * Advisory profile ↔ SF9 ↔ SF10 (API + rendered UI).
 * Never writes grades, locks, enrollments, or sync state.
 */

const API = process.env.SMART_API_URL ?? "http://localhost:5003/api";

function norm(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
function codeKey(code: unknown): string {
  return norm(code).toUpperCase();
}

async function sessionToken(page: Page, key: string): Promise<string> {
  const token = await page.evaluate((storageKey) => sessionStorage.getItem(storageKey), key);
  expect(token, `${key} should exist after login`).toBeTruthy();
  return token as string;
}

async function apiGet(page: Page, token: string, path: string) {
  const response = await page.request.get(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.status(), `GET ${path}`).toBe(200);
  return response.json();
}

function displayedNumber(text: string): number | null {
  const match = text.replace(/\s+/g, "").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : null;
}

test("Advisory, SF9 and SF10 show identical grades (read-only)", async ({ page, context }) => {
  test.skip(!hasAccount("teacher"), "Teacher credentials are not configured");
  test.skip(!hasAccount("registrar"), "Registrar credentials are not configured");

  const problems = collectProblems(page);
  await login(page, "teacher");
  const teacherToken = await sessionToken(page, "token_teacher");

  const advisory = await apiGet(page, teacherToken, "/advisory/my-advisory");
  test.skip(!advisory?.hasAdvisory || !advisory?.students?.length, "Teacher has no advisory learners");

  const sectionGradeLevel = String(advisory.section?.gradeLevel ?? "");
  const students = advisory.students.slice(0, 5);
  const firstStudent = students[0];
  const schoolYear = advisory.section?.schoolYear;

  const advisoryProfile = await apiGet(page, teacherToken, `/advisory/student/${firstStudent.id}/grades`);
  const advisoryRows: any[] = advisoryProfile.subjectGrades ?? [];
  expect(advisoryRows.length).toBeGreaterThan(0);

  const sf9Section = await apiGet(page, teacherToken, "/advisory/sf9");
  const sf9Student = (sf9Section.students ?? []).find((student: any) => student.student?.id === firstStudent.id);
  expect(sf9Student, "first advisory learner should exist in the SF9 payload").toBeTruthy();

  // ── API parity: Advisory vs SF9 ──
  for (const row of advisoryRows) {
    const sf9Row = (sf9Student.subjectGrades ?? []).find((item: any) => codeKey(item.subjectCode) === codeKey(row.subjectCode));
    expect(sf9Row, `SF9 row for ${row.subjectCode}`).toBeTruthy();
    for (const term of ["T1", "T2", "T3"] as const) {
      expect(sf9Row[term] ?? null, `${row.subjectCode} ${term} advisory=${row.grades?.[term]?.quarterlyGrade} sf9=${sf9Row[term]}`).toBe(
        row.grades?.[term]?.quarterlyGrade ?? null,
      );
    }
    expect(sf9Row.final ?? null).toBe(row.finalGrade ?? null);
  }

  // ── G10 Math must remain its own learning area ──
  if (sectionGradeLevel === "GRADE_10") {
    const hasMath = advisoryRows.some((row) => codeKey(row.subjectCode).startsWith("MATH"));
    expect(hasMath, "G10 advisory must include Mathematics").toBe(true);
    const sf9Math = (sf9Student.subjectGrades ?? []).some((row: any) => codeKey(row.subjectCode).startsWith("MATH"));
    expect(sf9Math, "G10 SF9 must include Mathematics").toBe(true);
  }

  // ── UI parity: Advisory profile ──
  await page.goto(`/teacher/advisory/student/${firstStudent.id}`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid^="grade-row-"]').first().waitFor({ state: "visible", timeout: 30_000 });

  for (const row of advisoryRows) {
    const key = codeKey(row.subjectCode);
    for (const term of ["T1", "T2", "T3"] as const) {
      const cell = page.getByTestId(`grade-${row.subjectCode}-${term}`);
      await expect(cell, `profile cell ${key} ${term}`).toBeVisible();
      const rendered = displayedNumber(await cell.innerText());
      const expected = row.grades?.[term]?.quarterlyGrade ?? null;
      expect(rendered, `profile ${key} ${term}`).toBe(expected);
    }
    const finalCell = page.getByTestId(`grade-${row.subjectCode}-final`);
    await expect(finalCell).toBeVisible();
    expect(displayedNumber(await finalCell.innerText()), `profile ${key} final`).toBe(row.finalGrade ?? null);
  }

  // ── UI parity: SF9 preview ──
  const printButton = page.getByTestId("print-student-sf9");
  if (await printButton.isVisible().catch(() => false)) {
    await printButton.click();
    const form = page.getByTestId("sf9-form");
    await expect(form).toBeVisible({ timeout: 30_000 });

    for (const row of advisoryRows) {
      const sf9Row = (sf9Student.subjectGrades ?? []).find((item: any) => codeKey(item.subjectCode) === codeKey(row.subjectCode));
      if (!sf9Row) continue;
      const domRow = form.locator("tbody tr").filter({ hasText: new RegExp(sf9Row.subjectName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") }).first();
      if (!(await domRow.count())) continue;
      const cells = domRow.locator("td");
      for (const [index, term] of (["T1", "T2", "T3", "final"] as const).entries()) {
        const expected = term === "final" ? sf9Row.final ?? null : sf9Row[term] ?? null;
        const rendered = displayedNumber(await cells.nth(1 + index).innerText());
        expect(rendered, `SF9 preview ${row.subjectCode} ${term}`).toBe(expected);
      }
    }
    await page.keyboard.press("Escape");
  }

  // ── Registrar APIs: SF9 / SF10 ──
  const registrarPage = await context.newPage();
  const registrarProblems = collectProblems(registrarPage);
  await login(registrarPage, "registrar");
  const registrarToken = await sessionToken(registrarPage, "token_registrar");

  const registrarSf9 = await apiGet(registrarPage, registrarToken, `/registrar/forms/sf9/${firstStudent.id}?schoolYear=${encodeURIComponent(schoolYear)}`);
  for (const row of advisoryRows) {
    const registrarRow = (registrarSf9.subjectGrades ?? []).find((item: any) => codeKey(item.subjectCode) === codeKey(row.subjectCode));
    expect(registrarRow, `registrar SF9 row ${row.subjectCode}`).toBeTruthy();
    expect(registrarRow.T1 ?? null).toBe(row.grades?.T1?.quarterlyGrade ?? null);
    expect(registrarRow.T2 ?? null).toBe(row.grades?.T2?.quarterlyGrade ?? null);
    expect(registrarRow.T3 ?? null).toBe(row.grades?.T3?.quarterlyGrade ?? null);
    expect(registrarRow.final ?? null).toBe(row.finalGrade ?? null);
  }

  const sf10 = await apiGet(registrarPage, registrarToken, `/registrar/forms/sf10/${firstStudent.id}`);
  const currentYear = (sf10.schoolRecords ?? []).find((record: any) => record.schoolYear === schoolYear);
  expect(currentYear, `SF10 record for ${schoolYear}`).toBeTruthy();
  for (const row of advisoryRows) {
    const registrarRow = (currentYear.subjectGrades ?? []).find((item: any) => codeKey(item.subjectCode) === codeKey(row.subjectCode));
    expect(registrarRow, `registrar SF10 row ${row.subjectCode}`).toBeTruthy();
    expect(registrarRow.T1 ?? null).toBe(row.grades?.T1?.quarterlyGrade ?? null);
    expect(registrarRow.T2 ?? null).toBe(row.grades?.T2?.quarterlyGrade ?? null);
    expect(registrarRow.T3 ?? null).toBe(row.grades?.T3?.quarterlyGrade ?? null);
    expect(registrarRow.final ?? null).toBe(row.finalGrade ?? null);
  }

  await registrarPage.close();

  expect(problems, problems.join("\n")).toEqual([]);
  expect(registrarProblems, registrarProblems.join("\n")).toEqual([]);
});
