require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function main() {
  const users = await prisma.user.findMany({
    where: { role: 'TEACHER', email: { equals: 'elpidio.aquino@deped.edu.ph', mode: 'insensitive' } },
    include: { teacher: true },
  });

  for (const u of users) {
    const assignments = await prisma.classAssignment.findMany({
      where: { teacherId: u.teacher?.id || 'none', schoolYear: '2026-2027' },
      include: { subject: true, section: true },
      orderBy: [{ section: { name: 'asc' } }, { subject: { code: 'asc' } }],
    });

    console.log(`\nUser=${u.id} teacher=${u.teacher?.id} employeeId=${u.teacher?.employeeId} name=${u.firstName} ${u.lastName}`);
    console.log(`Assignments: ${assignments.length}`);
    console.table(assignments.map((a) => ({ section: a.section.name, grade: a.section.gradeLevel, subject: a.subject.code, active: a.isActive })));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});
