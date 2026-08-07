/**
 * setup-demo-accounts.ts
 *
 * Sets up the correct credentials for Admin and Registrar accounts,
 * and verifies Teacher 3179586 is ready.
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient, Role } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const p = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) } as any);

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║   SMART — Setup Demo Accounts                            ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // ── Admin account ───────────────────────────────────────────────────────
  const adminHash = await bcrypt.hash('AdminSY2026!', 10);
  const adminUser = await p.user.findFirst({ where: { username: '1000001' } }) as any;

  if (adminUser) {
    await p.user.update({
      where: { id: adminUser.id },
      data: {
        username: '1000001',
        password: adminHash,
        firstName: 'System',
        lastName: 'Admin',
      },
    });
    console.log('✔ Admin updated: username=1000001, password=AdminSY2026!');
  } else {
    await p.user.create({
      data: {
        username: '1000001',
        email: 'admin@deped.gov.ph',
        password: adminHash,
        role: Role.ADMIN,
        firstName: 'System',
        lastName: 'Admin',
      },
    });
    console.log('✔ Admin created: username=1000001, password=AdminSY2026!');
  }

  // ── Registrar account ───────────────────────────────────────────────────
  const registrarHash = await bcrypt.hash('Registrar2026!', 10);
  const registrarUser = await p.user.findFirst({ where: { username: '1000002' } }) as any;

  if (registrarUser) {
    await p.user.update({
      where: { id: registrarUser.id },
      data: {
        username: '1000002',
        password: registrarHash,
        firstName: 'School',
        lastName: 'Registrar',
      },
    });
    console.log('✔ Registrar updated: username=1000002, password=Registrar2026!');
  } else {
    await p.user.create({
      data: {
        username: '1000002',
        email: 'registrar@deped.gov.ph',
        password: registrarHash,
        role: Role.REGISTRAR,
        firstName: 'School',
        lastName: 'Registrar',
      },
    });
    console.log('✔ Registrar created: username=1000002, password=Registrar2026!');
  }

  // ── Verify Teacher 3179586 ───────────────────────────────────────────────
  const teacher = await p.teacher.findUnique({
    where: { employeeId: '3179586' },
    include: { user: true },
  }) as any;

  if (teacher) {
    // Ensure password is DepEd2026!
    const teacherOk = await bcrypt.compare('DepEd2026!', teacher.user.password);
    if (!teacherOk) {
      const teacherHash = await bcrypt.hash('DepEd2026!', 10);
      await p.user.update({ where: { id: teacher.user.id }, data: { password: teacherHash, username: '3179586' } });
      console.log('✔ Teacher 3179586 password reset to DepEd2026!');
    } else {
      console.log('✔ Teacher 3179586 (Diego Aquino) password already correct');
    }
  } else {
    // Create teacher if not found
    const teacherHash = await bcrypt.hash('DepEd2026!', 10);
    const newUser = await p.user.create({
      data: {
        username: '3179586',
        password: teacherHash,
        role: Role.TEACHER,
        firstName: 'DIEGO',
        lastName: 'AQUINO',
        email: 'diego.aquino@deped.gov.ph',
      }
    });
    await p.teacher.create({
      data: {
        userId: newUser.id,
        employeeId: '3179586',
        specialization: 'MATH',
      }
    });
    console.log('✔ Teacher 3179586 created: 3179586 / DepEd2026!');
  }

  // ── Verify logins ───────────────────────────────────────────────────────
  console.log('\n── Login verification ──────────────────────────────────');

  const adminCheck = await p.user.findUnique({ where: { username: '1000001' } }) as any;
  const adminLoginOk = adminCheck && await bcrypt.compare('AdminSY2026!', adminCheck.password);
  console.log(`  Admin     1000001 / AdminSY2026!    → ${adminLoginOk ? 'PASS ✔' : 'FAIL ✗'}`);

  const regCheck = await p.user.findUnique({ where: { username: '1000002' } }) as any;
  const regLoginOk = regCheck && await bcrypt.compare('Registrar2026!', regCheck.password);
  console.log(`  Registrar 1000002 / Registrar2026!  → ${regLoginOk ? 'PASS ✔' : 'FAIL ✗'}`);

  const teacherCheck = await p.teacher.findUnique({
    where: { employeeId: '3179586' },
    include: { user: true },
  }) as any;
  const teacherLoginOk = teacherCheck && await bcrypt.compare('DepEd2026!', teacherCheck.user.password);
  console.log(`  Teacher   3179586  / DepEd2026!     → ${teacherLoginOk ? 'PASS ✔' : 'FAIL ✗'}`);

  console.log('');
}

main().then(() => p['$disconnect']()).catch(console.error);
