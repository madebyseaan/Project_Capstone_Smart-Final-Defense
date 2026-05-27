import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  console.log('--- Initializing SMART for School Year 2026-2027 ---');
  
  try {
    // 1. Update System Settings
    console.log('Step 1: Updating System Settings...');
    const settings = await prisma.systemSettings.upsert({
      where: { id: 'main' },
      update: { 
        currentSchoolYear: '2026-2027',
        currentQuarter: 'Q1'
      },
      create: { 
        id: 'main',
        currentSchoolYear: '2026-2027',
        currentQuarter: 'Q1',
        schoolName: 'Hinigaran National High School'
      },
    });
    console.log('System settings updated to:', settings.currentSchoolYear);

    // 2. Clear existing Sync History (optional, but keeps diagnostics clean for the new year)
    // console.log('Step 2: Clearing old sync history...');
    // await prisma.syncHistory.deleteMany({});

    console.log('\nSUCCESS: SMART is now targeting S.Y. 2026-2027.');
    console.log('Next Step: Go to the Admin Dashboard and click "Sync with EnrollPro" to pull in the 126 sections.');

  } catch (err: any) {
    console.error('Initialization failed:', err.message);
    if (err.message.includes('password')) {
      console.log('\n--- HINT ---');
      console.log('It looks like your DATABASE_URL password in server/.env might have special characters.');
      console.log('Ensure it is wrapped in quotes or URL-encoded.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
