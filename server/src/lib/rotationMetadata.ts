/**
 * Rotation metadata validation.
 *
 * A rotation group must stay consistent with the subject family it represents.
 * Historical/bad Atlas data (e.g. Mathematics 10 tagged as SCIENCE rotation)
 * silently merges subjects into the wrong SF form row, so writers validate and
 * audits flag these rows.
 *
 * Unknown (future) groups are accepted only when the label matches the group
 * and the rank is in range; known groups additionally enforce their code family.
 */

export interface RotationFields {
  code: string;
  rotationTermGroupId: string | null;
  rotationTermRank: number | null;
  rotationOutputLabel: string | null;
}

export const ROTATION_GROUP_RULES: Record<string, { label: string; codePrefixes: string[] }> = {
  SCIENCE: { label: "SCIENCE", codePrefixes: ["SCI"] },
  TLE_EXPLORATORY: { label: "TLE", codePrefixes: ["TLE"] },
};

export type RotationValidation =
  | { valid: true }
  | { valid: false; reason: string };

export function hasAnyRotationField(fields: RotationFields): boolean {
  return Boolean(fields.rotationTermGroupId || fields.rotationTermRank || fields.rotationOutputLabel);
}

export function validateRotationMetadata(fields: RotationFields): RotationValidation {
  const { code, rotationTermGroupId, rotationTermRank, rotationOutputLabel } = fields;
  const hasGroup = Boolean(rotationTermGroupId);
  const hasRank = rotationTermRank !== null && rotationTermRank !== undefined;
  const hasLabel = Boolean(rotationOutputLabel);

  if (!hasGroup && !hasRank && !hasLabel) return { valid: true };

  if (!hasGroup) return { valid: false, reason: "ORPHAN_ROTATION_FIELDS" };
  if (!hasRank) return { valid: false, reason: "MISSING_ROTATION_RANK" };
  if (!hasLabel) return { valid: false, reason: "MISSING_ROTATION_LABEL" };

  const rank = Number(rotationTermRank);
  if (!Number.isInteger(rank) || rank < 1 || rank > 3) {
    return { valid: false, reason: "INVALID_ROTATION_RANK" };
  }

  const groupId = rotationTermGroupId!.toUpperCase();
  const label = rotationOutputLabel!.trim().toUpperCase();
  const upperCode = code.toUpperCase();
  const rule = ROTATION_GROUP_RULES[groupId];

  if (rule) {
    if (label !== rule.label) return { valid: false, reason: "LABEL_MISMATCH" };
    const matchesFamily = rule.codePrefixes.some((prefix) => upperCode.startsWith(prefix));
    if (!matchesFamily) return { valid: false, reason: "GROUP_CODE_MISMATCH" };
    return { valid: true };
  }

  // Unknown future group: still require the label to describe the group.
  if (label !== groupId) return { valid: false, reason: "LABEL_MISMATCH" };
  return { valid: true };
}

/** Fields to write when clearing invalid rotation metadata. */
export function clearedRotationFields() {
  return {
    rotationTermGroupId: null,
    rotationTermRank: null,
    rotationOutputLabel: null,
  } as const;
}

export type RotationTerm = "T1" | "T2" | "T3";

/**
 * The only term a rotation component can hold grades in (rank 1 -> T1, etc.).
 * Returns null for non-rotation subjects and for invalid metadata, so callers
 * treat those grades in every term.
 */
export function rotationTermOf(fields: {
  rotationTermGroupId: string | null;
  rotationTermRank: number | null;
}): RotationTerm | null {
  if (!fields.rotationTermGroupId) return null;
  const rank = fields.rotationTermRank;
  if (rank === null || !Number.isInteger(rank) || rank < 1 || rank > 3) return null;
  return `T${rank}` as RotationTerm;
}

/**
 * Whether a DRAFT grade belongs to the finalization requirement set.
 *
 * - HG (homeroom guidance) never blocks.
 * - Rotation components block only in their own rank term; a DRAFT in any
 *   other term is stray data that `mergeRotationSubjects` already ignores.
 * - Non-rotation subjects and invalid rotation metadata block in every term.
 *
 * EOSY blockers, the year status board, and the post-EOSY term guard all use
 * this rule so they cannot disagree with Term Finalization.
 */
export function isBlockingDraftGrade(input: {
  term: string;
  subject: {
    code: string | null;
    rotationTermGroupId: string | null;
    rotationTermRank: number | null;
  };
}): boolean {
  if ((input.subject.code ?? "").toUpperCase().startsWith("HG")) return false;
  const rotationTerm = rotationTermOf(input.subject);
  return rotationTerm === null || rotationTerm === input.term;
}
