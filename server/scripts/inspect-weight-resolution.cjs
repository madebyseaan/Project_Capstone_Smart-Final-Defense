require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const classAssignmentId = process.argv[2];

  const configs = await prisma.gradingConfig.findMany({
    orderBy: { subjectType: 'asc' },
    select: {
      subjectType: true,
      writtenWorkWeight: true,
      performanceTaskWeight: true,
      quarterlyAssessWeight: true,
      isDepEdDefault: true,
      updatedAt: true,
    },
  });

  console.log('=== GradingConfig rows ===');
  console.table(
    configs.map((c) => ({
      subjectType: c.subjectType,
      ww: c.writtenWorkWeight,
      pt: c.performanceTaskWeight,
      qa: c.quarterlyAssessWeight,
      deped: c.isDepEdDefault,
      updatedAt: c.updatedAt,
    }))
  );

  if (classAssignmentId) {
    const ca = await prisma.classAssignment.findUnique({
      where: { id: classAssignmentId },
      select: {
        id: true,
        schoolYear: true,
        subject: {
          select: {
            id: true,
            code: true,
            name: true,
            type: true,
            writtenWorkWeight: true,
            perfTaskWeight: true,
            quarterlyAssessWeight: true,
          },
        },
        section: {
          select: {
            name: true,
            gradeLevel: true,
          },
        },
      },
    });

    console.log('\n=== ClassAssignment lookup ===');
    console.dir(ca, { depth: null });

    if (ca?.subject?.type) {
      const cfg = await prisma.gradingConfig.findUnique({
        where: { subjectType: ca.subject.type },
        select: {
          subjectType: true,
          writtenWorkWeight: true,
          performanceTaskWeight: true,
          quarterlyAssessWeight: true,
        },
      });
      console.log('\n=== Resolved config for subject type ===');
      console.dir(cfg, { depth: null });
    }
  }

  const scienceLikeSubjects = await prisma.subject.findMany({
    where: {
      OR: [
        { name: { contains: 'Science', mode: 'insensitive' } },
        { code: { contains: 'SCI', mode: 'insensitive' } },
        { name: { contains: 'Biology', mode: 'insensitive' } },
      ],
    },
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
      writtenWorkWeight: true,
      perfTaskWeight: true,
      quarterlyAssessWeight: true,
      updatedAt: true,
    },
    take: 50,
    orderBy: { name: 'asc' },
  });

  console.log('\n=== Science-like subjects (sample) ===');
  console.table(
    scienceLikeSubjects.map((s) => ({
      code: s.code,
      name: s.name,
      type: s.type,
      ww: s.writtenWorkWeight,
      pt: s.perfTaskWeight,
      qa: s.quarterlyAssessWeight,
      updatedAt: s.updatedAt,
    }))
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
