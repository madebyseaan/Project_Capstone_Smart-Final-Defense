/**
 * atlas.ts — Zod schemas for ATLAS Annual Teaching Load contract validation.
 *
 * Enforces the ATLAS Annual Teaching Load Integration contract:
 *  - Correct school + year scope
 *  - isActiveSchoolYear must be true
 *  - state ∈ {EMPTY, POPULATED}
 *  - version is a positive integer
 *  - No duplicate (subjectId, sectionId) pairs
 *
 * @see smart-annual-teaching-load-integration-handoff-2026-09-07.md
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

const positiveInt = z.number().int().positive();

// ---------------------------------------------------------------------------
// Effective payload sub-schemas
// ---------------------------------------------------------------------------

const atlasEffectiveSourceSchema = z.object({
  schoolId: positiveInt,
  schoolYearId: positiveInt,
  state: z.enum(['EMPTY', 'POPULATED']),
  version: positiveInt,
  initializedAt: z.string().min(1),
  updatedAt: z.string().min(1),
  isActiveSchoolYear: z.boolean(),
});

const atlasEffectiveAssignmentSchema = z.object({
  subjectId: positiveInt,
  sectionId: positiveInt,
  facultyId: positiveInt,
  facultyName: z.string().optional(),
  specializationCode: z.string().nullable().optional(),
  specializationLabel: z.string().nullable().optional(),
});

const atlasCoverageTotalsSchema = z.object({
  assignedPairs: z.number().int().min(0),
  activeAssignedPairs: z.number().int().min(0),
  realFacultyAssignedPairs: z.number().int().min(0),
  syntheticPlaceholderPairs: z.number().int().min(0),
  rawAssignedPairs: z.number().int().min(0),
  totalPairs: z.number().int().min(0),
  unassignedPairs: z.number().int().min(0),
  rawUnassignedPairs: z.number().int().min(0),
}).passthrough();

// ---------------------------------------------------------------------------
// Top-level effective response schema (with duplicate-key validation)
// ---------------------------------------------------------------------------

export const atlasEffectiveTeachingLoadSchema = z.object({
  source: atlasEffectiveSourceSchema,
  assignments: z.array(atlasEffectiveAssignmentSchema),
  coverageTotals: atlasCoverageTotalsSchema,
}).superRefine((data, ctx) => {
  // Reject duplicate (subjectId, sectionId) keys
  const seen = new Set<string>();
  for (const [i, a] of data.assignments.entries()) {
    const key = `${a.subjectId}:${a.sectionId}`;
    if (seen.has(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate ownership key (subjectId=${a.subjectId}, sectionId=${a.sectionId})`,
        path: ['assignments', i],
      });
    }
    seen.add(key);
  }
});

export type AtlasEffectivePayload = z.infer<typeof atlasEffectiveTeachingLoadSchema>;

// ---------------------------------------------------------------------------
// Scope validator — enforces school/year/active invariants post-parse
// ---------------------------------------------------------------------------

export interface AtlasScopeConstraints {
  schoolId: number;
  schoolYearId: number;
}

/**
 * Validates the parsed payload against the expected scope.
 * Returns null on success, or a rejection reason string.
 */
export function validateAtlasScope(
  payload: AtlasEffectivePayload,
  constraints: AtlasScopeConstraints,
): string | null {
  const s = payload.source;

  if (s.schoolId !== constraints.schoolId) {
    return `Wrong school: got ${s.schoolId}, expected ${constraints.schoolId}`;
  }
  if (s.schoolYearId !== constraints.schoolYearId) {
    return `Wrong school year: got ${s.schoolYearId}, expected ${constraints.schoolYearId}`;
  }
  if (!s.isActiveSchoolYear) {
    return `Inactive school year (schoolYearId=${s.schoolYearId})`;
  }

  return null;
}
