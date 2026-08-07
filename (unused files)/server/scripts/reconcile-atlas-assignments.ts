/**
 * reconcile-atlas-assignments.ts
 *
 * UNIVERSAL DB RECONCILIATION — ATLAS ↔ SMART ClassAssignment table.
 *
 * Policy enforced:
 *  • ATLAS is the Master of Subjects.
 *  • EnrollPro is the Master of People (students only).
 *  • No subject assignment may exist in SMART unless it is backed by ATLAS data.
 *
 * What this script does:
 *  1. Fetches the complete teaching load from ATLAS for every matched teacher.
 *  2. Rebuilds the expected set of (teacher, subject, section) triples.
 *  3. Deletes any SMART ClassAssignment not present in the ATLAS truth set ("ghost" records).
 *  4. Creates any ATLAS-backed assignment that is missing from SMART.
 *  5. Logs every MISSING SUBJECT MAPPING so an Admin/Registrar knows which
 *     ATLAS subject codes need to be added to the SMART subjects table.
 *
 * Usage:
 *   cd server && npx tsx scripts/reconcile-atlas-assignments.ts
 *
 * Dry-run mode (no writes):
 *   cd server && DRY_RUN=true npx tsx scripts/reconcile-atlas-assignments.ts
 */

import 'dotenv/config';
import http from 'http';
import { PrismaClient, GradeLevel } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

// ─── Prisma ──────────────────────────────────────────────────────────────────
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL! });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

// ─── Config ──────────────────────────────────────────────────────────────────
const ATLAS_BASE      = 'http://100.88.55.125:5001/api/v1';
const ATLAS_SCHOOL_ID = 1;
const SCHOOL_YEAR_ID  = 8;
const SCHOOL_YEAR     = '2026-2027';
const DRY_RUN         = process.env.DRY_RUN === 'true';

// ─── ATLAS subject-code → SMART subject-code overrides ───────────────────────
const ATLAS_SUBJECT_OVERRIDES: Record<string, string> = {
  'ENV_SCI7':                'ENVIRONMENTAL_SCIENCE7',
  'ENV_SCI8':                'ENVIRONMENTAL_SCIENCE7',
  'ENV_SCI9':                'ENVIRONMENTAL_SCIENCE7',
  'ENV_SCI10':               'ENVIRONMENTAL_SCIENCE7',
  'ENVIRONMENTAL_SCIENCE8':  'ENVIRONMENTAL_SCIENCE7',
  'ENVIRONMENTAL_SCIENCE9':  'ENVIRONMENTAL_SCIENCE7',
  'ENVIRONMENTAL_SCIENCE10': 'ENVIRONMENTAL_SCIENCE7',
};

function resolveSubjectCode(atlasCode: string, gradeLevel: GradeLevel): string {
  const suffix = gradeLevel.replace('GRADE_', '');
  const withSuffix = atlasCode + suffix;
  return ATLAS_SUBJECT_OVERRIDES[withSuffix] ?? withSuffix;
}

function mapGradeLevel(name: string | null | undefined): GradeLevel | null {
  const n = (name ?? '').toLowerCase();
  if (n.includes('10')) return 'GRADE_10';
  if (n.includes('7'))  return 'GRADE_7';
  if (n.includes('8'))  return 'GRADE_8';
  if (n.includes('9'))  return 'GRADE_9';
  return null;
}

// ─── HTTP helper ─────────────────────────────────────────────────────────────
function atlasGet(path: string, token: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${ATLAS_BASE}${path}`);
    const req = http.request(
      {
        hostname: url.hostname,
        port: parseInt(url.port) || 80,
        path: url.pathname + url.search,
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      },
      (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => {
          if (res.statusCode === 404) { resolve(null); return; }
          if (res.statusCode && res.statusCode >= 400) { resolve(null); return; }
          try { resolve(JSON.parse(b)); }
          catch { reject(new Error(`Atlas JSON parse error ${path}`)); }
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error(`Atlas timeout ${path}`)));
    req.end();
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const atlasToken = process.env.ATLAS_SYSTEM_TOKEN;
  if (!atlasToken) {
    console.error('[Reconcile] ATLAS_SYSTEM_TOKEN is not set. Cannot fetch ATLAS data.');
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log('[Reconcile] *** DRY RUN MODE — no writes will occur ***');
  }

  console.log(`[Reconcile] Starting ATLAS ↔ SMART reconciliation for school year ${SCHOOL_YEAR}...`);
  console.log(`[Reconcile] ATLAS is the Master of Subjects. EnrollPro label inference is DISABLED.`);

  // ── Load SMART reference data ─────────────────────────────────────────────
  const [allSubjects, allSections, allTeacherUsers] = await Promise.all([
    prisma.subject.findMany({ select: { id: true, code: true, name: true } }),
    prisma.section.findMany({ where: { schoolYear: SCHOOL_YEAR }, select: { id: true, name: true, gradeLevel: true } }),
    prisma.user.findMany({
      where: { role: 'TEACHER' },
      select: { email: true, teacher: { select: { id: true, employeeId: true } } },
    }),
  ]);

  const subjectByCode  = new Map(allSubjects.map(s => [s.code, s]));
  const sectionByName  = new Map(allSections.map(s => [s.name.trim(), s]));

  // email → SMART teacherId
  const emailToTeacherId = new Map<string, string>();
  for (const u of allTeacherUsers) {
    if (u.teacher?.id && u.email) emailToTeacherId.set(u.email.toLowerCase(), u.teacher.id);
  }

  // ── Fetch ATLAS faculty list ──────────────────────────────────────────────
  const facultyData = await atlasGet(`/faculty?schoolId=${ATLAS_SCHOOL_ID}`, atlasToken);
  const atlasFaculty: any[] = facultyData?.faculty ?? [];
  console.log(`[Reconcile] ATLAS faculty count: ${atlasFaculty.length}`);

  // Build atlas faculty ID → SMART teacher ID
  const atlasIdToSmartTeacherId = new Map<number, string>();
  for (const af of atlasFaculty) {
    const email = (af.contactInfo ?? '').toLowerCase();
    const tid = emailToTeacherId.get(email);
    if (tid) atlasIdToSmartTeacherId.set(af.id, tid);
  }

  // ── Build expected set from ATLAS ─────────────────────────────────────────
  // Key format: `${teacherId}|${subjectId}|${sectionId}`
  const expectedSet = new Set<string>();

  // Tracks: unresolved Atlas codes that have no SMART subject
  const missingSubjectMappings = new Map<string, { atlasCode: string; resolved: string; sections: string[] }>();

  // Tracks: Atlas sections not found in SMART
  const missingSections = new Set<string>();

  let atlasTeachersProcessed = 0;

  for (const af of atlasFaculty) {
    const smartTeacherId = atlasIdToSmartTeacherId.get(af.id);
    if (!smartTeacherId) continue; // ATLAS faculty not matched to any SMART teacher

    try {
      const detail = await atlasGet(
        `/faculty-assignments/${af.id}?schoolYearId=${SCHOOL_YEAR_ID}`,
        atlasToken,
      );
      const assignments: any[] = detail?.assignments ?? [];
      if (assignments.length === 0) continue;

      atlasTeachersProcessed++;

      for (const a of assignments) {
        const atlasCode: string = a.subject?.code ?? '';
        const atlasSections: any[] = a.sections ?? [];

        for (const sec of atlasSections) {
          const gradeLevel = mapGradeLevel(sec.gradeLevelName ?? sec.name);
          if (!gradeLevel) continue;

          const section = sectionByName.get(sec.name?.trim());
          if (!section) {
            missingSections.add(sec.name);
            continue;
          }

          const smartCode = resolveSubjectCode(atlasCode, gradeLevel);
          const subject = subjectByCode.get(smartCode) ?? subjectByCode.get(atlasCode);

          if (!subject) {
            const key = `${atlasCode}|${gradeLevel}`;
            const existing = missingSubjectMappings.get(key);
            if (existing) {
              existing.sections.push(sec.name);
            } else {
              missingSubjectMappings.set(key, {
                atlasCode,
                resolved: smartCode,
                sections: [sec.name],
              });
            }
            continue; // Cannot create — subject not in SMART
          }

          expectedSet.add(`${smartTeacherId}|${subject.id}|${section.id}`);
        }
      }
    } catch (err: any) {
      console.warn(`[Reconcile] Could not fetch assignments for ATLAS faculty ${af.id}: ${err.message}`);
    }
  }

  console.log(`[Reconcile] ATLAS teachers processed: ${atlasTeachersProcessed}`);
  console.log(`[Reconcile] Expected assignments from ATLAS: ${expectedSet.size}`);

  // ── Load current SMART assignments for the school year ───────────────────
  const currentAssignments = await prisma.classAssignment.findMany({
    where: { schoolYear: SCHOOL_YEAR },
    select: { id: true, teacherId: true, subjectId: true, sectionId: true },
  });

  console.log(`[Reconcile] Current SMART assignments: ${currentAssignments.length}`);

  // ── Identify ghost assignments (in SMART, not backed by ATLAS) ────────────
  const ghostIds: string[] = [];
  for (const ca of currentAssignments) {
    const key = `${ca.teacherId}|${ca.subjectId}|${ca.sectionId}`;
    if (!expectedSet.has(key)) {
      ghostIds.push(ca.id);
    }
  }

  // ── Identify missing assignments (in ATLAS, not yet in SMART) ─────────────
  const existingKeys = new Set(
    currentAssignments.map(ca => `${ca.teacherId}|${ca.subjectId}|${ca.sectionId}`)
  );
  const missingTriples: Array<{ teacherId: string; subjectId: string; sectionId: string }> = [];
  for (const key of expectedSet) {
    if (!existingKeys.has(key)) {
      const [teacherId, subjectId, sectionId] = key.split('|');
      missingTriples.push({ teacherId, subjectId, sectionId });
    }
  }

  // ── Report ────────────────────────────────────────────────────────────────
  console.log(`\n[Reconcile] ═══════════════════════════════════════════════════`);
  console.log(`[Reconcile] GHOST assignments to DELETE:   ${ghostIds.length}`);
  console.log(`[Reconcile] MISSING assignments to CREATE: ${missingTriples.length}`);

  if (missingSubjectMappings.size > 0) {
    console.warn(`\n[Reconcile] ⚠  MISSING SUBJECT MAPPINGS (${missingSubjectMappings.size}) ─────────────`);
    console.warn(`[Reconcile]    These Atlas subject codes have no matching subject in SMART.`);
    console.warn(`[Reconcile]    Add them to the SMART subjects table to enable those assignments.\n`);
    for (const [, info] of missingSubjectMappings) {
      console.warn(
        `[Reconcile]    Atlas code "${info.atlasCode}" (resolved "${info.resolved}") ` +
        `→ affects sections: ${info.sections.slice(0, 5).join(', ')}${info.sections.length > 5 ? ` +${info.sections.length - 5} more` : ''}`,
      );
    }
  }

  if (missingSections.size > 0) {
    console.warn(`\n[Reconcile] ⚠  MISSING SECTIONS in SMART (${missingSections.size}) ─────────────────`);
    console.warn(`[Reconcile]    These ATLAS sections were not found in SMART. Run a full Atlas sync first.`);
    for (const name of missingSections) {
      console.warn(`[Reconcile]    Section: "${name}"`);
    }
  }

  if (DRY_RUN) {
    console.log(`\n[Reconcile] DRY RUN complete — no changes written.`);
    return;
  }

  // ── Execute deletes ───────────────────────────────────────────────────────
  let deleted = 0;
  if (ghostIds.length > 0) {
    // Delete in batches to avoid hitting query-parameter limits
    const BATCH = 500;
    for (let i = 0; i < ghostIds.length; i += BATCH) {
      const batch = ghostIds.slice(i, i + BATCH);
      const result = await prisma.classAssignment.deleteMany({ where: { id: { in: batch } } });
      deleted += result.count;
    }
    console.log(`\n[Reconcile] ✓ Deleted ${deleted} ghost assignment(s).`);
  }

  // ── Execute creates ───────────────────────────────────────────────────────
  let created = 0;
  for (const triple of missingTriples) {
    try {
      await prisma.classAssignment.create({
        data: {
          teacherId: triple.teacherId,
          subjectId: triple.subjectId,
          sectionId: triple.sectionId,
          schoolYear: SCHOOL_YEAR,
        },
      });
      created++;
    } catch {
      // Duplicate or constraint violation — safe to ignore
    }
  }
  if (created > 0) {
    console.log(`[Reconcile] ✓ Created ${created} missing assignment(s).`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n[Reconcile] ═══════════════════════════════════════════════════`);
  console.log(`[Reconcile] Reconciliation complete.`);
  console.log(`[Reconcile]   Ghost records deleted : ${deleted}`);
  console.log(`[Reconcile]   Missing records added : ${created}`);
  console.log(`[Reconcile]   Missing subject codes : ${missingSubjectMappings.size}`);
  console.log(`[Reconcile]   Missing sections       : ${missingSections.size}`);
  if (missingSubjectMappings.size > 0) {
    console.warn(`[Reconcile] ⚠  Action required: add the missing subject codes listed above to SMART.`);
  }
}

main()
  .catch((err) => {
    console.error('[Reconcile] Fatal error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
