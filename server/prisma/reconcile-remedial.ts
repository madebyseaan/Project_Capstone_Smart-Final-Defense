/**
 * reconcile-remedial.ts — remove orphaned PENDING remedial rows.
 *
 * A never-conducted PENDING row may only be acted on while its enrollment is
 * live and CONDITIONALLY_PROMOTED. This script deletes dead rows (non-CP or
 * archived enrollments) and reports rows with remedial data entered for
 * registrar follow-up.
 *
 * Run: cd server && npx ts-node prisma/reconcile-remedial.ts [schoolYear]
 * Omit schoolYear to scan every school year (recommended for cleanup).
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL!;
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

async function main() {
  const { reconcileRemedialRows } = await import("../src/lib/remedial");
  const schoolYear = process.argv[2];
  const result = await reconcileRemedialRows({ schoolYear });
  console.log(JSON.stringify(result, null, 2));
}

main()
  .then(async () => {
    await prisma.$disconnect().catch(() => {});
    process.exit(0);
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  });
