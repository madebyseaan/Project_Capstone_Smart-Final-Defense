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
  });
}

function normalizeEmail(email) {
  if (!email) return '';
  return String(email)
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/├æ/g, 'n')
    .replace(/ñ/g, 'n');
}

async function main() {
  const token = process.env.ATLAS_SYSTEM_TOKEN;
  const headers = { Authorization: `Bearer ${token}` };

  const facultyData = await get(`${ATLAS_BASE}/faculty?schoolId=${ATLAS_SCHOOL_ID}`, headers);
  const af = (facultyData.faculty || []).find((f) =>
    String(f.firstName || '').toLowerCase().includes('elpidio') &&
    String(f.lastName || '').toLowerCase().includes('aquino')
  );
  if (!af) throw new Error('Elpidio not found in ATLAS');

  const atlasEmail = normalizeEmail(af.contactInfo || '');

  const users = await prisma.user.findMany({
    where: {
      role: 'TEACHER',
      OR: [
        { firstName: { contains: 'Elpidio' } },
        { lastName: { contains: 'Aquino' } },
        { email: { contains: 'aquino' } },
      ],
    },
    include: { teacher: true },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });

  const mapped = users.find((u) => normalizeEmail(u.email || '') === atlasEmail);

  console.log('ATLAS faculty record:');
  console.table([{ id: af.id, firstName: af.firstName, lastName: af.lastName, contactInfo: af.contactInfo, normalized: atlasEmail }]);

  console.log('Candidate SMART users:');
  console.table(users.map((u) => ({
    userId: u.id,
    teacherId: u.teacher?.id || null,
    employeeId: u.teacher?.employeeId || null,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    normalized: normalizeEmail(u.email || ''),
  })));

  console.log('Mapped by atlasSync email rule:');
  if (!mapped) {
    console.log('No SMART user matched.');
  } else {
    console.table([{ userId: mapped.id, teacherId: mapped.teacher?.id, firstName: mapped.firstName, lastName: mapped.lastName, email: mapped.email }]);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});
