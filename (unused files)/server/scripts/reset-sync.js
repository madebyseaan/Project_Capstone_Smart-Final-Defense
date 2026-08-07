const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  await prisma.systemSettings.updateMany({
    data: { lastEnrollProSync: null }
  });
  console.log('Cleared lastEnrollProSync');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
