/**
 * trim-assessment-columns.ts — Enforce the ECR column caps on stored grades.
 *
 * Keeps at most 5 Written Work and 3 Performance Task columns per grade, then
 * re-derives PS / initial / quarterly grades from the trimmed scores.
 *
 *   cd server && npx ts-node --files prisma/trim-assessment-columns.ts
 */
import "dotenv/config";
import { GradingMode } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { deriveGradeValues } from "../src/lib/gradeDerivation";
import { getTransmutationTable } from "../src/lib/transmutationCache";
import { getGradingModeForSchoolYear } from "../src/lib/gradingMode";
import { resolveEffectiveWeightsForClassAssignment } from "../src/routes/grades-sub/helpers";
import { MAX_PT_COLUMNS, MAX_WW_COLUMNS } from "../src/lib/assessmentColumns";

async function main() {
  const grades = await prisma.grade.findMany({
    select: {
      id: true,
      classAssignmentId: true,
      writtenWorkScores: true,
      perfTaskScores: true,
      examScores: true,
      quarterlyAssessScore: true,
      quarterlyAssessMax: true,
      classAssignment: { select: { schoolYear: true } },
    },
  });

  const table = await getTransmutationTable();
  const weightsCache = new Map<string, { ww: number; pt: number; qa: number }>();
  const modeCache = new Map<string, GradingMode>();
  let scanned = 0;
  let trimmed = 0;

  for (const g of grades) {
    const ww = Array.isArray(g.writtenWorkScores) ? (g.writtenWorkScores as unknown[]) : [];
    const pt = Array.isArray(g.perfTaskScores) ? (g.perfTaskScores as unknown[]) : [];
    if (ww.length <= MAX_WW_COLUMNS && pt.length <= MAX_PT_COLUMNS) continue;

    scanned++;

    const schoolYear = g.classAssignment.schoolYear;
    let mode = modeCache.get(schoolYear);
    if (!mode) {
      mode = await getGradingModeForSchoolYear(schoolYear);
      modeCache.set(schoolYear, mode);
    }

    let weights = weightsCache.get(g.classAssignmentId);
    if (!weights) {
      const resolved = await resolveEffectiveWeightsForClassAssignment(g.classAssignmentId);
      weights = { ww: resolved.ww, pt: resolved.pt, qa: resolved.qa };
      weightsCache.set(g.classAssignmentId, weights);
    }

    const trimmedWW = ww.slice(0, MAX_WW_COLUMNS) as any[];
    const trimmedPT = pt.slice(0, MAX_PT_COLUMNS) as any[];

    const derived = deriveGradeValues(
      {
        writtenWorkScores: trimmedWW,
        perfTaskScores: trimmedPT,
        examScores: g.examScores,
        quarterlyAssessScore: g.quarterlyAssessScore,
        quarterlyAssessMax: g.quarterlyAssessMax,
      },
      weights,
      mode,
      table,
    );

    await prisma.grade.update({
      where: { id: g.id },
      data: {
        writtenWorkScores: trimmedWW,
        perfTaskScores: trimmedPT,
        ...(derived.initialGrade !== null && derived.quarterlyGrade !== null
          ? {
              writtenWorkPS: derived.writtenWorkPS,
              perfTaskPS: derived.perfTaskPS,
              quarterlyAssessPS: derived.quarterlyAssessPS,
              quarterlyAssessScore: derived.nextQuarterlyAssessScore,
              quarterlyAssessMax: derived.nextQuarterlyAssessMax,
              initialGrade: derived.initialGrade,
              quarterlyGrade: derived.quarterlyGrade,
            }
          : {}),
      },
    });
    trimmed++;
  }

  console.log("=== Assessment column trim complete ===");
  console.log(`Scanned: ${grades.length}`);
  console.log(`Over cap: ${scanned}`);
  console.log(`Trimmed: ${trimmed}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
