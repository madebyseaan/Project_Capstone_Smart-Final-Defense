import 'dotenv/config';
import { prisma } from '../src/lib/prisma';

async function main() {
  const teacher = await prisma.teacher.findFirst({
    where: { user: { firstName: { contains: 'Elpidio' } } },
    include: { user: true }
  });

  if (!teacher) {
    console.log('Teacher Elpidio Aquino not found');
    return;
  }

  console.log(`Found teacher: ${teacher.user.firstName} ${teacher.user.lastName} (id=${teacher.id})`);

  const assignments = await prisma.classAssignment.findMany({
    where: { teacherId: teacher.id },
    include: {
      subject: true,
      section: true
    }
  });

  console.log(`Found ${assignments.length} assignments:`);
  for (const a of assignments) {
    console.log(`- ID: ${a.id}`);
    console.log(`  Subject: ${a.subject.name} (${a.subject.code}) [ID: ${a.subject.id}]`);
    console.log(`  Section: ${a.section.name} [ID: ${a.section.id}]`);
    console.log(`  Active: ${a.isActive}, ArchivedAt: ${a.archivedAt}, Reason: ${a.archivedReason}`);
    console.log('---');
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
