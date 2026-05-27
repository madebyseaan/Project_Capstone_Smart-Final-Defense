import { prisma } from './prisma';
import type { GradeLevel } from '@prisma/client';

// ---------------------------------------------------------------------------
// Grade level mapping — handles "Grade 7", "GRADE_7", "7-Rizal", etc.
// ---------------------------------------------------------------------------
export function mapGradeLevel(name: string | null | undefined): GradeLevel | null {
  const n = (name ?? '').toLowerCase();
  if (n.includes('10')) return 'GRADE_10';
  if (n.includes('7'))  return 'GRADE_7';
  if (n.includes('8'))  return 'GRADE_8';
  if (n.includes('9'))  return 'GRADE_9';
  return null;
}

// ---------------------------------------------------------------------------
// Atlas subject code → SMART subject code
// Atlas uses base codes ("FIL", "ENG") — SMART appends the grade number ("FIL7").
// Special overrides handle naming differences between Atlas and SMART.
// ---------------------------------------------------------------------------
// ATLAS_SUBJECT_OVERRIDES: maps Atlas base codes (with grade suffix appended) to SMART subject codes.
// Add entries here when ATLAS uses a different code than the SMART canonical code.
const ATLAS_SUBJECT_OVERRIDES: Record<string, string> = {
  'ENV_SCI7':                 'ENVIRONMENTAL_SCIENCE7',
  'ENV_SCI8':                 'ENVIRONMENTAL_SCIENCE7',
  'ENV_SCI9':                 'ENVIRONMENTAL_SCIENCE7',
  'ENV_SCI10':                'ENVIRONMENTAL_SCIENCE7',
  'ENVIRONMENTAL_SCIENCE8':   'ENVIRONMENTAL_SCIENCE7',
  'ENVIRONMENTAL_SCIENCE9':   'ENVIRONMENTAL_SCIENCE7',
  'ENVIRONMENTAL_SCIENCE10':  'ENVIRONMENTAL_SCIENCE7',
};

export function resolveSubjectCode(atlasCode: string, gradeLevel: GradeLevel): string {
  const gradeSuffix = gradeLevel.replace('GRADE_', ''); // "GRADE_7" → "7"
  const withSuffix = atlasCode + gradeSuffix;
  return ATLAS_SUBJECT_OVERRIDES[withSuffix] ?? withSuffix;
}

export function normalizeSubjectLabel(raw: string | null | undefined): string {
  return (raw ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
}

export const HOMEROOM_GUIDANCE_LABEL = 'Homeroom Guidance';
export const HOMEROOM_GUIDANCE_MINUTES = 60;

export async function ensureHomeroomGuidanceLabel(
  subject: { id: string; code: string; name: string },
  updated: Set<string>,
): Promise<void> {
  if (!subject.code.startsWith('HG')) return;
  if (subject.name === HOMEROOM_GUIDANCE_LABEL) return;
  if (updated.has(subject.id)) return;

  await prisma.subject.update({ where: { id: subject.id }, data: { name: HOMEROOM_GUIDANCE_LABEL } });
  subject.name = HOMEROOM_GUIDANCE_LABEL;
  updated.add(subject.id);
}
