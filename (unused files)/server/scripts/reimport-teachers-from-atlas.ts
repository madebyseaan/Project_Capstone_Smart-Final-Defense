/**
 * reimport-teachers-from-atlas.ts
 *
 * Re-imports ALL teachers from ATLAS (which has the faculty + assignment data).
 * EnrollPro and ATLAS have different teacher sets — ATLAS is the correct source
 * for SMART since SMART needs to display teaching assignments from ATLAS.
 *
 * Steps:
 *  1. Fetch 142 faculty from ATLAS (schoolId=1) — these have contactInfo=email
 *  2. Clear section advisers
 *  3. Delete all current TEACHER users
 *  4. Create real teacher users from ATLAS faculty data
 *  5. Re-assign section advisers using ATLAS section adviser data
 */
import 'dotenv/config';
import http from 'http';
import https from 'https';
import bcrypt from 'bcryptjs';
import { PrismaClient, Role } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const p = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) } as any);

const ATLAS_BASE = 'http://100.88.55.125:5001/api/v1';
const ATLAS_SCHOOL_ID = 1;
const SCHOOL_YEAR_ID = 8;
const SCHOOL_YEAR = '2026-2027';

function httpGet(url: string, headers: Record<string, string>): Promise<any> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    (lib as any).get(url, { headers } as any, (res: any) => {
      let body = '';
      res.on('data', (c: any) => body += c);
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}: ${body.substring(0, 200)}`));
        try { resolve(JSON.parse(body)); } catch { reject(new Error(body.substring(0, 200))); }
      });
    }).on('error', reject)
      .setTimeout(20000, function (this: any) { this.destroy(); reject(new Error(`Timeout: ${url}`)); });
  });
}

function toTitleCase(s: string): string {
  return (s ?? '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║   SMART — Re-import Teachers from ATLAS                  ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  const atlasToken = process.env.ATLAS_SYSTEM_TOKEN;
  if (!atlasToken) throw new Error('ATLAS_SYSTEM_TOKEN not set in .env');
  const authHeader = { Authorization: `Bearer ${atlasToken}` };

  // ── Step 1: Fetch ATLAS faculty ─────────────────────────────────────────
  console.log('👩‍🏫 Step 1: Fetching faculty from ATLAS...');
  const facultyData = await httpGet(`${ATLAS_BASE}/faculty?schoolId=${ATLAS_SCHOOL_ID}`, authHeader);
  const atlasFaculty: any[] = facultyData.faculty ?? [];
  console.log(`   Found ${atlasFaculty.length} faculty in ATLAS.\n`);
  if (atlasFaculty.length === 0) throw new Error('No faculty returned from ATLAS');

  // ── Step 2: Fetch ATLAS sections to get adviser mapping ─────────────────
  console.log('📚 Step 2: Fetching section adviser info from ATLAS...');
  // ATLAS section data is embedded in the faculty's /faculty-assignments summaries
  // and also available via the section data. We'll build adviser mapping from
  // the faculty?schoolId=1 response which has isClassAdviser + advisorySectionId.
  // Each faculty has advisorySectionId if isClassAdviser=true.
  const adviserFaculty = atlasFaculty.filter((f: any) => f.isClassAdviser);
  console.log(`   Faculty who are class advisers: ${adviserFaculty.length}`);
  
  // We need the section names. Fetch EnrollPro sections for section name lookup.
  // ATLAS sections endpoint: try /sections?schoolId=1&schoolYearId=8
  let atlasSections: any[] = [];
  try {
    const secResp = await httpGet(`${ATLAS_BASE}/sections?schoolId=${ATLAS_SCHOOL_ID}&schoolYearId=${SCHOOL_YEAR_ID}`, authHeader);
    atlasSections = secResp.sections ?? secResp.data ?? [];
    console.log(`   ATLAS sections: ${atlasSections.length}`);
  } catch (e: any) {
    console.log(`   Could not fetch ATLAS sections: ${e.message}`);
  }
  console.log();

  // ── Step 3: Clear section advisers ─────────────────────────────────────
  console.log('🔄 Step 3: Clearing current section advisers...');
  const cleared = await p.section.updateMany({ data: { adviserId: null } });
  console.log(`   Cleared ${cleared.count} sections.\n`);

  // ── Step 4: Delete all TEACHER users ───────────────────────────────────
  console.log('🗑️  Step 4: Deleting existing teacher accounts...');
  const deleted = await p.user.deleteMany({ where: { role: Role.TEACHER } });
  console.log(`   Deleted ${deleted.count} teacher accounts.\n`);

  // ── Step 5: Create teacher accounts from ATLAS ─────────────────────────
  console.log('✨ Step 5: Creating teacher accounts from ATLAS...');
  const teacherPassword = await bcrypt.hash('DepEd2026!', 10);
  let created = 0;
  let skipped = 0;
  const atlasIdToSmartTeacherId = new Map<number, string>();
  const emailToSmartTeacherId = new Map<string, string>();

  for (const af of atlasFaculty) {
    const email: string = (af.contactInfo ?? '').toLowerCase();
    if (!email || !email.includes('@')) {
      console.warn(`   ⚠ Faculty ${af.id} has no email, skipping.`);
      skipped++;
      continue;
    }

    const username = email.split('@')[0];
    const firstName = toTitleCase(af.firstName ?? '');
    const lastName = toTitleCase(af.lastName ?? '');
    // Use externalId as employeeId (links to EnrollPro), fall back to ATLAS id
    const employeeId = String(af.externalId ?? af.id);

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
              specialization: af.department ?? null,
            },
          },
        },
        include: { teacher: { select: { id: true } } },
      }) as any;
      atlasIdToSmartTeacherId.set(af.id, user.teacher.id);
      emailToSmartTeacherId.set(email, user.teacher.id);
      created++;
    } catch (err: any) {
      console.warn(`   ⚠ Could not create ${email}: ${err.message}`);
      skipped++;
    }
  }
  console.log(`   ✔ Created: ${created}, Skipped: ${skipped}\n`);

  // ── Step 6: Re-assign section advisers ────────────────────────────────
  console.log('🏫 Step 6: Re-assigning section advisers...');
  let assignedAdvisers = 0;
  let noAdviserFound = 0;

  // Build section name → SMART section map
  const smartSections = await p.section.findMany({ where: { schoolYear: SCHOOL_YEAR } });
  const sectionByName = new Map(smartSections.map((s: any) => [s.name, s]));

  if (atlasSections.length > 0) {
    // Use ATLAS section data: each section has adviserId (ATLAS faculty id)
    for (const sec of atlasSections) {
      const smartSec = sectionByName.get(sec.name);
      if (!smartSec) { noAdviserFound++; continue; }
      if (!sec.adviserId) { noAdviserFound++; continue; }
      // sec.adviserId is an ATLAS internal ID — won't match directly
      // We need to find the SMART teacherId for this ATLAS faculty
      // ATLAS section adviserId refers to EnrollPro teacherId (externalId system)
      // Try matching by adviserName
      if (sec.adviserName) {
        const parts = sec.adviserName.trim().split(' ');
        const lastName = parts[0];
        const firstName = parts.length > 1 ? parts[1] : '';
        // Find matching ATLAS faculty
        const adviserFac = atlasFaculty.find((f: any) =>
          f.lastName?.toUpperCase() === lastName.toUpperCase() &&
          f.firstName?.toUpperCase() === firstName.toUpperCase()
        );
        if (adviserFac) {
          const tid = atlasIdToSmartTeacherId.get(adviserFac.id);
          if (tid) {
            await p.section.update({ where: { id: smartSec.id }, data: { adviserId: tid } });
            assignedAdvisers++;
            continue;
          }
        }
      }
      noAdviserFound++;
    }
  } else {
    // Fallback: use ATLAS faculty isClassAdviser + advisorySectionId
    // Build a map of ATLAS section id → section name by fetching each adviser's assignment
    console.log('   Using ATLAS faculty advisory assignments...');
    for (const af of adviserFaculty) {
      if (!af.advisorySectionId) continue;
      try {
        const detail = await httpGet(
          `${ATLAS_BASE}/faculty-assignments/${af.id}?schoolYearId=${SCHOOL_YEAR_ID}`,
          authHeader
        );
        // Each adviser is linked to sections they advise — find sections where they're adviser
        // This is complex; skip for now and use advisorySectionName if available
        if (af.advisorySectionName) {
          const smartSec = sectionByName.get(af.advisorySectionName);
          if (smartSec) {
            const tid = atlasIdToSmartTeacherId.get(af.id);
            if (tid) {
              await p.section.update({ where: { id: smartSec.id }, data: { adviserId: tid } });
              assignedAdvisers++;
            } else { noAdviserFound++; }
          } else { noAdviserFound++; }
        }
      } catch { noAdviserFound++; }
    }
  }
  console.log(`   ✔ Assigned: ${assignedAdvisers}, Not found: ${noAdviserFound}\n`);

  // ── Summary ─────────────────────────────────────────────────────────────
  const finalTeachers = await p.teacher.count();
  const finalAdvisers = await p.section.count({ where: { adviserId: { not: null } } });

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║                        RESULT                            ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  Teachers created:       ${String(created).padEnd(28)} ║`);
  console.log(`║  Sections with adviser:  ${String(finalAdvisers).padEnd(28)} ║`);
  console.log(`║  Total teachers in DB:   ${String(finalTeachers).padEnd(28)} ║`);
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // Verify Miguel Valdez
  const miguel = await p.user.findFirst({
    where: { email: 'miguel.valdez@deped.edu.ph' },
    include: { teacher: true },
  }) as any;
  console.log(miguel
    ? `✔ Miguel Valdez: username=${miguel.username}, empId=${miguel.teacher?.employeeId}`
    : '⚠ Miguel Valdez not in SMART (not in ATLAS faculty list?)'
  );
}

main().then(() => p['$disconnect']()).catch(console.error);
