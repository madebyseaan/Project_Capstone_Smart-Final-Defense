/**
 * backfill-display-names.ts — One-time backfill for Subject.displayName.
 *
 * Run: cd server && npx ts-node prisma/backfill-display-names.ts
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { computeDisplayName } from '../src/lib/subjectDisplay';

const connectionString = process.env.DATABASE_URL!;
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  const subjects = await prisma.subject.findMany();
  let updated = 0;
  for (const s of subjects) {
    const dn = computeDisplayName(s.code, s.name);
    if (dn !== s.displayName) {
      await prisma.subject.update({ where: { id: s.id }, data: { displayName: dn } });
      updated++;
    }
  }
  console.log(`Backfill done: ${updated}/${subjects.length} subjects updated`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
