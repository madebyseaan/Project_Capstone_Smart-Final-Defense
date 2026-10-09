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

// ---------------------------------------------------------------------------
// v1.1 transferee-details contract (2026-09-29) — pure field sanitizers
// ---------------------------------------------------------------------------

export const SF9_ELIGIBILITY_STATUSES = [
  "PROMOTED",
  "CONDITIONALLY_PROMOTED",
  "RETAINED",
] as const;

export type Sf9EligibilityStatusValue = (typeof SF9_ELIGIBILITY_STATUSES)[number];

/** Contract enum `sf9EligibilityStatus`; unknown values are rejected (null). */
export function sanitizeSf9EligibilityStatus(value: unknown): Sf9EligibilityStatusValue | null {
  const raw = String(value ?? "").trim().toUpperCase();
  return (SF9_ELIGIBILITY_STATUSES as readonly string[]).includes(raw)
    ? (raw as Sf9EligibilityStatusValue)
    : null;
}

/**
 * `conditionalSubjectCodes` — 0-2 non-empty strings, order preserved.
 * Returns null for a malformed payload or a cardinality violation so the
 * caller keeps the previously stored value instead of writing bad data.
 */
export function sanitizeConditionalSubjectCodes(value: unknown): string[] | null {
  if (value == null) return null;
  if (!Array.isArray(value)) return null;
  const codes = value
    .map((code) => (typeof code === "string" ? code.trim() : ""))
    .filter((code) => code.length > 0 && code.length <= 50);
  if (codes.length !== value.length || codes.length > 2) return null;
  return codes;
}

/** Strict optional boolean — non-boolean payloads are skipped (null). */
export function sanitizeOptionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/** Strict optional finite number — numeric strings are not coerced. */
export function sanitizeOptionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Optional text — trimmed; blank/absent/non-string becomes null. */
export function sanitizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
