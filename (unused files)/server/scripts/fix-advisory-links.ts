/**
 * fix-advisory-links.ts
 *
 * BULK ADVISORY LINK REPAIR — ATLAS + EnrollPro → SMART Section.adviserId
 *
 * Policy enforced:
 *  • ATLAS /faculty/advisers is the primary authority for advisory assignments.
 *  • EnrollPro /integration/v1/sections (advisingTeacher) is the secondary source.
 *  • SMART Section.adviserId must match the teacher's SMART DB id.
 *
 * What this script does:
 *  1. Fetches all ATLAS advisory assignments from /faculty/advisers.
 *  2. Fetches all EnrollPro section→advisingTeacher mappings.
 *  3. For each advisory assignment found in either source:
 *       a. Resolves the teacher in SMART (by externalId → employeeId → email).
 *       b. Finds or creates the section in SMART.
 *       c. Sets Section.adviserId = teacher.id if it isn't already.
 *  4. Logs "System ID Mismatch" warnings where ATLAS sectionId ≠ EnrollPro sectionId
 *     for the same section name.
 *  5. Reports: fixed count, already-correct count, unresolved count.
 *
 * Usage:
 *   cd server && npx tsx scripts/fix-advisory-links.ts
 *
 * Dry-run mode (no writes):
 *   cd server && DRY_RUN=true npx tsx scripts/fix-advisory-links.ts
 */

import 'dotenv/config';
import http from 'http';
import https from 'https';
import { PrismaClient, GradeLevel } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

// ─── Prisma ──────────────────────────────────────────────────────────────────
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL! });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

// ─── Config ──────────────────────────────────────────────────────────────────
const ATLAS_BASE          = 'http://100.88.55.125:5001/api/v1';
const ATLAS_SCHOOL_ID     = 1;
const ATLAS_SCHOOL_YEAR_ID = 8;
const ENROLLPRO_BASE      = 'https://dev-jegs.buru-degree.ts.net/api';
const SCHOOL_YEAR         = '2026-2027';
const ENROLLPRO_SY_ID     = 8; // Update if EnrollPro school year ID differs
const DRY_RUN             = process.env.DRY_RUN === 'true';

// ─── HTTP helper (http + https) ───────────────────────────────────────────────
function httpGet(url: string, headers: Record<string, string> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request(
      {
        hostname: parsed.hostname,
        port: parseInt(parsed.port) || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers,
      },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          try { resolve(JSON.parse(body)); }
          catch { reject(new Error(`JSON parse failed for ${url}: ${body.slice(0, 200)}`)); }
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function atlasGet(path: string, token: string): Promise<any> {
  return httpGet(`${ATLAS_BASE}${path}`, { Authorization: `Bearer ${token}` });
}

// ─── Grade level mapper ───────────────────────────────────────────────────────
function mapGradeLevel(name: string | null | undefined): GradeLevel | null {
  const n = (name ?? '').toLowerCase();
  if (n.includes('10')) return 'GRADE_10';
  if (n.includes('7'))  return 'GRADE_7';
  if (n.includes('8'))  return 'GRADE_8';
  if (n.includes('9'))  return 'GRADE_9';
  return null;
}

// ─── EnrollPro admin token (cached) ──────────────────────────────────────────
let _cachedToken: string | null = null;

async function getEnrollProToken(): Promise<string> {
  if (_cachedToken) return _cachedToken;

  const accountName = process.env.ENROLLPRO_ACCOUNT_NAME;
  const password    = process.env.ENROLLPRO_PASSWORD;
  if (!accountName || !password) throw new Error('ENROLLPRO_ACCOUNT_NAME / ENROLLPRO_PASSWORD not set');

  const body = JSON.stringify({ accountName, password });
  const token = await new Promise<string>((resolve, reject) => {
    const parsed = new URL(`${ENROLLPRO_BASE}/auth/login`);
    const req = https.request(
      {
        hostname: parsed.hostname,
        port: 443,
        path: parsed.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            const tok = json?.token ?? json?.data?.token ?? json?.accessToken;
            if (!tok) reject(new Error(`No token in EnrollPro login response: ${data.slice(0, 200)}`));
            else resolve(tok);
          } catch { reject(new Error(`EnrollPro login parse failed: ${data.slice(0, 200)}`)); }
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  _cachedToken = token;
  return token;
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const atlasToken = process.env.ATLAS_SYSTEM_TOKEN;
  if (!atlasToken) throw new Error('ATLAS_SYSTEM_TOKEN not set');

  console.log(`\n${'='.repeat(70)}`);
  console.log('  fix-advisory-links.ts — Advisory Link Repair');
  console.log(`  Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE (will write to DB)'}`);
  console.log(`  School Year: ${SCHOOL_YEAR}`);
  console.log(`${'='.repeat(70)}\n`);

  // ── 1. Load ATLAS faculty + advisers ─────────────────────────────────────
  console.log('Fetching ATLAS faculty list...');
  const facultyData = await atlasGet(`/faculty?schoolId=${ATLAS_SCHOOL_ID}`, atlasToken);
  const atlasFaculty: any[] = facultyData?.faculty ?? [];
  console.log(`  → ${atlasFaculty.length} faculty members`);

  console.log('Fetching ATLAS advisory assignments...');
  const advisersData = await atlasGet(
    `/faculty/advisers?schoolId=${ATLAS_SCHOOL_ID}&schoolYearId=${ATLAS_SCHOOL_YEAR_ID}`,
    atlasToken,
  );
  const atlasAdvisers: any[] = advisersData?.advisers ?? advisersData?.data ?? [];
  console.log(`  → ${atlasAdvisers.length} advisory assignments in ATLAS`);

  // ── 2. Load EnrollPro sections ────────────────────────────────────────────
  console.log('Fetching EnrollPro sections...');
  const epToken = await getEnrollProToken();
  const epSectionsData = await httpGet(
    `${ENROLLPRO_BASE}/integration/v1/sections?schoolYearId=${ENROLLPRO_SY_ID}`,
    { Authorization: `Bearer ${epToken}` },
  );
  const epSections: any[] = epSectionsData?.data ?? [];
  console.log(`  → ${epSections.length} sections in EnrollPro`);

  // Build lookup maps
  const epSectionById  = new Map<number, any>(epSections.map((s: any) => [Number(s.id), s]));
  const epSectionByName = new Map<string, any[]>();
  for (const s of epSections) {
    const key = (s.name ?? '').trim();
    if (!key) continue;
    const list = epSectionByName.get(key) ?? [];
    list.push(s);
    epSectionByName.set(key, list);
  }

  // Build ATLAS facultyId → member map
  const atlasMemberById = new Map<number, any>(atlasFaculty.map((f: any) => [Number(f.id), f]));

  // ── 3. Load SMART teachers + sections ────────────────────────────────────
  console.log('Loading SMART teachers and sections...');
  const smartTeachers = await prisma.teacher.findMany({
    include: { user: { select: { email: true, firstName: true, lastName: true } } },
  });
  const smartSections = await prisma.section.findMany({ where: { schoolYear: SCHOOL_YEAR } });

  const smartTeacherByEmployeeId = new Map(smartTeachers.map((t) => [String(t.employeeId ?? '').trim(), t]));
  const smartTeacherByEmail      = new Map(
    smartTeachers.map((t) => [(t.user.email ?? '').toLowerCase(), t]),
  );
  const smartSectionByName       = new Map(smartSections.map((s) => [s.name.trim(), s]));

  // Helper: find SMART teacher for an ATLAS faculty member
  function resolveSmartTeacher(atlasMember: any) {
    // Try externalId (EnrollPro integer teacherId)
    if (atlasMember.externalId) {
      // Look up in EnrollPro by externalId to get employeeId
      const epTeacherIdStr = String(atlasMember.externalId);
      // externalId = EP teacher integer ID, not employeeId.
      // We rely on employeeId stored in SMART teacher records.
      // Actually try direct employeeId match via externalId = employeeId fallback
    }

    // Try by email (most reliable cross-system match)
    const email = (atlasMember.contactInfo ?? '').toLowerCase();
    if (email) {
      const byEmail = smartTeacherByEmail.get(email);
      if (byEmail) return byEmail;
    }

    // Try by employeeId stored as externalId
    const extId = String(atlasMember.externalId ?? '').trim();
    if (extId) {
      const byEmpId = smartTeacherByEmployeeId.get(extId);
      if (byEmpId) return byEmpId;
    }

    return null;
  }

  // ── 4. Section ID mismatch check ─────────────────────────────────────────
  console.log('\n── Section ID Cross-Check (ATLAS sectionId vs EnrollPro sectionId) ──────');
  let mismatchCount = 0;
  for (const adviser of atlasAdvisers) {
    const atlasSectionId = Number(adviser.sectionId ?? adviser.advisorySectionId ?? 0);
    const sectionName    = (adviser.sectionName ?? adviser.advisorySectionName ?? '').trim();
    if (!atlasSectionId || !sectionName) continue;

    const epSection = epSectionById.get(atlasSectionId);
    if (!epSection) {
      // ATLAS sectionId not found in EnrollPro by ID — check by name
      const epByName = epSectionByName.get(sectionName);
      if (epByName && epByName.length > 0) {
        const epId = Number(epByName[0].id);
        if (epId !== atlasSectionId) {
          console.warn(
            `  ⚠ System ID Mismatch: Section "${sectionName}" — ` +
            `ATLAS sectionId=${atlasSectionId} vs EnrollPro sectionId=${epId}`,
          );
          mismatchCount++;
        }
      } else {
        console.warn(
          `  ⚠ System ID Mismatch: ATLAS sectionId=${atlasSectionId} ("${sectionName}") ` +
          `not found in EnrollPro by ID or name`,
        );
        mismatchCount++;
      }
    }
  }
  if (mismatchCount === 0) {
    console.log('  ✓ No section ID mismatches detected');
  }

  // ── 5. Process ATLAS advisory assignments ────────────────────────────────
  console.log('\n── Processing Advisory Assignments ─────────────────────────────────────');

  let fixed         = 0;
  let alreadyCorrect = 0;
  let unresolved    = 0;
  const unresolvedLog: string[] = [];

  for (const adviser of atlasAdvisers) {
    const atlasFacultyId = Number(adviser.facultyId ?? adviser.teacherId ?? 0);
    const sectionName    = (adviser.sectionName ?? adviser.advisorySectionName ?? '').trim();
    const gradeLevelRaw  = (adviser.gradeLevelName ?? adviser.sectionName ?? '').trim();

    if (!atlasFacultyId || !sectionName) {
      console.log(`  ⚠ Skipping adviser record missing facultyId or sectionName: ${JSON.stringify(adviser)}`);
      unresolved++;
      continue;
    }

    const atlasMember = atlasMemberById.get(atlasFacultyId);
    if (!atlasMember) {
      const msg = `ATLAS facultyId=${atlasFacultyId} not found in /faculty list`;
      console.log(`  ⚠ ${msg}`);
      unresolvedLog.push(msg);
      unresolved++;
      continue;
    }

    const smartTeacher = resolveSmartTeacher(atlasMember);
    if (!smartTeacher) {
      const msg =
        `ATLAS facultyId=${atlasFacultyId} (${atlasMember.contactInfo ?? 'no email'}) ` +
        `not matched to any SMART teacher`;
      console.log(`  ⚠ ${msg}`);
      unresolvedLog.push(msg);
      unresolved++;
      continue;
    }

    const gradeLevel = mapGradeLevel(gradeLevelRaw);
    if (!gradeLevel) {
      const msg = `Cannot determine grade level from "${gradeLevelRaw}" for section "${sectionName}"`;
      console.log(`  ⚠ ${msg}`);
      unresolvedLog.push(msg);
      unresolved++;
      continue;
    }

    // Find or create section in SMART
    let smartSection = smartSectionByName.get(sectionName);
    if (!smartSection) {
      if (DRY_RUN) {
        console.log(`  [DRY RUN] Would create section "${sectionName}" (${gradeLevel})`);
        unresolved++;
        continue;
      }
      try {
        smartSection = await prisma.section.upsert({
          where: { name_gradeLevel_schoolYear: { name: sectionName, gradeLevel, schoolYear: SCHOOL_YEAR } },
          update: { adviserId: smartTeacher.id },
          create: { name: sectionName, gradeLevel, schoolYear: SCHOOL_YEAR, adviserId: smartTeacher.id },
        });
        smartSectionByName.set(sectionName, smartSection);
        console.log(
          `  ✓ Created section "${sectionName}" with adviserId=${smartTeacher.id} ` +
          `(${smartTeacher.user.firstName} ${smartTeacher.user.lastName})`,
        );
        fixed++;
        continue;
      } catch (err: any) {
        const msg = `Failed to create section "${sectionName}": ${err.message}`;
        console.log(`  ✗ ${msg}`);
        unresolvedLog.push(msg);
        unresolved++;
        continue;
      }
    }

    // Section exists — check adviserId
    if (smartSection.adviserId === smartTeacher.id) {
      console.log(
        `  ✓ Already correct: "${sectionName}" → adviserId=${smartTeacher.id} ` +
        `(${smartTeacher.user.firstName} ${smartTeacher.user.lastName})`,
      );
      alreadyCorrect++;
      continue;
    }

    // Need to update
    const prevAdviser = smartSection.adviserId;
    if (DRY_RUN) {
      console.log(
        `  [DRY RUN] Would set "${sectionName}" adviserId: ` +
        `${prevAdviser ?? 'null'} → ${smartTeacher.id} ` +
        `(${smartTeacher.user.firstName} ${smartTeacher.user.lastName})`,
      );
      fixed++;
    } else {
      try {
        await prisma.section.update({
          where: { id: smartSection.id },
          data: { adviserId: smartTeacher.id },
        });
        console.log(
          `  ✓ Fixed: "${sectionName}" adviserId: ${prevAdviser ?? 'null'} → ` +
          `${smartTeacher.id} (${smartTeacher.user.firstName} ${smartTeacher.user.lastName})`,
        );
        smartSection.adviserId = smartTeacher.id;
        fixed++;
      } catch (err: any) {
        const msg = `Failed to update section "${sectionName}": ${err.message}`;
        console.log(`  ✗ ${msg}`);
        unresolvedLog.push(msg);
        unresolved++;
      }
    }
  }

  // ── 6. EnrollPro advisory cross-check ────────────────────────────────────
  // Sections in EnrollPro that have an advisingTeacher but no ATLAS adviser record
  console.log('\n── EnrollPro Advisory Cross-Check ──────────────────────────────────────');
  const atlasAdvisedSectionNames = new Set(
    atlasAdvisers.map((a: any) => (a.sectionName ?? a.advisorySectionName ?? '').trim()),
  );
  let epOnlyAdvisory = 0;
  for (const epSection of epSections) {
    if (!epSection.advisingTeacher?.id) continue;
    const name = (epSection.name ?? '').trim();
    if (!atlasAdvisedSectionNames.has(name)) {
      console.log(
        `  ℹ EnrollPro-only advisory: section "${name}" has advisingTeacher.id=${epSection.advisingTeacher.id} ` +
        `but no matching ATLAS adviser record`,
      );
      epOnlyAdvisory++;
    }
  }
  if (epOnlyAdvisory === 0) {
    console.log('  ✓ All EnrollPro advisory sections are also present in ATLAS');
  }

  // ── 7. Summary ───────────────────────────────────────────────────────────
  console.log(`\n${'='.repeat(70)}`);
  console.log('  SUMMARY');
  console.log(`${'='.repeat(70)}`);
  console.log(`  Section ID mismatches detected : ${mismatchCount}`);
  console.log(`  Advisory links already correct  : ${alreadyCorrect}`);
  console.log(`  Advisory links fixed            : ${fixed}${DRY_RUN ? ' (dry run — no writes)' : ''}`);
  console.log(`  Unresolved / skipped            : ${unresolved}`);
  console.log(`  EnrollPro-only advisories       : ${epOnlyAdvisory}`);

  if (unresolvedLog.length > 0) {
    console.log('\n  Unresolved detail:');
    unresolvedLog.forEach((msg) => console.log(`    • ${msg}`));
  }

  if (DRY_RUN && fixed > 0) {
    console.log('\n  Re-run without DRY_RUN=true to apply the fixes above.');
  }

  console.log('');
  await prisma.$disconnect();
  await pool.end();
}

main().catch((err) => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
