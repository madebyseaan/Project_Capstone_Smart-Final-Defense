/**
 * assign-advisers.ts
 *
 * Assigns section advisers in SMART using ATLAS /faculty/advisers endpoint.
 * Run this once after reimporting teachers, or the atlasSync will handle it.
 */
import 'dotenv/config';
import http from 'http';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const p = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) } as any);

function httpGet(url: string, headers: Record<string, string>): Promise<any> {
  return new Promise((resolve, reject) => {
    http.get(url, { headers } as any, (res: any) => {
      let body = '';
      res.on('data', (c: any) => body += c);
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}: ${body.substring(0, 200)}`));
        try { resolve(JSON.parse(body)); } catch { reject(new Error(body.substring(0, 200))); }
      });
    }).on('error', reject);
  });
}

async function main() {
  const token = process.env.ATLAS_SYSTEM_TOKEN!;
  const auth = { Authorization: `Bearer ${token}` };

  // 1. Get ATLAS advisers with section names
  console.log('Fetching ATLAS advisers...');
  const advisersData = await httpGet('http://100.88.55.125:5001/api/v1/faculty/advisers?schoolId=1&schoolYearId=8', auth);
  const atlasAdvisers: any[] = advisersData.advisers ?? [];
  console.log(`  ATLAS advisers: ${atlasAdvisers.length}`);

  // 2. Get ATLAS full faculty list for email lookup
  const facultyData = await httpGet('http://100.88.55.125:5001/api/v1/faculty?schoolId=1', auth);
  const atlasFaculty: any[] = facultyData.faculty ?? [];
  const facultyEmailById = new Map<number, string>(
    atlasFaculty.map((f: any) => [f.id, (f.contactInfo ?? '').toLowerCase()])
  );

  // 3. Get SMART teachers: email → teacher id
  const smartTeachers = await p.user.findMany({
    where: { role: 'TEACHER' as any },
    include: { teacher: { select: { id: true } } },
  }) as any[];
  const teacherIdByEmail = new Map<string, string>(
    smartTeachers
      .filter((u: any) => u.teacher?.id && u.email)
      .map((u: any) => [u.email.toLowerCase(), u.teacher.id as string])
  );

  // 4. Get SMART sections: name → section id
  const smartSections = await p.section.findMany({ where: { schoolYear: '2026-2027' } }) as any[];
  const sectionIdByName = new Map<string, string>(
    smartSections.map((s: any) => [s.name, s.id as string])
  );

  // 5. Assign advisers
  let assigned = 0, notFound = 0;
  for (const adviser of atlasAdvisers) {
    const email = facultyEmailById.get(adviser.id) ?? '';
    const sectionName = adviser.advisedSectionName ?? '';

    const teacherId = teacherIdByEmail.get(email);
    const sectionId = sectionIdByName.get(sectionName);

    if (!teacherId) { console.warn(`  ⚠ Teacher not found for ${adviser.firstName} ${adviser.lastName} (${email})`); notFound++; continue; }
    if (!sectionId) { console.warn(`  ⚠ Section not found: "${sectionName}"`); notFound++; continue; }

    await p.section.update({ where: { id: sectionId }, data: { adviserId: teacherId } });
    assigned++;
  }

  const total = await p.section.count({ where: { adviserId: { not: null } } });
  console.log(`\nAssigned: ${assigned}, Not found: ${notFound}`);
  console.log(`Sections with adviser: ${total} / ${smartSections.length}`);
}

main().then(() => p['$disconnect']()).catch(console.error);
