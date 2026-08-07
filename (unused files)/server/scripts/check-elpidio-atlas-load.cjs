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
        if (res.statusCode >= 400) {
          return reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 300)}`));
        }
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error(`Invalid JSON from ${url}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => {
      req.destroy();
      reject(new Error(`Timeout: ${url}`));
    });
  });
}

async function main() {
  const token = process.env.ATLAS_SYSTEM_TOKEN;
  if (!token) throw new Error('ATLAS_SYSTEM_TOKEN is missing');
  const headers = { Authorization: `Bearer ${token}` };

  const facultyData = await get(`${ATLAS_BASE}/faculty?schoolId=${ATLAS_SCHOOL_ID}`, headers);
  const faculty = facultyData.faculty || [];

  const elpidio = faculty.find((f) =>
    String(f.firstName || '').toLowerCase().includes('elpidio') &&
    String(f.lastName || '').toLowerCase().includes('aquino')
  );

  if (!elpidio) {
    console.log('Elpidio Aquino not found in ATLAS faculty list.');
    return;
  }

  const detail = await get(
    `${ATLAS_BASE}/faculty-assignments/${elpidio.id}?schoolYearId=${ATLAS_SCHOOL_YEAR_ID}`,
    headers
  );
  let published = { entries: [] };
  try {
    published = await get(
      `${ATLAS_BASE}/schools/${ATLAS_SCHOOL_ID}/schedules/published/faculty/${elpidio.id}`,
      headers
    );
  } catch (error) {
    console.log(`Published schedule lookup skipped: ${error.message}`);
  }

  const assignments = detail.assignments || [];
  const flatSections = [];
  const sectionIdLoads = [];
  for (const a of assignments) {
    const subjectCode = a.subject?.code || '(no-code)';
    const subjectName = a.subject?.name || '(no-name)';
    const sections = a.sections || [];
    const sectionIds = a.sectionIds || [];
    for (const s of sections) {
      flatSections.push({
        subjectCode,
        subjectName,
        sectionName: s.name,
        gradeLevelName: s.gradeLevelName,
      });
    }
    for (const sid of sectionIds) {
      sectionIdLoads.push({
        subjectCode,
        subjectName,
        sectionId: sid,
      });
    }
  }

  console.log(`ATLAS faculty: ${elpidio.firstName} ${elpidio.lastName} (id=${elpidio.id})`);
  console.log(`Assignments objects: ${assignments.length}`);
  console.log(`Flattened subject-section loads: ${flatSections.length}`);
  console.log(`Flattened subject-sectionId loads: ${sectionIdLoads.length}`);
  console.log('Assignment payload shape summary:');
  console.table(assignments.map((a) => ({
    subjectCode: a.subject?.code,
    sectionsLength: Array.isArray(a.sections) ? a.sections.length : 0,
    sectionIdsLength: Array.isArray(a.sectionIds) ? a.sectionIds.length : 0,
    gradeLevelsLength: Array.isArray(a.gradeLevels) ? a.gradeLevels.length : 0,
  })));
  console.table(flatSections);
  if (sectionIdLoads.length > 0) {
    console.table(sectionIdLoads);
  }

  const pubEntries = Array.isArray(published?.entries) ? published.entries : [];
  const pubUnique = new Map();
  for (const e of pubEntries) {
    if (e.facultyId != null && Number(e.facultyId) !== elpidio.id) continue;
    const subjectCode = String(e.subjectCode || '').trim().toUpperCase();
    const sectionId = Number(e.sectionId);
    if (!subjectCode || !Number.isFinite(sectionId)) continue;
    const key = `${subjectCode}:${sectionId}`;
    if (!pubUnique.has(key)) {
      pubUnique.set(key, {
        subjectCode,
        sectionId,
        sectionName: e.sectionName || e.section?.name || null,
        gradeLevelName: e.gradeLevelName || e.section?.gradeLevelName || null,
      });
    }
  }

  console.log(`Published schedule entries: ${pubEntries.length}`);
  console.log(`Published unique subject-section pairs: ${pubUnique.size}`);
  if (pubUnique.size > 0) {
    console.table([...pubUnique.values()]);
  }

  const facultySubjects = Array.isArray(elpidio.facultySubjects) ? elpidio.facultySubjects : [];
  const facultySubjectSectionIds = [];
  for (const fs of facultySubjects) {
    const subjectCode = String(fs?.subject?.code || '').trim().toUpperCase();
    const sectionIds = Array.isArray(fs?.sectionIds) ? fs.sectionIds : [];
    for (const sid of sectionIds) {
      facultySubjectSectionIds.push({ subjectCode, sectionId: sid });
    }
  }

  console.log(`Faculty list subject buckets: ${facultySubjects.length}`);
  console.log(`Faculty list flattened subject-sectionIds: ${facultySubjectSectionIds.length}`);
  if (facultySubjectSectionIds.length > 0) {
    console.table(facultySubjectSectionIds);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
