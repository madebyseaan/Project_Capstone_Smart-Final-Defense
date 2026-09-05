/**
 * fix-retained-students.ts — One-time fix for CP-tagged students with 3+ failures.
 *
 * Run: cd server && npx ts-node --files prisma/fix-retained-students.ts
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";

async function main() {
  const conditionals = await prisma.enrollment.findMany({
    where: { promotionStatus: "CONDITIONALLY_PROMOTED" },
    include: {
      section: true,
      remedialClasses: true,
      student: true,
    },
  });

  let fixed = 0;
  for (const enrollment of conditionals) {
    const grades = await prisma.grade.findMany({
      where: {
        studentId: enrollment.studentId,
        status: "FINALIZED",
        classAssignment: { schoolYear: enrollment.schoolYear },
      },
      include: { classAssignment: { select: { subject: true } } },
    });
    const failing = grades.filter((g) =>
      !g.classAssignment.subject.isNonPromotional &&
      !g.classAssignment.subject.code.toUpperCase().startsWith("HG") &&
      g.quarterlyGrade !== null && g.quarterlyGrade < 75,
    );
    const uniqueSubjects = new Set(failing.map((g) => g.classAssignment.subject.code));

    if (uniqueSubjects.size >= 3) {
      await prisma.remedialClass.deleteMany({ where: { enrollmentId: enrollment.id } });
      await prisma.enrollment.update({
        where: { id: enrollment.id },
        data: { promotionStatus: "RETAINED" },
      });
      console.log(`FIXED: ${enrollment.student.lastName} — ${uniqueSubjects.size} failing → RETAINED, ${enrollment.remedialClasses.length} remedial rows deleted`);
      fixed++;
    }
  }
  console.log(`\nDone: ${fixed} enrollments fixed`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
