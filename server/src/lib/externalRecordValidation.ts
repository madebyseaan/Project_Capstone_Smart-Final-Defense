/**
 * externalRecordValidation.ts
 *
 * Pure helpers for registrar-entered prior-school (SF10/SF9) records.
 * Display-only data — never feeds Grade / promotion / EOSY math.
 * See docs/REGISTRAR/SF10_SF9_IMPORT_PLAN.md.
 *
 * Dependency-free so it is trivially unit-testable.
 */

export const MIN_GRADE_SCORE = 0;
export const MAX_GRADE_SCORE = 100;

export interface ExternalTerm {
  label: string;
  value: number;
}

/** A grade rating must be a finite number within 0–100. */
export function isValidGradeScore(value: unknown): boolean {
  if (value === null || value === undefined || typeof value === "boolean") return false;
  if (typeof value === "string" && value.trim() === "") return false;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n >= MIN_GRADE_SCORE && n <= MAX_GRADE_SCORE;
}

/** Coerces a value to a valid grade number, or null when out of range/invalid. */
export function normalizeGradeScore(value: unknown): number | null {
  return isValidGradeScore(value) ? Number(value) : null;
}

/** DepEd SF10 ratings/averages are whole numbers — round to the nearest integer. */
export function roundGradeScore(value: unknown): number | null {
  const n = normalizeGradeScore(value);
  return n === null ? null : Math.round(n);
}

/**
 * Normalizes a term entry. Accepts `{ label, value }` and keeps only valid
 * entries. Labels are trimmed and capped at 30 chars; invalid values are dropped.
 */
export function sanitizeTerms(input: unknown): ExternalTerm[] {
  if (!Array.isArray(input)) return [];
  const out: ExternalTerm[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const label = String((raw as { label?: unknown }).label ?? "").trim().slice(0, 30);
    const value = roundGradeScore((raw as { value?: unknown }).value);
    if (!label || value === null) continue;
    out.push({ label, value });
  }
  return out;
}

/**
 * Computes the final rating as the rounded average of the term values.
 * Returns null when there are no usable terms.
 */
export function computeFinalFromTerms(terms: ExternalTerm[] | null | undefined): number | null {
  if (!Array.isArray(terms) || terms.length === 0) return null;
  const values = terms
    .map((t) => normalizeGradeScore(t?.value))
    .filter((v): v is number => v !== null);
  if (values.length === 0) return null;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.round(avg);
}

/** Passing mark for prior-school subjects (DepEd JHS). */
export const PRIOR_PASSING_GRADE = 75;

/** Derives "Passed" / "Failed" from a final rating, or null when no rating. */
export function deriveRemarks(finalRating: number | null | undefined): string | null {
  const n = normalizeGradeScore(finalRating);
  if (n === null) return null;
  return n >= PRIOR_PASSING_GRADE ? "Passed" : "Failed";
}

/**
 * Expected prior grade levels for a transfer-in grade level.
 * Grade 8 -> [GRADE_7]; Grade 9 -> [GRADE_7, GRADE_8]; Grade 10 -> [GRADE_7..9].
 * Grade 7 -> [] (elementary prior record is out of scope).
 */
const PRIOR_LEVELS: Record<string, string[]> = {
  GRADE_7: [],
  GRADE_8: ["GRADE_7"],
  GRADE_9: ["GRADE_7", "GRADE_8"],
  GRADE_10: ["GRADE_7", "GRADE_8", "GRADE_9"],
};

export function expectedPriorGradeLevels(gradeLevel: string | null | undefined): string[] {
  if (!gradeLevel) return [];
  return PRIOR_LEVELS[gradeLevel] ?? [];
}
