/**
 * subjects.ts — DepEd JHS learning-area dictionary for SF10/SF9 scanning.
 * Matching is by keyword so it survives layout changes.
 */

export interface SubjectAlias {
  canonical: string;
  patterns: RegExp[];
}

export const SUBJECT_ALIASES: SubjectAlias[] = [
  { canonical: "Filipino", patterns: [/filipino/i] },
  { canonical: "English", patterns: [/english/i] },
  { canonical: "Mathematics", patterns: [/mathematic/i, /\bmath\b/i] },
  { canonical: "Environmental Science", patterns: [/environmental\s*science/i] },
  { canonical: "Science", patterns: [/general\s*science/i, /\bscience\b/i] },
  { canonical: "Araling Panlipunan", patterns: [/araling\s*panlipunan/i, /\bap\b/i] },
  { canonical: "Edukasyon sa Pagpapakatao", patterns: [/edukasyon\s*sa\s*pagpapakatao/i, /\besp\b/i, /\bvalues\b/i] },
  { canonical: "Technology and Livelihood Education", patterns: [/technology\s*and\s*livelihood/i, /\btle\b/i] },
  { canonical: "MAPEH", patterns: [/\bmapeh\b/i, /\bmusic\b/i, /\barts\b/i, /physical\s*education/i, /\bhealth\b/i] },
  { canonical: "Research", patterns: [/\bresearch\b/i] },
];

/** Returns the canonical learning-area name matched on a line, or null. */
export function matchSubject(line: string): string | null {
  const text = String(line ?? "");
  for (const alias of SUBJECT_ALIASES) {
    if (alias.patterns.some((p) => p.test(text))) return alias.canonical;
  }
  return null;
}
