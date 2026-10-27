import { test, expect } from "@playwright/test";
import { login } from "./fixtures";

/**
 * Read-only UX guard for the ATLAS outage fallback work.
 *
 * The backend may legitimately report an integration error while ATLAS is
 * degraded; teachers must still see plain-language copy, never raw upstream
 * URLs, HTTP codes, or contract codes.
 */
test("teacher schedule and class records never expose raw upstream errors", async ({ page }) => {
  await login(page, "teacher");

  const rawMarkers = [
    "Timeout:",
    "HTTP_500",
    "HTTP_502",
    "faculty-external",
    "FACULTY_NOT_FOUND",
    "ATLAS_FACULTY_UNRESOLVED",
    "Code: HTTP_",
  ];

  for (const path of ["/teacher/classes", "/teacher/schedule"]) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(8_000);

    const body = await page.locator("body").innerText();
    expect(body.trim().length, `${path} should render content`).toBeGreaterThan(10);
    expect(page.url(), `${path} should not bounce to login`).not.toContain("/login");

    for (const marker of rawMarkers) {
      expect(body, `${path} must not expose "${marker}"`).not.toContain(marker);
    }
  }
});
