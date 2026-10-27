import { test, expect, type Page } from "@playwright/test";
import { account, collectProblems, hasAccount, login } from "./fixtures";

/**
 * Read-only guard for the advisory SF9 / temporary term card printables.
 * Never mutates grades, locks, terms, enrollments, or sync state.
 */

const API = process.env.SMART_API_URL ?? "http://localhost:5003/api";

async function stubPrint(page: Page) {
  await page.addInitScript(() => {
    (window as any).__printCalls = 0;
    (window as any).__printFormCounts = [] as number[];
    window.print = () => {
      (window as any).__printCalls += 1;
      (window as any).__printFormCounts.push(
        document.querySelectorAll(".sf-print-container .print-form").length,
      );
    };
  });
}

async function teacherToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => sessionStorage.getItem("token_teacher"));
  expect(token, "teacher token should exist after login").toBeTruthy();
  return token as string;
}

async function currentPrintablePageCount(page: Page): Promise<number> {
  try {
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });
    return (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  } catch {
    test.skip(true, "PDF page-count gate requires headless Chromium");
    return 0;
  }
}

async function openPrintCenter(page: Page) {
  await page.goto("/teacher/advisory?view=printables", { waitUntil: "domcontentloaded" });
  const center = page.getByTestId("print-center");
  try {
    await center.waitFor({ state: "visible", timeout: 20_000 });
  } catch {
    test.skip(true, "Teacher account has no advisory section");
  }
  await expect(center).toBeVisible();

  const firstRow = page.getByTestId("student-row").first();
  try {
    await firstRow.waitFor({ state: "visible", timeout: 20_000 });
  } catch {
    test.skip(true, "Advisory section has no learners to print");
  }
  await expect(firstRow).toBeVisible();
}

async function openAdvisoryFromSidebar(page: Page): Promise<boolean> {
  await page.goto("/teacher/advisory", { waitUntil: "domcontentloaded" });
  const link = page.getByTestId("advisory-printables-link");
  try {
    await link.waitFor({ state: "visible", timeout: 20_000 });
    return true;
  } catch {
    return false;
  }
}

test.describe("advisory printables (read-only)", () => {
  test("E-01 print center loads without console/API errors", async ({ page }) => {
    await stubPrint(page);
    const problems = collectProblems(page);
    await login(page, "teacher");
    await openPrintCenter(page);

    expect(page.url()).not.toContain("/login");
    expect(problems, problems.join("\n")).toEqual([]);
  });

  test("E-02 MyAdvisory entry point opens the print center", async ({ page }) => {
    await stubPrint(page);
    await login(page, "teacher");

    const hasLink = await openAdvisoryFromSidebar(page);
    if (!hasLink) test.skip(true, "Teacher account has no advisory section");

    await page.getByTestId("advisory-printables-link").click();
    await expect(page.getByTestId("print-center")).toBeVisible();
    await expect(page).toHaveURL(/\/teacher\/advisory\?view=printables/);
    await expect(page.getByText("Loading advisory records...")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Printables" })).toHaveCount(0);
  });

  test("E-03/E-04 SF9 bulk print clones the selection and cleans up", async ({ page }) => {
    await stubPrint(page);
    await login(page, "teacher");
    await openPrintCenter(page);

    const rows = page.getByTestId("student-row");
    const rowCount = await rows.count();
    if (rowCount < 2) test.skip(true, "Need at least two advisory learners");

    await rows.nth(0).getByTestId("student-checkbox").check();
    await rows.nth(1).getByTestId("student-checkbox").check();
    await expect(page.getByTestId("print-selected")).toContainText("(2)");
    await page.getByTestId("print-selected").click();

    await expect.poll(() => page.evaluate(() => (window as any).__printCalls)).toBe(1);
    const counts = await page.evaluate(() => (window as any).__printFormCounts);
    expect(counts[0]).toBe(2);
    expect(await page.locator(".sf-print-container .print-form-sf9").count()).toBe(2);

    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    await expect(page.locator(".sf-print-container")).toHaveCount(0);
    await expect(page.locator('style[id="advisory-print-style"]')).toHaveCount(0);
  });

  test("E-05/E-06 term card is one term, temporary, and status-consistent", async ({ page }) => {
    await stubPrint(page);
    await login(page, "teacher");
    await openPrintCenter(page);

    await page.getByTestId("print-mode-term").click();
    await expect(page.getByTestId("term-pill-T1")).toBeVisible();
    await page.getByTestId("term-pill-T1").click();

    const card = page.getByTestId("term-card-form").first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("term-card-watermark").first()).toBeVisible();
    await expect(card.getByText(/final rating/i)).toHaveCount(0);
    await expect(card.getByText(/with honors|promoted|retained/i)).toHaveCount(0);

    const status = await card.getAttribute("data-term-status");
    expect(["DRAFT", "FINAL"]).toContain(status);
    const badge = page.getByTestId("term-status-badge").first();
    await expect(badge).toBeVisible();
    if (status === "DRAFT") {
      await expect(badge).toContainText(/draft/i);
    } else {
      await expect(badge).toContainText(/final/i);
    }
  });

  test("E-07 term card bulk print clones the selection", async ({ page }) => {
    await stubPrint(page);
    await login(page, "teacher");
    await openPrintCenter(page);

    await page.getByTestId("print-mode-term").click();
    await page.getByTestId("term-pill-T1").click();
    await expect(page.getByTestId("student-row").first()).toBeVisible({ timeout: 30_000 });

    const rows = page.getByTestId("student-row");
    const rowCount = await rows.count();
    if (rowCount < 2) test.skip(true, "Need at least two advisory learners");

    await rows.nth(0).getByTestId("student-checkbox").check();
    await rows.nth(1).getByTestId("student-checkbox").check();
    await expect(page.getByTestId("print-selected")).toContainText("(2)");
    await page.getByTestId("print-selected").click();

    await expect.poll(() => page.evaluate(() => (window as any).__printCalls)).toBe(1);
    expect(await page.locator(".sf-print-container .print-form-term-card").count()).toBe(2);
  });

  test("E-08/E-09 single learner SF9 and term card from the profile page", async ({ page }) => {
    await stubPrint(page);
    await login(page, "teacher");

    const hasLink = await openAdvisoryFromSidebar(page);
    if (!hasLink) test.skip(true, "Teacher account has no advisory section");

    await page.getByTestId("student-profile-link").first().click();
    const printSf9 = page.getByTestId("print-student-sf9");
    let profileLoaded = true;
    try {
      await printSf9.waitFor({ state: "visible", timeout: 20_000 });
    } catch {
      profileLoaded = false;
    }
    if (!profileLoaded) test.skip(true, "Student profile could not be loaded");

    await printSf9.click();
    await expect(page.getByTestId("preview-dialog")).toBeVisible();
    await expect(page.getByTestId("sf9-form")).toBeVisible();
    await page.getByTestId("confirm-print").click();
    await expect.poll(() => page.evaluate(() => (window as any).__printCalls)).toBe(1);
    expect(await page.evaluate(() => (window as any).__printFormCounts)).toEqual([1]);

    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    await page.locator('[data-slot="dialog-close"]').first().click();
    await expect(page.getByTestId("preview-dialog")).toBeHidden();

    await page.getByTestId("profile-term-pill-T1").click();
    await page.getByTestId("print-student-term").click();
    await expect(page.getByTestId("preview-dialog")).toBeVisible();
    await expect(page.getByTestId("term-card-form")).toBeVisible();
    await page.getByTestId("confirm-print").click();
    await expect.poll(() => page.evaluate(() => (window as any).__printCalls)).toBe(2);
    const counts = await page.evaluate(() => (window as any).__printFormCounts);
    expect(counts).toEqual([1, 1]);
  });

  test("E-16 print pagination: term card is one page, SF9 is two pages", async ({ page }) => {
    await stubPrint(page);
    await login(page, "teacher");
    await openPrintCenter(page);

    await page.getByTestId("print-mode-term").click();
    await page.getByTestId("term-pill-T1").click();
    await expect(page.getByTestId("student-row").first()).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("student-checkbox").first().check();
    await expect(page.getByTestId("print-selected")).toContainText("(1)");
    await page.getByTestId("print-selected").click();
    await page
      .locator(".sf-print-container .print-form-term-card")
      .waitFor({ state: "attached", timeout: 15_000 });
    expect(await currentPrintablePageCount(page)).toBe(1);

    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    await expect(page.locator(".sf-print-container")).toHaveCount(0);

    await page.getByTestId("print-mode-sf9").click();
    await expect(page.getByTestId("student-row").first()).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("student-checkbox").first().check();
    await expect(page.getByTestId("print-selected")).toContainText("(1)");
    await page.getByTestId("print-selected").click();
    await page
      .locator(".sf-print-container .print-form-sf9")
      .waitFor({ state: "attached", timeout: 15_000 });
    expect(await currentPrintablePageCount(page)).toBe(2);
  });

  test("E-17 legacy printables URL redirects into My Advisory", async ({ page }) => {
    await stubPrint(page);
    await login(page, "teacher");
    await page.goto("/teacher/advisory/print", { waitUntil: "domcontentloaded" });

    await expect(page).toHaveURL(/\/teacher\/advisory\?view=printables/);
    await expect(page.getByTestId("print-center")).toBeVisible({ timeout: 20_000 });
  });

  test("E-10 registrar cannot open the teacher print center", async ({ page, request }) => {
    let registrarReady = false;
    try {
      const reg = account("registrar");
      const probe = await request.post(`${API}/auth/login`, {
        data: { email: reg.id, password: reg.pw },
      });
      registrarReady = probe.status() === 200;
    } catch {
      registrarReady = false;
    }
    if (!registrarReady) test.skip(true, "Registrar test credentials are unavailable");

    await login(page, "registrar");
    await page.goto("/teacher/advisory?view=printables", { waitUntil: "domcontentloaded" });

    await expect(page).not.toHaveURL(/\/teacher\/advisory/);
    await expect(page.getByTestId("print-center")).toHaveCount(0);
  });

  test("E-11/E-12/E-13/E-14 API contract and role separation", async ({ page, request }) => {
    await login(page, "teacher");
    const token = await teacherToken(page);
    const teacherHeaders = { Authorization: `Bearer ${token}` };

    const full = await request.get(`${API}/advisory/sf9`, { headers: teacherHeaders });
    expect(full.status()).toBe(200);
    const fullBody = await full.json();
    expect(fullBody.meta.mode).toBe("SF9");
    expect(Array.isArray(fullBody.students)).toBe(true);
    if (fullBody.students.length === 0) test.skip(true, "Advisory section has no learners");

    const term = await request.get(`${API}/advisory/sf9?term=T1`, { headers: teacherHeaders });
    expect(term.status()).toBe(200);
    const termBody = await term.json();
    expect(termBody.meta.mode).toBe("TERM_CARD");
    expect(termBody.meta.isTemporary).toBe(true);
    for (const student of termBody.students) {
      expect(Array.isArray(student.termSubjects)).toBe(true);
    }

    expect(
      (await request.get(`${API}/advisory/sf9?term=T4`, { headers: teacherHeaders })).status(),
    ).toBe(400);

    const observed = await request.get(`${API}/advisory/observed-values?term=T1`, {
      headers: teacherHeaders,
    });
    expect(observed.status()).toBe(200);
    const observedBody = await observed.json();
    expect(observedBody.groups.length).toBeGreaterThan(0);
    expect(observedBody.students.length).toBeGreaterThan(0);
    expect(observedBody.students[0].totalCount).toBeGreaterThan(0);
    expect(
      (await request.get(`${API}/advisory/observed-values?term=T4`, { headers: teacherHeaders })).status(),
    ).toBe(400);

    const studentId = fullBody.students[0]?.student?.id;
    const teacherOnRegistrar = await request.get(
      `${API}/registrar/forms/sf9/${studentId}?schoolYear=${fullBody.meta.schoolYear}`,
      { headers: teacherHeaders },
    );
    expect(teacherOnRegistrar.status()).toBe(403);

    const reg = account("registrar");
    const regLogin = await request.post(`${API}/auth/login`, {
      data: { email: reg.id, password: reg.pw },
    });

    if (regLogin.status() === 200) {
      const regBody = await regLogin.json();
      const regHeaders = { Authorization: `Bearer ${regBody.token}` };

      expect((await request.get(`${API}/advisory/sf9`, { headers: regHeaders })).status()).toBe(403);
      expect(
        (
          await request.get(
            `${API}/registrar/forms/sf9/${studentId}?schoolYear=${fullBody.meta.schoolYear}`,
            { headers: regHeaders },
          )
        ).status(),
      ).toBe(200);
    } else {
      test.info().annotations.push({
        type: "registrar-credentials",
        description: `Registrar login returned ${regLogin.status()}; registrar role-separation checks were skipped.`,
      });
    }
  });

  test("E-15 non-adviser teacher cannot fetch another adviser's learner", async ({ page, request }) => {
    test.skip(!hasAccount("teacher2"), "SMART_TEST_TEACHER2_* not configured");

    await login(page, "teacher");
    const token = await teacherToken(page);
    const full = await request.get(`${API}/advisory/sf9`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(full.status()).toBe(200);
    const body = await full.json();
    if (body.students.length === 0) test.skip(true, "Advisory section has no learners");
    const studentId = body.students[0].student.id;

    const second = account("teacher2");
    const loginRes = await request.post(`${API}/auth/login`, {
      data: { email: second.id, password: second.pw },
    });
    expect(loginRes.status()).toBe(200);
    const secondBody = await loginRes.json();

    const denied = await request.get(`${API}/advisory/sf9/${studentId}`, {
      headers: { Authorization: `Bearer ${secondBody.token}` },
    });
    // 403 when teacher2 advises another section; 404 when teacher2 has no advisory.
    expect([403, 404]).toContain(denied.status());
  });
});
