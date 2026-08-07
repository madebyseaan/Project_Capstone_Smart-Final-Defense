import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient, Role } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const p = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) } as any);
async function main() {
  const hash = await bcrypt.hash('DepEd2026!', 10);
  const r = await p.user.updateMany({ where: { role: Role.TEACHER }, data: { password: hash } });
  console.log('Updated teacher passwords:', r.count);
  // Verify
  const test = await p.user.findFirst({ where: { email: 'angelo.aquino@deped.edu.ph' } }) as any;
  const ok = await bcrypt.compare('DepEd2026!', test?.password ?? '');
  console.log('Login test for angelo.aquino@deped.edu.ph:', ok ? 'PASS' : 'FAIL');
}
main().then(() => p['$disconnect']()).catch(console.error);
