import 'dotenv/config';
import { prisma } from '../src/lib/prisma';

async function main() {
  console.log('Cleaning up stale enrollments...');
  
  // 1. Get all enrollments
  const enrollments = await prisma.enrollment.findMany({
    where: { schoolYear: '2026-2027', status: 'ENROLLED' },
    orderBy: { createdAt: 'asc' } // Older first
  });
  
  const studentEnrollments = new Map<string, typeof enrollments[0]>();
  const toDropIds: string[] = [];
  
  // 2. Identify duplicates (keep the latest one)
  for (const e of enrollments) {
    if (studentEnrollments.has(e.studentId)) {
      // If we already saw this student, mark the OLDER one as DROPPED
      const older = studentEnrollments.get(e.studentId)!;
      toDropIds.push(older.id);
    }
    // Set current as the latest active enrollment
    studentEnrollments.set(e.studentId, e);
  }
  
  console.log(`Found ${toDropIds.length} stale/duplicate enrollments to drop.`);
  
  // 3. Update them to DROPPED
  if (toDropIds.length > 0) {
    const result = await prisma.enrollment.updateMany({
      where: { id: { in: toDropIds } },
      data: { status: 'DROPPED' }
    });
    console.log(`Successfully marked ${result.count} enrollments as DROPPED.`);
  } else {
    console.log('No stale enrollments found.');
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
