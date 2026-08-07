/**
 * EnrollPro → SMART Import Script
 * 
 * Imports from EnrollPro:
 *   - Admin user (hardcoded demo credential)
 *   - Registrar user (from EnrollPro registrar account)
 *   - All 142 teachers (from integration/v1/faculty)
 *   - All 65 sections (from integration/v1/sections)
 *   - Standard DepEd JHS subjects (ATLAS is empty, fallback to standard set)
 * 
 * Run: cd server && npx ts-node --esm import-enrollpro.ts
 * Or:  cd server && npx tsx import-enrollpro.ts
 */

import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import bcrypt from 'bcryptjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter } as any);

// ─── Config ────────────────────────────────────────────────────────────────────
const ENROLLPRO_BASE = 'https://dev-jegs.buru-degree.ts.net/api';
const SCHOOL_YEAR_ID = 8;
const SCHOOL_YEAR_LABEL = '2026-2027';

const DEMO_ACCOUNTS = {
  admin: { email: 'admin@deped.edu.ph', password: 'DepEdSY2026!', firstName: 'SYSTEM', lastName: 'ADMINISTRATOR' },
  registrar: { email: 'regina.cruz@deped.edu.ph', password: 'Gx$P*w2$TuKW', firstName: 'REGINA', lastName: 'CRUZ' },
  teacher: { email: 'miguel.valdez@deped.edu.ph', password: 'DepEd2026!' },
};

// Standard DepEd JHS Subjects
const DEPED_SUBJECTS = [
  { code: 'ENG', name: 'English', type: 'CORE', ww: 30, pt: 50, qa: 20 },
  { code: 'FIL', name: 'Filipino', type: 'CORE', ww: 30, pt: 50, qa: 20 },
  { code: 'MATH', name: 'Mathematics', type: 'MATH_SCIENCE', ww: 40, pt: 40, qa: 20 },
  { code: 'SCI', name: 'Science', type: 'MATH_SCIENCE', ww: 40, pt: 40, qa: 20 },
  { code: 'AP', name: 'Araling Panlipunan', type: 'CORE', ww: 30, pt: 50, qa: 20 },
  { code: 'ESP', name: 'Edukasyon sa Pagpapakatao', type: 'CORE', ww: 30, pt: 50, qa: 20 },
  { code: 'TLE', name: 'Technology and Livelihood Education', type: 'TLE', ww: 20, pt: 60, qa: 20 },
  { code: 'MAPEH', name: 'MAPEH', type: 'MAPEH', ww: 20, pt: 60, qa: 20 },
] as const;

// ─── Helpers ───────────────────────────────────────────────────────────────────
function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse error for ${url}: ${data.substring(0, 200)}`)); }
      });
    });
    req.setTimeout(30000, () => { req.destroy(); reject(new Error(`Timeout fetching ${url}`)); });
    req.on('error', reject);
  });
}

async function fetchAllPages(endpoint: string): Promise<any[]> {
  // Single large request - avoids pagination hang
  const url = `${ENROLLPRO_BASE}${endpoint}&page=1&limit=200`;
  const res = await fetchJson(url);
  return res.data || [];
}

function gradeLevelEnum(name: string): string {
  const map: Record<string, string> = {
    'Grade 7': 'GRADE_7',
    'Grade 8': 'GRADE_8',
    'Grade 9': 'GRADE_9',
    'Grade 10': 'GRADE_10',
  };
  return map[name] || 'GRADE_7';
}

function emailToUsername(email: string): string {
  return email.split('@')[0];
}

// ─── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║     EnrollPro → SMART Import Pipeline        ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  // ─── Step 1: Create subjects ──────────────────────────────────────────────
  console.log('📚 Step 1: Creating DepEd JHS subjects...');
  for (const s of DEPED_SUBJECTS) {
    await prisma.subject.upsert({
      where: { code: s.code },
      update: {},
      create: {
        code: s.code,
        name: s.name,
        type: s.type as any,
        writtenWorkWeight: s.ww,
        perfTaskWeight: s.pt,
        quarterlyAssessWeight: s.qa,
      },
    });
    process.stdout.write('  .');
  }
  console.log(`\n  ✓ ${DEPED_SUBJECTS.length} subjects ready.\n`);

  // ─── Step 2: Create Admin ─────────────────────────────────────────────────
  console.log('👤 Step 2: Creating Admin account...');
  const adminHash = await bcrypt.hash(DEMO_ACCOUNTS.admin.password, 8);
  await prisma.user.upsert({
    where: { username: emailToUsername(DEMO_ACCOUNTS.admin.email) },
    update: { password: adminHash },
    create: {
      username: emailToUsername(DEMO_ACCOUNTS.admin.email),
      password: adminHash,
      role: 'ADMIN',
      firstName: DEMO_ACCOUNTS.admin.firstName,
      lastName: DEMO_ACCOUNTS.admin.lastName,
      email: DEMO_ACCOUNTS.admin.email,
    },
  });
  console.log(`  ✓ Admin: ${DEMO_ACCOUNTS.admin.email} / ${DEMO_ACCOUNTS.admin.password}\n`);

  // ─── Step 3: Create Registrar ─────────────────────────────────────────────
  console.log('👤 Step 3: Creating Registrar account...');
  const regHash = await bcrypt.hash(DEMO_ACCOUNTS.registrar.password, 8);
  await prisma.user.upsert({
    where: { username: emailToUsername(DEMO_ACCOUNTS.registrar.email) },
    update: { password: regHash },
    create: {
      username: emailToUsername(DEMO_ACCOUNTS.registrar.email),
      password: regHash,
      role: 'REGISTRAR',
      firstName: DEMO_ACCOUNTS.registrar.firstName,
      lastName: DEMO_ACCOUNTS.registrar.lastName,
      email: DEMO_ACCOUNTS.registrar.email,
    },
  });
  console.log(`  ✓ Registrar: ${DEMO_ACCOUNTS.registrar.email} / ${DEMO_ACCOUNTS.registrar.password}\n`);

  // ─── Step 4: Fetch and import all faculty ─────────────────────────────────
  console.log('👩‍🏫 Step 4: Fetching faculty from EnrollPro...');
  const faculty = await fetchAllPages(`/integration/v1/faculty?schoolYearId=${SCHOOL_YEAR_ID}`);
  console.log(`  Found ${faculty.length} faculty members.\n  Importing...`);

  // Pre-hash default password ONCE (reused for all teachers)
  const defaultTeacherHash = await bcrypt.hash('DepEd2026!', 8);
  const demoTeacherHash = await bcrypt.hash(DEMO_ACCOUNTS.teacher.password, 8);
  console.log('  Passwords pre-hashed. Importing teachers...');

  let teacherCreated = 0;
  let teacherSkipped = 0;
  const teacherMap = new Map<number, string>(); // enrollProTeacherId → SMART Teacher.id

  for (const f of faculty) {
    if (!f.email) { teacherSkipped++; continue; }
    const username = emailToUsername(f.email);
    // Reuse pre-hashed password (avoids hashing 142x)
    const pwHash = f.email === DEMO_ACCOUNTS.teacher.email ? demoTeacherHash : defaultTeacherHash;

    try {
      const user = await prisma.user.upsert({
        where: { username },
        update: {
          firstName: f.firstName,
          lastName: f.lastName,
          email: f.email,
        },
        create: {
          username,
          password: pwHash,
          role: 'TEACHER',
          firstName: f.firstName,
          lastName: f.lastName,
          email: f.email,
        },
      });

      // Ensure Teacher record exists
      const teacher = await prisma.teacher.upsert({
        where: { userId: user.id },
        update: { specialization: f.specialization ?? undefined },
        create: {
          userId: user.id,
          employeeId: f.employeeId ?? `EP-${f.teacherId}`,
          specialization: f.specialization ?? undefined,
        },
      });

      teacherMap.set(f.teacherId, teacher.id);
      teacherCreated++;
      if (teacherCreated % 10 === 0) console.log(`  Imported ${teacherCreated}/${faculty.length}...`);
    } catch (err: any) {
      // Duplicate employeeId — update instead
      if (err.code === 'P2002') {
        teacherSkipped++;
      } else {
        console.error(`\n  Error for ${f.email}:`, err.message);
      }
    }
  }
  console.log(`\n  ✓ ${teacherCreated} teachers imported, ${teacherSkipped} skipped.\n`);

  // ─── Step 5: Fetch and import sections ───────────────────────────────────
  console.log('🏫 Step 5: Fetching sections from EnrollPro...');
  const sections = await fetchAllPages(`/integration/v1/sections?schoolYearId=${SCHOOL_YEAR_ID}`);
  console.log(`  Found ${sections.length} sections.\n  Importing...`);

  let sectCreated = 0;
  const sectionMap = new Map<number, string>(); // enrollProSectionId → SMART Section.id

  for (const s of sections) {
    const gradeLevel = gradeLevelEnum(s.gradeLevel?.name ?? 'Grade 7');
    const advisingTeacherId = s.advisingTeacher?.id ?? null;
    const smartTeacherId = advisingTeacherId ? teacherMap.get(advisingTeacherId) ?? null : null;

    try {
      const section = await prisma.section.upsert({
        where: {
          name_gradeLevel_schoolYear: {
            name: s.name,
            gradeLevel: gradeLevel as any,
            schoolYear: SCHOOL_YEAR_LABEL,
          },
        },
        update: {
          adviserId: smartTeacherId,
        },
        create: {
          name: s.name,
          gradeLevel: gradeLevel as any,
          schoolYear: SCHOOL_YEAR_LABEL,
          adviserId: smartTeacherId,
        },
      });
      sectionMap.set(s.id, section.id);
      sectCreated++;
    } catch (err: any) {
      console.error(`\n  Error for section ${s.name}:`, err.message);
    }
  }
  console.log(`  ✓ ${sectCreated} sections imported.\n`);

  // ─── Step 6: Update advisory sections from faculty data ──────────────────
  console.log('🔗 Step 6: Linking advisory teachers to sections...');
  let advisoryLinked = 0;
  for (const f of faculty) {
    if (!f.isClassAdviser || !f.advisorySectionId) continue;
    const smartTeacherId = teacherMap.get(f.teacherId);
    const smartSectionId = sectionMap.get(f.advisorySectionId);
    if (!smartTeacherId || !smartSectionId) continue;

    await prisma.section.update({
      where: { id: smartSectionId },
      data: { adviserId: smartTeacherId },
    });
    advisoryLinked++;
  }
  console.log(`  ✓ ${advisoryLinked} advisory assignments linked.\n`);

  // ─── Summary ─────────────────────────────────────────────────────────────
  const counts = await Promise.all([
    prisma.user.count(),
    prisma.teacher.count(),
    prisma.section.count(),
    prisma.subject.count(),
  ]);
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║                 Import Complete               ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║  Users:    ${String(counts[0]).padEnd(34)}║`);
  console.log(`║  Teachers: ${String(counts[1]).padEnd(34)}║`);
  console.log(`║  Sections: ${String(counts[2]).padEnd(34)}║`);
  console.log(`║  Subjects: ${String(counts[3]).padEnd(34)}║`);
  console.log('╠══════════════════════════════════════════════╣');
  console.log('║  Demo Credentials:                           ║');
  console.log('║  Admin:     admin            / DepEdSY2026! ║');
  console.log('║  Registrar: regina.cruz      / Gx$P*w2$TuKW ║');
  console.log('║  Teacher:   miguel.valdez    / DepEd2026!   ║');
  console.log('║  (all other teachers)        / DepEd2026!   ║');
  console.log('╚══════════════════════════════════════════════╝');

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('\n❌ Import failed:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
