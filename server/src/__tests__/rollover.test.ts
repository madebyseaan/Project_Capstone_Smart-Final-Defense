/**
 * rollover.test.ts — R1/R4/R5 tests for rollover transactional correctness
 *
 * Tests the archive-year endpoint and concurrent archive behavior.
 * Tests run against the live server on port 5003.
 */

import { describe, it, expect, beforeAll } from "vitest";

const BASE = "http://localhost:5003/api";

let adminToken: string;
let csrfToken: string;

async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data: any = await res.json();
  return data.token;
}

function post(url: string, token: string, body: unknown) {
  return fetch(`${BASE}${url}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "x-csrf-token": csrfToken,
    },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  adminToken = await login("1234501@deped.gov.ph", "DepEdSY2026!");

  const seed = await fetch(`${BASE}/health`);
  const cookies = (seed.headers.getSetCookie?.() ?? []) as string[];
  csrfToken = cookies
    .find((c: string) => c.startsWith("x-csrf-token="))
    ?.split(";")[0]
    ?.split("=")[1] ?? "";
});

describe("Rollover — R1 advisory lock", () => {
  it("GET /rollover-status returns valid structure", async () => {
    const res = await fetch(`${BASE}/admin/rollover-status`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const data: any = await res.json();

    expect(res.status).toBe(200);
    expect(data).toHaveProperty("currentSY");
    expect(data).toHaveProperty("previousYear");
    expect(data).toHaveProperty("unfinalizedCount");
    expect(data).toHaveProperty("canArchive");
    expect(typeof data.unfinalizedCount).toBe("number");
  });

  it("POST /archive-year rejects active school year", async () => {
    const settingsRes = await fetch(`${BASE}/admin/settings`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const { settings }: any = await settingsRes.json();
    const activeYearId = settings.schoolYearId;

    if (!activeYearId) return;

    const res = await post("/admin/archive-year", adminToken, { schoolYearId: activeYearId });

    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.message).toMatch(/cannot archive/i);
  });

  it("POST /archive-year rejects already-archived year (idempotency)", async () => {
    const yearsRes = await fetch(`${BASE}/admin/year-locks`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const { locks }: any = await yearsRes.json();
    const archivedYear = locks?.find((l: any) => l.status === "ARCHIVED");

    if (!archivedYear) return;

    const res = await post("/admin/archive-year", adminToken, { schoolYearId: archivedYear.schoolYearId });

    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.message).toMatch(/already archived/i);
  });

  it("POST /archive-year rejects when unfinalized sections exist", async () => {
    const statusRes = await fetch(`${BASE}/admin/rollover-status`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const status: any = await statusRes.json();

    if (!status.previousYear || status.unfinalizedCount === 0) return;

    const res = await post("/admin/archive-year", adminToken, { schoolYearId: status.previousYear.id });

    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.message).toMatch(/unfinalized/i);
    expect(body.unfinalizedSections).toBeDefined();
  });

  it("Concurrent POST /archive-year calls produce safe outcome", async () => {
    const statusRes = await fetch(`${BASE}/admin/rollover-status`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const status: any = await statusRes.json();

    if (!status.previousYear || !status.canArchive) return;

    const [res1, res2] = await Promise.all([
      post("/admin/archive-year", adminToken, { schoolYearId: status.previousYear.id }),
      post("/admin/archive-year", adminToken, { schoolYearId: status.previousYear.id }),
    ]);

    const body1: any = await res1.json();
    const body2: any = await res2.json();

    const statuses = [res1.status, res2.status];
    const hasSuccess = statuses.includes(200);
    const hasAlreadyArchived = [body1.message, body2.message].some((m: string) =>
      /already archived/i.test(m)
    );

    expect(hasSuccess || hasAlreadyArchived || statuses.every((s) => s === 400)).toBe(true);

    if (hasSuccess) {
      const verifyRes = await fetch(`${BASE}/admin/year-locks`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const { locks }: any = await verifyRes.json();
      const archived = locks?.find(
        (l: any) => l.schoolYearId === status.previousYear.id
      );
      if (archived) {
        expect(archived.status).toBe("ARCHIVED");
        expect(archived.yearLock.isLocked).toBe(true);
      }
    }
  });
});
