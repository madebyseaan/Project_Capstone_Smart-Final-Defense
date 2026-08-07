/**
 * fetch-atlas-teaching-load.ts
 *
 * Flow:
 *  1. ATLAS GET /faculty?schoolId=1 → faculty list (externalId = EnrollPro teacherId)
 *  2. For each faculty: ATLAS GET /faculty-assignments/:id?schoolYearId=8
 *     → returns assignments[].{ subject.code, sections[].{ id, name, gradeLevelName } }
 *  3. Match ATLAS externalId → SMART Teacher.employeeId
 *  4. Match section by name → SMART Section
 *  5. Delete all heuristic ClassAssignments; create real ones from ATLAS
 *  6. Check EnrollPro for real students (opens June 1)
 *
 * ATLAS schoolId = 1 (NOT 5 — EnrollPro uses schoolId=5, ATLAS uses 1 internally)
 */
import 'dotenv/config';
import https from 'https';
import http from 'http';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter } as any);

const ENROLLPRO_BASE = 'https://dev-jegs.buru-degree.ts.net/api';
const ATLAS_BASE = 'http://100.88.55.125:5001/api/v1';
const ATLAS_SCHOOL_ID = 1;   // ← ATLAS internal schoolId (NOT EnrollPro's schoolId=5)
const SCHOOL_YEAR_ID = 8;
const SCHOOL_YEAR = '2026-2027';

// ATLAS SYSTEM_ADMIN service token (long-lived)
const ATLAS_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InN5c3RlbS1hcGlAYXRsYXMubG9jYWwiLCJyb2xlIjoiU1lTVEVNX0FETUlOIiwidXNlcklkIjpudWxsLCJpYXQiOjE3Nzg0Nzg4NDMsImV4cCI6NDkzNDIzODg0M30.VTB3uv8FEB9VbY0W2mUz0Y5q9fn5WaC02sGJ2jodH08';

// EnrollPro credentials (read-only operations only)
const EP_EMAIL = 'regina.cruz@deped.edu.ph';
const EP_PASSWORD = 'Gx$P*w2$TuKW';

// ─── HTTP helpers ─────────────────────────────────────────────────────────────
function httpGet(url: string, headers: Record<string,string> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = (lib as any).get(url, { headers }, (res: any) => {
      let body = '';
      res.on('data', (c: any) => body += c);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${body.substring(0,300)}`));
        } else {
          try { resolve(JSON.parse(body)); }
          catch { reject(new Error(`JSON parse error: ${body.substring(0,200)}`)); }
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
  });
}

function httpPost(url: string, body: any, headers: Record<string,string> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const data = JSON.stringify(body);
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (url.startsWith('https') ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers },
    };
    const req = (lib as any).request(options, (res: any) => {
      let resp = '';
      res.on('data', (c: any) => resp += c);
      res.on('end', () => {
        try { resolve(JSON.parse(resp)); }
        catch { reject(new Error(`JSON parse error: ${resp.substring(0,200)}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('POST timeout')); });
    req.write(data);
    req.end();
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║     SMART — ATLAS Teaching Load Importer                 ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  const atlasAuth = { Authorization: `Bearer ${ATLAS_TOKEN}` };

  // ── Step 1: Get ATLAS faculty list (schoolId=1) ──────────────────────────
  console.log('👩‍🏫 Step 1: Loading ATLAS faculty (schoolId=1)...');
  const facultyData = await httpGet(`${ATLAS_BASE}/faculty?schoolId=${ATLAS_SCHOOL_ID}`, atlasAuth);
  const atlasFaculty: any[] = facultyData.faculty ?? [];
  console.log(`   Found ${atlasFaculty.length} faculty in ATLAS.\n`);

  // ── Step 2: Match ATLAS faculty → SMART teachers via email ─────────────
  console.log('🔗 Step 2: Matching ATLAS faculty to SMART teachers (by email)...');
  // ATLAS contactInfo = teacher email = SMART User.email
  const atlasIdToSmartTeacherId = new Map<number, string>();
  for (const af of atlasFaculty) {
    const email: string = af.contactInfo ?? '';
    if (!email) continue;
    const smartUser = await prisma.user.findFirst({
      where: { email },
      include: { teacher: { select: { id: true } } },
    });
    if (smartUser?.teacher?.id) {
      atlasIdToSmartTeacherId.set(af.id, smartUser.teacher.id);
    }
  }
  console.log(`   Matched ${atlasIdToSmartTeacherId.size} / ${atlasFaculty.length} faculty to SMART teachers.\n`);

  // ── Step 3: Fetch all teaching assignments from ATLAS ───────────────────
  console.log('📋 Step 3: Fetching individual teaching loads from ATLAS...');

  /**
   * ATLAS assignment structure (real):
   * {
   *   id, facultyId, subjectId, schoolId, gradeLevels: [7], sectionIds: [640, 649],
   *   subject: { id, name, code, ... },
   *   sections: [{ id, name, gradeLevelName, ... }]
   * }
   * We match sections by name to SMART sections.
   */

  // Collect: { smartTeacherId, subjectCode, sectionName }[]
  const loads: Array<{ smartTeacherId: string; subjectCode: string; sectionName: string }> = [];
  let fetchedCount = 0;
  let teachersWithLoads = 0;

  for (const af of atlasFaculty) {
    try {
      const detail = await httpGet(
        `${ATLAS_BASE}/faculty-assignments/${af.id}?schoolYearId=${SCHOOL_YEAR_ID}`,
        atlasAuth,
      );
      const assignments: any[] = detail.assignments ?? [];
      if (assignments.length === 0) { fetchedCount++; continue; }

      const smartTeacherId = atlasIdToSmartTeacherId.get(af.id);
      if (!smartTeacherId) {
        console.warn(`   ⚠ No SMART match for ATLAS faculty ${af.id} (${af.firstName} ${af.lastName})`);
        fetchedCount++; continue;
      }

      teachersWithLoads++;
      for (const a of assignments) {
        const subjectCode: string = a.subject?.code ?? '';
        const sections: any[] = a.sections ?? [];
        for (const sec of sections) {
          loads.push({ smartTeacherId, subjectCode, sectionName: sec.name });
        }
      }

      console.log(`   ✔ ${af.firstName} ${af.lastName}: ${assignments.length} subject(s), ` +
        assignments.map((a: any) => `${a.subject?.code} (${a.sections?.length} sections)`).join(', '));
    } catch (err: any) {
      console.warn(`   ⚠ Could not fetch assignments for ${af.firstName} ${af.lastName}: ${err.message}`);
    }
    fetchedCount++;
    if (fetchedCount % 30 === 0) console.log(`   ... processed ${fetchedCount}/${atlasFaculty.length}`);
  }

  console.log(`\n   ✔ ${teachersWithLoads} teachers have assignments | ${loads.length} total load entries.\n`);

  if (loads.length === 0) {
    console.log('   ⚠ No assignments found in ATLAS. Keeping existing data unchanged.');
    await summarize();
    return;
  }

  // ── Step 4: Load SMART subjects + sections ──────────────────────────────
  const subjects = await prisma.subject.findMany();
  const subjectByCode = new Map(subjects.map(s => [s.code, s]));

  const sections = await prisma.section.findMany({ where: { schoolYear: SCHOOL_YEAR } });
  const sectionByName = new Map(sections.map(s => [s.name, s]));

  // ── Step 5: Delete ALL existing heuristic class assignments + create real ─
  console.log('🗑️  Step 5: Replacing heuristic class assignments with ATLAS real data...');
  const deleted = await prisma.classAssignment.deleteMany({ where: { schoolYear: SCHOOL_YEAR } });
  console.log(`   Deleted ${deleted.count} old assignments.`);

  let created = 0;
  let skipped = 0;
  const warnedSubjects = new Set<string>();

  for (const load of loads) {
    const subject = subjectByCode.get(load.subjectCode);
    if (!subject) {
      if (!warnedSubjects.has(load.subjectCode)) {
        console.warn(`   ⚠ Subject code not in SMART DB: ${load.subjectCode}`);
        warnedSubjects.add(load.subjectCode);
      }
      skipped++; continue;
    }

    const section = sectionByName.get(load.sectionName);
    if (!section) {
      console.warn(`   ⚠ Section not found in SMART: "${load.sectionName}"`);
      skipped++; continue;
    }

    try {
      await prisma.classAssignment.upsert({
        where: {
          teacherId_subjectId_sectionId_schoolYear: {
            teacherId: load.smartTeacherId,
            subjectId: subject.id,
            sectionId: section.id,
            schoolYear: SCHOOL_YEAR,
          },
        },
        update: {},
        create: {
          teacherId: load.smartTeacherId,
          subjectId: subject.id,
          sectionId: section.id,
          schoolYear: SCHOOL_YEAR,
        },
      });
      created++;
    } catch (err: any) {
      skipped++;
    }
  }
  console.log(`   ✔ Created ${created} real class assignments (${skipped} skipped).\n`);

  // ── Step 6: Check EnrollPro students ────────────────────────────────────
  console.log('👨‍🎓 Step 6: Checking EnrollPro for real students...');
  const loginData = await httpPost(`${ENROLLPRO_BASE}/auth/login`, { email: EP_EMAIL, password: EP_PASSWORD });
  const epToken = loginData.token;
  if (epToken) {
    const epStudents = await httpGet(
      `${ENROLLPRO_BASE}/integration/v1/students?schoolYearId=${SCHOOL_YEAR_ID}&page=1&limit=1`,
      { Authorization: `Bearer ${epToken}` },
    );
    const total = epStudents.meta?.total ?? 0;
    console.log(`   EnrollPro students total: ${total}`);
    if (total === 0) console.log('   → 0 students (enrollment opens June 1). Keeping placeholder students.\n');
  }

  await summarize();
}

async function summarize() {
  const [ca, students, enrollments] = await Promise.all([
    prisma.classAssignment.count(),
    prisma.student.count(),
    prisma.enrollment.count(),
  ]);

  // Show sample for Miguel
  const miguel = await prisma.user.findFirst({ where: { email: 'miguel.valdez@deped.edu.ph' }, include: { teacher: true } });
  if (miguel?.teacher) {
    const miguelCAs = await prisma.classAssignment.findMany({
      where: { teacherId: miguel.teacher.id },
      include: { subject: true, section: true },
    });
    console.log(`Miguel Valdez's class assignments (${miguelCAs.length}):`);
    miguelCAs.forEach(ca => console.log(`  → ${ca.subject.code} (${ca.subject.name}) | ${ca.section.name} [${ca.section.gradeLevel}]`));
    console.log();
  }

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║                        RESULT                            ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  Class Assignments:  ${String(ca).padEnd(35)}║`);
  console.log(`║  Students:           ${String(students).padEnd(35)}║`);
  console.log(`║  Enrollments:        ${String(enrollments).padEnd(35)}║`);
  console.log('╚══════════════════════════════════════════════════════════╝\n');
}

main()
  .catch(console.error)
  .finally(() => prisma['$disconnect']());
