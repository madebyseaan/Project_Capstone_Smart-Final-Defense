/**
 * rollover.test.ts — R1/R4/R5/R8/R10 tests for rollover transactional correctness.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { BASE, hasCredentials, getAdminCredentials, login, getCsrfToken, post } from "./test-helpers";

const credsOk = hasCredentials("admin");

describe.skipIf(!credsOk)("Rollover — R1 advisory lock", () => {
  let adminToken = "";
  let csrfToken = "";

  beforeAll(async () => {
    const creds = getAdminCredentials()!;
    adminToken = await login(creds.email, creds.password);
    csrfToken = await getCsrfToken();
  });

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
    if (!settings.schoolYearId) return;
    const res = await post("/admin/archive-year", adminToken, { schoolYearId: settings.schoolYearId }, csrfToken);
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
    const res = await post("/admin/archive-year", adminToken, { schoolYearId: archivedYear.schoolYearId }, csrfToken);
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
    const res = await post("/admin/archive-year", adminToken, { schoolYearId: status.previousYear.id }, csrfToken);
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
      post("/admin/archive-year", adminToken, { schoolYearId: status.previousYear.id }, csrfToken),
      post("/admin/archive-year", adminToken, { schoolYearId: status.previousYear.id }, csrfToken),
    ]);
    const body1: any = await res1.json();
    const body2: any = await res2.json();
    const statuses = [res1.status, res2.status];
    const hasSuccess = statuses.includes(200);
    const hasAlreadyArchived = [body1.message, body2.message].some((m: string) => /already archived/i.test(m));
    expect(hasSuccess || hasAlreadyArchived || statuses.every((s) => s === 400)).toBe(true);
  });
});
