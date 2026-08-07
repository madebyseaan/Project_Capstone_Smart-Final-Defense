require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

function isHG(code) {
  return /^HG\d{0,2}$/i.test(String(code || '').trim());
}

async function main() {
  const teachers = [
    { label: 'Elpidio Aquino (4997)', teacherId: 'cmpml0rcx0005usvev3m217sp' },
    { label: 'ELPIDIO AQUINO (2000056)', teacherId: 'cmpml5bji02cuf0ve8mkru44f' },
  ];

  for (const t of teachers) {
    const assignments = await prisma.classAssignment.findMany({
      where: { teacherId: t.teacherId, schoolYear: '2026-2027', isActive: true },
      include: { subject: true },
    });

    const totalTeachingClasses = assignments.filter((a) => !isHG(a.subject.code)).length;
    const totalAll = assignments.length;

    console.log(`${t.label}: all=${totalAll}, teaching(non-HG)=${totalTeachingClasses}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});
