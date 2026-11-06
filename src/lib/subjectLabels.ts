const BASE_LABELS: Record<string, string> = {
  "Araling Panlipunan": "AP",
  "Edukasyon sa Pagpapakatao": "ESP",
  Mathematics: "Math",
  "TLE Exploratory": "TLE",
};

const COMPONENT_LABELS: Record<string, string> = {
  "Agriculture and Fishery Arts": "AFA",
  "Family and Consumer Science": "FCS",
  "Earth Science": "Earth Sci",
};

const SKIP_WORDS = new Set(["and", "of", "the", "sa", "ng"]);

function initials(text: string): string {
  return text
    .split(/\s+/)
    .filter((word) => word && !SKIP_WORDS.has(word.toLowerCase()))
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * Human-friendly short label for tight UI (grade preview headers/chips).
 * Full subject names remain available as a secondary line/tooltip.
 *
 * "Edukasyon sa Pagpapakatao 7" -> "ESP 7"
 * "TLE Exploratory - Agriculture and Fishery Arts 7" -> "TLE · AFA 7"
 * "Science - Earth Science 7" -> "Science · Earth Sci 7"
 */
export function shortSubjectName(fullName: string): string {
  const normalized = fullName.replace(/\s+/g, " ").trim();
  const dashIndex = normalized.indexOf(" - ");

  if (dashIndex !== -1) {
    const base = normalized.slice(0, dashIndex).trim();
    const rest = normalized.slice(dashIndex + 3).trim();
    const gradeMatch = rest.match(/\s+(\d+)\s*$/);
    const grade = gradeMatch ? ` ${gradeMatch[1]}` : "";
    const component = rest.replace(/\s+\d+\s*$/, "").trim();
    const baseShort = BASE_LABELS[base] ?? base;
    const componentShort =
      COMPONENT_LABELS[component] ??
      (component.length > 18 ? initials(component) : component);
    return `${baseShort} · ${componentShort}${grade}`;
  }

  for (const [long, short] of Object.entries(BASE_LABELS)) {
    if (normalized === long) return short;
    if (normalized.startsWith(`${long} `)) {
      return `${short}${normalized.slice(long.length)}`;
    }
  }

  return normalized;
}
