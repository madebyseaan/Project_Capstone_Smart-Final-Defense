require('dotenv').config();
const { PrismaClient, EnrollmentStatus } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const teacher = await prisma.teacher.findUnique({
    where: { id: 'cmpml0rcx0005usvev3m217sp' },
    include: { user: true },
  });

  if (!teacher) {
    console.log('Teacher Elpidio Aquino not found');
    return;
  }

  const systemSettings = await prisma.systemSettings.findUnique({ where: { id: 'main' } });
  const currentSchoolYear = systemSettings?.currentSchoolYear ?? '2026-2027';

  const activeClassAssignments = await prisma.classAssignment.findMany({
    where: {
      teacherId: teacher.id,
      schoolYear: currentSchoolYear,
      isActive: true,
    },
    include: {
      subject: true,
      section: {
        include: {
          _count: {
            select: {
              enrollments: {
                where: { status: EnrollmentStatus.ENROLLED, schoolYear: currentSchoolYear },
              },
            },
          },
        },
      },
    },
  });

  const uniqueSectionEnrollments = new Map();
  for (const ca of activeClassAssignments) {
    if (!uniqueSectionEnrollments.has(ca.sectionId)) {
      uniqueSectionEnrollments.set(ca.sectionId, {
        name: ca.section.name,
        gradeLevel: ca.section.gradeLevel,
        students: ca.section._count.enrollments,
      });
    }
  }

  const advisorySections = await prisma.section.findMany({
    where: {
      adviserId: teacher.id,
      schoolYear: currentSchoolYear,
      id: { notIn: [...uniqueSectionEnrollments.keys()] },
    },
    include: {
      _count: {
        select: {
          enrollments: {
            where: { status: EnrollmentStatus.ENROLLED, schoolYear: currentSchoolYear },
          },
        },
      },
    },
  });

  console.log(`Teacher: ${teacher.user.firstName} ${teacher.user.lastName} (${teacher.id})`);
  console.log(`School Year: ${currentSchoolYear}`);
  console.log(`Active class assignments: ${activeClassAssignments.length}`);
  console.log(`Unique active sections from assignments: ${uniqueSectionEnrollments.size}`);
  console.table([...uniqueSectionEnrollments.values()]);

  console.log(`Advisory-only sections added by dashboard logic: ${advisorySections.length}`);
  console.table(advisorySections.map((s) => ({ name: s.name, gradeLevel: s.gradeLevel, students: s._count.enrollments })));

  console.log(`Dashboard totalSections = ${uniqueSectionEnrollments.size + advisorySections.length}`);

  const allTeacherAssignments = await prisma.classAssignment.findMany({
    where: { teacherId: teacher.id, schoolYear: currentSchoolYear },
    include: { section: true, subject: true },
    orderBy: [{ isActive: 'desc' }, { section: { name: 'asc' } }, { subject: { name: 'asc' } }],
  });

  console.log(`All assignments this SY (active + inactive): ${allTeacherAssignments.length}`);
  console.table(
    allTeacherAssignments.map((a) => ({
      section: a.section.name,
      subject: a.subject.code,
      active: a.isActive,
      archivedReason: a.archivedReason,
    }))
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
