/**
 * check-data-integrity.ts — read-only deployment preflight.
 *
 * Fails when grade data is stranded on archived assignments while the active
 * same-family assignment is empty (e.g. ATLAS remapped TLE exploratory
 * subjects to TLE7–TLE10 after grades were already seeded).
 *
 * Exit codes:
 *   0 = no blocking issue
 *   1 = CRITICAL anomaly (or any anomaly with --strict)
 *   2 = could not run the check
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/check-data-integrity.ts
 *   npx ts-node --transpile-only scripts/check-data-integrity.ts --school-year 2026-2027
 *   npx ts-node --transpile-only scripts/check-data-integrity.ts --strict
 *   npx ts-node --transpile-only scripts/check-data-integrity.ts --json
 */

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { buildDataIntegrityReport } from "../src/lib/dataIntegrity";

function readArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

async function main() {
  const explicitYear = readArg("--school-year");
  let schoolYear = explicitYear ?? "";

  if (!schoolYear) {
    const settings = await prisma.systemSettings.findUnique({
      where: { id: "main" },
      select: { currentSchoolYear: true },
    });
    schoolYear = settings?.currentSchoolYear ?? "";
  }

  if (!schoolYear) {
    console.error("[data-integrity] No school year found. Pass --school-year YYYY-YYYY.");
    process.exitCode = 2;
    return;
  }

  const report = await buildDataIntegrityReport(schoolYear);
  const json = process.argv.includes("--json");
  const strict = process.argv.includes("--strict");
  const blocking = report.anomalies.filter(
    (anomaly) => anomaly.severity === "CRITICAL" || (strict && anomaly.severity === "WARNING"),
  );

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`[data-integrity] School year: ${schoolYear}`);
    console.log(
      `[data-integrity] Sections: ${report.metrics.sectionsChecked} | ` +
        `Subject families: ${report.metrics.subjectFamiliesChecked} | ` +
        `Archived assignments with grades: ${report.metrics.archivedAssignmentsWithGrades}`,
    );
    if (report.anomalies.length === 0) {
      console.log("[data-integrity] OK — no stranded grade placement found.");
    } else {
      console.log(`[data-integrity] ${report.anomalies.length} anomaly(ies):`);
      for (const anomaly of report.anomalies) {
        console.log(
          `  - [${anomaly.severity}] ${anomaly.sectionName} / ${anomaly.subjectFamily}: ${anomaly.message}`,
        );
      }
    }
    if (blocking.length > 0) {
      console.error(
        `[data-integrity] FAIL — ${blocking.length} blocking anomaly(ies)${
          strict ? " (strict)" : ""
        }.`,
      );
    } else if (report.anomalies.length > 0) {
      console.log("[data-integrity] No blocking anomalies. Use --strict to fail on warnings.");
    }
  }

  if (blocking.length > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("[data-integrity] Check failed:", error instanceof Error ? error.message : error);
    process.exitCode = 2;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
