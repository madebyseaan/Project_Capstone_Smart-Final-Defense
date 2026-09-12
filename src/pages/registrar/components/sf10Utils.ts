  // DepEd JHS learning area sort order (lower = higher priority)
export const DEPED_AREA_ORDER: Record<string, number> = {
    FIL: 1, ENG: 2, MATH: 3, SCI: 4, AP: 5, ESP: 6, TLE: 7, MAPEH: 8,
    DEVL_READING: 9,
    SPA_SPEC: 10, SPS_SPEC: 11,
    STE_RESEARCH: 12, STE_ENV_SCI: 13, STE_BIOTECH: 14,
    STE_APPLIED_CHEM: 15, STE_APPLIED_PHYS: 16, STE_ROBOTICS: 17,
  };

  // Display names for SF10 learning areas
export const DEPED_AREA_NAMES: Record<string, string> = {
    FIL: 'Filipino', ENG: 'English', MATH: 'Mathematics', SCI: 'Science',
    AP: 'Araling Panlipunan (AP)', ESP: 'Edukasyon sa Pagpapakatao (EsP)',
    TLE: 'Technology and Livelihood Education (TLE)',
    MAPEH: 'MAPEH',
    DEVL_READING: 'Developmental Reading',
    SPA_SPEC: 'Special Program in the Arts: Specialization',
    SPS_SPEC: 'Special Program in Sports: Specialization',
    STE_RESEARCH: 'Research', STE_ENV_SCI: 'Environmental Science',
    STE_BIOTECH: 'Biotechnology', STE_APPLIED_CHEM: 'Applied Chemistry',
    STE_APPLIED_PHYS: 'Applied Physics', STE_ROBOTICS: 'Robotics',
  };

  // Map individual ATLAS subject codes to SF10 grouped codes
  // Science: SCI_BIO, SCI_CHEM, SCI_ES â†’ SCI (grouped)
  // TLE: TLE_AFA, TLE_FCS, TLE_ICT (with or without _EXP suffix) â†’ TLE (grouped)
  // MAPEH: MUSIC, ARTS, PE, HEALTH â†’ MAPEH (grouped, for historical seed data)
export const SF10_GROUP_MAP: Record<string, string> = {
    SCI_BIO: 'SCI', SCI_CHEM: 'SCI', SCI_ES: 'SCI', SCI: 'SCI',
    SCIENCE: 'SCI',
    TLE_AFA: 'TLE', TLE_AFA_EXP: 'TLE',
    TLE_FCS: 'TLE', TLE_FCS_EXP: 'TLE',
    TLE_ICT: 'TLE', TLE_ICT_EXP: 'TLE',
    TLE: 'TLE',
    MUSIC: 'MAPEH', ARTS: 'MAPEH', PE: 'MAPEH', HEALTH: 'MAPEH', MAPEH: 'MAPEH',
  };

  // Extract the base SF10 code from a subject code (strip grade number)
export const sf10Code = (subjectCode: string): string =>
    subjectCode.toUpperCase().replace(/\d+$/, '').replace(/[^A-Z_]/g, '');

  // Map a raw SF10 code to its grouped code (if applicable)
export const sf10GroupCode = (code: string): string => SF10_GROUP_MAP[code] ?? code;

  // Build the SF10 learning area list from ATLAS subjectGrades (dynamic, per record)
  // Groups SCI_* into one "Science" row and TLE_* into one "TLE" row
export const buildSF10Areas = (subjectGrades: any[]) => {
    const seen = new Map<string, { code: string; name: string; order: number; subCodes: string[] }>();
    for (const sg of subjectGrades) {
      const rawCode = sf10Code(sg.subjectCode);
      const groupCode = sf10GroupCode(rawCode);
      if (!seen.has(groupCode)) {
        seen.set(groupCode, {
          code: groupCode,
          name: DEPED_AREA_NAMES[groupCode] ?? sg.subjectName.replace(/\s*\d+$/, ''),
          order: DEPED_AREA_ORDER[groupCode] ?? 99,
          subCodes: [],
        });
      }
      const entry = seen.get(groupCode)!;
      if (!entry.subCodes.includes(rawCode)) entry.subCodes.push(rawCode);
    }
    return Array.from(seen.values()).sort((a, b) => a.order - b.order);
  };

  // Get display values for a learning area (handles grouped subjects by averaging sub-grades)
export const getAreaDisplayValues = (area: { code: string; subCodes: string[] }, subjectGrades: any[]) => {
    // For non-grouped subjects (single subCode), match by subCode list
    if (area.subCodes.length <= 1) {
      const matched = subjectGrades.find((sg: any) => area.subCodes.includes(sf10Code(sg.subjectCode)));
      return { t1: matched?.T1 ?? null, t2: matched?.T2 ?? null, t3: matched?.T3 ?? null, final: matched?.final ?? null };
    }
    // For grouped subjects, average all matching sub-grades
    const subs = subjectGrades.filter((sg: any) => area.subCodes.includes(sf10Code(sg.subjectCode)));
    if (subs.length === 0) return { t1: null, t2: null, t3: null, final: null };
    const avg = (field: string) => {
      const vals = subs.map((s: any) => s[field]).filter((v: any) => v != null);
      return vals.length > 0 ? Math.round(vals.reduce((a: number, b: number) => a + b, 0) / vals.length) : null;
    };
    return { t1: avg('T1'), t2: avg('T2'), t3: avg('T3'), final: avg('final') };
  };