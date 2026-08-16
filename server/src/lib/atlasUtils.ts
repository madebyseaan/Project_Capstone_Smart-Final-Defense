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

// ---------------------------------------------------------------------------
// Subject code → proper display name mapping (deployment-proof)
//
// Strategy:
//   1. Exact code match (e.g. "FIL7" → "Filipino 7")
//   2. Base code + grade suffix (e.g. "FIL" + "7" → "Filipino 7")
//   3. Prefix match for compound codes (e.g. "STE_RESEARCH8" → "Research 8")
//   4. Algorithmic fallback: parse underscores, map segments, reassemble
//
// This guarantees NO subject ever displays as "Sci Es" or "Ste Biotech".
// ---------------------------------------------------------------------------
const SUBJECT_BASE_NAMES: Record<string, string> = {
  // ── Core subjects ──────────────────────────────────────────────────────────
  FIL:                        'Filipino',
  ENG:                        'English',
  MATH:                       'Mathematics',
  SCI:                        'Science',
  AP:                         'Araling Panlipunan',
  ESP:                        'Edukasyon sa Pagpapakatao',
  TLE:                        'Technology and Livelihood Education',
  MAPEH:                      'MAPEH',
  HG:                         'Homeroom Guidance',
  DEVL_READING:               'Developmental Reading',
  READ:                       'Reading',

  // ── Science strands ────────────────────────────────────────────────────────
  SCI_BIO:                    'Science - Biology',
  SCI_CHEM:                   'Science - Chemistry',
  SCI_PHYS:                   'Science - Physics',
  SCI_ES:                     'Science - Earth Science',
  ENVIRONMENTAL_SCIENCE:      'Environmental Science',

  // ── MAPEH components ───────────────────────────────────────────────────────
  MUSIC:                      'Music',
  ARTS:                       'Arts',
  PE:                         'Physical Education',
  HEALTH:                     'Health',

  // ── TLE strands ────────────────────────────────────────────────────────────
  TLE_HE:                     'Technology and Livelihood Education - Home Economics',
  TLE_HOME_ECONOMICS:         'Technology and Livelihood Education - Home Economics',
  HOME_ECONOMICS:             'Home Economics',
  TLE_AFA_EXP:                'TLE Exploratory - Agriculture and Fishery Arts',
  TLE_FCS_EXP:                'TLE Exploratory - Family and Consumer Science',
  TLE_ICT_EXP:                'TLE Exploratory - ICT',

  // ── STE (Science Technology Engineering) strands ───────────────────────────
  STE_RESEARCH:               'Research',
  STE_BIOTECH:                'Biotechnology',
  STE_ENV_SCI:                'Environmental Science',
  STE_ROBOTICS:               'Robotics',
  STE_APPLIED_CHEM:           'Applied Chemistry',
  STE_APPLIED_PHYS:           'Applied Physics',

  // ── Special programs ───────────────────────────────────────────────────────
  SPA_SPEC:                   'Special Program in the Arts: Specialization',
  SPS_SPEC:                   'Special Program in Sports: Specialization',
};

// Prefix-based rules for compound codes (checked in order, first match wins)
const SUBJECT_PREFIX_RULES: Array<{ prefix: string; label: string }> = [
  { prefix: 'STE_RESEARCH',    label: 'Research' },
  { prefix: 'STE_BIOTECH',     label: 'Biotechnology' },
  { prefix: 'STE_ENV_SCI',     label: 'Environmental Science' },
  { prefix: 'STE_ROBOTICS',    label: 'Robotics' },
  { prefix: 'STE_APPLIED_CHEM',label: 'Applied Chemistry' },
  { prefix: 'STE_APPLIED_PHYS',label: 'Applied Physics' },
  { prefix: 'STE_',            label: 'STE' },
  { prefix: 'SCI_BIO',         label: 'Science - Biology' },
  { prefix: 'SCI_CHEM',        label: 'Science - Chemistry' },
  { prefix: 'SCI_PHYS',        label: 'Science - Physics' },
  { prefix: 'SCI_ES',          label: 'Science - Earth Science' },
  { prefix: 'SCI_',            label: 'Science' },
  { prefix: 'TLE_AFA_EXP',     label: 'TLE Exploratory - Agriculture and Fishery Arts' },
  { prefix: 'TLE_FCS_EXP',     label: 'TLE Exploratory - Family and Consumer Science' },
  { prefix: 'TLE_ICT_EXP',     label: 'TLE Exploratory - ICT' },
  { prefix: 'TLE_HE',          label: 'Technology and Livelihood Education - Home Economics' },
  { prefix: 'TLE_',            label: 'Technology and Livelihood Education' },
  { prefix: 'SPA_SPEC',        label: 'Special Program in the Arts: Specialization' },
  { prefix: 'SPS_SPEC',        label: 'Special Program in Sports: Specialization' },
  { prefix: 'ENV_SCI',         label: 'Environmental Science' },
  { prefix: 'ENVIRONMENTAL_SCIENCE', label: 'Environmental Science' },
  { prefix: 'DEVL_READING',    label: 'Developmental Reading' },
  { prefix: 'MAPEH',           label: 'MAPEH' },
  { prefix: 'HG',              label: 'Homeroom Guidance' },
];

/**
 * Resolves the proper display name for a subject given its SMART code.
 * Guarantees a clean, deployment-ready name for ANY code pattern.
 *
 * @param smartCode  The resolved SMART subject code (e.g. "FIL7", "STE_RESEARCH8")
 * @param gradeLevel The grade level (e.g. "GRADE_7") — used as fallback suffix
 * @returns          Proper display name (e.g. "Filipino 7", "Research 8")
 */
export function resolveSubjectName(smartCode: string, gradeLevel?: GradeLevel): string {
  const gradeSuffix = gradeLevel?.replace('GRADE_', '') ?? '';

  // 1. Exact match (e.g. "FIL7" → "Filipino 7", "STE_RESEARCH8" → "Research 8")
  if (SUBJECT_BASE_NAMES[smartCode]) return SUBJECT_BASE_NAMES[smartCode];

  // 2. Strip trailing digits (grade suffix) and try base code
  const baseCode = smartCode.replace(/\d+$/, '');
  if (SUBJECT_BASE_NAMES[baseCode]) {
    const base = SUBJECT_BASE_NAMES[baseCode];
    const digits = smartCode.match(/(\d+)$/)?.[1] ?? gradeSuffix;
    return digits ? `${base} ${digits}` : base;
  }

  // 3. Prefix match — find the longest matching prefix rule
  for (const rule of SUBJECT_PREFIX_RULES) {
    if (baseCode.startsWith(rule.prefix) || smartCode.startsWith(rule.prefix)) {
      const digits = smartCode.match(/(\d+)$/)?.[1] ?? gradeSuffix;
      return digits ? `${rule.label} ${digits}` : rule.label;
    }
  }

  // 4. Algorithmic fallback: parse underscores, title-case each segment
  //    e.g. "TLE_AFA_EXP7" → "Tle Afa Exp 7" (shouldn't reach here with proper mapping)
  const digits = smartCode.match(/(\d+)$/)?.[1] ?? '';
  const textPart = smartCode.replace(/\d+$/, '').replace(/_/g, ' ');
  const humanized = textPart
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return digits ? `${humanized} ${digits}` : humanized;
}

/**
 * Sanitizes a subject name, resolving it through the mapping.
 * Always returns the canonical name from the mapping — safe to call on any name.
 */
export function sanitizeSubjectName(
  name: string,
  code: string,
  gradeLevel?: GradeLevel,
): string {
  const resolved = resolveSubjectName(code, gradeLevel);
  return resolved !== name ? resolved : name;
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
