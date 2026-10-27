// Shared pure formatting helpers for registrar school form rendering.

export { formatGradeLevel } from "@/lib/utils";

// Format an ISO date string as mm/dd/yyyy using the calendar date directly
// (avoids toLocaleDateString shifting the day when the browser is in a negative UTC offset)
export const formatISODate = (iso?: string): string | null => {
  const datePart = iso?.split("T")[0];
  if (!datePart) return null;
  const [y, m, d] = datePart.split("-");
  if (!y || !m || !d) return null;
  return `${m}/${d}/${y}`;
};
