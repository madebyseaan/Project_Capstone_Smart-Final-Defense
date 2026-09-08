/**
 * aimsCourseMatch.ts — AIMS course ↔ SMART class assignment mismatch warnings.
 *
 * Extracted from grades-sub/aims.ts so the logic is unit-testable and
 * the route file stays thin (per AGENTS.md).
 *
 * Key design: subject comparison normalizes trailing grade-level digit
 * suffixes ("Developmental Reading 8" → base "developmental reading")
 * so that AIMS base names (DepEd convention) don't false-positive as
 * mismatches against SMART's grade-suffixed display names.
 */

// ---------------------------------------------------------------------------
// Subject name normalization
// ---------------------------------------------------------------------------

/**
 * Strip a trailing standalone grade-level digit token (" 7".." 10") from a subject name.
 * "Developmental Reading 8" → { base: "developmental reading", grade: "8" }
 * "Developmental Reading"   → { base: "developmental reading", grade: null }
 * "Science - Chemistry"     → { base: "science - chemistry",   grade: null }
 */
export function normalizeSubjectName(name: string): { base: string; grade: string | null } {
  const m = name.trim().match(/^(.*\S)\s+(7|8|9|10)$/i);
  if (m) return { base: m[1].trim().toLowerCase(), grade: m[2] };
  return { base: name.trim().toLowerCase(), grade: null };
}

/**
 * Compare two subject names with grade-suffix awareness.
 * Returns true if they match (possibly with different or missing suffixes).
 *
 * Match cases (no warning):
 *   "Developmental Reading" vs "Developmental Reading 8" — same base, one side no grade
 *   "English" vs "English" — identical
 *   "Mathematics 8" vs "Mathematics" — same base, one side no grade
 *   "Science" vs "Science 10" — same base, one side no grade
 *
 * Mismatch cases (warning):
 *   "Filipino 7" vs "Filipino 8" — same base, different grades (cross-grade link)
 *   "Science - Chemistry" vs "Science 8" — different base (different granularity)
 *   "English" vs "Mathematics" — different subjects
 */
function subjectsMatch(courseSubject: string, smartSubject: string): boolean {
  const a = normalizeSubjectName(courseSubject);
  const b = normalizeSubjectName(smartSubject);
  if (a.base !== b.base) return false;      // different subjects → still a mismatch
  if (a.grade && b.grade && a.grade !== b.grade) return false; // Grade 7 course on Grade 8 class → still a mismatch
  return true;                              // suffix-only difference (or one side has none) → match
}

// ---------------------------------------------------------------------------
// Warning computation
// ---------------------------------------------------------------------------

/**
 * Compute mismatch warnings between AIMS course and SMART class assignment.
 * Used by both the link route and the GET scores route (persistent warnings).
 */
export function computeCourseWarnings(
  course: { schoolYear?: string; sectionName?: string; subject?: string },
  assignment: { schoolYear: string; sectionName?: string; subjectName?: string },
): string[] {
  const warnings: string[] = [];
  if (course.schoolYear && assignment.schoolYear && course.schoolYear !== assignment.schoolYear) {
    warnings.push(`School year mismatch: AIMS course is ${course.schoolYear}, class is ${assignment.schoolYear}`);
  }
  if (course.sectionName && assignment.sectionName && course.sectionName.toLowerCase() !== assignment.sectionName.toLowerCase()) {
    warnings.push(`Section mismatch: AIMS course is "${course.sectionName}", class is "${assignment.sectionName}"`);
  }
  if (course.subject && assignment.subjectName && !subjectsMatch(course.subject, assignment.subjectName)) {
    warnings.push(`Subject mismatch: AIMS course is "${course.subject}", class is "${assignment.subjectName}"`);
  }
  return warnings;
}
