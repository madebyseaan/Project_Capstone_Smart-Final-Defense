import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
async function main() {
  await prisma.systemSettings.updateMany({
    data: { lastEnrollProSync: null }
  });
  console.log('Cleared lastEnrollProSync');
}
main().catch(console.error).finally(() => prisma.$disconnect());
