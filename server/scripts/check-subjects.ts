import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(process.cwd(), '.env') });
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

async function main() {
  // Get ALL class assignments with section details
  const assignments = await prisma.classAssignment.findMany({
    select: {
      subject: { select: { code: true, name: true } },
      section: { select: { gradeLevel: true, name: true, program: true, schoolYear: true } },
    },
    where: { section: { schoolYear: '2026-2027' } },
  });

  const bySection: Record<string, { program: string; grade: string; subjects: string[] }> = {};
  for (const r of assignments) {
    const secKey = `${r.section.name}|${r.section.gradeLevel}|${r.section.program}`;
    if (!bySection[secKey]) bySection[secKey] = { program: r.section.program, grade: r.section.gradeLevel, subjects: [] };
    bySection[secKey].subjects.push(`${r.subject.code} | ${r.subject.name}`);
  }

  for (const [k, v] of Object.entries(bySection).sort()) {
    console.log(`\n=== ${k} ===`);
    v.subjects.sort().forEach(s => console.log(`  ${s}`));
  }

  // Also check what SF10 hardcodes
  console.log('\n\n=== COMPARISON: ATLAS vs SF10 HARDCODED ===');
  
  // Group by grade+program
  const byGradeProgram: Record<string, Record<string, Set<string>>> = {};
  for (const r of assignments) {
    const g = r.section.gradeLevel;
    const p2 = r.section.program || 'REGULAR';
    if (!byGradeProgram[g]) byGradeProgram[g] = {};
    if (!byGradeProgram[g][p2]) byGradeProgram[g][p2] = new Set();
    byGradeProgram[g][p2].add(r.subject.code);
  }

  for (const [grade, programs] of Object.entries(byGradeProgram).sort()) {
    for (const [program, codes] of Object.entries(programs).sort()) {
      const regularCodes = programs['REGULAR'] || new Set();
      const extra = [...codes].filter(c => !regularCodes.has(c));
      const missing = [...regularCodes].filter(c => !codes.has(c));
      if (extra.length > 0 || missing.length > 0) {
        console.log(`\n${grade} | ${program}:`);
        if (extra.length > 0) console.log(`  EXTRA (vs Regular): ${extra.join(', ')}`);
        if (missing.length > 0) console.log(`  MISSING (vs Regular): ${missing.join(', ')}`);
      }
    }
  }
}

main().then(() => prisma.$disconnect());
