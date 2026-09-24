import { test, expect, type Page } from "@playwright/test";

/**
 * T3 offline portal simulation — remaining scenarios (S4, S8, S9, S10).
 * Runs against the isolated rig only (test DB + loopback stubs).
 */
const EP_CONTROL = process.env.EP_STUB_CONTROL ?? "http://127.0.0.1:5999";
const ATLAS_CONTROL = "http://127.0.0.1:5998";
const AIMS_CONTROL = "http://127.0.0.1:5997";

const TEACHER = {
  id: process.env.SMART_TEST_TEACHER_EMAIL ?? "rig.teacher@example.test",
  pw: process.env.SMART_TEST_TEACHER_PASSWORD ?? "RigPass123!",
};
const REGISTRAR = {
  id: process.env.SMART_TEST_REGISTRAR_EMAIL ?? "rig.registrar@example.test",
  pw: process.env.SMART_TEST_REGISTRAR_PASSWORD ?? "RigPass123!",
};

async function setMode(control: string, mode: string): Promise<void> {
  const res = await fetch(`${control}/_control/mode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  });
  expect(res.ok).toBe(true);
}

async function getState(control: string): Promise<{ mode: string; counters?: Record<string, number> }> {
  const res = await fetch(`${control}/_control/state`);
  expect(res.ok).toBe(true);
  return res.json();
}

async function login(page: Page, url: string, creds: { id: string; pw: string }): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.locator("input").nth(0).fill(creds.id);
  await page.locator("input").nth(1).fill(creds.pw);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !u.toString().includes("/login"), { timeout: 30_000 });
}

function collectErrors(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(m.text().slice(0, 160));
  });
  return problems;
}

test.describe("offline systems (S4, S8, S9, S10)", () => {
  test.beforeEach(async () => {
    await setMode(EP_CONTROL, "online");
    await setMode(ATLAS_CONTROL, "online");
    await setMode(AIMS_CONTROL, "online");
  });

  test.afterAll(async () => {
    await setMode(EP_CONTROL, "online");
    await setMode(ATLAS_CONTROL, "online");
    await setMode(AIMS_CONTROL, "online");
  });

  test("S4: partial outage — EP down, ATLAS/AIMS up", async ({ page }) => {
    const problems = collectErrors(page);
    await login(page, "/login/registrar", REGISTRAR);

    // Warm the section-roster cache while EnrollPro is up (stub serves its learner
    // fixture for any positive id — no dependency on DB↔EP section-name mapping).
    const token = await page.evaluate(() => sessionStorage.getItem("token_registrar"));
    const auth = { Authorization: `Bearer ${token}` };
    const rosterId = 1;
    const warm = await page.request.get(`/api/registrar/section-roster/${rosterId}`, { headers: auth });
    expect(warm.ok()).toBe(true);
    const warmBody = await warm.json();

    // Outage: EP hangs, ATLAS/AIMS stay up.
    await setMode(EP_CONTROL, "hang");
    const started = Date.now();
    await page.goto("/registrar", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    const elapsed = Date.now() - started;
    console.log(`[pw] S4 registrar load (EP down, others up): ${elapsed}ms`);

    const body = await page.locator("body").innerText();
    expect(body.trim().length, "registrar page should render").toBeGreaterThan(10);
    expect(page.url(), "must not bounce to login").not.toContain("/login");
    expect(elapsed, "partial outage must stay bounded").toBeLessThan(20_000);
    expect(problems, problems.join("\n")).toEqual([]);

    // Roster must be served from cache (not a 500), with the same content + status contract.
    const cachedStarted = Date.now();
    const cached = await page.request.get(`/api/registrar/section-roster/${rosterId}`, { headers: auth });
    const cachedMs = Date.now() - cachedStarted;
    expect(cached.ok(), "roster must fall back to cached data during EP outage").toBe(true);
    expect(cachedMs, "cached roster must not hang during outage").toBeLessThan(3000);
    const cachedBody = await cached.json();
    expect(cachedBody.total).toBe(warmBody.total);
    expect(typeof cachedBody.stale).toBe("boolean");
    expect(typeof cachedBody.ageMs).toBe("number");

    const ep = await getState(EP_CONTROL);
    expect(ep.mode).toBe("hang");
    const atlas = await getState(ATLAS_CONTROL);
    expect(atlas.mode, "ATLAS must remain online during EP-only outage").toBe("online");
    const aims = await getState(AIMS_CONTROL);
    expect(aims.mode, "AIMS must remain online during EP-only outage").toBe("online");
  });

  test("S8: ATLAS down does not take the teacher portal down", async ({ page }) => {
    await setMode(ATLAS_CONTROL, "hang");
    const problems = collectErrors(page);

    await login(page, "/login", TEACHER);
    const started = Date.now();
    await page.goto("/teacher", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    const elapsed = Date.now() - started;
    console.log(`[pw] S8 teacher load (ATLAS down): ${elapsed}ms`);

    const body = await page.locator("body").innerText();
    expect(body.trim().length, "teacher page should render").toBeGreaterThan(10);
    expect(page.url(), "must not bounce to login").not.toContain("/login");
    expect(elapsed, "ATLAS outage must stay bounded").toBeLessThan(20_000);
    if (problems.length > 0) console.log(`[pw] S8 console errors (non-fatal): ${problems.join(" | ")}`);

    const atlas = await getState(ATLAS_CONTROL);
    expect(atlas.mode).toBe("hang");
  });

  test("S9: ATLAS recovery restores calls without a restart", async ({ page }) => {
    await setMode(ATLAS_CONTROL, "hang");
    await login(page, "/login", TEACHER);
    await page.goto("/teacher", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    const before = await getState(ATLAS_CONTROL);
    const callsBefore = Object.values(before.counters ?? {}).reduce((a, b) => a + b, 0);

    await setMode(ATLAS_CONTROL, "online");
    await page.waitForTimeout(1600);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);

    const body = await page.locator("body").innerText();
    expect(body.trim().length, "teacher page should render after ATLAS recovery").toBeGreaterThan(10);
    expect(page.url()).not.toContain("/login");

    const after = await getState(ATLAS_CONTROL);
    const callsAfter = Object.values(after.counters ?? {}).reduce((a, b) => a + b, 0);
    expect(callsAfter, "ATLAS must receive calls again after recovery").toBeGreaterThan(callsBefore);
  });

  test("S10: AIMS down does not block any portal", async ({ page }) => {
    await setMode(AIMS_CONTROL, "hang");
    const problems = collectErrors(page);

    await login(page, "/login", TEACHER);
    const started = Date.now();
    await page.goto("/teacher", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    const elapsed = Date.now() - started;
    console.log(`[pw] S10 teacher load (AIMS down): ${elapsed}ms`);

    const body = await page.locator("body").innerText();
    expect(body.trim().length, "teacher page should render").toBeGreaterThan(10);
    expect(elapsed, "AIMS outage must stay bounded").toBeLessThan(15_000);

    const aims = await getState(AIMS_CONTROL);
    expect(aims.mode).toBe("hang");
  });
});
