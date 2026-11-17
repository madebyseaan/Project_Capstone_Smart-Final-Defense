import { normalizeProgramCode } from "../src/lib/programCode";
import { hashStr, seededRandom, type SpecialStudent, type StudentInfo } from "./seedTeacherScoresCore";

export interface ProgramFailureSection {
  id: string;
  name: string;
  gradeLevel: string;
  program: string;
  archivedAt: Date | null;
}

/**
 * Pick learners from special-program sections (G7-G9 only) who will fail exactly
 * ONE subject. G10 is excluded on purpose: 1-2 failures there produce
 * JHS_COMPLETER (no remedial row, no BEC/Regular demotion scenario).
 */
export function pickProgramFailureStudents(
  sections: ProgramFailureSection[],
  sectionStudentIds: Map<string, string[]>,
  studentsById: Map<string, StudentInfo>,
  studentSubjects: Map<string, string[]>,
  sectionsWithActiveCa: Set<string>,
  count: number,
  gradeFilter: string | null,
  transfereeIds: Set<string>,
  rotationGroupByCode: Map<string, string>,
): SpecialStudent[] {
  if (count <= 0) return [];

  const allowedGrades = new Set(["GRADE_7", "GRADE_8", "GRADE_9"]);
  const gradeFilterValue = gradeFilter ? `GRADE_${gradeFilter}` : null;

  const eligible: Array<{
    section: { id: string; name: string; gradeLevel: string; program: string };
    student: StudentInfo;
  }> = [];

  for (const section of sections) {
    if (section.archivedAt) continue;
    if (!sectionsWithActiveCa.has(section.id)) continue;
    if (!allowedGrades.has(section.gradeLevel)) continue;
    if (gradeFilterValue && section.gradeLevel !== gradeFilterValue) continue;

    const program = normalizeProgramCode(section.program);
    if (program === "REGULAR" || program === "SPED") continue;

    for (const studentId of sectionStudentIds.get(section.id) ?? []) {
      const student = studentsById.get(studentId);
      if (!student || transfereeIds.has(studentId)) continue;
      if ((studentSubjects.get(studentId) ?? []).length === 0) continue;
      eligible.push({ section, student });
    }
  }

  eligible.sort((a, b) => {
    const gradeCmp = a.section.gradeLevel.localeCompare(b.section.gradeLevel);
    if (gradeCmp !== 0) return gradeCmp;
    const sectionCmp = a.section.name.localeCompare(b.section.name);
    if (sectionCmp !== 0) return sectionCmp;
    const lastCmp = (a.student.lastName ?? "").localeCompare(b.student.lastName ?? "");
    if (lastCmp !== 0) return lastCmp;
    return (a.student.firstName ?? "").localeCompare(b.student.firstName ?? "");
  });

  const result: SpecialStudent[] = [];
  const usedIds = new Set<string>();

  for (const entry of eligible) {
    if (result.length >= count) break;
    if (usedIds.has(entry.student.id)) continue;

    const allSubjects = studentSubjects.get(entry.student.id) ?? [];
    // Prefer a standalone subject so the failure stays visibly ONE subject;
    // rotation strands expand to their whole group later.
    const nonRotation = allSubjects.filter((code) => !rotationGroupByCode.has(code));
    const pool = nonRotation.length > 0 ? nonRotation : allSubjects;
    if (pool.length === 0) continue;

    const rand = seededRandom(hashStr(entry.student.id + "-programfail"));
    const shuffled = [...pool].sort(() => rand() - 0.5);
    const failedSubject = shuffled[0];

    usedIds.add(entry.student.id);
    result.push({
      studentId: entry.student.id,
      failedSubjects: [failedSubject],
      type: "REMEDIAL",
    });

    console.log(
      `  PROGRAM FAIL: ${entry.student.lastName}, ${entry.student.firstName} | ${normalizeProgramCode(entry.section.program)} | ${entry.section.gradeLevel.replace("GRADE_", "Grade ")} - ${entry.section.name} | failed: ${failedSubject}`,
    );
  }

  if (result.length < count) {
    console.log(`  Note: only ${result.length} program-failure learner(s) eligible (requested ${count}).`);
  }

  return result;
}
