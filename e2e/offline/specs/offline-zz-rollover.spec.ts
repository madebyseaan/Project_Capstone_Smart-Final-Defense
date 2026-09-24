import { test, expect, type Page } from "@playwright/test";

/**
 * S3 — rollover simulation (the safety case).
 *
 * EnrollPro goes down; while it is down it comes back announcing a NEW active
 * school year. SMART must (a) not serve the old scope after reconnect, and
 * (b) propagate the new year through the existing rollover path.
 */
const CONTROL = process.env.EP_STUB_CONTROL ?? "http://127.0.0.1:5999";
const REGISTRAR = {
  id: process.env.SMART_TEST_REGISTRAR_EMAIL ?? "rig.registrar@example.test",
  pw: process.env.SMART_TEST_REGISTRAR_PASSWORD ?? "RigPass123!",
};

async function setMode(mode: string): Promise<void> {
  const res = await fetch(`${CONTROL}/_control/mode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  });
  expect(res.ok).toBe(true);
}

async function switchStubYear(): Promise<void> {
  const res = await fetch(`${CONTROL}/_control/year`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: 900004, label: "2090-2091", activeTerm: "T1" }),
  });
  expect(res.ok).toBe(true);
}

async function loginRegistrar(page: Page): Promise<void> {
  await page.goto("/login/registrar", { waitUntil: "domcontentloaded" });
  await page.locator("input").nth(0).fill(REGISTRAR.id);
  await page.locator("input").nth(1).fill(REGISTRAR.pw);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !u.toString().includes("/login"), { timeout: 30_000 });
}

test.describe("rollover simulation (S3)", () => {
  test.setTimeout(180_000);

  test("EP reconnects with a new active year and SMART follows", async ({ page }) => {
    // Baseline: fixture year A is active.
    const before = await (await page.request.get("/api/admin/settings/public")).text();
    expect(before).toContain("2088-2089");

    await loginRegistrar(page);

    // 1. EnrollPro goes down (blackhole).
    await setMode("hang");
    await page.goto("/registrar", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);

    // 2. While down, the next active year is announced.
    await switchStubYear();
    await setMode("online");

    // 3. Breaker cooldown lapses → the next portal load is the recovery probe.
    await page.waitForTimeout(1600);
    await page.goto("/registrar", { waitUntil: "domcontentloaded" });

    // 4. SMART must converge on year B (scope invalidation + immediate resync).
    await expect
      .poll(
        async () => {
          const body = await (await page.request.get("/api/admin/settings/public")).text();
          return body.includes("2090-2091");
        },
        { timeout: 90_000, intervals: [2000] },
      )
      .toBe(true);

    // 5. And the old year must no longer be the active scope.
    const after = await (await page.request.get("/api/admin/settings/public")).text();
    expect(after).not.toContain('"currentSchoolYear":"2088-2089"');
  });
});
