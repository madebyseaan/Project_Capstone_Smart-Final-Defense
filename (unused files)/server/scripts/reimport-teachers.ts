/**
 * reimport-teachers.ts
 *
 * Replaces all fake seeded teacher accounts with real teacher data from EnrollPro.
 *
 * Steps:
 *  1. Fetch real teachers from EnrollPro GET /teachers
 *  2. Fetch sections from EnrollPro GET /sections (grouped by gradeLevels)
 *  3. Clear section advisers (avoid FK constraint)
 *  4. Delete all fake TEACHER users (cascade removes Teacher records)
 *  5. Create real teacher users from EnrollPro data (password: DepEd2026!)
 *  6. Re-assign section advisers from section.advisingTeacher data
 */
import 'dotenv/config';
import https from 'https';
import http from 'http';
import bcrypt from 'bcryptjs';
import { PrismaClient, Role } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const p = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) } as any);

const EP_BASE = process.env.ENROLLPRO_BASE_URL ?? 'https://dev-jegs.buru-degree.ts.net/api';
const SCHOOL_YEAR = '2025-2026';

function httpPost(url: string, body: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const data = JSON.stringify(body);
    const u = new URL(url);
    const req = (lib as any).request({
      hostname: u.hostname, port: u.port || 443,
      path: u.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res: any) => {
      let r = ''; res.on('data', (c: any) => r += c);
      res.on('end', () => { try { resolve(JSON.parse(r)); } catch { reject(new Error(r.substring(0, 300))); } });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('POST timeout')); });
    req.write(data); req.end();
  });
}

function httpGet(url: string, headers: Record<string, string>): Promise<any> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    (lib as any).get(url, { headers } as any, (res: any) => {
      let body = '';
      res.on('data', (c: any) => body += c);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          return reject(new Error(`HTTP ${res.statusCode}: ${body.substring(0, 200)}`));
        }
        try { resolve(JSON.parse(body)); } catch { reject(new Error(body.substring(0, 200))); }
      });
    }).on('error', reject);
  });
}

function toTitleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║   SMART — Re-import Teachers from EnrollPro              ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // ── Step 1: Login to EnrollPro ──────────────────────────────────────────
  console.log('🔐 Step 1: Authenticating with EnrollPro...');
  const accountName = process.env.ENROLLPRO_ACCOUNT_NAME;
  const password = process.env.ENROLLPRO_PASSWORD;
  if (!accountName || !password) throw new Error('ENROLLPRO_ACCOUNT_NAME / ENROLLPRO_PASSWORD not set');
  const login = await httpPost(`${EP_BASE}/auth/login`, { accountName, password });
  const token = login.token;
  if (!token) throw new Error('EnrollPro login failed: ' + JSON.stringify(login));
  const auth = { Authorization: `Bearer ${token}` };
  console.log('   ✔ Authenticated.\n');

  // ── Step 2: Fetch teachers from EnrollPro ───────────────────────────────
  console.log('👩‍🏫 Step 2: Fetching teachers from EnrollPro...');
  const epTeachersResp = await httpGet(`${EP_BASE}/teachers`, auth);
  const epTeachers: any[] = epTeachersResp.teachers ?? [];
  console.log(`   Found ${epTeachers.length} teachers in EnrollPro.\n`);

  if (epTeachers.length === 0) {
    console.error('   ✗ No teachers returned from EnrollPro. Aborting.');
    return;
  }

  // ── Step 3: Fetch sections from EnrollPro for adviser mapping ───────────
  console.log('📚 Step 3: Fetching sections from EnrollPro for adviser mapping...');
  const sectsResp = await httpGet(`${EP_BASE}/sections`, auth);
  const gradeLevels: any[] = sectsResp.gradeLevels ?? [];
  const allEpSections: any[] = gradeLevels.flatMap((gl: any) =>
    (gl.sections ?? []).map((s: any) => ({ ...s, gradeLevelName: gl.gradeLevelName }))
  );
  const populatedSections = allEpSections.filter((s: any) => s.enrolledCount > 0 && s.advisingTeacher);
  console.log(`   Total sections: ${allEpSections.length}, with adviser+students: ${populatedSections.length}\n`);

  // Build map: EnrollPro teacher id → employeeId (for adviser matching)
  // epTeachers have: { id, employeeId, firstName, lastName, email, ... }
  const epIdToEmployeeId = new Map<number, string>(
    epTeachers.map((t: any) => [t.id as number, String(t.employeeId)] as [number, string])
  );

  // Build map: section name → adviser employeeId (from section.advisingTeacher.id)
  const sectionNameToAdviserEmpId = new Map<string, string>();
  for (const sec of populatedSections) {
    const epTeacherId: number = sec.advisingTeacher.id;
    const empId = epIdToEmployeeId.get(epTeacherId);
    if (empId) sectionNameToAdviserEmpId.set(sec.name, empId);
  }
  console.log(`   Adviser mappings found: ${sectionNameToAdviserEmpId.size}\n`);

  // ── Step 4: Clear section advisers ─────────────────────────────────────
  console.log('🔄 Step 4: Clearing current section advisers...');
  const cleared = await p.section.updateMany({ data: { adviserId: null } });
  console.log(`   Cleared ${cleared.count} section adviser assignments.\n`);

  // ── Step 5: Delete all fake TEACHER users ──────────────────────────────
  console.log('🗑️  Step 5: Deleting fake teacher accounts...');
  const deleted = await p.user.deleteMany({ where: { role: Role.TEACHER } });
  console.log(`   Deleted ${deleted.count} fake teacher users.\n`);

  // ── Step 6: Create real teachers from EnrollPro data ───────────────────
  console.log('✨ Step 6: Creating real teacher accounts from EnrollPro...');
  const teacherPassword = await bcrypt.hash('DepEd2026!', 10);
  let created = 0;
  let skipped = 0;

  // Map: employeeId → SMART teacher DB id (for adviser re-assignment)
  const empIdToSmartTeacherId = new Map<string, string>();

  for (const t of epTeachers) {
    const employeeId: string = String(t.employeeId ?? '');
    if (!employeeId) { skipped++; continue; }

    // Build email from name if not provided: firstname.lastname@deped.gov.ph
    const rawEmail: string = t.email ?? '';
    const firstName = toTitleCase(t.firstName ?? '');
    const lastName = toTitleCase(t.lastName ?? '');
    const middleName = t.middleName ? toTitleCase(t.middleName) : null;

    // Use employeeId as username (unique, matches login)
    const username = employeeId;
    const email = rawEmail.toLowerCase() || `${employeeId}@deped.gov.ph`;

    try {
      const user = await p.user.create({
        data: {
          username,
          email,
          password: teacherPassword,
          role: Role.TEACHER,
          firstName,
          lastName,
          teacher: {
            create: {
              employeeId,
              specialization: t.specialization ?? null,
            },
          },
        },
        include: { teacher: { select: { id: true } } },
      }) as any;
      empIdToSmartTeacherId.set(employeeId, user.teacher.id);
      created++;
    } catch (err: any) {
      console.warn(`   ⚠ Could not create ${employeeId} (${firstName} ${lastName}): ${err.message}`);
      skipped++;
    }
  }
  console.log(`   ✔ Created: ${created}, Skipped: ${skipped}\n`);

  // ── Step 7: Re-assign section advisers ────────────────────────────────
  console.log('🏫 Step 7: Re-assigning section advisers...');
  const smartSections = await p.section.findMany({ where: { schoolYear: SCHOOL_YEAR } });
  let assignedAdvisers = 0;
  let noAdviser = 0;

  for (const sec of smartSections) {
    const adviserEmpId = sectionNameToAdviserEmpId.get(sec.name);
    if (!adviserEmpId) { noAdviser++; continue; }

    const teacherId = empIdToSmartTeacherId.get(adviserEmpId);
    if (!teacherId) { noAdviser++; continue; }

    await p.section.update({
      where: { id: sec.id },
      data: { adviserId: teacherId },
    });
    assignedAdvisers++;
  }
  console.log(`   ✔ Assigned advisers: ${assignedAdvisers}, No adviser found: ${noAdviser}\n`);

  // ── Summary ─────────────────────────────────────────────────────────────
  const finalTeachers = await p.teacher.count();
  const finalSectionsWithAdviser = await p.section.count({ where: { adviserId: { not: null } } });

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║                        RESULT                            ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  Teachers created:       ${String(created).padEnd(28)} ║`);
  console.log(`║  Sections with adviser:  ${String(finalSectionsWithAdviser).padEnd(28)} ║`);
  console.log(`║  Total teachers in DB:   ${String(finalTeachers).padEnd(28)} ║`);
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // Verify the target teacher
  const sample = await p.teacher.findUnique({
    where: { employeeId: '3179586' },
    include: { user: { select: { email: true, firstName: true, lastName: true } } },
  }) as any;
  if (sample) {
    console.log(`✔ Teacher 3179586 found: ${sample.user.firstName} ${sample.user.lastName} (${sample.user.email})`);
  } else {
    console.log('⚠ Teacher with employeeId 3179586 not found — check EnrollPro data');
    // Print first 3 for reference
    const first3 = await p.teacher.findMany({ take: 3, include: { user: { select: { email: true, firstName: true, lastName: true } } } }) as any[];
    console.log('   Sample teachers:', first3.map((t: any) => `${t.employeeId} → ${t.user.firstName} ${t.user.lastName}`));
  }
}

main()
  .then(() => { (p as any)['$disconnect'](); })
  .catch((e) => { console.error(e); (p as any)['$disconnect'](); process.exit(1); });
