import 'dotenv/config';
import { prisma } from '../src/lib/prisma';

const CA_ID = 'cmphr7mai02iz48vele2fbt2y';

async function main() {
  const ca = await prisma.classAssignment.findUnique({
    where: { id: CA_ID },
    include: { subject: true, section: true }
  });
  if (!ca) { console.log('NOT FOUND'); return; }
  console.log(`ClassAssignment: subject="${ca.subject.name}" section="${ca.section.name}" CA.schoolYear="${ca.schoolYear}" section.schoolYear="${ca.section.schoolYear}"`);

  const allEnrollments = await prisma.enrollment.groupBy({
    by: ['status', 'schoolYear'],
    where: { sectionId: ca.sectionId },
    _count: { id: true }
  });
  console.log('\nAll enrollment groups for this section:');
  allEnrollments.forEach((e: any) => console.log(`  status="${e.status}" SY="${e.schoolYear}" n=${e._count.id}`));

  const filtered = await prisma.enrollment.findMany({
    where: { sectionId: ca.sectionId, status: 'ENROLLED', schoolYear: ca.schoolYear },
    include: { student: { select: { firstName: true, lastName: true, gender: true } } }
  });
  console.log(`\nStudents matching ECR filter (status=ENROLLED, SY=${ca.schoolYear}):`);
  filtered.forEach((e: any) => console.log(`  ${e.student.lastName}, ${e.student.firstName} | gender="${e.student.gender}"`));
}

main().catch(console.error).finally(() => process.exit(0));
