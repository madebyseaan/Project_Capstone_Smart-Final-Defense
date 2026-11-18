/**
 * scripts/wipe-academic.ts
 *
 * Fresh academic reset across ALL school years (historical data included).
 * Use before an EnrollPro rollover simulation so SMART starts from zero.
 *
 * DELETED:
 *   - SchoolYear, TeacherYearArchive, YearGradeLock, TermGradeLock
 *   - Student, Section, Subject, Enrollment, ExternalSchoolRecord(s)
 *   - ClassAssignment, ScheduleEntry, WorkloadEntry
 *   - Grade, GradeSnapshot, AimsScore, EcrSync, StudentObservedValue
 *   - Attendance, RemedialClass
 *   - GradeEditRequest, AuditLog, SyncHistory
 *   - AtlasCrosswalk, AtlasScheduleMeta
 *
 * KEPT (by default):
 *   - User accounts (ADMIN / REGISTRAR / TEACHER) + Teacher profiles
 *   - SystemSettings (branding, EnrollPro credentials, policies)
 *   - GradingConfig, TransmutationEntry
 *   - ExcelTemplate uploads (SF forms)
 *
 * SystemSettings academic pointers are reset: active school year, term,
 * term dates, grade/transition locks, Atlas applied-version markers.
 * The next EnrollPro/Atlas sync repopulates the fresh year.
 *
 * Usage:
 *   npx ts-node scripts/wipe-academic.ts --dry-run
 *   npx ts-node scripts/wipe-academic.ts --yes
 *
 * Flags:
 *   --dry-run           Show per-table counts only; change nothing
 *   --yes               Required to execute the wipe
 *   --wipe-teachers     Also delete Teacher profiles + TEACHER user accounts
 *   --wipe-users        Also delete ALL users (forces --wipe-templates)
 *   --wipe-templates    Also delete uploaded Excel templates
 *   --reset-branding    Also clear school name/identity/logo/colors (EnrollPro-synced branding)
 *
 * Recommended: STOP the dev server before running, restart after.
 * Recommended: Run `pnpm run db:backup` first.
 */

import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { prisma } from "../src/lib/prisma";
import { Prisma } from "@prisma/client";
import { collectCounts, runWipe, type TableCount } from "../src/lib/wipe";
import { invalidateAllCaches } from "../src/lib/syncCache";

interface Flags {
  dryRun: boolean;
  yes: boolean;
  wipeTeachers: boolean;
  wipeUsers: boolean;
  wipeTemplates: boolean;
  resetBranding: boolean;
  confirmProduction: boolean;
}

const EXTRA_COUNT_TABLES = ["EcrSync", "StudentObservedValue"] as const;

function printUsage(): void {
  console.log(`
Usage: npx ts-node scripts/wipe-academic.ts [flags]

Flags:
  --dry-run           Show per-table counts only; change nothing
  --yes               Required to execute the wipe
  --wipe-teachers     Also delete Teacher profiles + TEACHER user accounts
  --wipe-users        Also delete ALL users (forces --wipe-templates)
  --wipe-templates    Also delete uploaded Excel templates
  --reset-branding    Also clear school identity/logo/colors (EnrollPro-synced)
  --i-know-this-wipes-production   Required in production (with WIPE_CONFIRM=yes)

Recommended: stop the dev server first, and back up with \`pnpm run db:backup\`.
`);
}

function parseArgs(argv: string[]): Flags {
  const flags: Flags = {
    dryRun: false,
    yes: false,
    wipeTeachers: false,
    wipeUsers: false,
    wipeTemplates: false,
    resetBranding: false,
    confirmProduction: false,
  };

  for (const arg of argv.slice(2)) {
    switch (arg) {
      case "--dry-run":
        flags.dryRun = true;
        break;
      case "--yes":
        flags.yes = true;
        break;
      case "--wipe-teachers":
        flags.wipeTeachers = true;
        break;
      case "--wipe-users":
        flags.wipeUsers = true;
        break;
      case "--wipe-templates":
        flags.wipeTemplates = true;
        break;
      case "--reset-branding":
        flags.resetBranding = true;
        break;
      case "--i-know-this-wipes-production":
        flags.confirmProduction = true;
        break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
      default:
        console.error(`Unknown flag: ${arg}`);
        printUsage();
        process.exit(1);
    }
  }

  if (flags.wipeUsers) {
    flags.wipeTeachers = true;
    flags.wipeTemplates = true;
  }

  return flags;
}

function guardProduction(flags: Flags): void {
  if (process.env.NODE_ENV !== "production") return;

  if (!flags.confirmProduction) {
    console.error("\n[wipe-academic] FATAL: refusing to wipe in production without --i-know-this-wipes-production.");
    process.exit(1);
  }
  if (process.env.WIPE_CONFIRM !== "yes") {
    console.error("\n[wipe-academic] FATAL: refusing to wipe in production without WIPE_CONFIRM=yes.");
    process.exit(1);
  }
  console.warn("\n[wipe-academic] PRODUCTION WIPE CONFIRMED — proceeding.\n");
}

async function collectAllCounts(
  client: Prisma.TransactionClient | typeof prisma,
): Promise<TableCount[]> {
  const base = await collectCounts(client);
  const extras: TableCount[] = [];
  for (const table of EXTRA_COUNT_TABLES) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    extras.push({ table, count: await (client as any)[table].count() });
  }
  return [...base, ...extras];
}

function printCounts(label: string, counts: TableCount[]): void {
  console.log(`\n${label}:`);
  console.log("-".repeat(45));
  let total = 0;
  for (const { table, count } of counts) {
    console.log(`  ${table.padEnd(25)} ${String(count).padStart(6)}`);
    total += count;
  }
  console.log("-".repeat(45));
  console.log(`  ${"TOTAL".padEnd(25)} ${String(total).padStart(6)}`);
}

function printPlan(flags: Flags): void {
  console.log("[wipe-academic] Plan:");
  console.log("  DELETE: all academic rows — every school year + historical archives,");
  console.log("          grades, snapshots, attendance, enrollment, remedial, observed values,");
  console.log("          AIMS scores, ECR syncs, schedules, workloads, students, sections,");
  console.log("          subjects, locks, Atlas metadata, sync history, audit logs, edit requests.");
  console.log(
    `  KEEP:   ${
      flags.wipeUsers
        ? "no user accounts (all deleted)"
        : flags.wipeTeachers
          ? "ADMIN + REGISTRAR users only (teacher accounts deleted)"
          : "all user accounts + teacher profiles"
    }`,
  );
  console.log(`          ${flags.wipeTemplates ? "Excel templates DELETED" : "Excel templates kept"}`);
  console.log(
    `          SystemSettings: ${flags.resetBranding ? "BRANDING RESET" : "branding kept"}, EnrollPro credentials, GradingConfig, TransmutationEntry.`,
  );
  console.log("  RESET:  active school year, current term, term dates, grade/transition locks, Atlas markers.");
}

/**
 * Verify nothing academic survived. Catalog-driven for tables this script does
 * not intentionally keep, so future schema additions cannot silently survive.
 */
async function verifyWiped(tx: Prisma.TransactionClient, flags: Flags): Promise<void> {
  const mustBeEmpty = [
    "Attendance",
    "Grade",
    "GradeSnapshot",
    "AimsScore",
    "EcrSync",
    "GradeEditRequest",
    "WorkloadEntry",
    "ScheduleEntry",
    "AtlasCrosswalk",
    "AtlasScheduleMeta",
    "RemedialClass",
    "Enrollment",
    "ClassAssignment",
    "ExternalSubjectRecord",
    "ExternalSchoolRecord",
    "StudentObservedValue",
    "Student",
    "Section",
    "Subject",
    "YearGradeLock",
    "TermGradeLock",
    "TeacherYearArchive",
    "SchoolYear",
    "SyncHistory",
    "AuditLog",
  ];

  for (const table of mustBeEmpty) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const count = await (tx as any)[table].count();
    if (count > 0) {
      throw new Error(`[wipe-academic] VERIFICATION FAILED: ${table} still has ${count} rows. Rolling back.`);
    }
  }

  if (flags.wipeTeachers) {
    const teachers = await tx.teacher.count();
    const teacherUsers = await tx.user.count({ where: { role: "TEACHER" } });
    if (teachers > 0 || teacherUsers > 0) {
      throw new Error(
        `[wipe-academic] VERIFICATION FAILED: Teacher=${teachers}, TEACHER users=${teacherUsers}. Rolling back.`,
      );
    }
  }

  if (flags.wipeUsers) {
    const users = await tx.user.count();
    if (users > 0) {
      throw new Error(`[wipe-academic] VERIFICATION FAILED: User still has ${users} rows. Rolling back.`);
    }
  }

  if (flags.wipeTemplates) {
    const templates = await tx.excelTemplate.count();
    if (templates > 0) {
      throw new Error(`[wipe-academic] VERIFICATION FAILED: ExcelTemplate still has ${templates} rows. Rolling back.`);
    }
  }

  // Catalog catch-all: any table not explicitly kept must be empty.
  const allowed = new Set([
    "SystemSettings",
    "GradingConfig",
    "TransmutationEntry",
    "_prisma_migrations",
  ]);
  if (!flags.wipeUsers) {
    allowed.add("User");
    allowed.add("RefreshToken");
    allowed.add("CompanionSsoCode");
    if (!flags.wipeTeachers) allowed.add("Teacher");
  }
  if (!flags.wipeTemplates) allowed.add("ExcelTemplate");

  const catalogRows = await tx.$queryRawUnsafe<Array<{ table_name: string }>>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'`,
  );
  for (const { table_name } of catalogRows) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table_name)) continue;
    if (allowed.has(table_name)) continue;
    const [{ count }] = await tx.$queryRawUnsafe<Array<{ count: number }>>(
      `SELECT COUNT(*)::int AS count FROM "${table_name}"`,
    );
    if (count > 0) {
      throw new Error(
        `[wipe-academic] VERIFICATION FAILED: unexpected rows in ${table_name} (${count}). Rolling back.`,
      );
    }
  }

  const settings = await tx.systemSettings.findUnique({ where: { id: "main" } });
  if (!settings) {
    throw new Error("[wipe-academic] VERIFICATION FAILED: SystemSettings row missing.");
  }
  if (
    settings.schoolYearId !== null ||
    settings.currentSchoolYear !== "UNSET" ||
    settings.gradeLock ||
    settings.transitionLock ||
    settings.t1StartDate ||
    settings.t2StartDate ||
    settings.t3StartDate
  ) {
    throw new Error("[wipe-academic] VERIFICATION FAILED: SystemSettings academic pointers were not reset.");
  }

  if (flags.resetBranding) {
    const brandingBlank =
      settings.schoolName === "" &&
      settings.schoolId === "" &&
      settings.division === "" &&
      settings.region === "" &&
      settings.district === "" &&
      settings.logoUrl === null;
    if (!brandingBlank) {
      throw new Error("[wipe-academic] VERIFICATION FAILED: SystemSettings branding was not reset.");
    }
  }
}

async function main(): Promise<void> {
  const flags = parseArgs(process.argv);

  if (!flags.yes && !flags.dryRun) {
    console.error("[wipe-academic] Refusing to run without --yes (or use --dry-run to preview).");
    printUsage();
    process.exit(1);
  }

  guardProduction(flags);
  printPlan(flags);

  if (flags.dryRun) {
    console.log("\n[wipe-academic] DRY RUN — no changes will be made.");
  }

  const preCounts = await collectAllCounts(prisma);
  printCounts("Pre-wipe counts", preCounts);

  if (flags.dryRun) {
    console.log("\n[wipe-academic] Dry run complete. No changes made.");
    await prisma.$disconnect();
    return;
  }

  // runWipe() updates SystemSettings by id — make sure the row exists.
  await prisma.systemSettings.upsert({ where: { id: "main" }, update: {}, create: { id: "main" } });

  console.log("\n[wipe-academic] Executing wipe in a single transaction...");
  await prisma.$transaction(async (tx) => {
    // Wipes every domain table (includes historical years + archives).
    // keepUsers=true preserves accounts; user-bound tables are cleaned below.
    // --wipe-users uses the full-wipe path so User/ExcelTemplate FKs are handled.
    await runWipe(tx, {
      keepUsers: !flags.wipeUsers,
      keepTemplates: !flags.wipeTemplates,
    });

    // Academic/history tables that runWipe skips when keepUsers=true.
    await tx.gradeEditRequest.deleteMany({});
    await tx.auditLog.deleteMany({});

    if (flags.wipeTeachers) {
      await tx.teacher.deleteMany({});
      await tx.user.deleteMany({ where: { role: "TEACHER" } });
    }
    if (flags.wipeUsers) {
      await tx.user.deleteMany({});
    }

    // Reset academic pointers + stale term/Atlas state so the next sync re-derives.
    await tx.systemSettings.update({
      where: { id: "main" },
      data: {
        schoolYearId: null,
        currentSchoolYear: "UNSET",
        currentTerm: "T1",
        gradeLock: false,
        transitionLock: false,
        lastEnrollProSync: null,
        t1StartDate: null,
        t1EndDate: null,
        t2StartDate: null,
        t2EndDate: null,
        t3StartDate: null,
        t3EndDate: null,
        termDatesDerived: false,
        atlasAppliedVersion: null,
        atlasAppliedScope: null,
        atlasAppliedAt: null,
        atlasEmptyLoadSeenAt: null,
        ...(flags.resetBranding
          ? {
              schoolName: "",
              schoolId: "",
              division: "",
              region: "",
              district: "",
              schoolHeadName: null,
              address: null,
              contactNumber: null,
              email: null,
              logoUrl: null,
              primaryColor: "#10b981",
              secondaryColor: "#34d399",
              accentColor: "#6ee7b7",
            }
          : {}),
      },
    });

    await verifyWiped(tx, flags);
  }, { maxWait: 30_000, timeout: 300_000 });

  if (flags.resetBranding) {
    const uploadDir = path.join(__dirname, "../uploads");
    try {
      for (const name of fs.readdirSync(uploadDir)) {
        if (name.startsWith("logo-enrollpro-sync")) {
          fs.unlinkSync(path.join(uploadDir, name));
        }
      }
    } catch (err) {
      console.warn(
        `[wipe-academic] Warn: could not remove synced logo files: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  invalidateAllCaches();

  const postCounts = await collectAllCounts(prisma);
  printCounts("Post-wipe counts", postCounts);

  console.log(
    `\n[wipe-academic] DONE — academic data cleared, ${flags.resetBranding ? "branding reset" : "configuration kept"}.`,
  );
  console.log("Next steps:");
  if (flags.resetBranding) {
    console.log("  1. Keep the server STOPPED until EnrollPro has an active school year.");
    console.log("     (An early start would re-import EnrollPro's placeholder branding on sync.)");
    console.log("  2. Start the server — branding/identity repopulate from EnrollPro.");
  } else {
    console.log("  1. Restart the dev server.");
  }
  console.log("  3. Re-run with --dry-run to confirm all academic counts are 0.");

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("\n[wipe-academic] FATAL:", err?.message || err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
