import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '.env') });
import { prisma } from './src/lib/prisma';

async function main() {
  const sy = await prisma.schoolYear.findMany({
    orderBy: { label: 'asc' },
    select: { label: true, status: true, externalId: true },
  });
  console.log('SCHOOL YEARS:');
  sy.forEach((s) => console.log(' ', s.label, s.status, 'ext=' + s.externalId));

  const settings = await prisma.systemSettings.findUnique({
    where: { id: 'main' },
    select: { currentSchoolYear: true, schoolYearId: true },
  });
  console.log('SETTINGS currentSchoolYear=', settings?.currentSchoolYear, 'schoolYearId=', settings?.schoolYearId);

  // For each year: data counts + how many active assignments
  for (const s of sy) {
    const ca = await prisma.classAssignment.count({ where: { schoolYear: s.label } });
    const caActive = await prisma.classAssignment.count({ where: { schoolYear: s.label, isActive: true } });
    const enroll = await prisma.enrollment.count({ where: { schoolYear: s.label } });
    const enrollActive = await prisma.enrollment.count({ where: { schoolYear: s.label, isArchived: false } });
    const grades = await prisma.grade.count({ where: { classAssignment: { schoolYear: s.label } } });
    const sections = await prisma.section.count({ where: { schoolYear: s.label } });
    const sectionsCompleted = await prisma.section.count({ where: { schoolYear: s.label, status: 'COMPLETED' } });
    console.log(`YEAR ${s.label} [${s.status}]: sections=${sections}(completed=${sectionsCompleted}) CAs=${ca}(active=${caActive}) enrollments=${enroll}(notArchived=${enrollActive}) grades=${grades}`);
  }

  // Check the 257 incident assignments
  const archived257 = await prisma.classAssignment.count({
    where: { schoolYear: '2026-2027', isActive: false, archivedReason: { startsWith: 'ATLAS_STALE' } },
  });
  const archivedByYear = await prisma.classAssignment.count({
    where: { schoolYear: '2026-2027', isActive: false, archivedReason: { contains: 'archived' } },
  });
  console.log('2026-2027 assignments archivedReason=ATLAS_STALE*:', archived257);
  console.log('2026-2027 assignments archivedReason contains "archived":', archivedByYear);

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });