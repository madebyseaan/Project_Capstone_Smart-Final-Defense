// Shared canonical grade math for seed/repair scripts.
// Mirrors the server's transmute() (src/routes/grades-sub/helpers.ts) and
// resolveEffectiveWeightsForClassAssignment precedence EXACTLY, so seeded grades
// match what the class record ledger recomputes and what SF9/SF10 display.
// Always read the TransmutationEntry table and GradingConfig from the DB at
// runtime — never hardcode tables/weights here or grades will drift from the
// admin-configured values.

export type TransmutationRow = { minGrade: number; maxGrade: number; transmutedGrade: number };
export type Weights = { ww: number; pt: number; qa: number };
export type GradingConfigRow = {
  subjectType: string;
  writtenWorkWeight: number;
  performanceTaskWeight: number;
  quarterlyAssessWeight: number;
};
export type SubjectWeightRow = {
  type: string;
  writtenWorkWeight: number | null;
  perfTaskWeight: number | null;
  quarterlyAssessWeight: number | null;
};

export const GENERIC_FALLBACK_WEIGHTS: Weights = { ww: 20, pt: 50, qa: 30 };

export function makeTransmuter(table: TransmutationRow[]): (initialGrade: number) => number {
  return (initialGrade: number): number => {
    const roundedGrade = Math.round(initialGrade * 100) / 100;
    for (const entry of table) {
      if (roundedGrade >= entry.minGrade && roundedGrade <= entry.maxGrade) {
        return entry.transmutedGrade;
      }
    }
    throw new Error(
      `Initial grade ${roundedGrade} matched no transmutation range — check the TransmutationEntry table for gaps or misconfigured ranges (${table.length} entries).`,
    );
  };
}

// Server precedence: subject-override (all three non-null) > subject-type config > generic fallback
export function resolveCanonicalWeights(subject: SubjectWeightRow, configs: GradingConfigRow[]): Weights {
  if (
    subject.writtenWorkWeight !== null &&
    subject.perfTaskWeight !== null &&
    subject.quarterlyAssessWeight !== null
  ) {
    return { ww: subject.writtenWorkWeight, pt: subject.perfTaskWeight, qa: subject.quarterlyAssessWeight };
  }
  const gc = configs.find((c) => c.subjectType === subject.type);
  if (gc) {
    return { ww: gc.writtenWorkWeight, pt: gc.performanceTaskWeight, qa: gc.quarterlyAssessWeight };
  }
  return { ...GENERIC_FALLBACK_WEIGHTS };
}
