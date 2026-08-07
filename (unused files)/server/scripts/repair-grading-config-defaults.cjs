require('dotenv').config();
const { PrismaClient, SubjectType } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const defs = [
    { subjectType: SubjectType.CORE, ww: 20, pt: 50, qa: 30 },
    { subjectType: SubjectType.MATH_SCIENCE, ww: 20, pt: 50, qa: 30 },
    { subjectType: SubjectType.MAPEH, ww: 20, pt: 60, qa: 20 },
    { subjectType: SubjectType.TLE, ww: 20, pt: 60, qa: 20 },
  ];

  for (const d of defs) {
    await prisma.gradingConfig.upsert({
      where: { subjectType: d.subjectType },
      update: {
        writtenWorkWeight: d.ww,
        performanceTaskWeight: d.pt,
        quarterlyAssessWeight: d.qa,
        isDepEdDefault: true,
      },
      create: {
        subjectType: d.subjectType,
        writtenWorkWeight: d.ww,
        performanceTaskWeight: d.pt,
        quarterlyAssessWeight: d.qa,
        isDepEdDefault: true,
      },
    });
  }

  const rows = await prisma.gradingConfig.findMany({
    orderBy: { subjectType: 'asc' },
    select: {
      subjectType: true,
      writtenWorkWeight: true,
      performanceTaskWeight: true,
      quarterlyAssessWeight: true,
      isDepEdDefault: true,
    },
  });

  console.table(
    rows.map((r) => ({
      subjectType: r.subjectType,
      ww: r.writtenWorkWeight,
      pt: r.performanceTaskWeight,
      qa: r.quarterlyAssessWeight,
      deped: r.isDepEdDefault,
    }))
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
