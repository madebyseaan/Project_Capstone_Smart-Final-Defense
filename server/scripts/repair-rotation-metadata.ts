/**
 * repair-rotation-metadata.ts — clear invalid rotation metadata on subjects.
 *
 * Default is DRY-RUN. Use --apply to write. Saves an undo report.
 *
 * Usage:
 *   ts-node --transpile-only scripts/repair-rotation-metadata.ts --json artifacts/rotation-repair.json
 *   ts-node --transpile-only scripts/repair-rotation-metadata.ts --apply --json artifacts/rotation-repair.json
 *   ts-node --transpile-only scripts/repair-rotation-metadata.ts --undo artifacts/rotation-repair.json
 */

import dotenv from "dotenv";
import path from "path";
import fs from "fs";
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { prisma } from "../src/lib/prisma";
import { createAuditLog } from "../src/lib/audit";
import { AuditAction, AuditSeverity } from "@prisma/client";
import { clearedRotationFields, hasAnyRotationField, validateRotationMetadata } from "../src/lib/rotationMetadata";

interface RepairRow {
  subjectId: string;
  code: string;
  name: string;
  reason: string;
  old: {
    rotationTermGroupId: string | null;
    rotationTermRank: number | null;
    rotationOutputLabel: string | null;
  };
}

function readArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const jsonPath = readArg("--json");
  const undoPath = readArg("--undo");

  if (undoPath) {
    const report = JSON.parse(fs.readFileSync(path.resolve(undoPath), "utf8")) as { rows: RepairRow[] };
    let restored = 0;
    for (const row of report.rows) {
      await prisma.subject.update({
        where: { id: row.subjectId },
        data: row.old,
      }).catch(() => {});
      restored += 1;
    }
    console.log(`[rotation-repair] Restored rotation fields on ${restored} subject(s)`);
    await prisma.$disconnect();
    return;
  }

  const subjects = await prisma.subject.findMany({ orderBy: { code: "asc" } });
  const rows: RepairRow[] = [];
  for (const subject of subjects) {
    const fields = {
      code: subject.code,
      rotationTermGroupId: subject.rotationTermGroupId,
      rotationTermRank: subject.rotationTermRank,
      rotationOutputLabel: subject.rotationOutputLabel,
    };
    if (!hasAnyRotationField(fields)) continue;
    const validation = validateRotationMetadata(fields);
    if (validation.valid) continue;
    rows.push({
      subjectId: subject.id,
      code: subject.code,
      name: subject.name,
      reason: validation.reason,
      old: {
        rotationTermGroupId: subject.rotationTermGroupId,
        rotationTermRank: subject.rotationTermRank,
        rotationOutputLabel: subject.rotationOutputLabel,
      },
    });
  }

  console.log(`[rotation-repair] Mode: ${apply ? "APPLY" : "DRY-RUN"}`);
  console.log(`[rotation-repair] Subjects scanned: ${subjects.length}`);
  console.log(`[rotation-repair] Invalid rotation subjects: ${rows.length}`);
  for (const row of rows) {
    console.log(`  - ${row.code} (${row.name}) group=${row.old.rotationTermGroupId} rank=${row.old.rotationTermRank} label=${row.old.rotationOutputLabel} reason=${row.reason}`);
  }

  if (jsonPath) {
    fs.mkdirSync(path.dirname(path.resolve(jsonPath)), { recursive: true });
    fs.writeFileSync(path.resolve(jsonPath), JSON.stringify({ generatedAt: new Date().toISOString(), applied: apply, rows }, null, 2));
    console.log(`[rotation-repair] Report written to ${jsonPath}`);
  }

  if (!apply) {
    console.log("[rotation-repair] Dry-run only. Re-run with --apply to write.");
    await prisma.$disconnect();
    return;
  }

  for (const row of rows) {
    await prisma.subject.update({
      where: { id: row.subjectId },
      data: clearedRotationFields(),
    });
  }

  if (rows.length > 0) {
    await createAuditLog(
      AuditAction.UPDATE,
      { id: null, role: "SYSTEM", firstName: "Rotation", lastName: "Repair" },
      "Subject",
      "DATA_REPAIR",
      `Cleared invalid rotation metadata on ${rows.length} subject(s): ${rows.map((row) => `${row.code} (${row.reason})`).join("; ")}`,
      undefined,
      AuditSeverity.WARNING,
    ).catch(() => {});
  }

  console.log(`[rotation-repair] Applied: ${rows.length} subject(s) updated.`);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error("[rotation-repair] Failed:", error);
  await prisma.$disconnect();
  process.exit(1);
});
