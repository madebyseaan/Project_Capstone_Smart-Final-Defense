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
