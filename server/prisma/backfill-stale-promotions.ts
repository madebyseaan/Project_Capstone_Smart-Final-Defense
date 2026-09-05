import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL!;
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

async function main() {
  const { backfillStaleConditionalPromotions } = await import("../src/lib/remedial");
  const result = await backfillStaleConditionalPromotions();
  console.log(`Stale promotion backfill complete: ${result.upgraded} enrollments upgraded to PROMOTED (scanned ${result.scanned})`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
