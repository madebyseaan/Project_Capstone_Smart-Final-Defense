require('dotenv').config();
const http = require('http');

const ATLAS_BASE = 'http://100.88.55.125:5001/api/v1';
const ATLAS_SCHOOL_ID = 1;
const ATLAS_SCHOOL_YEAR_ID = Number.parseInt(process.env.ATLAS_SCHOOL_YEAR_ID || '8', 10);

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 300)}`));
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error(`Invalid JSON from ${url}`)); }
      });
    });
    req.on('error', reject);
  });
}

async function main() {
  const token = process.env.ATLAS_SYSTEM_TOKEN;
  const headers = { Authorization: `Bearer ${token}` };
  const url = `${ATLAS_BASE}/faculty-assignments/summary?schoolId=${ATLAS_SCHOOL_ID}&schoolYearId=${ATLAS_SCHOOL_YEAR_ID}`;
  const data = await get(url, headers);

  const rows = data.facultyAssignments || data.data || data.faculty || [];
  const elpidioRows = rows.filter((r) => String(r.firstName || r.facultyFirstName || r.name || '').toLowerCase().includes('elpidio') && String(r.lastName || r.facultyLastName || r.name || '').toLowerCase().includes('aquino'));

  console.log(`Summary rows total: ${rows.length}`);
  console.log('Elpidio rows:');
  console.table(elpidioRows);

  if (elpidioRows[0]) {
    const assignments = Array.isArray(elpidioRows[0].assignments) ? elpidioRows[0].assignments : [];
    console.log(`Elpidio summary assignments length: ${assignments.length}`);
    console.table(assignments.map((a) => ({
      subjectCode: a?.subject?.code || a?.subjectCode || null,
      sectionIdsLen: Array.isArray(a?.sectionIds) ? a.sectionIds.length : 0,
      sectionsLen: Array.isArray(a?.sections) ? a.sections.length : 0,
      sectionIds: Array.isArray(a?.sectionIds) ? a.sectionIds.join(',') : null,
    })));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
