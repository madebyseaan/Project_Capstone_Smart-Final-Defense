const { PrismaClient } = require('../node_modules/@prisma/client');
const prisma = new PrismaClient();
async function main() {
  // Check gender values
  const students = await prisma.student.findMany({ take: 10, select: { firstName: true, lastName: true, gender: true } });
  console.log('=== Gender values ===');
  students.forEach(s => console.log(`${s.lastName}, ${s.firstName} → gender="${s.gender}"`));

  // Check enrollment counts for a section
  const enrStats = await prisma.enrollment.groupBy({ by: ['status', 'schoolYear'], _count: { id: true }, orderBy: { schoolYear: 'asc' } });
  console.log('\n=== Enrollment stats ===');
  enrStats.forEach(e => console.log(`schoolYear=${e.schoolYear} status=${e.status} count=${e._count.id}`));
}
main().catch(console.error).finally(() => process.exit(0));
