import 'dotenv/config';
import { prisma } from '../src/lib/prisma';

async function main() {
  // Find Mark Villanueva's teacher record
  const teacher = await prisma.teacher.findFirst({
    where: { user: { username: { contains: 'villanueva', mode: 'insensitive' } } },
    include: { user: true }
  });
  console.log('Teacher:', teacher?.user.username, 'id:', teacher?.id);

  if (!teacher) return;

  // Get his class assignments
  const assignments = await prisma.classAssignment.findMany({
    where: { teacherId: teacher.id },
    include: { subject: true, section: true },
    orderBy: { schoolYear: 'desc' }
  });
  console.log('\n=== Class Assignments ===');
  assignments.forEach((a: any) => {
    console.log(`  id=${a.id} subject="${a.subject.name}" section="${a.section.name}" SY="${a.schoolYear}" sectionSY="${a.section.schoolYear}"`);
  });

  // For each assignment, check enrollment count
  for (const a of assignments) {
    const enrolled = await prisma.enrollment.count({
      where: { sectionId: a.sectionId, status: 'ENROLLED', schoolYear: a.schoolYear }
    });
    const allInSection = await prisma.enrollment.count({ where: { sectionId: a.sectionId } });
    console.log(`  [${a.subject.name}] sectionId=${a.sectionId} enrolled(sy+enrolled)=${enrolled} total-in-section=${allInSection}`);
    
    // Show all enrollment statuses for that section
    const statuses = await prisma.enrollment.groupBy({
      by: ['status', 'schoolYear'],
      where: { sectionId: a.sectionId },
      _count: { id: true }
    });
    statuses.forEach((s: any) => console.log(`    status="${s.status}" SY="${s.schoolYear}" n=${s._count.id}`));
  }
}

main().catch(console.error).finally(() => process.exit(0));
