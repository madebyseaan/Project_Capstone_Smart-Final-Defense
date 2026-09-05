import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL!;
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

async function main() {
  const { backfillMissingRemedialRows } = await import("../src/lib/remedial");
  const result = await backfillMissingRemedialRows();
  console.log(`Backfill complete: ${result.enrollmentsFixed} enrollments fixed, ${result.rowsCreated} rows created (scanned ${result.enrollmentsScanned} orphans)`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
