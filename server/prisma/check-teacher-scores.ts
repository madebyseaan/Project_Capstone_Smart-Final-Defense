import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL!;
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  const settings = await prisma.systemSettings.findUnique({ where: { id: "main" } });
  const sy = await prisma.schoolYear.findUnique({ where: { id: settings?.schoolYearId ?? "" } });
  const syLabel = sy?.label ?? "UNKNOWN";
  console.log(`ACTIVE SY: ${syLabel}`);

  const cas = await prisma.classAssignment.findMany({
    where: { schoolYear: syLabel },
    include: { subject: true, section: true, teacher: { include: { user: true } } },
  });
  const active = cas.filter((c) => c.isActive);
  const inactive = cas.filter((c) => !c.isActive);
  console.log(`ClassAssignments: total=${cas.length} active=${active.length} inactive=${inactive.length}`);
  const noTeacher = active.filter((c) => !c.teacherId);
  console.log(`Active WITHOUT teacher: ${noTeacher.length}`);
  if (noTeacher.length > 0) {
    console.log("  (sample):", noTeacher.slice(0, 8).map((c) => `${c.subject.code}@${c.section.name}`).join(", "));
  }

  // Distinct teachers teaching this SY
  const teacherIds = new Set(active.filter((c) => c.teacherId).map((c) => c.teacherId));
  console.log(`Distinct teachers on active CAs: ${teacherIds.size}`);

  const gradeRows = await prisma.grade.findMany({
    where: { classAssignment: { schoolYear: syLabel } },
    select: { classAssignmentId: true, term: true, quarterlyGrade: true, status: true, remarks: true, studentId: true },
  });
  const activeIds = new Set(active.map((c) => c.id));
  let onActive = 0;
  let onInactive = 0;
  for (const g of gradeRows) {
    if (activeIds.has(g.classAssignmentId)) onActive++;
    else onInactive++;
  }
  console.log(`\nGrades this SY: total=${gradeRows.length}`);
  console.log(`  on ACTIVE ca: ${onActive}`);
  console.log(`  on INACTIVE ca: ${onInactive} ${onInactive > 0 ? "<<< STALE DATA (shows on SF9/SF10 but not teacher ledger)" : ""}`);

  const byTerm: Record<string, number> = {};
  for (const g of gradeRows) byTerm[g.term] = (byTerm[g.term] ?? 0) + 1;
  console.log(`  by term:`, Object.entries(byTerm).map(([t, n]) => `${t}:${n}`).join(" "));

  // Per-student failed subject analysis (final rating = avg of T1-T3, HG excluded, non-promotional excluded)
  const subjects = await prisma.subject.findMany();
  const subjById = new Map(subjects.map((s) => [s.id, s]));
  const caById = new Map(cas.map((c) => [c.id, c]));

  const studentSubjects = new Map<string, Map<string, { name: string; grades: Map<string, number> }>>();
  for (const g of gradeRows) {
    const ca = caById.get(g.classAssignmentId);
    if (!ca) continue;
    const subj = subjById.get(ca.subjectId);
    if (!subj) continue;
    if ((subj.code ?? "").toUpperCase().startsWith("HG")) continue;
    if (subj.isNonPromotional) continue;
    if (!studentSubjects.has(g.studentId)) studentSubjects.set(g.studentId, new Map());
    const perStudent = studentSubjects.get(g.studentId)!;
    const key = subj.code;
    if (!perStudent.has(key)) perStudent.set(key, { name: subj.name, grades: new Map() });
    const row = perStudent.get(key)!;
    if (g.quarterlyGrade !== null) row.grades.set(g.term, g.quarterlyGrade);
  }

  const enrollments = await prisma.enrollment.findMany({
    where: { schoolYear: syLabel, isArchived: false, status: "ENROLLED" },
    include: { student: true, section: true },
  });

  const failures: Array<{ name: string; section: string; gradeLevel: string; failed: Array<{ code: string; final: number; terms: string }> }> = [];
  for (const e of enrollments) {
    const perStudent = studentSubjects.get(e.studentId);
    if (!perStudent) continue;
    const failed: Array<{ code: string; final: number; terms: string }> = [];
    for (const [code, row] of perStudent) {
      const vals = [row.grades.get("T1"), row.grades.get("T2"), row.grades.get("T3")].filter((v): v is number => v !== undefined);
      if (vals.length === 0) continue;
      const final = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
      if (final < 75) {
        failed.push({ code, final, terms: `T1=${row.grades.get("T1") ?? "-"} T2=${row.grades.get("T2") ?? "-"} T3=${row.grades.get("T3") ?? "-"}` });
      }
    }
    if (failed.length > 0) {
      failures.push({
        name: `${e.student.lastName}, ${e.student.firstName}`,
        section: e.section.name,
        gradeLevel: e.section.gradeLevel,
        failed,
      });
    }
  }

  console.log(`\n=== Students with failed subjects (final rating < 75) ===`);
  for (const f of failures) {
    const kind = f.failed.length >= 3 ? "RETAINED-candidate (3+)" : "REMEDIAL-candidate (1-2)";
    console.log(`${kind}: ${f.name} [${f.gradeLevel} ${f.section}] — ${f.failed.length} failed:`);
    for (const s of f.failed) console.log(`    ${s.code}: final=${s.final} (${s.terms})`);
  }
  const retained = failures.filter((f) => f.failed.length >= 3);
  const remedial = failures.filter((f) => f.failed.length >= 1 && f.failed.length <= 2);
  console.log(`\nSummary: retained-candidates=${retained.length}, remedial-candidates=${remedial.length}`);

  const promo = await prisma.enrollment.groupBy({ by: ["promotionStatus"], where: { schoolYear: syLabel }, _count: true });
  console.log(`\nEnrollment promotionStatus:`, promo.map((p) => `${p.promotionStatus ?? "null"}:${p._count}`).join(", "));

  const rem = await prisma.remedialClass.findMany({
    where: { schoolYear: syLabel },
    include: { enrollment: { include: { student: true } } },
  });
  console.log(`\nRemedialClass rows: ${rem.length}`);
  for (const r of rem) {
    console.log(`  ${r.status} | ${r.subjectCode} orig=${r.originalGrade} rcm=${r.remedialMark} rfg=${r.recomputedGrade} | ${r.enrollment.student.lastName}, ${r.enrollment.student.firstName} | enrollment.promo=${r.enrollment.promotionStatus}`);
  }

  const snaps = await prisma.gradeSnapshot.count({ where: { schoolYear: syLabel } });
  console.log(`\nGradeSnapshots this SY: ${snaps}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
