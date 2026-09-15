/**
 * seed-test-base.ts — Idempotent base fixture for the isolated *_test database.
 *
 * Guarantees a resolvable active SchoolYear + SystemSettings row so DB-backed
 * tests never depend on live/synced data. Runs automatically via `npm test`
 * after the *_test guard.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL ?? "";

function dbNameFromUrl(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\//, "");
  } catch {
    return "";
  }
}

if (!/(^|_)test(_|$)/i.test(dbNameFromUrl(connectionString))) {
  console.error("[seed-test-base] Refusing: DATABASE_URL must target a *_test database.");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  const label = "2088-2089";
  const year = await prisma.schoolYear.upsert({
    where: { externalId: 900003 },
    update: { label, status: "ACTIVE" },
    create: { label, externalId: 900003, status: "ACTIVE" },
  });

  await prisma.systemSettings.upsert({
    where: { id: "main" },
    update: { schoolYearId: year.id, currentSchoolYear: label, currentTerm: "T1", gradeLock: false },
    create: { id: "main", schoolYearId: year.id, currentSchoolYear: label, currentTerm: "T1", gradeLock: false },
  });

  console.log(`[seed-test-base] Active school year fixture ready: ${label} (${year.id})`);
}

main()
  .catch((e) => {
    console.error("[seed-test-base] Failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
