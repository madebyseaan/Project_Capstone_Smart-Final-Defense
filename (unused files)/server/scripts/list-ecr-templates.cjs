const { PrismaClient } = require('./node_modules/@prisma/client');
const prisma = new PrismaClient();
prisma.eCRTemplate.findMany({ select: { id: true, subjectName: true, subjectType: true, isActive: true } })
  .then(r => { console.log(JSON.stringify(r, null, 2)); })
  .catch(console.error)
  .finally(() => prisma.$disconnect());
