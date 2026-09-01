/**
 * wipe.ts
 *
 * Business logic for a safe, FK-order database wipe.
 * Exported for testability — the CLI script (scripts/wipe.ts) is a thin wrapper.
 *
 * Wipes all domain tables in FK-safe order, resets SystemSettings,
 * and verifies all domain tables are empty within the same transaction.
 */

import { PrismaClient, Prisma } from "@prisma/client";

// ---------------------------------------------------------------------------
// Wipe order — leaf tables first, roots last (§1.3)
// ---------------------------------------------------------------------------
export const WIPE_ORDER: readonly string[] = [
  "Attendance",
  "Grade",
  "GradeSnapshot",
  "GradeEditRequest",
  "WorkloadEntry",
  "ScheduleEntry",
  "Enrollment",
  "ClassAssignment",
  "RefreshToken",
  "Teacher",
  "Section",
  "Subject",
  "Student",
  "YearGradeLock",
  "TermGradeLock",
  "SchoolYear",
  "SyncHistory",
  "AuditLog",
  "ExcelTemplate",
  "User",
] as const;

// Config tables to KEEP: SystemSettings, GradingConfig, TransmutationEntry

export interface WipeOptions {
  keepUsers?: boolean;
  keepTemplates?: boolean;
}

export interface TableCount {
  table: string;
  count: number;
}

/**
 * Collect per-table counts for all tables in WIPE_ORDER.
 */
export async function collectCounts(prisma: PrismaClient | Prisma.TransactionClient): Promise<TableCount[]> {
  const counts: TableCount[] = [];
  for (const table of WIPE_ORDER) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const count = await (prisma as any)[table].count();
    counts.push({ table, count });
  }
  return counts;
}

/**
 * Tables that are skipped when --keep-users is active.
 */
const USER_FAMILY = new Set([
  "RefreshToken",
  "Teacher",
  "User",
]);

// When keepUsers is set, we also skip tables that FK-reference User
// without cascade — otherwise deleteMany on User would FK-fail.
const USER_REF_TABLES = new Set([
  "AuditLog",
  "ExcelTemplate",
  "GradeEditRequest",
]);

/**
 * Tables that are skipped when --keep-templates is active (default ON).
 */
const TEMPLATE_TABLES = new Set(["ExcelTemplate"]);

/**
 * Run the wipe inside an existing Prisma transaction.
 * After deleting, verifies all wiped tables have count 0.
 * Throws if any count > 0 (transaction will be rolled back by caller).
 */
export async function runWipe(
  tx: PrismaClient | Prisma.TransactionClient,
  options: WipeOptions = {},
): Promise<void> {
  const skipTables = new Set<string>();

  if (options.keepUsers) {
    for (const t of USER_FAMILY) skipTables.add(t);
    for (const t of USER_REF_TABLES) skipTables.add(t);
  }

  if (options.keepTemplates) {
    for (const t of TEMPLATE_TABLES) skipTables.add(t);
  }

  // Delete in FK-safe order
  for (const table of WIPE_ORDER) {
    if (skipTables.has(table)) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tx as any)[table].deleteMany();
  }

  // Reset SystemSettings (NOT delete — it's referenced everywhere)
  await tx.systemSettings.update({
    where: { id: "main" },
    data: {
      currentSchoolYear: "UNSET",
      schoolYearId: null,
      currentTerm: "T1",
      gradeLock: false,
      transitionLock: false,
      lastEnrollProSync: null,
      // KEEP: schoolName, branding, credentials, retention policies, term dates
    },
  });

  // Verification: all wiped tables must be 0
  for (const table of WIPE_ORDER) {
    if (skipTables.has(table)) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const count = await (tx as any)[table].count();
    if (count > 0) {
      throw new Error(
        `[wipe] VERIFICATION FAILED: ${table} has ${count} rows after deleteMany. Rolling back.`
      );
    }
  }

  // Verify SystemSettings was reset
  const settings = await tx.systemSettings.findUnique({ where: { id: "main" } });
  if (!settings) {
    throw new Error("[wipe] VERIFICATION FAILED: SystemSettings row missing after wipe.");
  }
  if (settings.currentSchoolYear !== "UNSET") {
    throw new Error(
      `[wipe] VERIFICATION FAILED: SystemSettings.currentSchoolYear is "${settings.currentSchoolYear}", expected "UNSET".`
    );
  }
}

export interface WipeResult {
  preWipeCounts: TableCount[];
  postVerification: "PASSED";
  systemSettingsReset: boolean;
}
