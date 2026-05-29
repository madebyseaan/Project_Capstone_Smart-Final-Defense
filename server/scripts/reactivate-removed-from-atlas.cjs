require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const settings = await prisma.systemSettings.findUnique({ where: { id: 'main' } });
  const currentSchoolYear = settings?.currentSchoolYear ?? '2026-2027';

  const before = await prisma.classAssignment.count({
    where: {
      schoolYear: currentSchoolYear,
      isActive: false,
      archivedReason: 'Removed from Atlas schedule',
    },
  });

  const result = await prisma.classAssignment.updateMany({
    where: {
      schoolYear: currentSchoolYear,
      isActive: false,
      archivedReason: 'Removed from Atlas schedule',
    },
    data: {
      isActive: true,
      archivedAt: null,
      archivedReason: null,
    },
  });

  const after = await prisma.classAssignment.count({
    where: {
      schoolYear: currentSchoolYear,
      isActive: false,
      archivedReason: 'Removed from Atlas schedule',
    },
  });

  console.log(`School Year: ${currentSchoolYear}`);
  console.log(`Rows matching before repair: ${before}`);
  console.log(`Rows reactivated: ${result.count}`);
  console.log(`Rows still matching after repair: ${after}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
