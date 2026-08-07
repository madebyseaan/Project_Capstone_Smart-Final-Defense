import 'dotenv/config';
import { prisma } from '../src/lib/prisma';

async function main() {
  // Check gender values
  const students = await prisma.student.findMany({ take: 10, select: { firstName: true, lastName: true, gender: true } });
  console.log('=== Sample gender values ===');
  students.forEach((s: any) => console.log(`  ${s.lastName}, ${s.firstName} → gender="${s.gender}"`));

  // Check enrollment stats by school year
  const enrStats = await prisma.enrollment.groupBy({ by: ['status', 'schoolYear'], _count: { id: true }, orderBy: { schoolYear: 'asc' } });
  console.log('\n=== Enrollment stats ===');
  enrStats.forEach((e: any) => console.log(`  SY="${e.schoolYear}" status="${e.status}" count=${e._count.id}`));

  // Check the EMILIO JACINTO section
  const section = await prisma.section.findFirst({ where: { name: { contains: 'JACINTO', mode: 'insensitive' } } });
  if (section) {
    console.log(`\n=== Section: ${section.name} (${section.schoolYear}) ===`);
    const enrollments = await prisma.enrollment.findMany({
      where: { sectionId: section.id },
      include: { student: { select: { firstName: true, lastName: true, gender: true } } }
    });
    enrollments.forEach((e: any) => console.log(`  ${e.student.lastName}, ${e.student.firstName} | gender="${e.student.gender}" | status="${e.status}" | SY="${e.schoolYear}"`));
  }
}

main().catch(console.error).finally(() => process.exit(0));
