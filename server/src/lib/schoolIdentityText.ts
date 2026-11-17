export function formatRegionLabel(value?: string | null): string {
  const region = value?.trim();
  if (!region) return "";
  return /^region\b/i.test(region) ? region : `Region ${region}`;
}

export function formatDivisionLabel(value?: string | null): string {
  const division = value?.trim();
  if (!division) return "";
  return /^division\s+of\b/i.test(division) ? division : `Division of ${division}`;
}

// Official DepEd district for each institution EnrollPro can serve. Used only
// when EnrollPro is unreachable or its payload predates the district field.
const DISTRICT_BY_SCHOOL_ID: Record<string, string> = {
  "302651": "Hinigaran I",
  "302624": "Pulupandan",
};

const DISTRICT_BY_SCHOOL_NAME: Record<string, string> = {
  "hinigaran national high school": "Hinigaran I",
  "enriqueta montilla de esteban memorial high school": "Pulupandan",
};

function normalizeSchoolName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function resolveDistrictFallback(
  schoolId?: string | null,
  schoolName?: string | null
): string {
  // Prefer the institution name: a stale/mis-synced DepEd ID must not
  // override the school that is actually configured.
  const name = schoolName ? normalizeSchoolName(schoolName) : "";
  if (name && DISTRICT_BY_SCHOOL_NAME[name]) return DISTRICT_BY_SCHOOL_NAME[name];

  const id = schoolId?.trim();
  if (id && DISTRICT_BY_SCHOOL_ID[id]) return DISTRICT_BY_SCHOOL_ID[id];
  return "";
}
