/**
 * alumniClassifier-lib.test.ts — T11: Alumni classification unit test
 * Tests isStudentAlumni pure function. No HTTP, no auth, no DB.
 */
import { describe, it, expect } from "vitest";
import { isStudentAlumni, type EnrollmentRecord } from "../routes/registrar/main";

const CURRENT_YEAR = "2026-2027";

function enr(overrides: Partial<EnrollmentRecord> & { studentId: string }): EnrollmentRecord {
  return {
    promotionStatus: null,
    status: "ENROLLED",
    schoolYear: "2025-2026",
    ...overrides,
  };
}

describe("T11 — isStudentAlumni classification", () => {
  it("currently enrolled student is NOT alumni", () => {
    const latest = enr({ studentId: "s1", schoolYear: CURRENT_YEAR, status: "ENROLLED" });
    expect(isStudentAlumni(latest, [latest], new Set(["s1"]), CURRENT_YEAR)).toBe(false);
  });

  it("JHS_COMPLETER is always alumni", () => {
    const latest = enr({ studentId: "s2", promotionStatus: "JHS_COMPLETER", schoolYear: "2025-2026" });
    expect(isStudentAlumni(latest, [latest], new Set(), CURRENT_YEAR)).toBe(true);
  });

  it("PROMOTED without current-year enrollment is NOT alumni (awaiting re-enrollment)", () => {
    const latest = enr({ studentId: "s3", promotionStatus: "PROMOTED", schoolYear: "2025-2026" });
    expect(isStudentAlumni(latest, [latest], new Set(), CURRENT_YEAR)).toBe(false);
  });

  it("PROMOTED with later TRANSFERRED enrollment IS alumni", () => {
    const older = enr({ studentId: "s4", promotionStatus: "PROMOTED", schoolYear: "2024-2025", status: "ENROLLED" });
    const newer = enr({ studentId: "s4", schoolYear: "2025-2026", status: "TRANSFERRED" });
    expect(isStudentAlumni(newer, [older, newer], new Set(), CURRENT_YEAR)).toBe(true);
  });

  it("PROMOTED with later DROPPED enrollment IS alumni", () => {
    const older = enr({ studentId: "s5", promotionStatus: "PROMOTED", schoolYear: "2024-2025", status: "ENROLLED" });
    const newer = enr({ studentId: "s5", schoolYear: "2025-2026", status: "DROPPED" });
    expect(isStudentAlumni(newer, [older, newer], new Set(), CURRENT_YEAR)).toBe(true);
  });

  it("TRANSFERRED student is alumni", () => {
    const latest = enr({ studentId: "s6", status: "TRANSFERRED", schoolYear: "2025-2026" });
    expect(isStudentAlumni(latest, [latest], new Set(), CURRENT_YEAR)).toBe(true);
  });

  it("DROPPED student is alumni", () => {
    const latest = enr({ studentId: "s7", status: "DROPPED", schoolYear: "2025-2026" });
    expect(isStudentAlumni(latest, [latest], new Set(), CURRENT_YEAR)).toBe(true);
  });

  it("CONDITIONALLY_PROMOTED without terminal is NOT alumni", () => {
    const latest = enr({ studentId: "s8", promotionStatus: "CONDITIONALLY_PROMOTED", schoolYear: "2025-2026" });
    expect(isStudentAlumni(latest, [latest], new Set(), CURRENT_YEAR)).toBe(false);
  });

  it("RETAINED without terminal is NOT alumni", () => {
    const latest = enr({ studentId: "s9", promotionStatus: "RETAINED", schoolYear: "2025-2026" });
    expect(isStudentAlumni(latest, [latest], new Set(), CURRENT_YEAR)).toBe(false);
  });
});
