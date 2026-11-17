/**
 * normalize-remedial-names.ts — one-time cleanup of RemedialClass.subjectName.
 *
 * Rewrites legacy default names to the grade-qualified canonical convention
 * ("Science" → "Science 7", "Science - Earth Science 7" → "Science 7",
 * "TLE" → "TLE 8"). Manually entered names are left untouched.
 *
 * Run: cd server && npx ts-node prisma/normalize-remedial-names.ts [schoolYear] [--apply]
 * Default is dry-run; pass --apply to persist the changes.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL!;
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const schoolYear = args.find((arg) => /^\d{4}-\d{4}$/.test(arg));

  const { normalizeRemedialSubjectNames } = await import("../src/lib/remedial");
  const result = await normalizeRemedialSubjectNames({ schoolYear, dryRun: !apply });
  console.log(JSON.stringify(result, null, 2));
  if (!apply && result.updated > 0) {
    console.log("\nDry run only. Re-run with --apply to persist.");
  }
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
