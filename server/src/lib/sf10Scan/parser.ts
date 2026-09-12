/**
 * parser.ts — Heuristic, label-based parser for scanned SF10/SF9 OCR text.
 *
 * Deliberately format-resilient: it keys off words/labels (school, grade,
 * learning-area names) rather than pixel positions, so a new DepEd layout does
 * not break it. Output is a best-effort draft that the registrar reviews.
 *
 * See docs/REGISTRAR/SF10_SF9_IMPORT_PLAN.md.
 */

import { matchSubject } from "./subjects";

export interface ScanTerm {
  label: string;
  value: number;
}

export interface ScanSubject {
  subjectName: string;
  terms: ScanTerm[];
  finalRating: number | null;
  confidence: number;
}

export interface Sf10ScanDraft {
  documentType: "SF10" | "SF9" | "UNKNOWN";
  schoolName: string | null;
  schoolId: string | null;
  schoolYear: string | null;
  gradeLevel: string | null;
  sectionName: string | null;
  adviserName: string | null;
  subjects: ScanSubject[];
  confidence: number;
  warnings: string[];
}

const MIN_GRADE = 60;
const MAX_GRADE = 100;

export function detectDocumentType(text: string): "SF10" | "SF9" | "UNKNOWN" {
  if (/permanent\s+academic\s+record|sf\s*10|form\s*137/i.test(text)) return "SF10";
  if (/progress\s+report|report\s+card|sf\s*9/i.test(text)) return "SF9";
  return "UNKNOWN";
}

export function extractSchoolYear(text: string): string | null {
  const m = text.match(/\b(20\d{2})\s*[-\u2013\u2014]\s*(20\d{2})\b/);
  return m ? `${m[1]}-${m[2]}` : null;
}

export function extractGradeLevel(text: string): string | null {
  const m = text.match(/grade\s*[:\-]?\s*([7-9]|10)\b/i);
  return m ? `GRADE_${m[1]}` : null;
}

export function extractSchoolId(text: string): string | null {
  const m = text.match(/school\s*id[:\s]*([0-9]{5,7})/i);
  return m ? m[1] : null;
}

/** Finds the value after a label on the same line, else the next non-empty line. */
export function extractLabeledValue(lines: string[], label: RegExp): string | null {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(label);
    if (!m) continue;
    const after = line.slice((m.index ?? 0) + m[0].length).replace(/^[:\s]+/, "").trim();
    if (after) return after;
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j].trim();
      if (next) return next;
    }
  }
  return null;
}

/** Extracts plausible grade numbers (60–100) from a line, in order. */
export function parseGradeNumbers(line: string): number[] {
  const tokens = String(line ?? "").match(/\b\d{1,3}(?:\.\d+)?\b/g) ?? [];
  return tokens
    .map((t) => Number(t))
    .filter((n) => Number.isFinite(n) && n >= MIN_GRADE && n <= MAX_GRADE);
}

function subjectFromNumbers(name: string, nums: number[]): ScanSubject {
  if (nums.length === 0) {
    return { subjectName: name, terms: [], finalRating: null, confidence: 0.3 };
  }
  if (nums.length === 1) {
    return { subjectName: name, terms: [], finalRating: nums[0], confidence: 0.6 };
  }
  const termValues = nums.slice(0, 3);
  const terms: ScanTerm[] = termValues.map((value, idx) => ({ label: `T${idx + 1}`, value }));
  const finalRating = nums.length >= 4 ? nums[3] : null;
  return { subjectName: name, terms, finalRating, confidence: 0.8 };
}

export function parseSf10Text(raw: string): Sf10ScanDraft {
  const text = String(raw ?? "");
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const warnings: string[] = [];
  const bySubject = new Map<string, ScanSubject>();

  for (const line of lines) {
    // Skip header/noise lines that mention "grade" but are not subject rows.
    const name = matchSubject(line);
    if (!name) continue;
    const nums = parseGradeNumbers(line);
    const candidate = subjectFromNumbers(name, nums);
    const existing = bySubject.get(name);
    // Keep the row with the most numeric evidence.
    if (!existing || candidate.terms.length + (candidate.finalRating != null ? 1 : 0) >
        existing.terms.length + (existing.finalRating != null ? 1 : 0)) {
      bySubject.set(name, candidate);
    }
  }

  const subjects = Array.from(bySubject.values());
  if (subjects.length === 0) warnings.push("No learning areas detected — enter manually.");
  if (subjects.some((s) => s.terms.length === 0 && s.finalRating == null)) {
    warnings.push("Some learning areas had no readable grades.");
  }

  const confidence = subjects.length > 0
    ? subjects.reduce((a, s) => a + s.confidence, 0) / subjects.length
    : 0;

  return {
    documentType: detectDocumentType(text),
    schoolName: extractLabeledValue(lines, /school\s*name/i),
    schoolId: extractSchoolId(text),
    schoolYear: extractSchoolYear(text),
    gradeLevel: extractGradeLevel(text),
    sectionName: extractLabeledValue(lines, /section/i),
    adviserName: extractLabeledValue(lines, /adviser|teacher/i),
    subjects,
    confidence: Math.round(confidence * 100) / 100,
    warnings,
  };
}
