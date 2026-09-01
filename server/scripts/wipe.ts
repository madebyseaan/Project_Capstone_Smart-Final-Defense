/**
 * scripts/wipe.ts
 *
 * CLI wrapper for the database wipe operation.
 * Business logic lives in lib/wipe.ts — this is a thin CLI entry point.
 *
 * Usage:
 *   npx ts-node scripts/wipe.ts [flags]
 *
 * Flags:
 *   --dry-run                   Print what would be deleted, exit without touching anything
 *   --keep-users                Skip User/Teacher/RefreshToken/AuditLog/GradeEditRequest/ExcelTemplate
 *   --keep-templates            Skip ExcelTemplate deletion (DEFAULT ON)
 *   --wipe-templates            Include ExcelTemplate in wipe
 *   --i-know-this-wipes-production   Required in production mode
 */

import dotenv from "dotenv";
import path from "path";

// Load .env before anything else
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { prisma } from "../src/lib/prisma";
import { collectCounts, runWipe, type TableCount, type WipeOptions } from "../src/lib/wipe";
import { invalidateAllCaches } from "../src/lib/syncCache";

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

interface CliFlags {
  dryRun: boolean;
  keepUsers: boolean;
  keepTemplates: boolean;
  wipeTemplates: boolean;
  confirmProduction: string | null;
}

function parseArgs(argv: string[]): CliFlags {
  const flags: CliFlags = {
    dryRun: false,
    keepUsers: false,
    keepTemplates: true, // DEFAULT ON
    wipeTemplates: false,
    confirmProduction: null,
  };

  for (const arg of argv.slice(2)) {
    switch (arg) {
      case "--dry-run":
        flags.dryRun = true;
        break;
      case "--keep-users":
        flags.keepUsers = true;
        break;
      case "--keep-templates":
        flags.keepTemplates = true;
        break;
      case "--wipe-templates":
        flags.wipeTemplates = true;
        flags.keepTemplates = false;
        break;
      default:
        if (arg.startsWith("--i-know-this-wipes-production")) {
          flags.confirmProduction = arg;
        } else {
          console.error(`Unknown flag: ${arg}`);
          printUsage();
          process.exit(1);
        }
    }
  }

  return flags;
}

function printUsage(): void {
  console.log(`
Usage: npm run db:wipe -- [flags]

Flags:
  --dry-run                   Print what would be deleted, exit without touching anything
  --keep-users                Skip User/Teacher/RefreshToken/AuditLog/GradeEditRequest/ExcelTemplate
  --keep-templates            Skip ExcelTemplate deletion (DEFAULT ON)
  --wipe-templates            Include ExcelTemplate in wipe
  --i-know-this-wipes-production   Required in production mode (with WIPE_CONFIRM=yes env)
`);
}

// ---------------------------------------------------------------------------
// Production safety gate
// ---------------------------------------------------------------------------

function guardProduction(flags: CliFlags): void {
  if (process.env.NODE_ENV !== "production") return;

  if (flags.confirmProduction !== "--i-know-this-wipes-production") {
    console.error("\n[FATAL] Refusing to wipe in production without confirmation flags.");
    console.error("  Required: --i-know-this-wipes-production");
    console.error("  Required: WIPE_CONFIRM=yes (environment variable)");
    console.error("\nThis is a destructive operation. No data will be deleted.\n");
    process.exit(1);
  }

  if (process.env.WIPE_CONFIRM !== "yes") {
    console.error("\n[FATAL] Refusing to wipe in production without WIPE_CONFIRM=yes.");
    console.error("  Set WIPE_CONFIRM=yes in your environment.");
    console.error("\nThis is a destructive operation. No data will be deleted.\n");
    process.exit(1);
  }

  console.warn("\n⚠️  PRODUCTION WIPE INITIATED — you confirmed this is intentional.\n");
}

// ---------------------------------------------------------------------------
// Print helpers
// ---------------------------------------------------------------------------

function printCounts(label: string, counts: TableCount[]): void {
  console.log(`\n${label}:`);
  console.log("─".repeat(45));
  let total = 0;
  for (const { table, count } of counts) {
    console.log(`  ${table.padEnd(25)} ${String(count).padStart(6)}`);
    total += count;
  }
  console.log("─".repeat(45));
  console.log(`  ${"TOTAL".padEnd(25)} ${String(total).padStart(6)}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const flags = parseArgs(process.argv);

  if (flags.dryRun) {
    console.log("[wipe] DRY RUN — no changes will be made.\n");
  }

  guardProduction(flags);

  // 1. Pre-wipe counts
  const preCounts = await collectCounts(prisma);
  printCounts("Pre-wipe counts", preCounts);

  const totalRows = preCounts.reduce((sum, c) => sum + c.count, 0);
  if (totalRows === 0 && !flags.dryRun) {
    console.log("\n[wipe] All domain tables are already empty. Nothing to do.");
    await prisma.$disconnect();
    return;
  }

  if (flags.dryRun) {
    console.log("\n[wipe] Dry run complete. No changes made.");
    await prisma.$disconnect();
    return;
  }

  // 2. Execute wipe in a single transaction
  console.log("\n[wipe] Executing wipe...");
  const wipeOptions: WipeOptions = {
    keepUsers: flags.keepUsers,
    keepTemplates: flags.keepTemplates,
  };

  await prisma.$transaction(async (tx) => {
    await runWipe(tx, wipeOptions);
  });

  // 3. Invalidate caches (harmless in CLI, correctness if ever imported)
  invalidateAllCaches();

  console.log("\n[wipe] Done. Next steps:");
  console.log("  1. Verify server/.env school-scoped vars (ENROLLPRO_SCHOOL_YEAR_ID, ATLAS_SCHOOL_ID, ATLAS_SCHOOL_YEAR_ID)");
  console.log("  2. Start the server (scheduler will auto-sync) OR POST /api/sync/... for immediate sync");
  console.log("  3. Run the sync verification report (Task 3) and confirm zero anomalies");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("\n[wipe] FATAL:", err.message || err);
  prisma.$disconnect().catch(() => {});
  process.exit(1);
});
