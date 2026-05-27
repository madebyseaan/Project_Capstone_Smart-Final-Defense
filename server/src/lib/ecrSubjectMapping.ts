/**
 * ECR Subject Mapping
 *
 * Maps subject codes (from the Subject.code field) to the correct DepEd ECR
 * template filename stored in `server/uploads/ecr-templates/`.
 *
 * Priority for template selection in the generate route:
 *   1. Exact DB subjectName match
 *   2. Subject-code mapping (this module) — bridges specialised codes to standard templates
 *   3. SubjectType DB match
 *   4. Any active template fallback
 */

import path from 'path';
import fs from 'fs';

const TERM_ORDINALS: Record<string, string> = {
  T1: '1ST TERM',
  T2: '2ND TERM',
  T3: '3RD TERM',
};

/**
 * Returns the ECR template filename (not full path) for a given subject code.
 *
 * @param subjectCode  The Subject.code value, e.g. "AP", "STE_RESEARCH", "TLE_HE"
 * @param term         Term string: "T1" | "T2" | "T3" (required for MAPEH/SPA/SPS)
 * @returns            Filename like "GRADE 7-10_SCIENCE.xlsx", or null if no mapping exists
 */
export function getTemplateFilenameForSubjectCode(
  subjectCode: string,
  term: string = 'T1'
): string | null {
  const code = subjectCode.toUpperCase().trim();
  const ordinal = TERM_ORDINALS[term.toUpperCase()] ?? '1ST TERM';

  // ── Prefix-based mappings ────────────────────────────────────────────────

  // STE specialisation → Science
  if (code.startsWith('STE_') || code === 'STE') {
    return 'GRADE 7-10_SCIENCE.xlsx';
  }

  // SCI variants → Science
  if (code.startsWith('SCI_') || code === 'SCI') {
    return 'GRADE 7-10_SCIENCE.xlsx';
  }

  // SPS (Sports) / SPA (Arts) specialisation → MAPEH (term-specific)
  if (code.startsWith('SPS_') || code === 'SPS' || code.startsWith('SPA_') || code === 'SPA') {
    return `GRADE 7-10_MAPEH ${ordinal}.xlsx`;
  }

  // TLE with Home Economics specialisation
  if (code === 'TLE_HE' || code === 'TLE_HOME_ECONOMICS' || code === 'HOME_ECONOMICS' || code === 'HE') {
    return 'GRADE 7-10_HOME ECONOMICS.xlsx';
  }

  // General TLE / Tech-Voc variants
  if (code.startsWith('TLE_') || code === 'TLE') {
    return 'GRADE 7-10_TLE.xlsx';
  }

  // ── Direct code-to-template mapping table ───────────────────────────────
  const mapping: Record<string, string> = {
    // Core subjects
    AP:           'GRADE 7-10_ARALING PANLIPUNAN.xlsx',
    ENG:          'GRADE 7-10_ENGLISH.xlsx',
    DEVL_READING: 'GRADE 7-10_ENGLISH.xlsx',
    READ:         'GRADE 7-10_ENGLISH.xlsx',
    ESP:          'GRADE 7-10_EDUKASYON SA PAGPAPAKATAO.xlsx',
    HG:           'GRADE 7-10_EDUKASYON SA PAGPAPAKATAO.xlsx',  // Homeroom Guidance
    FIL:          'GRADE 7-10_FILIPINO.xlsx',
    MATH:         'GRADE 7-10_MATHEMATICS.xlsx',
    SCI:          'GRADE 7-10_SCIENCE.xlsx',
    // MAPEH — quarter-specific files
    MAPEH:        `GRADE 7-10_MAPEH ${ordinal}.xlsx`,
    MUSIC:        `GRADE 7-10_MAPEH ${ordinal}.xlsx`,
    ARTS:         `GRADE 7-10_MAPEH ${ordinal}.xlsx`,
    PE:           `GRADE 7-10_MAPEH ${ordinal}.xlsx`,
    HEALTH:       `GRADE 7-10_MAPEH ${ordinal}.xlsx`,
  };

  return mapping[code] ?? null;
}

/**
 * Resolves the absolute filesystem path of the mapped ECR template.
 *
 * @param subjectCode  Subject.code value
 * @param quarter      "Q1" | "Q2" | "Q3" | "Q4"
 * @param ecrDir       Absolute path to the ecr-templates directory
 * @returns            Full path if the file exists, otherwise null
 */
export function resolveEcrTemplatePath(
  subjectCode: string,
  quarter: string,
  ecrDir: string
): string | null {
  const filename = getTemplateFilenameForSubjectCode(subjectCode, quarter);
  if (!filename) return null;

  const fullPath = path.join(ecrDir, filename);
  return fs.existsSync(fullPath) ? fullPath : null;
}
