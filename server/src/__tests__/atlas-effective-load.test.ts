/**
 * atlas-effective-load.test.ts — ATLAS Annual Teaching Load contract validation tests
 *
 * Pure unit tests for the zod schema + scope validator in schemas/atlas.ts.
 * Validates acceptance criteria #6 from the ATLAS handoff:
 *   Wrong-school, wrong-year, inactive, malformed-version, duplicate, missing,
 *   and ambiguous fixtures fail closed.
 *
 * @see smart-annual-teaching-load-integration-handoff-2026-09-07.md
 */

import { describe, it, expect } from 'vitest';
import {
  atlasEffectiveTeachingLoadSchema,
  validateAtlasScope,
  type AtlasEffectivePayload,
  type AtlasScopeConstraints,
} from '../schemas/atlas';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function validSource(overrides: Record<string, unknown> = {}) {
  return {
    schoolId: 1,
    schoolYearId: 8,
    state: 'POPULATED',
    version: 4,
    initializedAt: '2026-09-04T00:00:00Z',
    updatedAt: '2026-09-07T00:00:00Z',
    isActiveSchoolYear: true,
    ...overrides,
  };
}

function validAssignment(overrides: Record<string, unknown> = {}) {
  return {
    subjectId: 10,
    sectionId: 20,
    facultyId: 100,
    ...overrides,
  };
}

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    source: validSource(),
    assignments: [validAssignment()],
    coverageTotals: {
      assignedPairs: 1,
      activeAssignedPairs: 1,
      realFacultyAssignedPairs: 1,
      syntheticPlaceholderPairs: 0,
      rawAssignedPairs: 1,
      totalPairs: 1,
      unassignedPairs: 0,
      rawUnassignedPairs: 0,
    },
    ...overrides,
  };
}

const defaultConstraints: AtlasScopeConstraints = {
  schoolId: 1,
  schoolYearId: 8,
};

// ---------------------------------------------------------------------------
// Schema validation (atlasEffectiveTeachingLoadSchema)
// ---------------------------------------------------------------------------

describe('ATLAS Effective Payload Schema', () => {
  it('accepts a valid POPULATED payload', () => {
    const result = atlasEffectiveTeachingLoadSchema.safeParse(validPayload());
    expect(result.success).toBe(true);
  });

  it('accepts a valid EMPTY payload', () => {
    const result = atlasEffectiveTeachingLoadSchema.safeParse(
      validPayload({
        source: validSource({ state: 'EMPTY' }),
        assignments: [],
      }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects missing source', () => {
    const payload = validPayload();
    delete (payload as any).source;
    const result = atlasEffectiveTeachingLoadSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('rejects invalid state', () => {
    const result = atlasEffectiveTeachingLoadSchema.safeParse(
      validPayload({ source: validSource({ state: 'INVALID' }) }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects non-positive version', () => {
    const result = atlasEffectiveTeachingLoadSchema.safeParse(
      validPayload({ source: validSource({ version: 0 }) }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects negative version', () => {
    const result = atlasEffectiveTeachingLoadSchema.safeParse(
      validPayload({ source: validSource({ version: -1 }) }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects non-integer version', () => {
    const result = atlasEffectiveTeachingLoadSchema.safeParse(
      validPayload({ source: validSource({ version: 1.5 }) }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects isActiveSchoolYear as non-boolean', () => {
    const result = atlasEffectiveTeachingLoadSchema.safeParse(
      validPayload({ source: validSource({ isActiveSchoolYear: 'yes' }) }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects duplicate (subjectId, sectionId) pairs', () => {
    const result = atlasEffectiveTeachingLoadSchema.safeParse(
      validPayload({
        assignments: [
          validAssignment({ subjectId: 10, sectionId: 20, facultyId: 100 }),
          validAssignment({ subjectId: 10, sectionId: 20, facultyId: 200 }),
        ],
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const duplicateIssue = result.error.issues.find(i =>
        i.message.includes('Duplicate ownership key'),
      );
      expect(duplicateIssue).toBeDefined();
    }
  });

  it('allows same subjectId with different sectionId', () => {
    const result = atlasEffectiveTeachingLoadSchema.safeParse(
      validPayload({
        assignments: [
          validAssignment({ subjectId: 10, sectionId: 20 }),
          validAssignment({ subjectId: 10, sectionId: 21 }),
        ],
      }),
    );
    expect(result.success).toBe(true);
  });

  it('allows same sectionId with different subjectId', () => {
    const result = atlasEffectiveTeachingLoadSchema.safeParse(
      validPayload({
        assignments: [
          validAssignment({ subjectId: 10, sectionId: 20 }),
          validAssignment({ subjectId: 11, sectionId: 20 }),
        ],
      }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects assignment with missing subjectId', () => {
    const a = validAssignment();
    delete (a as any).subjectId;
    const result = atlasEffectiveTeachingLoadSchema.safeParse(
      validPayload({ assignments: [a] }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects assignment with missing sectionId', () => {
    const a = validAssignment();
    delete (a as any).sectionId;
    const result = atlasEffectiveTeachingLoadSchema.safeParse(
      validPayload({ assignments: [a] }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects assignment with missing facultyId', () => {
    const a = validAssignment();
    delete (a as any).facultyId;
    const result = atlasEffectiveTeachingLoadSchema.safeParse(
      validPayload({ assignments: [a] }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects zero schoolId', () => {
    const result = atlasEffectiveTeachingLoadSchema.safeParse(
      validPayload({ source: validSource({ schoolId: 0 }) }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects zero schoolYearId', () => {
    const result = atlasEffectiveTeachingLoadSchema.safeParse(
      validPayload({ source: validSource({ schoolYearId: 0 }) }),
    );
    expect(result.success).toBe(false);
  });

  it('accepts assignment with optional fields omitted', () => {
    const result = atlasEffectiveTeachingLoadSchema.safeParse(
      validPayload({
        assignments: [{ subjectId: 10, sectionId: 20, facultyId: 100 }],
      }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts assignment with null specializationCode', () => {
    const result = atlasEffectiveTeachingLoadSchema.safeParse(
      validPayload({
        assignments: [validAssignment({ specializationCode: null, specializationLabel: null })],
      }),
    );
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Scope validation (validateAtlasScope)
// ---------------------------------------------------------------------------

describe('ATLAS Scope Validation', () => {
  it('returns null for matching scope', () => {
    const payload = validPayload() as AtlasEffectivePayload;
    const result = validateAtlasScope(payload, defaultConstraints);
    expect(result).toBeNull();
  });

  it('rejects wrong schoolId', () => {
    const payload = validPayload({
      source: validSource({ schoolId: 999 }),
    }) as AtlasEffectivePayload;
    const result = validateAtlasScope(payload, defaultConstraints);
    expect(result).toContain('Wrong school');
    expect(result).toContain('999');
  });

  it('rejects wrong schoolYearId', () => {
    const payload = validPayload({
      source: validSource({ schoolYearId: 999 }),
    }) as AtlasEffectivePayload;
    const result = validateAtlasScope(payload, defaultConstraints);
    expect(result).toContain('Wrong school year');
    expect(result).toContain('999');
  });

  it('rejects inactive school year', () => {
    const payload = validPayload({
      source: validSource({ isActiveSchoolYear: false }),
    }) as AtlasEffectivePayload;
    const result = validateAtlasScope(payload, defaultConstraints);
    expect(result).toContain('Inactive school year');
  });

  it('accepts EMPTY state with matching scope', () => {
    const payload = validPayload({
      source: validSource({ state: 'EMPTY' }),
      assignments: [],
    }) as AtlasEffectivePayload;
    const result = validateAtlasScope(payload, defaultConstraints);
    expect(result).toBeNull();
  });

  it('accepts different version with matching scope', () => {
    const payload = validPayload({
      source: validSource({ version: 5 }),
    }) as AtlasEffectivePayload;
    const result = validateAtlasScope(payload, defaultConstraints);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Combined: schema + scope (full contract validation)
// ---------------------------------------------------------------------------

describe('ATLAS Full Contract Validation', () => {
  it('wrong-school payload fails schema+scope (acceptance #6)', () => {
    const raw = validPayload({ source: validSource({ schoolId: 999 }) });
    const parsed = atlasEffectiveTeachingLoadSchema.safeParse(raw);
    expect(parsed.success).toBe(true); // schema OK
    if (parsed.success) {
      const scopeError = validateAtlasScope(parsed.data, defaultConstraints);
      expect(scopeError).toContain('Wrong school');
    }
  });

  it('wrong-year payload fails scope (acceptance #6)', () => {
    const raw = validPayload({ source: validSource({ schoolYearId: 999 }) });
    const parsed = atlasEffectiveTeachingLoadSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const scopeError = validateAtlasScope(parsed.data, defaultConstraints);
      expect(scopeError).toContain('Wrong school year');
    }
  });

  it('inactive payload fails scope (acceptance #6)', () => {
    const raw = validPayload({ source: validSource({ isActiveSchoolYear: false }) });
    const parsed = atlasEffectiveTeachingLoadSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const scopeError = validateAtlasScope(parsed.data, defaultConstraints);
      expect(scopeError).toContain('Inactive school year');
    }
  });

  it('malformed-version fails schema (acceptance #6)', () => {
    const raw = validPayload({ source: validSource({ version: -1 }) });
    const parsed = atlasEffectiveTeachingLoadSchema.safeParse(raw);
    expect(parsed.success).toBe(false);
  });

  it('duplicate keys fail schema (acceptance #6)', () => {
    const raw = validPayload({
      assignments: [
        validAssignment({ subjectId: 10, sectionId: 20, facultyId: 100 }),
        validAssignment({ subjectId: 10, sectionId: 20, facultyId: 200 }),
      ],
    });
    const parsed = atlasEffectiveTeachingLoadSchema.safeParse(raw);
    expect(parsed.success).toBe(false);
  });

  it('EMPTY payload with zero assignments is valid (acceptance #4)', () => {
    const raw = validPayload({
      source: validSource({ state: 'EMPTY' }),
      assignments: [],
    });
    const parsed = atlasEffectiveTeachingLoadSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.source.state).toBe('EMPTY');
      expect(parsed.data.assignments).toHaveLength(0);
    }
  });

  it('POPULATED payload with 265 assignments is valid (verified baseline)', () => {
    const assignments = Array.from({ length: 265 }, (_, i) =>
      validAssignment({ subjectId: i + 1, sectionId: i + 1000, facultyId: (i % 50) + 1 }),
    );
    const raw = validPayload({
      source: validSource({ version: 4 }),
      assignments,
    });
    const parsed = atlasEffectiveTeachingLoadSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
  });

  it('empty assignments array is valid (no missing-field issue)', () => {
    const raw = validPayload({ assignments: [] });
    const parsed = atlasEffectiveTeachingLoadSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
  });
});
