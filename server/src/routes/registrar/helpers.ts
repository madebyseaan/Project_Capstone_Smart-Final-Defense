import { GradeLevel } from "@prisma/client";
import { getActiveSchoolYearLabel } from "../../lib/schoolYearResolver";

export async function resolveCurrentSchoolYearLabel(): Promise<string> {
  return getActiveSchoolYearLabel();
}

export function getSyncFreshness(lastSyncAtIso: string | null): {
  lastSyncedAt: string | null;
  minutesSinceLastSync: number | null;
  isStale: boolean;
  status: "fresh" | "stale" | "never";
} {
  if (!lastSyncAtIso) {
    return {
      lastSyncedAt: null,
      minutesSinceLastSync: null,
      isStale: true,
      status: "never",
    };
  }

  const minutesSinceLastSync = Math.floor((Date.now() - new Date(lastSyncAtIso).getTime()) / 60000);
  const isStale = minutesSinceLastSync > 10;

  return {
    lastSyncedAt: lastSyncAtIso,
    minutesSinceLastSync,
    isStale,
    status: isStale ? "stale" : "fresh",
  };
}

export function normalizeGradeLevel(raw: string | null | undefined): GradeLevel | null {
  const value = String(raw ?? "").toLowerCase();
  if (value.includes("7")) return "GRADE_7";
  if (value.includes("8")) return "GRADE_8";
  if (value.includes("9")) return "GRADE_9";
  if (value.includes("10")) return "GRADE_10";
  return null;
}

export function normalizeSex(raw: string | null | undefined): "male" | "female" | "unknown" {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "male" || value === "m") return "male";
  if (value === "female" || value === "f") return "female";
  return "unknown";
}

/** Converts raw DB sex/gender ("MALE"/"FEMALE"/"M"/"F") to title-case for frontend display and official forms. */
export function normalizeDisplaySex(raw: string | null | undefined): string {
  const value = String(raw ?? "").trim().toUpperCase();
  if (value === "MALE" || value === "M") return "Male";
  if (value === "FEMALE" || value === "F") return "Female";
  return "Unknown";
}

/** Compute age as of the 1st Friday of June of the school year's start year (DepEd age-cutoff rule). */
export function computeAgeAsOfJune(birthDate: Date | string | null | undefined, schoolYear: string): number {
  if (!birthDate) return 0;
  const bd = new Date(birthDate);
  if (isNaN(bd.getTime())) return 0;
  const syStartYear = parseInt(schoolYear.split("-")[0], 10);
  // 1st Friday of June
  const june1 = new Date(syStartYear, 5, 1);
  const dayOfWeek = june1.getDay(); // 0=Sun,5=Fri
  const daysUntilFriday = (5 - dayOfWeek + 7) % 7 || 7;
  const firstFriday = new Date(syStartYear, 5, 1 + daysUntilFriday);
  let age = firstFriday.getFullYear() - bd.getFullYear();
  const monthDiff = firstFriday.getMonth() - bd.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && firstFriday.getDate() < bd.getDate())) {
    age--;
  }
  return age;
}

/** Map enrollment status and student flags to DepEd SF1 remark codes. */
export function mapRemarksCodes(enrollment: any, student: any): string[] {
  const codes: string[] = [];
  const status = String(enrollment?.status ?? "").toUpperCase();
  if (status === "TRANSFERRED" || enrollment?.transferOutDate) codes.push("T/O");
  if (enrollment?.transferInDate) codes.push("T/I");
  if (status === "DROPPED") codes.push("DRP");
  if (student?.isBalikAral) codes.push("B/A");
  if (student?.is4PsBeneficiary) codes.push("CCT");
  if (student?.disability) codes.push("LWD");
  // ACL and LE require additional data not currently stored; leave for manual entry
  return codes;
}

export function studentsByGrace(
  studentsByGrade: { sectionId: string; _count: number }[],
  sectionMap: Map<string, GradeLevel>,
  gradeStats: Record<string, number>
) {
  studentsByGrade.forEach(item => {
    const gradeLevel = sectionMap.get(item.sectionId);
    if (gradeLevel && gradeStats[gradeLevel] !== undefined) {
      gradeStats[gradeLevel] += item._count;
    }
  });
}

// Helper to check if a subject is Homeroom Guidance
export function isHomeroomGuidanceSubjectCode(subjectCode?: string | null): boolean {
  return (subjectCode ?? '').toUpperCase().startsWith('HG');
}

export function isSubjectAlignedWithGrade(subjectCode: string, gradeLevel: string): boolean {
  const gradeSuffix = gradeLevel.replace('GRADE_', '');
  const code = subjectCode.toUpperCase();
  const match = code.match(/\d+$/);
  if (match) {
    return match[0] === gradeSuffix;
  }
  return true;
}

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function canonicalSubjectCode(subjectCode: string): string {
  const code = normalizeWhitespace(subjectCode).toUpperCase();
  const aliasMap: Record<string, string> = {
    TLE_AFA_EXP: 'TLE_AFA_EXP10',
    TLE_FCS_EXP: 'TLE_FCS_EXP10',
    TLE_ICT_EXP: 'TLE_ICT_EXP10',
  };
  return aliasMap[code] ?? code;
}

export function toDisplayName(value: string): string {
  return normalizeWhitespace(value)
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

export function subjectCanonicalKey(subjectCode: string, subjectName: string): string {
  // Use canonical code so legacy aliases (e.g., TLE_AFA_EXP vs TLE_AFA_EXP10)
  // collapse into one learning area entry in SF forms.
  return canonicalSubjectCode(subjectCode);
}

/** Convert an ALL-CAPS label like "SCIENCE" or "TLE" to title case "Science" / "Tle". */
export function toTitleCase(value: string): string {
  return normalizeWhitespace(value)
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}
