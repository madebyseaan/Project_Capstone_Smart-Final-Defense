/**
 * audit-grade-alignment.ts — READ-ONLY parity audit for the grade pipeline.
 *
 * Compares, per learner/subject/term:
 *   - Advisory profile (real lib used by the API)
 *   - Class Record (active ledger + predecessor inheritance)
 *   - SF9 composer (real implementation)
 *   - SF10 composer (real implementation)
 *   - Stored Grade.quarterlyGrade vs the Class Record live recompute
 *   - Teacher labels (Advisory vs SF9 payload)
 *   - Subject rotation metadata validity
 *
 * No writes. Exit code is always 0 (gates read the JSON).
 *
 * Usage:
 *   ts-node --transpile-only scripts/audit-grade-alignment.ts --school-year 2026-2027
 *   ts-node --transpile-only scripts/audit-grade-alignment.ts --school-year 2026-2027 --json artifacts/audit.json
 *   --sf10-limit <n>   number of learners to audit for SF10 (default 40; 0 = all)
 */

import dotenv from "dotenv";
import path from "path";
import fs from "fs";
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { prisma } from "../src/lib/prisma";
import {
  buildAdvisoryStudentGrades,
  gradeSignalScore,
  isSubjectAlignedWithGrade,
  subjectDedupKey,
} from "../src/lib/advisoryStudentGrades";
import { composeSf9Section } from "../src/lib/sf9Composer";
import { buildSf10Records } from "../src/lib/sf10";
import { getActiveSchoolYearLabel } from "../src/lib/schoolYearResolver";
import { getTransmutationTable } from "../src/lib/transmutationCache";
import { computeTermGrade, getGradingModeForSchoolYear } from "../src/lib/gradingMode";
import { computeExamPS } from "../src/lib/examMath";
import { resolveEffectiveWeightsForClassAssignment } from "../src/routes/grades-sub/helpers";
import { hasAnyRotationField, validateRotationMetadata } from "../src/lib/rotationMetadata";

const TERMS = ["T1", "T2", "T3"] as const;

function readArg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1] ?? null;
}

function nw(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}
function codeKey(code: string | null | undefined): string {
  return nw(code).toUpperCase();
}
function fmt(value: number | null | undefined): string {
  return value === null || value === undefined ? "-" : String(value);
}
function roundAverage(values: number[]): number | null {
  return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
}
function isHG(code: string | null | undefined): boolean {
  return codeKey(code).startsWith("HG");
}

interface MismatchDetail {
  studentId: string;
  sectionId: string;
  subject: string;
  term: string;
  left: number | null;
  right: number | null;
  note?: string;
}

function pushDetail(list: MismatchDetail[], detail: MismatchDetail, cap = 60) {
  if (list.length < cap) list.push(detail);
}

async function main() {
  const schoolYear = readArg("--school-year") ?? (await getActiveSchoolYearLabel());
  const jsonPath = readArg("--json");
  const sf10LimitArg = Number(readArg("--sf10-limit") ?? "40");
  const sf10Limit = Number.isFinite(sf10LimitArg) ? sf10LimitArg : 40;

  const sections = await prisma.section.findMany({
    where: { schoolYear },
    select: { id: true, name: true, gradeLevel: true, adviserId: true },
    orderBy: [{ gradeLevel: "asc" }, { name: "asc" }],
  });
  const sectionIds = sections.map((s) => s.id);
  if (sectionIds.length === 0) {
    console.log(`No sections for ${schoolYear}`);
    return;
  }

  const enrollments = await prisma.enrollment.findMany({
    where: { sectionId: { in: sectionIds }, schoolYear, status: "ENROLLED" },
    select: { id: true, sectionId: true, studentId: true },
  });
  const studentIds = [...new Set(enrollments.map((e) => e.studentId))];

  const assignments = await prisma.classAssignment.findMany({
    where: { sectionId: { in: sectionIds }, schoolYear },
    include: {
      subject: true,
      teacher: { include: { user: { select: { firstName: true, lastName: true } } } },
    },
  });
  type Assignment = (typeof assignments)[number];

  const grades = await prisma.grade.findMany({
    where: {
      studentId: { in: studentIds },
      classAssignment: { sectionId: { in: sectionIds }, schoolYear },
    },
  });
  const gradeByCaStudent = new Map<string, typeof grades>();
  for (const grade of grades) {
    const key = `${grade.classAssignmentId}:${grade.studentId}`;
    const list = gradeByCaStudent.get(key) ?? [];
    list.push(grade);
    gradeByCaStudent.set(key, list);
  }

  const subjectIds = [...new Set(assignments.map((a) => a.subjectId))];
  const subjects = await prisma.subject.findMany({ where: { id: { in: subjectIds } } });
  const rotationMetadata = {
    checked: 0,
    invalid: [] as Array<{ subjectId: string; code: string; name: string; group: string | null; rank: number | null; label: string | null; reason: string }>,
  };
  for (const subject of subjects) {
    const fields = {
      code: subject.code,
      rotationTermGroupId: subject.rotationTermGroupId,
      rotationTermRank: subject.rotationTermRank,
      rotationOutputLabel: subject.rotationOutputLabel,
    };
    if (!hasAnyRotationField(fields)) continue;
    rotationMetadata.checked += 1;
    const result = validateRotationMetadata(fields);
    if (!result.valid) {
      rotationMetadata.invalid.push({
        subjectId: subject.id,
        code: subject.code,
        name: subject.name,
        group: subject.rotationTermGroupId,
        rank: subject.rotationTermRank,
        label: subject.rotationOutputLabel,
        reason: result.reason,
      });
    }
  }

  // Stored grade vs Class Record live recompute (ledger rule).
  const gradingMode = await getGradingModeForSchoolYear(schoolYear);
  const transmutationTable = await getTransmutationTable();
  const weightsCache = new Map<string, { ww: number; pt: number; qa: number }>();
  const storedVsLedger = {
    rowsScanned: 0,
    mismatches: 0,
    byStatus: {} as Record<string, number>,
    examples: [] as MismatchDetail[],
  };
  for (const assignment of assignments.filter((a) => a.isActive)) {
    let weights = weightsCache.get(assignment.id);
    if (!weights) {
      const resolved = await resolveEffectiveWeightsForClassAssignment(assignment.id);
      weights = { ww: resolved.ww, pt: resolved.pt, qa: resolved.qa };
      weightsCache.set(assignment.id, weights);
    }
    for (const grade of grades.filter((g) => g.classAssignmentId === assignment.id)) {
      storedVsLedger.rowsScanned += 1;
      const wwScores = Array.isArray(grade.writtenWorkScores) ? (grade.writtenWorkScores as any[]) : [];
      const ptScores = Array.isArray(grade.perfTaskScores) ? (grade.perfTaskScores as any[]) : [];
      const wwMax = wwScores.reduce((sum, item) => sum + (Number(item?.maxScore) || 0), 0);
      const ptMax = ptScores.reduce((sum, item) => sum + (Number(item?.maxScore) || 0), 0);
      const wwPS = grade.writtenWorkPS ?? (wwMax > 0 ? (wwScores.reduce((sum, item) => sum + (Number(item?.score) || 0), 0) / wwMax) * 100 : null);
      const ptPS = grade.perfTaskPS ?? (ptMax > 0 ? (ptScores.reduce((sum, item) => sum + (Number(item?.score) || 0), 0) / ptMax) * 100 : null);
      const examScores = Array.isArray(grade.examScores) ? (grade.examScores as any[]) : [];
      const examPS = examScores.length > 0 ? computeExamPS(examScores) : null;
      const qaMax = Number(grade.quarterlyAssessMax) || 100;
      const qaPS = examPS ?? grade.quarterlyAssessPS ?? (qaMax > 0 ? ((Number(grade.quarterlyAssessScore) || 0) / qaMax) * 100 : null);
      let recomputed: number | null = null;
      if (wwPS !== null && ptPS !== null && qaPS !== null) {
        recomputed = computeTermGrade(
          wwPS * (weights.ww / 100) + ptPS * (weights.pt / 100) + qaPS * (weights.qa / 100),
          gradingMode,
          transmutationTable,
        );
      }
      if (recomputed !== grade.quarterlyGrade) {
        storedVsLedger.mismatches += 1;
        storedVsLedger.byStatus[grade.status] = (storedVsLedger.byStatus[grade.status] ?? 0) + 1;
        pushDetail(storedVsLedger.examples, {
          studentId: grade.studentId,
          sectionId: assignment.sectionId,
          subject: assignment.subject.code,
          term: grade.term,
          left: grade.quarterlyGrade,
          right: recomputed,
          note: `status=${grade.status} archived=${grade.isArchived}`,
        });
      }
    }
  }

  // ── Parity loop ──────────────────────────────────────────────────────────
  const advisoryVsClassRecord = { cells: 0, mismatches: 0, examples: [] as MismatchDetail[] };
  const advisoryVsSf9 = { cells: 0, mismatches: 0, teacherDiffs: 0, examples: [] as MismatchDetail[], teacherExamples: [] as string[] };
  const advisoryVsSf10 = { cells: 0, mismatches: 0, examples: [] as MismatchDetail[], skippedStudents: 0 };
  const advisoryErrors = { count: 0, details: [] as Array<{ studentId: string; status: number; message: string }> };
  const sf9MissingStudent = { count: 0 };
  const subjectSetDiffs = { advisoryOnly: [] as string[], sf9Only: [] as string[] };

  let sf10Audited = 0;
  let subjectRowsCompared = 0;

  for (const section of sections) {
    const sectionAssignments = assignments.filter((a) => a.sectionId === section.id);
    const sectionEnrollments = enrollments.filter((e) => e.sectionId === section.id);
    if (sectionEnrollments.length === 0) continue;

    const teacherId = section.adviserId ?? sectionAssignments[0]?.teacherId ?? null;
    const sf9 = teacherId ? await composeSf9Section({ sectionId: section.id, schoolYear }) : null;
    const sf9ByStudent = new Map<string, any>();
    for (const payload of sf9?.students ?? []) {
      if (payload?.student?.id) sf9ByStudent.set(payload.student.id, payload);
    }

    for (const enrollment of sectionEnrollments) {
      const studentId = enrollment.studentId;

      // ── Advisory (real lib) ──
      let advisoryRows: any[] = [];
      if (teacherId) {
        const advisory = await buildAdvisoryStudentGrades({ teacherId, studentId, schoolYear });
        if (!advisory.ok) {
          advisoryErrors.count += 1;
          if (advisoryErrors.details.length < 20) {
            advisoryErrors.details.push({ studentId, status: advisory.status, message: advisory.message });
          }
        } else {
          advisoryRows = advisory.payload.subjectGrades;
        }
      }
      const advisoryByKey = new Map<string, any>();
      for (const row of advisoryRows) {
        const key = row.rotationTermGroupId ? `ROT:${row.rotationTermGroupId}` : subjectDedupKey(row.subjectCode, row.subjectName);
        if (!advisoryByKey.has(key)) advisoryByKey.set(key, row);
      }

      // ── Class Record (active ledger + inherited predecessor) ──
      const eligible = sectionAssignments.filter(
        (a) => !isHG(a.subject.code) && isSubjectAlignedWithGrade(a.subject.code, section.gradeLevel),
      );
      const scoreForStudent = (assignment: Assignment) =>
        gradeSignalScore({
          grades: gradeByCaStudent.get(`${assignment.id}:${studentId}`) ?? [],
          updatedAt: assignment.updatedAt,
        });
      const dedupAgenda = [...new Map(
        eligible
          .filter((a) => a.isActive)
          .sort((a, b) => scoreForStudent(b) - scoreForStudent(a))
          .map((a) => [subjectDedupKey(a.subject.code, a.subject.name), a]),
      ).values()];

      const ledgerValue = (assignment: Assignment, term: string): number | null => {
        const own = (gradeByCaStudent.get(`${assignment.id}:${studentId}`) ?? []).find((g) => g.term === term);
        if (own) return own.quarterlyGrade;
        const predecessors = eligible
          .filter((p) => !p.isActive && p.subjectId === assignment.subjectId && p.id !== assignment.id)
          .sort((a, b) => (b.archivedAt?.getTime() ?? 0) - (a.archivedAt?.getTime() ?? 0));
        for (const predecessor of predecessors) {
          const row = (gradeByCaStudent.get(`${predecessor.id}:${studentId}`) ?? []).find((g) => g.term === term);
          if (row) return row.quarterlyGrade;
        }
        return null;
      };

      const classRows = new Map<string, { byTerm: Record<string, number | null>; finalGrade: number | null }>();
      const rotationGroups = new Map<string, Assignment[]>();
      for (const assignment of dedupAgenda) {
        if (assignment.subject.rotationTermGroupId) {
          const list = rotationGroups.get(assignment.subject.rotationTermGroupId) ?? [];
          list.push(assignment);
          rotationGroups.set(assignment.subject.rotationTermGroupId, list);
        } else {
          const byTerm: Record<string, number | null> = {};
          for (const term of TERMS) byTerm[term] = ledgerValue(assignment, term);
          classRows.set(subjectDedupKey(assignment.subject.code, assignment.subject.name), {
            byTerm,
            finalGrade: roundAverage(TERMS.map((t) => byTerm[t]).filter((v): v is number => v !== null)),
          });
        }
      }
      for (const [groupId, members] of rotationGroups) {
        const byTerm: Record<string, number | null> = { T1: null, T2: null, T3: null };
        for (const member of members) {
          const rank = member.subject.rotationTermRank;
          if (!rank) continue;
          byTerm[`T${rank}`] = ledgerValue(member, `T${rank}`);
        }
        classRows.set(`ROT:${groupId}`, {
          byTerm,
          finalGrade: roundAverage(TERMS.map((t) => byTerm[t]).filter((v): v is number => v !== null)),
        });
      }

      for (const [key, advisoryRow] of advisoryByKey) {
        const classRow = classRows.get(key);
        if (!classRow) continue;
        subjectRowsCompared += 1;
        for (const term of [...TERMS, "FINAL" as const]) {
          advisoryVsClassRecord.cells += 1;
          const left = term === "FINAL" ? advisoryRow.finalGrade ?? null : advisoryRow.grades?.[term]?.quarterlyGrade ?? null;
          const right = term === "FINAL" ? classRow.finalGrade : classRow.byTerm[term] ?? null;
          if (left !== right) {
            advisoryVsClassRecord.mismatches += 1;
            pushDetail(advisoryVsClassRecord.examples, {
              studentId,
              sectionId: section.id,
              subject: advisoryRow.subjectCode,
              term,
              left,
              right,
            });
          }
        }
      }

      // ── SF9 ──
      const sf9Payload = sf9ByStudent.get(studentId);
      if (!sf9Payload) {
        if (sf9) sf9MissingStudent.count += 1;
      } else {
        const sf9ByCode = new Map<string, any>();
        for (const row of sf9Payload.subjectGrades ?? []) {
          const key = codeKey(row.subjectCode);
          if (!sf9ByCode.has(key)) sf9ByCode.set(key, row);
        }
        const advisoryByCode = new Map<string, any>();
        for (const row of advisoryRows) {
          const key = codeKey(row.subjectCode);
          if (!advisoryByCode.has(key)) advisoryByCode.set(key, row);
        }
        for (const [key, advisoryRow] of advisoryByCode) {
          const sf9Row = sf9ByCode.get(key);
          if (!sf9Row) {
            if (subjectSetDiffs.advisoryOnly.length < 30) subjectSetDiffs.advisoryOnly.push(`${section.name}:${key}`);
            continue;
          }
          for (const term of [...TERMS, "FINAL" as const]) {
            advisoryVsSf9.cells += 1;
            const left = term === "FINAL" ? advisoryRow.finalGrade ?? null : advisoryRow.grades?.[term]?.quarterlyGrade ?? null;
            const right = term === "FINAL" ? sf9Row.final ?? null : sf9Row[term] ?? null;
            if (left !== right) {
              advisoryVsSf9.mismatches += 1;
              pushDetail(advisoryVsSf9.examples, {
                studentId,
                sectionId: section.id,
                subject: advisoryRow.subjectCode,
                term,
                left,
                right,
                note: "SF9",
              });
            }
          }
          const advisoryTeacher = nw(advisoryRow.teacher).toLowerCase();
          const sf9Teacher = nw(sf9Row.teacher).toLowerCase();
          if (advisoryTeacher && sf9Teacher && advisoryTeacher !== sf9Teacher) {
            advisoryVsSf9.teacherDiffs += 1;
            if (advisoryVsSf9.teacherExamples.length < 30) {
              advisoryVsSf9.teacherExamples.push(`${section.name}:${key}: advisory="${advisoryRow.teacher}" sf9="${sf9Row.teacher}"`);
            }
          }
        }
        for (const key of sf9ByCode.keys()) {
          if (!advisoryByCode.has(key) && subjectSetDiffs.sf9Only.length < 30) {
            subjectSetDiffs.sf9Only.push(`${section.name}:${key}`);
          }
        }
      }

      // ── SF10 ──
      if (sf10Limit === 0 || sf10Audited < sf10Limit) {
        const sf10 = await buildSf10Records(studentId);
        const yearRecord: any = sf10?.schoolRecords?.find((record: any) => record.schoolYear === schoolYear);
        if (yearRecord) {
          sf10Audited += 1;
          const sf10ByCode = new Map<string, any>();
          for (const row of yearRecord.subjectGrades ?? []) {
            const key = codeKey(row.subjectCode);
            if (!sf10ByCode.has(key)) sf10ByCode.set(key, row);
          }
          const advisoryByCode = new Map<string, any>();
          for (const row of advisoryRows) {
            const key = codeKey(row.subjectCode);
            if (!advisoryByCode.has(key)) advisoryByCode.set(key, row);
          }
          for (const [key, advisoryRow] of advisoryByCode) {
            const sf10Row = sf10ByCode.get(key);
            if (!sf10Row) continue;
            for (const term of [...TERMS, "FINAL" as const]) {
              advisoryVsSf10.cells += 1;
              const left = term === "FINAL" ? advisoryRow.finalGrade ?? null : advisoryRow.grades?.[term]?.quarterlyGrade ?? null;
              const right = term === "FINAL" ? sf10Row.final ?? null : sf10Row[term] ?? null;
              if (left !== right) {
                advisoryVsSf10.mismatches += 1;
                pushDetail(advisoryVsSf10.examples, {
                  studentId,
                  sectionId: section.id,
                  subject: advisoryRow.subjectCode,
                  term,
                  left,
                  right,
                  note: "SF10",
                });
              }
            }
          }
        } else {
          advisoryVsSf10.skippedStudents += 1;
        }
      }
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    schoolYear,
    summary: {
      sections: sections.length,
      learners: studentIds.length,
      subjectRowsCompared,
      sf10LearnersAudited: sf10Audited,
      gradingMode,
      rotationSubjectsChecked: rotationMetadata.checked,
    },
    advisoryVsClassRecord,
    advisoryVsSf9,
    advisoryVsSf10,
    storedVsLedger,
    advisoryErrors,
    sf9MissingStudent,
    subjectSetDiffs,
    rotationMetadata,
  };

  const summary = {
    schoolYear,
    learners: studentIds.length,
    advisoryVsClassRecord: `${advisoryVsClassRecord.mismatches}/${advisoryVsClassRecord.cells} mismatches`,
    advisoryVsSf9: `${advisoryVsSf9.mismatches}/${advisoryVsSf9.cells} mismatches; ${advisoryVsSf9.teacherDiffs} teacher diffs`,
    advisoryVsSf10: `${advisoryVsSf10.mismatches}/${advisoryVsSf10.cells} mismatches`,
    storedVsLedger: `${storedVsLedger.mismatches}/${storedVsLedger.rowsScanned} mismatches`,
    invalidRotationSubjects: rotationMetadata.invalid.length,
    advisoryErrors: advisoryErrors.count,
  };
  console.log(JSON.stringify(summary, null, 2));

  if (jsonPath) {
    fs.mkdirSync(path.dirname(path.resolve(jsonPath)), { recursive: true });
    fs.writeFileSync(path.resolve(jsonPath), JSON.stringify(report, null, 2));
    console.log(`[audit] JSON written to ${jsonPath}`);
  }
}

main()
  .catch((error) => {
    console.error("[audit] Failed:", error);
    process.exit(2);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
