import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

async function main() {
  // Check all enrollments with non-ENROLLED status
  const inactive = await p.enrollment.findMany({
    where: { status: { not: 'ENROLLED' } },
    include: { student: true, section: true },
    take: 10,
  });
  console.log('=== Non-ENROLLED enrollments ===');
  console.log(JSON.stringify(inactive.map(e => ({
    lrn: e.student.lrn,
    name: `${e.student.lastName}, ${e.student.firstName}`,
    status: e.status,
    sy: e.schoolYear,
    section: e.section.name,
  })), null, 2));

  // Check all enrollments
  const count = await p.enrollment.count();
  const enrolled = await p.enrollment.count({ where: { status: 'ENROLLED' } });
  console.log(`\nTotal enrollments: ${count}, ENROLLED: ${enrolled}, Non-ENROLLED: ${count - enrolled}`);

  // Check specific LRN
  const aguilar = await p.student.findFirst({ where: { lrn: '100000000037' } });
  console.log('\n=== AGUILAR (LRN 100000000037) ===');
  if (aguilar) {
    const enrollments = await p.enrollment.findMany({
      where: { studentId: aguilar.id },
      include: { section: true },
    });
    console.log('Student:', JSON.stringify(aguilar, null, 2));
    console.log('Enrollments:', JSON.stringify(enrollments, null, 2));
  } else {
    console.log('Student NOT FOUND in database');
  }

  await p.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
