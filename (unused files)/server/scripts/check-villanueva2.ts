import 'dotenv/config';
import { prisma } from '../src/lib/prisma';

async function main() {
  const teachers = await prisma.teacher.findMany({
    take: 5,
    include: { user: { select: { username: true, firstName: true, lastName: true } } }
  });
  teachers.forEach((t: any) => console.log('teacher id:', t.id, 'username:', t.user.username, 'name:', t.user.lastName));

  // Find teacher with lastName VILLANUEVA
  const teacher = await prisma.teacher.findFirst({
    where: { user: { lastName: { contains: 'VILLANUEVA', mode: 'insensitive' } } },
    include: { user: true }
  });
  if (!teacher) {
    console.log('No VILLANUEVA teacher found');
    return;
  }
  console.log('\nFound teacher:', teacher.id);
  
  const assignments = await prisma.classAssignment.findMany({
    where: { teacherId: teacher.id },
    include: { subject: true, section: true }
  });
  for (const a of assignments) {
    const enrolled = await prisma.enrollment.count({
      where: { sectionId: a.sectionId, status: 'ENROLLED', schoolYear: a.schoolYear }
    });
    const allStatuses = await prisma.enrollment.groupBy({
      by: ['status', 'schoolYear'],
      where: { sectionId: a.sectionId },
      _count: { id: true }
    });
    console.log(`\n[${a.subject.name}] section="${a.section.name}" assignSY="${a.schoolYear}" sectionSY="${a.section.schoolYear}" enrolledInSY=${enrolled}`);
    allStatuses.forEach((s: any) => console.log(`  status="${s.status}" SY="${s.schoolYear}" n=${s._count.id}`));
  }
}

main().catch(console.error).finally(() => process.exit(0));
