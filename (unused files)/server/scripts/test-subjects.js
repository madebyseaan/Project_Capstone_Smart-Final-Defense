const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.subject.findMany().then(r => console.log(JSON.stringify(r, null, 2))).finally(() => process.exit(0));
