/**
 * subjectDisplay.ts — Single source of truth for canonical DepEd subject names.
 *
 * Used by SF forms (SF1/SF5/SF9/SF10) to map internal subject codes/names
 * to their official DepEd learning-area display names.
 *
 * Internal views (teacher dashboards, audit logs) continue to use `name`.
 */

// Canonical DepEd learning-area names for SF forms
export const DEPED_AREA_NAMES: Record<string, string> = {
  FIL: 'Filipino',
  ENG: 'English',
  MATH: 'Mathematics',
  SCI: 'Science',
  AP: 'Araling Panlipunan',
  ESP: 'Edukasyon sa Pagpapakatao',
  TLE: 'Technology and Livelihood Education (TLE)',
  MAPEH: 'MAPEH',
  MUSIC: 'Music',
  ARTS: 'Arts',
  PE: 'Physical Education',
  HEALTH: 'Health',
  DEVL_READING: 'Developmental Reading',
  SPA_SPEC: 'Special Program in the Arts: Specialization',
  SPS_SPEC: 'Special Program in Sports: Specialization',
  STE_RESEARCH: 'Research',
  STE_ENV_SCI: 'Environmental Science',
  STE_BIOTECH: 'Biotechnology',
  STE_APPLIED_CHEM: 'Applied Chemistry',
  STE_APPLIED_PHYS: 'Applied Physics',
  STE_ROBOTICS: 'Robotics',
};

// Branch codes → parent learning area
export const SF10_GROUP_MAP: Record<string, string> = {
  SCI_BIO: 'SCI', SCI_CHEM: 'SCI', SCI_ES: 'SCI', SCI: 'SCI',
  SCIENCE: 'SCI',
  TLE_AFA: 'TLE', TLE_AFA_EXP: 'TLE',
  TLE_FCS: 'TLE', TLE_FCS_EXP: 'TLE',
  TLE_ICT: 'TLE', TLE_ICT_EXP: 'TLE', TLE: 'TLE',
  MUSIC: 'MAPEH', ARTS: 'MAPEH', PE: 'MAPEH', HEALTH: 'MAPEH', MAPEH: 'MAPEH',
};

// Official SF10 learning-area order (lower = earlier)
export const DEPED_AREA_ORDER: Record<string, number> = {
  FIL: 1, ENG: 2, MATH: 3, SCI: 4, AP: 5, ESP: 6, TLE: 7, MAPEH: 8,
  DEVL_READING: 9, SPA_SPEC: 10, SPS_SPEC: 11,
  STE_RESEARCH: 12, STE_ENV_SCI: 13, STE_BIOTECH: 14,
  STE_APPLIED_CHEM: 15, STE_APPLIED_PHYS: 16, STE_ROBOTICS: 17,
};

// Strip grade digits from a subject code: "SCI_BIO7" → "SCI_BIO"
export function baseSubjectCode(code: string): string {
  return code.toUpperCase().replace(/\d+$/, '').replace(/[^A-Z_]/g, '');
}

// Compute canonical SF display name from any code/name pair
export function computeDisplayName(code: string, name: string): string {
  const base = baseSubjectCode(code);
  if (DEPED_AREA_NAMES[base]) return DEPED_AREA_NAMES[base];
  const group = SF10_GROUP_MAP[base];
  if (group && DEPED_AREA_NAMES[group]) return DEPED_AREA_NAMES[group];
  // Fallback: strip trailing grade from name ("Filipino 7" → "Filipino")
  return name.replace(/\s*\d+$/, '').trim();
}
