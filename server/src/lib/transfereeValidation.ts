/**
 * transfereeValidation.ts
 *
 * Pure, dependency-free validators for the EnrollPro transferee feed.
 * Contract: "SMART Transferee Enrollment Handoff" (verified 2026-09-11).
 *
 * Kept free of Prisma/network imports so it is trivially unit-testable.
 */

/** Intended business identifier: exactly 12 digits. */
export const TRANSFEREE_LRN_PATTERN = /^\d{12}$/;

export function normalizeLrn(value: unknown): string {
  return String(value ?? "").trim();
}

export function isValidLrn(value: unknown): boolean {
  return TRANSFEREE_LRN_PATTERN.test(normalizeLrn(value));
}

/** The feed only publishes learners whose application is OFFICIALLY_ENROLLED. */
export function isOfficiallyEnrolled(status: unknown): boolean {
  return String(status ?? "").trim().toUpperCase() === "OFFICIALLY_ENROLLED";
}

const GRADE_LEVEL_BY_ORDER: Record<number, string> = {
  7: "GRADE_7",
  8: "GRADE_8",
  9: "GRADE_9",
  10: "GRADE_10",
};

const GRADE_LEVEL_BY_KEY: Record<string, string> = {
  grade7: "GRADE_7",
  grade8: "GRADE_8",
  grade9: "GRADE_9",
  grade10: "GRADE_10",
};

/**
 * Resolves an EnrollPro grade-level value to a SMART `GradeLevel` enum string.
 * Accepts `{ name, displayOrder }`, "Grade 8", "GRADE_8", or a numeric order.
 * Returns null when the value is not Junior High School (Grade 7–10).
 */
export function mapGradeLevelToEnum(input: unknown): string | null {
  if (input == null) return null;

  if (typeof input === "object") {
    const obj = input as { name?: unknown; displayOrder?: unknown };
    const fromName = mapGradeLevelToEnum(obj.name);
    if (fromName) return fromName;
    const order = Number(obj.displayOrder);
    if (Number.isFinite(order) && GRADE_LEVEL_BY_ORDER[order]) {
      return GRADE_LEVEL_BY_ORDER[order];
    }
    return null;
  }

  const raw = String(input).trim();
  if (!raw) return null;

  const key = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (GRADE_LEVEL_BY_KEY[key]) return GRADE_LEVEL_BY_KEY[key];

  const digits = key.match(/(\d{1,2})/);
  if (digits) {
    const order = Number(digits[1]);
    if (GRADE_LEVEL_BY_ORDER[order]) return GRADE_LEVEL_BY_ORDER[order];
  }
  return null;
}
