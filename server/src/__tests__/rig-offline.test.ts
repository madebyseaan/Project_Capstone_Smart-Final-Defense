/**
 * rig-offline.test.ts — T2 rig smoke + measurements (offline rig only).
 *
 * Requires SMART_OFFLINE_RIG=1 (set by e2e/offline/run-rig.mjs).
 * Asserts functional behavior of the rig; latency budgets are added in Phase 0.
 */
import { describe, it, expect } from "vitest";

const ENABLED = process.env.SMART_OFFLINE_RIG === "1";
const BASE = process.env.SMART_RIG_BASE ?? "http://127.0.0.1:5004/api";
const CONTROL = process.env.EP_STUB_CONTROL ?? "http://127.0.0.1:5999";

const ADMIN = { email: process.env.SMART_TEST_ADMIN_EMAIL ?? "rig.admin@example.test", password: process.env.SMART_TEST_ADMIN_PASSWORD ?? "RigPass123!" };
const TEACHER = { email: process.env.SMART_TEST_TEACHER_EMAIL ?? "rig.teacher@example.test", password: process.env.SMART_TEST_TEACHER_PASSWORD ?? "RigPass123!" };
const REGISTRAR = { email: process.env.SMART_TEST_REGISTRAR_EMAIL ?? "rig.registrar@example.test", password: process.env.SMART_TEST_REGISTRAR_PASSWORD ?? "RigPass123!" };

async function login(email: string, password: string, portal: "ADMIN" | "TEACHER" | "REGISTRAR") {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, portal }),
  });
  const data: any = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function setMode(mode: string) {
  const res = await fetch(`${CONTROL}/_control/mode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  });
  expect(res.ok).toBe(true);
}

async function controlState() {
  const res = await fetch(`${CONTROL}/_control/state`);
  return res.json() as Promise<any>;
}

describe.skipIf(!ENABLED)("offline rig", () => {
  it("health endpoint is reachable", async () => {
    const res = await fetch(`${BASE}/health`);
    expect(res.ok).toBe(true);
  });

  it("stub control API switches modes deterministically", async () => {
    await fetch(`${CONTROL}/_control/reset`, { method: "POST" });
    await setMode("hang");
    let state = await controlState();
    expect(state.mode).toBe("hang");
    await setMode("refuse");
    state = await controlState();
    expect(state.mode).toBe("refuse");
    await setMode("online");
    state = await controlState();
    expect(state.mode).toBe("online");
  });

  it("teacher can log in with the rig fixtures (EP online)", async () => {
    await setMode("online");
    const { status, data } = await login(TEACHER.email, TEACHER.password, "TEACHER");
    expect(status, JSON.stringify(data)).toBe(200);
    expect(data.token).toBeTruthy();
  });

  it("registrar and admin can log in", async () => {
    const registrar = await login(REGISTRAR.email, REGISTRAR.password, "REGISTRAR");
    expect(registrar.status, JSON.stringify(registrar.data)).toBe(200);
    const admin = await login(ADMIN.email, ADMIN.password, "ADMIN");
    expect(admin.status, JSON.stringify(admin.data)).toBe(200);
  });

  it("measures dashboard latency in each EP mode (baseline evidence)", async () => {
    const registrar = await login(REGISTRAR.email, REGISTRAR.password, "REGISTRAR");
    expect(registrar.status).toBe(200);
    const token = registrar.data.token as string;

    const budgets: Record<string, number> = { online: 2000, hang: 8000, refuse: 2000 };

    for (const mode of ["online", "hang", "refuse"]) {
      await setMode(mode);
      if (mode === "online") {
        // Let the request-path breaker cooldown lapse so the probe can succeed.
        await new Promise((r) => setTimeout(r, 1300));
      }
      const started = Date.now();
      let elapsed = 0;
      try {
        const res = await fetch(`${BASE}/registrar/dashboard`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(180000),
        });
        elapsed = Date.now() - started;
        console.log(`[rig-measure] registrar/dashboard mode=${mode} status=${res.status} elapsedMs=${elapsed}`);
      } catch (err: any) {
        elapsed = Date.now() - started;
        console.log(`[rig-measure] registrar/dashboard mode=${mode} aborted elapsedMs=${elapsed} error=${err.message}`);
      }
      expect(elapsed, `registrar/dashboard mode=${mode} exceeded ${budgets[mode]}ms`).toBeLessThanOrEqual(budgets[mode]);
    }

    await setMode("online");
  }, 600000);
});
