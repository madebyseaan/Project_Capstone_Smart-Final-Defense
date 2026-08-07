require('dotenv').config();
const http = require('http');
const https = require('https');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const ATLAS_BASE = 'http://100.88.55.125:5001/api/v1';
const ATLAS_SCHOOL_ID = 1;
const ATLAS_SCHOOL_YEAR_ID = Number.parseInt(process.env.ATLAS_SCHOOL_YEAR_ID || '8', 10);

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 300)}`));
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error(`Invalid JSON from ${url}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => {
      req.destroy();
      reject(new Error(`Timeout: ${url}`));
    });
  });
}

function mapGradeLevel(raw) {
  const s = String(raw || '').toLowerCase();
  if (s.includes('grade 7') || s.endsWith('7')) return 'GRADE_7';
  if (s.includes('grade 8') || s.endsWith('8')) return 'GRADE_8';
  if (s.includes('grade 9') || s.endsWith('9')) return 'GRADE_9';
  if (s.includes('grade 10') || s.endsWith('10')) return 'GRADE_10';
  return null;
}

function resolveSubjectCode(subjectCode, gradeLevel) {
  const code = String(subjectCode || '').trim().toUpperCase();
  const glNum = String(gradeLevel || '').replace('GRADE_', '');

  if (code === 'SCI_BIO') return `SCI_BIO${glNum}`;
  if (code === 'SCI_CHEM') return `SCI_CHEM${glNum}`;
  if (code === 'SCI_ES') return `SCI_ES${glNum}`;
  if (code === 'SCI_PHYS') return `SCI_PHYS${glNum}`;
  if (code === 'HG') return `HG${glNum}`;
  if (code.startsWith('STE_')) return `${code}${glNum}`;
  return code;
}

async function main() {
  const token = process.env.ATLAS_SYSTEM_TOKEN;
  if (!token) throw new Error('ATLAS_SYSTEM_TOKEN missing');
  const headers = { Authorization: `Bearer ${token}` };

  const facultyData = await get(`${ATLAS_BASE}/faculty?schoolId=${ATLAS_SCHOOL_ID}`, headers);
  const faculty = facultyData.faculty || [];
  const atlasFaculty = faculty.find((f) =>
    String(f.firstName || '').toLowerCase().includes('elpidio') &&
    String(f.lastName || '').toLowerCase().includes('aquino')
  );
  if (!atlasFaculty) throw new Error('Elpidio Aquino not found in ATLAS faculty');

  const teacher = await prisma.teacher.findFirst({
    where: { user: { firstName: { contains: 'Elpidio' }, lastName: { contains: 'Aquino' } } },
    include: { user: true },
  });
  if (!teacher) throw new Error('Elpidio Aquino not found in SMART teacher table');

  const settings = await prisma.systemSettings.findUnique({ where: { id: 'main' } });
  const sy = settings?.currentSchoolYear || '2026-2027';

  const epScoped = await get(`https://dev-jegs.buru-degree.ts.net/api/integration/v1/sections?schoolYearId=55&limit=500`);
  const epUnscoped = await get(`https://dev-jegs.buru-degree.ts.net/api/integration/v1/sections?limit=500`);
  const epSections = [...(epScoped.data || []), ...(epUnscoped.data || [])];
  const epById = new Map(epSections.map((s) => [Number(s.id), s]));

  const localSections = await prisma.section.findMany({ where: { schoolYear: sy } });
  const localByKey = new Map(localSections.map((s) => [`${s.name.trim()}:${s.gradeLevel}`, s]));

  const facultySubjects = Array.isArray(atlasFaculty.facultySubjects) ? atlasFaculty.facultySubjects : [];
  const expected = [];
  for (const fs of facultySubjects) {
    const rawCode = String(fs?.subject?.code || '').trim().toUpperCase();
    const sids = Array.isArray(fs?.sectionIds) ? fs.sectionIds : [];
    for (const sid of sids) {
      const ep = epById.get(Number(sid));
      const epName = ep?.name;
      const epGl = mapGradeLevel(ep?.gradeLevel?.name || ep?.gradeLevelName || ep?.name);
      const smartCode = epGl ? resolveSubjectCode(rawCode, epGl) : null;
      const secKey = epName && epGl ? `${epName.trim()}:${epGl}` : null;
      const localSection = secKey ? localByKey.get(secKey) : null;
      expected.push({ rawCode, sid: Number(sid), epName: epName || null, epGrade: epGl, smartCode, secKey, localSectionId: localSection?.id || null });
    }
  }

  const smartAssignments = await prisma.classAssignment.findMany({
    where: { teacherId: teacher.id, schoolYear: sy, isActive: true },
    include: { subject: true, section: true },
  });
  const smartKeys = new Set(smartAssignments.map((a) => `${a.subject.code}:${a.section.id}`));

  const status = expected.map((e) => ({
    ...e,
    smartKey: e.smartCode && e.localSectionId ? `${e.smartCode}:${e.localSectionId}` : null,
    existsInSMART: e.smartCode && e.localSectionId ? smartKeys.has(`${e.smartCode}:${e.localSectionId}`) : false,
  }));

  console.log(`ATLAS facultySubjects flattened: ${expected.length}`);
  console.log(`SMART active assignments: ${smartAssignments.length}`);
  console.log('Missing candidates:');
  console.table(status.filter((r) => !r.existsInSMART));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});
