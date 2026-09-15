import { test, expect } from "@playwright/test";
import { login, collectProblems } from "./fixtures";

const PAGES = {
  admin: [
    "/admin",
    "/admin/users",
    "/admin/assignments",
    "/admin/edit-requests",
    "/admin/grading",
    "/admin/transmutation",
    "/admin/school-years",
    "/admin/settings",
    "/admin/health",
    "/admin/logs",
  ],
  teacher: [
    "/teacher",
    "/teacher/classes",
    "/teacher/attendance",
    "/teacher/attendance-reports",
    "/teacher/schedule",
    "/teacher/advisory",
  ],
  registrar: [
    "/registrar",
    "/registrar/students",
    "/registrar/roster",
    "/registrar/forms",
    "/registrar/eosy",
    "/registrar/alumni",
    "/registrar/remedial",
    "/registrar/transferees",
  ],
} as const;

for (const role of ["admin", "teacher", "registrar"] as const) {
  test.describe(`${role} portal (read-only smoke)`, () => {
    test(`${role} login + all pages load with no console/API errors`, async ({ page }) => {
      const problems = collectProblems(page);
      await login(page, role);

      for (const path of PAGES[role]) {
        await page.goto(path, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(4500);
        const body = await page.locator("body").innerText();
        expect(body.trim().length, `${path} should render content`).toBeGreaterThan(10);
        expect(page.url(), `${path} should not bounce to login`).not.toContain("/login");
      }

      expect(problems, problems.join("\n")).toEqual([]);
    });
  });
}

test("unknown route shows the 404 page (not a login bounce)", async ({ page }) => {
  await login(page, "teacher");
  await page.goto("/definitely/not/a/route", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await expect(page.getByText(/page not found/i)).toBeVisible();
});
