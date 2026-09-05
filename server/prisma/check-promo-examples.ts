import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL!;
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  const settings = await prisma.systemSettings.findUnique({ where: { id: "main" } });
  const sy = await prisma.schoolYear.findUnique({ where: { id: settings?.schoolYearId ?? "" } });
  const syLabel = sy?.label ?? "UNKNOWN";

  const enrollments = await prisma.enrollment.findMany({
    where: { schoolYear: syLabel, promotionStatus: { in: ["CONDITIONALLY_PROMOTED", "RETAINED"] } },
    include: { student: true, section: true },
  });

  for (const e of enrollments) {
    console.log(`\n=== ${e.student.lastName}, ${e.student.firstName} | LRN ${e.student.lrn} | ${e.section.gradeLevel} ${e.section.name} | ${e.promotionStatus} ===`);
    const grades = await prisma.grade.findMany({
      where: { studentId: e.studentId, classAssignment: { sectionId: e.sectionId, schoolYear: syLabel } },
      include: { classAssignment: { include: { subject: true } } },
      orderBy: { classAssignment: { subject: { code: "asc" } } },
    });
    const bySubject = new Map<string, number[]>();
    for (const g of grades) {
      const code = g.classAssignment.subject.code;
      if (code.toUpperCase().startsWith("HG")) continue;
      if (!bySubject.has(code)) bySubject.set(code, []);
      if (g.quarterlyGrade !== null) bySubject.get(code)!.push(g.quarterlyGrade);
    }
    for (const [code, vals] of bySubject) {
      const final = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
      console.log(`  ${code}: T=${vals.join(",")} final=${final} ${final < 75 ? "FAILED" : "passed"}`);
    }
    const finals = [...bySubject.values()].map((vals) => Math.round(vals.reduce((a, b) => a + b, 0) / vals.length));
    const ga = finals.length > 0 ? Math.round(finals.reduce((a, b) => a + b, 0) / finals.length) : null;
    console.log(`  General Average: ${ga} | failing subjects: ${finals.filter((f) => f < 75).length}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
