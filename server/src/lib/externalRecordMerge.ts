/**
 * externalRecordMerge.ts
 *
 * Pure helpers that fold registrar-entered prior-school (SF10/SF9) records into
 * SMART's SF10 `schoolRecords` shape. Term structure is T1/T2/T3 (owner decision
 * 2026-09-12). Display-only: this never feeds Grade / promotion / EOSY math.
 *
 * See docs/REGISTRAR/SF10_SF9_IMPORT_PLAN.md (§9 merge rules).
 */

export interface MergeableSubject {
  subjectCode?: string | null;
  subjectName: string;
  T1: number | null;
  T2: number | null;
  T3: number | null;
  final?: number | null;
  remarks?: string | null;
}

export interface MergeableRecord {
  schoolYear: string;
  gradeLevel: string;
  section?: string | null;
  program?: string | null;
  school?: string | null;
  schoolId?: string | null;
  district?: string | null;
  division?: string | null;
  region?: string | null;
  adviserName?: string | null;
  transferInDate?: string | Date | null;
  subjectGrades: MergeableSubject[];
  generalAverage?: number | null;
  honors?: string | null;
  promotionStatus?: string | null;
  remedialClasses?: unknown[];
  profileSnapshot?: unknown;
  external?: boolean;
  mergedFromPreviousSchool?: string | null;
}

export interface ExternalRecordLike {
  schoolYear: string;
  gradeLevel: string;
  schoolName: string;
  schoolId?: string | null;
  sectionName?: string | null;
  adviserName?: string | null;
  generalAverage?: number | null;
  promotionStatus?: string | null;
  isPartialYear?: boolean;
  subjects: Array<{
    subjectCode?: string | null;
    subjectName: string;
    terms?: Array<{ label: string; value: number }> | null;
    finalRating?: number | null;
    remarks?: string | null;
  }>;
}

/** Maps a free-text term label to a T1/T2/T3 slot. Ignores anything else. */
export function termLabelToSlot(label: string): "T1" | "T2" | "T3" | null {
  const s = String(label ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s.includes("1") || s.includes("first")) return "T1";
  if (s.includes("2") || s.includes("second")) return "T2";
  if (s.includes("3") || s.includes("third")) return "T3";
  return null;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

function subjectKey(code: string | null | undefined, name: string): string {
  const c = String(code ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (c) return c;
  return String(name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function sameSubject(a: MergeableSubject, b: MergeableSubject): boolean {
  const ak = subjectKey(a.subjectCode, a.subjectName);
  const bk = subjectKey(b.subjectCode, b.subjectName);
  return !!ak && ak === bk;
}

/** Converts one external record into a `schoolRecords`-shaped entry. */
export function externalRecordToSchoolRecord(rec: ExternalRecordLike): MergeableRecord {
  const subjectGrades: MergeableSubject[] = rec.subjects.map((s) => {
    const slots = { T1: null as number | null, T2: null as number | null, T3: null as number | null };
    for (const t of s.terms ?? []) {
      const slot = termLabelToSlot(t.label);
      if (slot && typeof t.value === "number" && Number.isFinite(t.value)) {
        slots[slot] = Math.round(t.value);
      }
    }
    const present = [slots.T1, slots.T2, slots.T3].filter((v): v is number => v !== null);
    const final =
      s.finalRating != null && Number.isFinite(s.finalRating)
        ? Math.round(s.finalRating)
        : present.length > 0
          ? Math.round(present.reduce((a, b) => a + b, 0) / present.length)
          : null;
    return {
      subjectCode: s.subjectCode ?? null,
      subjectName: s.subjectName,
      T1: slots.T1,
      T2: slots.T2,
      T3: slots.T3,
      final,
      remarks: s.remarks ?? null,
    };
  });

  const finals = subjectGrades
    .map((s) => s.final)
    .filter((v): v is number => v != null);
  const generalAverage =
    rec.generalAverage != null && Number.isFinite(rec.generalAverage)
      ? Math.round(rec.generalAverage)
      : average(finals);

  return {
    schoolYear: rec.schoolYear,
    gradeLevel: rec.gradeLevel,
    section: rec.sectionName ?? null,
    program: null,
    school: rec.schoolName,
    schoolId: rec.schoolId ?? null,
    district: null,
    division: null,
    region: null,
    adviserName: rec.adviserName ?? null,
    transferInDate: null,
    subjectGrades,
    generalAverage,
    honors: null,
    promotionStatus: rec.promotionStatus ?? null,
    remedialClasses: [],
    profileSnapshot: null,
    external: true,
  };
}

/**
 * Merges external records into local SF10 records.
 *
 * - No matching local year/grade -> append the external record as-is (`external: true`).
 * - Matching local year/grade + `isPartialYear` -> term-level fill: missing T1/T2/T3
 *   slots are taken from the previous school; unmatched subjects are appended. Local
 *   subject finals and the local general average are left untouched (display rule:
 *   external data never feeds local averages).
 * - Matching local year/grade + NOT partial -> append separately (flagged).
 *
 * The returned array is sorted by schoolYear (then gradeLevel).
 */
export function mergeExternalRecords<T extends MergeableRecord>(
  localRecords: T[],
  externalRecords: ExternalRecordLike[]
): Array<T | MergeableRecord> {
  const result: Array<T | MergeableRecord> = [...localRecords];

  for (const ext of externalRecords) {
    const converted = externalRecordToSchoolRecord(ext);
    const localIdx = result.findIndex(
      (r) =>
        r.schoolYear === ext.schoolYear &&
        r.gradeLevel === ext.gradeLevel &&
        !(r as MergeableRecord).external
    );

    if (localIdx === -1) {
      result.push(converted);
      continue;
    }

    if (!ext.isPartialYear) {
      result.push(converted);
      continue;
    }

    const local = result[localIdx];
    for (const extSub of converted.subjectGrades) {
      const match = local.subjectGrades.find((s) => sameSubject(s, extSub));
      if (match) {
        if (match.T1 == null) match.T1 = extSub.T1;
        if (match.T2 == null) match.T2 = extSub.T2;
        if (match.T3 == null) match.T3 = extSub.T3;
      } else {
        local.subjectGrades.push(extSub);
      }
    }
    (local as MergeableRecord).mergedFromPreviousSchool = ext.schoolName;
  }

  return result.sort(
    (a, b) =>
      a.schoolYear.localeCompare(b.schoolYear) ||
      String(a.gradeLevel).localeCompare(String(b.gradeLevel))
  );
}
