import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL!;
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

async function main() {
  const settings = await prisma.systemSettings.findUnique({ where: { id: "main" } });
  const sy = settings?.schoolYearId
    ? await prisma.schoolYear.findUnique({ where: { id: settings.schoolYearId } })
    : null;
  const schoolYearLabel = sy?.label;

  // Remedial students
  const remedialIds = [
    "cmth7hhjf00a594ve4ksq5jw3", // MENDOZA, JOSE GABRIEL
    "cmtjp7szj00t4f0ve4omy7un3", // MENDOZA, JUSTIN
  ];

  for (const studentId of remedialIds) {
    const student = await prisma.student.findUnique({ where: { id: studentId } });
    console.log(`\n=== ${student?.lastName}, ${student?.firstName} ===`);

    const grades = await prisma.grade.findMany({
      where: {
        studentId,
        classAssignment: { schoolYear: schoolYearLabel },
      },
      include: {
        classAssignment: { include: { subject: true, section: true } },
      },
      orderBy: [
        { classAssignment: { subject: { code: "asc" } } },
        { term: "asc" },
      ],
    });

    // Group by subject
    const bySubject = new Map<string, typeof grades>();
    for (const g of grades) {
      const code = g.classAssignment.subject.code;
      if (!bySubject.has(code)) bySubject.set(code, []);
      bySubject.get(code)!.push(g);
    }

    for (const [code, subjectGrades] of bySubject) {
      const t1 = subjectGrades.find(g => g.term === "T1");
      const t2 = subjectGrades.find(g => g.term === "T2");
      const t3 = subjectGrades.find(g => g.term === "T3");
      const t1QG = t1?.quarterlyGrade ?? null;
      const t2QG = t2?.quarterlyGrade ?? null;
      const t3QG = t3?.quarterlyGrade ?? null;
      const avg = [t1QG, t2QG, t3QG].filter(v => v !== null);
      const finalRating = avg.length > 0 ? Math.round(avg.reduce((a, b) => a + b, 0) / avg.length) : null;
      const passed = finalRating !== null && finalRating >= 75;
      console.log(`  ${code}: T1=${t1QG} T2=${t2QG} T3=${t3QG} → avg=${finalRating} → ${passed ? "PASSED" : "FAILED"}`);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
