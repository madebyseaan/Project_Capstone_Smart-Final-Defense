import { test, expect, type Page } from "@playwright/test";

/**
 * T3 offline portal simulation (S1, S2, S5, S6).
 * Runs against the isolated rig only (test DB + loopback stubs).
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

async function resetStub(): Promise<void> {
  await fetch(`${CONTROL}/_control/reset`, { method: "POST" });
}

async function loginRegistrar(page: Page): Promise<void> {
  await page.goto("/login/registrar", { waitUntil: "domcontentloaded" });
  await page.locator("input").nth(0).fill(REGISTRAR.id);
  await page.locator("input").nth(1).fill(REGISTRAR.pw);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !u.toString().includes("/login"), { timeout: 30_000 });
}

test.describe("offline portal (EnrollPro stub)", () => {
  test.beforeEach(async () => {
    await resetStub();
  });

  test.afterAll(async () => {
    await resetStub();
  });

  test("S1: registrar portal loads while EnrollPro hangs", async ({ page }) => {
    await setMode("hang");
    const problems: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") problems.push(m.text().slice(0, 160));
    });

    await loginRegistrar(page);
    const started = Date.now();
    await page.goto("/registrar", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    const elapsed = Date.now() - started;
    console.log(`[pw] S1 registrar load under EP hang: ${elapsed}ms`);

    const body = await page.locator("body").innerText();
    expect(body.trim().length, "registrar page should render").toBeGreaterThan(10);
    expect(page.url(), "must not bounce to login").not.toContain("/login");
    expect(elapsed, "load must stay bounded under EP hang").toBeLessThan(20_000);
    expect(problems, problems.join("\n")).toEqual([]);
  });

  test("S6: warm reload under EP hang stays fast", async ({ page }) => {
    await loginRegistrar(page);
    await page.goto("/registrar", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    await setMode("hang");
    const started = Date.now();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    const elapsed = Date.now() - started;
    console.log(`[pw] S6 warm reload under EP hang: ${elapsed}ms`);

    expect(elapsed, "warm reload must stay bounded").toBeLessThan(12_000);
    const body = await page.locator("body").innerText();
    expect(body.trim().length).toBeGreaterThan(10);
  });

  test("S2: portal responds after EnrollPro returns", async ({ page }) => {
    await loginRegistrar(page);
    await setMode("hang");
    await page.goto("/registrar", { waitUntil: "domcontentloaded" });

    await setMode("online");
    // Let the breaker cooldown lapse so the portal's next call can succeed.
    await page.waitForTimeout(1600);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    const body = await page.locator("body").innerText();
    expect(body.trim().length).toBeGreaterThan(10);
    expect(page.url()).not.toContain("/login");
  });

  test("S5: flapping (hang → refuse → online) does not break the portal", async ({ page }) => {
    await loginRegistrar(page);
    await setMode("hang");
    await setMode("refuse");
    await setMode("online");

    await page.goto("/registrar", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    const body = await page.locator("body").innerText();
    expect(body.trim().length).toBeGreaterThan(10);
    expect(page.url()).not.toContain("/login");
  });
});
