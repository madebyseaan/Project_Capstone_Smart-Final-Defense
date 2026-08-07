import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
dotenv.config();
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) } as any);

// Counts
const [users, teachers, sections, subjects, ca, students, enrollments, advisers] = await Promise.all([
  prisma.user.count(),
  prisma.teacher.count(),
  prisma.section.count(),
  prisma.subject.count(),
  prisma.classAssignment.count(),
  prisma.student.count(),
  prisma.enrollment.count(),
  prisma.section.count({ where: { adviserId: { not: null } } }),
]);

console.log('\n╔══════════════════════════════════════════════════════════╗');
console.log('║              SMART DB — Verification Report              ║');
console.log('╠══════════════════════════════════════════════════════════╣');
console.log(`║  Users:              ${String(users).padEnd(35)}║`);
console.log(`║  Teachers:           ${String(teachers).padEnd(35)}║`);
console.log(`║  Sections:           ${String(sections).padEnd(35)}║`);
console.log(`║  Sections w/ Adviser:${String(advisers).padEnd(35)}║`);
console.log(`║  Subjects:           ${String(subjects).padEnd(35)}║`);
console.log(`║  ClassAssignments:   ${String(ca).padEnd(35)}║`);
console.log(`║  Students:           ${String(students).padEnd(35)}║`);
console.log(`║  Enrollments:        ${String(enrollments).padEnd(35)}║`);
console.log('╚══════════════════════════════════════════════════════════╝');

// Sample students
console.log('\n📋 Sample Students (first 5):');
const sampleStudents = await prisma.student.findMany({
  take: 5,
  include: { enrollments: { include: { section: true }, take: 1 } },
});
sampleStudents.forEach(s => {
  const sec = s.enrollments[0]?.section;
  console.log(`  LRN: ${s.lrn} | ${s.lastName}, ${s.firstName} ${s.middleName ?? ''} | ${s.gender} | ${s.birthDate?.toISOString().split('T')[0]} | Section: ${sec?.name ?? 'N/A'} (${sec?.gradeLevel ?? ''})`);
});

// Sample class assignments
console.log('\n📚 Sample Class Assignments (first 5):');
const sampleCA = await prisma.classAssignment.findMany({
  take: 5,
  include: { teacher: { include: { user: true } }, subject: true, section: true },
  orderBy: { createdAt: 'asc' },
});
sampleCA.forEach(c => {
  console.log(`  ${c.teacher.user.email} → ${c.subject.code} (${c.subject.name}) → ${c.section.name} [${c.section.gradeLevel}]`);
});

// Sample advisory assignments
console.log('\n🏫 Sample Advisory (sections with advisers, first 5):');
const advisorySections = await prisma.section.findMany({
  where: { adviserId: { not: null } },
  take: 5,
  include: { adviser: { include: { user: true } } },
  orderBy: { gradeLevel: 'asc' },
});
advisorySections.forEach(s => {
  console.log(`  ${s.adviser?.user?.email} → Adviser of ${s.name} [${s.gradeLevel}]`);
});

// Subjects breakdown
console.log('\n📖 Subjects:');
const allSubjects = await prisma.subject.findMany({ orderBy: { code: 'asc' } });
allSubjects.forEach(s => console.log(`  ${s.code.padEnd(8)} ${s.name} (${s.type})`));

// Students per grade level
console.log('\n👥 Enrollments per grade level:');
const gradeSections = await prisma.section.findMany({
  include: { _count: { select: { enrollments: true } } },
  orderBy: { gradeLevel: 'asc' },
});
const gradeMap = new Map<string, number>();
gradeSections.forEach(s => {
  const cur = gradeMap.get(s.gradeLevel) ?? 0;
  gradeMap.set(s.gradeLevel, cur + s._count.enrollments);
});
gradeMap.forEach((count, grade) => console.log(`  ${grade}: ${count} students`));

await prisma['$disconnect']();
