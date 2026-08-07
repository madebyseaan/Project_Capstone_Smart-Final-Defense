require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const codes = ['STE_APPLIED_CHEM9', 'SCI_ES9', 'SCI_ES7', 'SCI_ES8', 'SCI_ES10'];
  const subjects = await prisma.subject.findMany({
    where: { code: { in: codes } },
    select: { id: true, code: true, name: true },
    orderBy: { code: 'asc' },
  });
  console.log('Subjects present for expected codes:');
  console.table(subjects);

  const assignments = await prisma.classAssignment.findMany({
    where: {
      teacherId: 'cmpml0rcx0005usvev3m217sp',
      schoolYear: '2026-2027',
    },
    include: { subject: true, section: true },
    orderBy: [{ subject: { code: 'asc' } }, { section: { name: 'asc' } }],
  });

  const matching = assignments
    .filter((a) => codes.includes(a.subject.code))
    .map((a) => ({ code: a.subject.code, section: a.section.name, active: a.isActive }));

  console.log('Assignments using expected codes:');
  console.table(matching);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
