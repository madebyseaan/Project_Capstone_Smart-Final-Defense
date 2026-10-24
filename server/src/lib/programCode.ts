/**
 * programCode.ts
 *
 * Normalizes upstream programType values (EnrollPro/ATLAS) into stable SMART
 * program codes. Known DepEd special programs get canonical acronyms; unknown
 * programs are preserved instead of being collapsed to REGULAR so newly added
 * upstream programs keep flowing into SMART and get a deterministic color.
 */

const PROGRAM_ALIASES: Array<[RegExp, string]> = [
  [/^REG(ULAR)?$/, 'REGULAR'],
  [/ARTS/, 'SPA'],
  [/SPORT/, 'SPS'],
  [/SCIENCE|ENGINEERING|ESEP|^STE$/, 'STE'],
  [/SPECIAL ED|SPED|SNED/, 'SPED'],
  [/FOREIGN LANGUAGE|SPFL/, 'SPFL'],
  [/JOURNALISM|SPJ/, 'SPJ'],
  [/OPEN HIGH SCHOOL|OHSP/, 'OHSP'],
  [/TECHNICAL|VOCATIONAL|SPTVE/, 'SPTVE'],
];

const ACRONYM_STOPWORDS = new Set(['OF', 'IN', 'THE', 'AND', 'FOR']);

export function normalizeProgramCode(programType: string | null | undefined): string {
  const raw = String(programType ?? '').trim().toUpperCase();
  if (!raw) return 'REGULAR';

  for (const [pattern, code] of PROGRAM_ALIASES) {
    if (pattern.test(raw)) return code;
  }

  if (raw.length <= 16 && !/\s/.test(raw)) return raw;

  const acronym = raw
    .split(/[^A-Z0-9]+/)
    .filter((word) => word && !ACRONYM_STOPWORDS.has(word))
    .map((word) => word[0])
    .join('')
    .slice(0, 8);

  return acronym || 'REGULAR';
}
