// Shared pure formatting helpers for registrar school form rendering.

// Helper function to format grade level for display
export const formatGradeLevel = (gradeLevel: string) => {
  if (gradeLevel.startsWith("GRADE_")) {
    return gradeLevel.replace("GRADE_", "");
  }
  return gradeLevel;
};

// Format an ISO date string as mm/dd/yyyy using the calendar date directly
// (avoids toLocaleDateString shifting the day when the browser is in a negative UTC offset)
export const formatISODate = (iso?: string): string | null => {
  const datePart = iso?.split("T")[0];
  if (!datePart) return null;
  const [y, m, d] = datePart.split("-");
  if (!y || !m || !d) return null;
  return `${m}/${d}/${y}`;
};
