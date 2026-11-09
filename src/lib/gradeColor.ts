export function gradeLevelLabel(value: string): string {
  return value.replace(/^GRADE_/, "Grade ");
}

export function getGradeBadgeClass(gradeLevel: string): string {
  switch (gradeLevel) {
    case "GRADE_7":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "GRADE_8":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "GRADE_9":
      return "bg-rose-50 text-rose-700 border-rose-200";
    case "GRADE_10":
      return "bg-blue-50 text-blue-700 border-blue-200";
    default:
      return "bg-muted/30 text-muted-foreground border-border";
  }
}
