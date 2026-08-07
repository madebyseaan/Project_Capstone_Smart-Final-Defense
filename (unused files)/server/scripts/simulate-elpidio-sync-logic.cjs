require('dotenv').config();
const http = require('http');
const https = require('https');

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

function mapGradeLevel(name) {
  const n = String(name || '').toLowerCase();
  if (n.includes('10')) return 'GRADE_10';
  if (n.includes('7')) return 'GRADE_7';
  if (n.includes('8')) return 'GRADE_8';
  if (n.includes('9')) return 'GRADE_9';
  return null;
}

function normalizeAtlasSubjectCode(code) {
  return String(code || '').trim().toUpperCase();
}

async function main() {
  const token = process.env.ATLAS_SYSTEM_TOKEN;
  const headers = { Authorization: `Bearer ${token}` };

  const facultyData = await get(`${ATLAS_BASE}/faculty?schoolId=${ATLAS_SCHOOL_ID}`, headers);
  const af = (facultyData.faculty || []).find((f) =>
    String(f.firstName || '').toLowerCase().includes('elpidio') &&
    String(f.lastName || '').toLowerCase().includes('aquino')
  );
  if (!af) throw new Error('Elpidio not found in faculty list');

  const detail = await get(`${ATLAS_BASE}/faculty-assignments/${af.id}?schoolYearId=${ATLAS_SCHOOL_YEAR_ID}`, headers);
  const assignments = detail.assignments || [];

  const scoped = await get('https://dev-jegs.buru-degree.ts.net/api/integration/v1/sections?schoolYearId=55&limit=500');
  const unscoped = await get('https://dev-jegs.buru-degree.ts.net/api/integration/v1/sections?limit=500');
  const merged = new Map();
  for (const s of scoped.data || []) merged.set(Number(s.id), s);
  for (const s of unscoped.data || []) if (!merged.has(Number(s.id))) merged.set(Number(s.id), s);

  const flatAssignments = assignments.filter((a) => a && (a.subjectCode || a.sectionId));
  const nestedAssignments = assignments.filter((a) => a && (a.subject?.code || a.sections));
  const hasSectionIds = flatAssignments.some((a) => a?.sectionId ?? a?.section?.id);
  let pubEntries = [];
  if (!hasSectionIds) {
    try {
      const pubData = await get(`${ATLAS_BASE}/schools/${ATLAS_SCHOOL_ID}/schedules/published/faculty/${af.id}`, headers);
      pubEntries = Array.isArray(pubData?.entries) ? pubData.entries : [];
    } catch {
      pubEntries = [];
    }
  }

  const teacherLoads = [];
  const MAX_SANE_SECTIONS = 10;

  if (flatAssignments.length > 0 && flatAssignments.some((a) => a?.sectionId ?? a?.section?.id)) {
    for (const a of flatAssignments) {
      const subjectCode = normalizeAtlasSubjectCode(a?.subjectCode ?? a?.subject?.code);
      if (!subjectCode) continue;
      const sectionId = Number(a?.sectionId ?? a?.section?.id);
      const epSection = merged.get(sectionId);
      const gradeLevel = mapGradeLevel(epSection?.gradeLevel?.name ?? epSection?.gradeLevelName ?? epSection?.name);
      if (gradeLevel) teacherLoads.push({ source: 'flat', subjectCode, sectionName: epSection.name, gradeLevel, sid: sectionId });
    }
  } else if (nestedAssignments.length > 0 && nestedAssignments.some((a) => (a.sections ?? []).length > 0)) {
    for (const a of nestedAssignments) {
      const subjectCode = normalizeAtlasSubjectCode(a.subject?.code ?? '');
      if (!subjectCode) continue;
      const sections = a.sections ?? [];
      if (sections.length > MAX_SANE_SECTIONS) continue;
      for (const sec of sections) {
        const gradeLevel = mapGradeLevel(sec.gradeLevelName ?? sec.name);
        if (gradeLevel) teacherLoads.push({ source: 'nested', subjectCode, sectionName: sec.name, gradeLevel });
      }
    }
  } else if (pubEntries.length > 0) {
    const seen = new Set();
    for (const entry of pubEntries) {
      if (entry.facultyId != null && Number(entry.facultyId) !== af.id) continue;
      const subjectCode = normalizeAtlasSubjectCode(entry?.subjectCode);
      const sectionId = Number(entry?.sectionId);
      if (!subjectCode || !Number.isFinite(sectionId)) continue;
      const key = `${subjectCode}:${sectionId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const epSection = merged.get(sectionId);
      const gradeLevel = mapGradeLevel(epSection?.gradeLevel?.name ?? epSection?.gradeLevelName ?? epSection?.name);
      if (gradeLevel) teacherLoads.push({ source: 'published', subjectCode, sectionName: epSection.name, gradeLevel, sid: sectionId });
    }
  } else if (Array.isArray(af.facultySubjects) && af.facultySubjects.length > 0) {
    for (const fs of af.facultySubjects) {
      const subjectCode = normalizeAtlasSubjectCode(fs.subject?.code);
      if (!subjectCode) continue;
      const sectionIds = Array.isArray(fs.sectionIds) ? fs.sectionIds : [];
      for (const sid of sectionIds) {
        const epSection = merged.get(Number(sid));
        if (!epSection?.name) continue;
        const gradeLevel = mapGradeLevel(epSection.gradeLevel?.name ?? epSection.gradeLevelName ?? epSection.name);
        if (gradeLevel) teacherLoads.push({ source: 'facultySubjects', subjectCode, sectionName: epSection.name, gradeLevel, sid: Number(sid) });
      }
    }
  }

  console.log('flatAssignments', flatAssignments.length, 'nestedAssignments', nestedAssignments.length, 'hasSectionIds', hasSectionIds, 'pubEntries', pubEntries.length);
  console.log('teacherLoads', teacherLoads.length);
  console.table(teacherLoads);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
