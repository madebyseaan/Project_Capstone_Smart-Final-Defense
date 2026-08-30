/**
 * year-term-locks.test.ts — Per-year / per-term grade lock endpoints + enforcement + EOSY finalize (live server)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { BASE, hasCredentials, getAdminCredentials, getTeacherCredentials, getRegistrarCredentials, login, getCsrfToken, post } from "./test-helpers";

const credsOk = hasCredentials("admin", "teacher", "registrar");

describe.skipIf(!credsOk)("Year/Term Lock Admin API", () => {
  let adminToken = "";
  let teacherToken = "";
  let registrarToken = "";
  let csrfToken = "";
  let activeSyId: string | null = null;
  let currentTerm = "T3";
  let teacherClass: { classAssignmentId: string; studentId: string; schoolYear: string; term: string } | null = null;
  let originalSystemLock = false;

  beforeAll(async () => {
    const adminCreds = getAdminCredentials()!;
    const teacherCreds = getTeacherCredentials()!;
    const registrarCreds = getRegistrarCredentials()!;
    adminToken = await login(adminCreds.email, adminCreds.password);
    teacherToken = await login(teacherCreds.email, teacherCreds.password);
    registrarToken = await login(registrarCreds.email, registrarCreds.password);
    csrfToken = await getCsrfToken();

    const settingsRes = await fetch(`${BASE}/admin/settings`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const { settings }: any = await settingsRes.json();
    currentTerm = settings?.currentTerm ?? "T3";

    const locksRes = await fetch(`${BASE}/admin/year-locks`, { headers: { Authorization: `Bearer ${adminToken}` } });
    if (locksRes.ok) {
      const { locks }: any = await locksRes.json();
      activeSyId = locks?.find((l: any) => l.label === settings?.currentSchoolYear)?.schoolYearId ?? null;
    }

    const classesRes = await fetch(`${BASE}/grades/my-classes`, { headers: { Authorization: `Bearer ${teacherToken}` } });
    if (classesRes.ok) {
      const classes: any = await classesRes.json();
      const candidates = (classes ?? []).filter(
        (c: any) => c.section?.enrollments?.length > 0 && !String(c.subject?.code ?? "").toUpperCase().startsWith("HG")
      );
      for (const cls of candidates) {
        const recordRes = await fetch(`${BASE}/grades/class-record/${cls.id}?term=${currentTerm}`, {
          headers: { Authorization: `Bearer ${teacherToken}` },
        });
        if (!recordRes.ok) continue;
        const record: any = await recordRes.json();
        const target = (record.classRecord ?? []).find((row: any) => !(row.grades ?? []).some((g: any) => g.isArchived));
        if (target) {
          teacherClass = { classAssignmentId: cls.id, studentId: target.student.id, schoolYear: cls.schoolYear, term: currentTerm };
          break;
        }
      }
    }

    if (activeSyId) {
      await post(`/admin/year-locks/${activeSyId}`, adminToken, { locked: false }, csrfToken).catch(() => {});
      await post(`/admin/term-locks/${activeSyId}/${currentTerm}`, adminToken, { locked: false }, csrfToken).catch(() => {});
    }
    const sysRes = await fetch(`${BASE}/admin/settings`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const sysData: any = await sysRes.json();
    originalSystemLock = sysData?.settings?.gradeLock ?? false;
    if (originalSystemLock) {
      await post(`/admin/settings/grade-lock`, adminToken, { locked: false }, csrfToken).catch(() => {});
    }
  });

  afterAll(async () => {
    if (activeSyId) {
      await post(`/admin/year-locks/${activeSyId}`, adminToken, { locked: false }, csrfToken).catch(() => {});
      await post(`/admin/term-locks/${activeSyId}/${currentTerm}`, adminToken, { locked: false }, csrfToken).catch(() => {});
    }
    if (originalSystemLock) {
      await post(`/admin/settings/grade-lock`, adminToken, { locked: true }, csrfToken).catch(() => {});
    }
  });

  it("GET /admin/year-locks returns lock matrix for admin", async () => {
    const res = await fetch(`${BASE}/admin/year-locks`, { headers: { Authorization: `Bearer ${adminToken}` } });
    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(Array.isArray(data.locks)).toBe(true);
    if (data.locks.length > 0) {
      expect(data.locks[0]).toHaveProperty("termLocks");
      expect(data.locks[0].termLocks).toHaveLength(3);
      expect(data.locks[0]).toHaveProperty("yearLock");
    }
  });

  it("GET /admin/year-locks is forbidden for teacher", async () => {
    const res = await fetch(`${BASE}/admin/year-locks`, { headers: { Authorization: `Bearer ${teacherToken}` } });
    expect(res.status).toBe(403);
  });

  it("POST year lock on unknown school year → 404", async () => {
    const res = await post(`/admin/year-locks/nonexistent-id`, adminToken, { locked: true }, csrfToken);
    expect(res.status).toBe(404);
  });

  it("POST term lock on unknown school year → 404", async () => {
    const res = await post(`/admin/term-locks/nonexistent-id/T1`, adminToken, { locked: true }, csrfToken);
    expect(res.status).toBe(404);
  });

  it("year lock blocks teacher grade save with YEAR_LOCKED", async () => {
    if (!activeSyId || !teacherClass) return;
    await post(`/admin/year-locks/${activeSyId}`, adminToken, { locked: false }, csrfToken).catch(() => {});
    await post(`/admin/term-locks/${activeSyId}/${currentTerm}`, adminToken, { locked: false }, csrfToken).catch(() => {});
    await post(`/admin/year-locks/${activeSyId}`, adminToken, { locked: true }, csrfToken);
    const res = await post(`/grades/grade`, teacherToken, {
      studentId: teacherClass.studentId, classAssignmentId: teacherClass.classAssignmentId,
      term: currentTerm, writtenWorkScores: [], perfTaskScores: [],
    }, csrfToken);
    const data: any = await res.json();
    expect(res.status).toBe(403);
    expect(data.code).toBe("YEAR_LOCKED");
    await post(`/admin/year-locks/${activeSyId}`, adminToken, { locked: false }, csrfToken);
  });

  it("term lock blocks teacher grade save with TERM_LOCKED (year unlocked)", async () => {
    if (!activeSyId || !teacherClass) return;
    await post(`/admin/year-locks/${activeSyId}`, adminToken, { locked: false }, csrfToken).catch(() => {});
    await post(`/admin/term-locks/${activeSyId}/${currentTerm}`, adminToken, { locked: true }, csrfToken);
    const res = await post(`/grades/grade`, teacherToken, {
      studentId: teacherClass.studentId, classAssignmentId: teacherClass.classAssignmentId,
      term: currentTerm, writtenWorkScores: [], perfTaskScores: [],
    }, csrfToken);
    const data: any = await res.json();
    expect(res.status).toBe(403);
    expect(data.code).toBe("TERM_LOCKED");
    await post(`/admin/term-locks/${activeSyId}/${currentTerm}`, adminToken, { locked: false }, csrfToken);
  });

  it("locks are off after unlock — class-record reports gradeLock=false", async () => {
    if (!teacherClass) return;
    const res = await fetch(`${BASE}/grades/class-record/${teacherClass.classAssignmentId}?term=${teacherClass.term}`, {
      headers: { Authorization: `Bearer ${teacherToken}` },
    });
    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data.gradeLock).toBe(false);
    expect(data.locks).toBeDefined();
    expect(data.locks.yearLocked).toBe(false);
    expect(data.locks.termLocks[teacherClass.term]).toBe(false);
  });

  it("GET /registrar/eosy/promotion-status returns computed + stored statuses", async () => {
    const schoolYear = "2026-2027";
    const sectionsRes = await fetch(`${BASE}/registrar/sections?schoolYear=${schoolYear}`, {
      headers: { Authorization: `Bearer ${registrarToken}` },
    });
    if (!sectionsRes.ok) return;
    const sections: any = await sectionsRes.json();
    const sectionId = sections?.[0]?.id;
    if (!sectionId) return;
    const res = await fetch(`${BASE}/registrar/eosy/promotion-status/${sectionId}?schoolYear=${schoolYear}`, {
      headers: { Authorization: `Bearer ${registrarToken}` },
    });
    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data.section).toBeDefined();
    expect(Array.isArray(data.enrollments)).toBe(true);
    expect(Array.isArray(data.draftBlockers)).toBe(true);
  });

  it("promotion-status is forbidden for teacher", async () => {
    const schoolYear = "2026-2027";
    const sectionsRes = await fetch(`${BASE}/registrar/sections?schoolYear=${schoolYear}`, {
      headers: { Authorization: `Bearer ${registrarToken}` },
    });
    if (!sectionsRes.ok) return;
    const sections: any = await sectionsRes.json();
    const sectionId = sections?.[0]?.id;
    if (!sectionId) return;
    const res = await fetch(`${BASE}/registrar/eosy/promotion-status/${sectionId}?schoolYear=${schoolYear}`, {
      headers: { Authorization: `Bearer ${teacherToken}` },
    });
    expect(res.status).toBe(403);
  });

  it("finalize is DRAFT-blocked or succeeds and is idempotent", async () => {
    const schoolYear = "2026-2027";
    const sectionsRes = await fetch(`${BASE}/registrar/sections?schoolYear=${schoolYear}`, {
      headers: { Authorization: `Bearer ${registrarToken}` },
    });
    if (!sectionsRes.ok) return;
    const sections: any = await sectionsRes.json();
    const sectionId = sections?.[0]?.id;
    if (!sectionId) return;
    const first = await post(`/registrar/eosy/finalize`, registrarToken, { sectionId, schoolYear }, csrfToken);
    expect([200, 400]).toContain(first.status);
    const firstData: any = await first.json();
    if (first.status === 400) {
      expect(Array.isArray(firstData.blockers)).toBe(true);
      expect(firstData.blockers.length).toBeGreaterThan(0);
      return;
    }
    const second = await post(`/registrar/eosy/finalize`, registrarToken, { sectionId, schoolYear }, csrfToken);
    expect(second.status).toBe(200);
    const secondData: any = await second.json();
    expect(secondData.snapshotsCreated).toBe(0);
    expect(secondData.processed).toBe(firstData.processed);
  });
});
