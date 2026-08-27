import "dotenv/config";
import { PrismaClient, Term } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL!;
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

// Grading weights (generic fallback when subject has no weights)
const WW_WEIGHT = 20;
const PT_WEIGHT = 50;
const QA_WEIGHT = 30;

// Deterministic pseudo-random (mulberry32)
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function randFloat(rng: () => number, min: number, max: number, decimals = 2): number {
  return Math.round((rng() * (max - min) + min) * 10 ** decimals) / 10 ** decimals;
}

interface TierDef {
  label: string;
  count: number;
  initialGradeRange: [number, number];
  wwPctRange: [number, number];
  ptPctRange: [number, number];
  qaPctRange: [number, number];
}

const TIERS: TierDef[] = [
  { label: "with high honors", count: 5, initialGradeRange: [98, 100], wwPctRange: [0.97, 1.0], ptPctRange: [0.97, 1.0], qaPctRange: [0.97, 1.0] },
  { label: "with honors", count: 10, initialGradeRange: [90, 97], wwPctRange: [0.88, 0.98], ptPctRange: [0.88, 0.98], qaPctRange: [0.85, 0.97] },
  { label: "high", count: 12, initialGradeRange: [82, 89], wwPctRange: [0.78, 0.92], ptPctRange: [0.78, 0.92], qaPctRange: [0.75, 0.90] },
  { label: "average", count: 12, initialGradeRange: [75, 81], wwPctRange: [0.68, 0.82], ptPctRange: [0.65, 0.82], qaPctRange: [0.60, 0.80] },
  { label: "below average", count: 5, initialGradeRange: [65, 74], wwPctRange: [0.55, 0.72], ptPctRange: [0.50, 0.72], qaPctRange: [0.45, 0.70] },
  { label: "failed", count: 1, initialGradeRange: [40, 55], wwPctRange: [0.30, 0.50], ptPctRange: [0.25, 0.50], qaPctRange: [0.20, 0.45] },
];

function buildStudentTiers(studentCount: number, rng: () => number): number[] {
  const tiers: number[] = [];
  let remaining = studentCount;
  for (let t = 0; t < TIERS.length; t++) {
    const assign = t === TIERS.length - 1 ? remaining : Math.min(TIERS[t].count, remaining);
    for (let i = 0; i < assign; i++) tiers.push(t);
    remaining -= assign;
  }
  // Shuffle deterministically
  for (let i = tiers.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [tiers[i], tiers[j]] = [tiers[j], tiers[i]];
  }
  return tiers;
}

function pickInRange(rng: () => number, min: number, max: number): number {
  return randFloat(rng, min, max);
}

function buildWWScores(rng: () => number, targetPct: number): { name: string; score: number; maxScore: number }[] {
  const count = randInt(rng, 5, 8);
  const items: { name: string; score: number; maxScore: number }[] = [];
  for (let i = 1; i <= count; i++) {
    const max = randInt(rng, 10, 50);
    const score = Math.min(max, Math.round(max * targetPct * randFloat(rng, 0.85, 1.05)));
    items.push({ name: `WW${i}`, score, maxScore: max });
  }
  return items;
}

function buildPTScores(rng: () => number, targetPct: number): { name: string; score: number; maxScore: number }[] {
  const count = randInt(rng, 3, 5);
  const items: { name: string; score: number; maxScore: number }[] = [];
  for (let i = 1; i <= count; i++) {
    const max = randInt(rng, 20, 50);
    const score = Math.min(max, Math.round(max * targetPct * randFloat(rng, 0.85, 1.05)));
    items.push({ name: `PT${i}`, score, maxScore: max });
  }
  return items;
}

function calcPS(scores: { score: number; maxScore: number }[]): number {
  const totalScore = scores.reduce((s, x) => s + x.score, 0);
  const totalMax = scores.reduce((s, x) => s + x.maxScore, 0);
  return totalMax > 0 ? (totalScore / totalMax) * 100 : 0;
}

function getRemarks(grade: number): string {
  if (grade >= 98) return "with high honors";
  if (grade >= 90) return "with honors";
  if (grade >= 75) return "Passed";
  return "Failed";
}

function getQualitative(grade: number): string {
  if (grade >= 90) return "Outstanding";
  if (grade >= 85) return "Very Satisfactory";
  if (grade >= 80) return "Satisfactory";
  if (grade >= 75) return "Fairly Satisfactory";
  return "Did Not Meet Expectations";
}

function findTransmutedGrade(initialGrade: number, table: { minGrade: number; maxGrade: number; transmutedGrade: number }[]): number {
  const rounded = Math.round(initialGrade * 100) / 100;
  for (const entry of table) {
    if (rounded >= entry.minGrade && rounded <= entry.maxGrade) {
      return entry.transmutedGrade;
    }
  }
  return 60;
}

async function main() {
  console.log("Starting grade seeding...");

  // Fetch existing data
  const section = await prisma.section.findFirst({
    where: { name: "Diamond", schoolYear: "2025-2026" },
  });
  if (!section) throw new Error("Section Diamond not found. Run main seed first.");

  const enrollments = await prisma.enrollment.findMany({
    where: { sectionId: section.id, schoolYear: "2025-2026", status: "ENROLLED" },
    include: { student: true },
  });
  if (enrollments.length === 0) throw new Error("No enrollments found. Run main seed first.");

  const classAssignments = await prisma.classAssignment.findMany({
    where: { sectionId: section.id, schoolYear: "2025-2026", isActive: true },
    include: { subject: true, teacher: true },
  });
  if (classAssignments.length === 0) throw new Error("No class assignments found. Run main seed first.");

  const transmutationTable = await prisma.transmutationEntry.findMany({
    orderBy: { minGrade: "desc" },
  });
  if (transmutationTable.length === 0) throw new Error("No transmutation entries found. Run main seed first.");

  console.log(`Found ${enrollments.length} students, ${classAssignments.length} class assignments.`);

  // Assign tiers to students (deterministic)
  const rng = mulberry32(42);
  const studentTiers = buildStudentTiers(enrollments.length, rng);

  // Clear existing grades
  console.log("Clearing existing grades...");
  await prisma.gradeSnapshot.deleteMany({});
  await prisma.grade.deleteMany({});

  let totalGrades = 0;
  const terms: Term[] = [Term.T1, Term.T2, Term.T3];

  for (const ca of classAssignments) {
    console.log(`Seeding grades for ${ca.subject.name} (${ca.subject.code})...`);

    for (let si = 0; si < enrollments.length; si++) {
      const enrollment = enrollments[si];
      const tierIdx = studentTiers[si];
      const tier = TIERS[tierIdx];

      for (const term of terms) {
        // Per-term variation (±2%)
        const termVariation = randFloat(rng, -0.02, 0.02);
        const targetInitial = pickInRange(
          rng,
          tier.initialGradeRange[0] + termVariation * 10,
          tier.initialGradeRange[1] + termVariation * 10
        );

        // Generate component percentages that produce the target initial grade
        // initialGrade = wwPct*20 + ptPct*50 + qaPct*30
        const targetWWPct = pickInRange(rng, tier.wwPctRange[0], tier.wwPctRange[1]);
        const targetPTPct = pickInRange(rng, tier.ptPctRange[0], tier.ptPctRange[1]);
        const targetQAPct = pickInRange(rng, tier.qaPctRange[0], tier.qaPctRange[1]);

        // Build score arrays
        const wwScores = buildWWScores(rng, targetWWPct);
        const ptScores = buildPTScores(rng, targetPTPct);
        const qaMax = 50;
        const qaScore = Math.min(qaMax, Math.round(qaMax * targetQAPct * randFloat(rng, 0.9, 1.05)));

        // Calculate PS values
        const writtenWorkPS = calcPS(wwScores);
        const perfTaskPS = calcPS(ptScores);
        const quarterlyAssessPS = (qaScore / qaMax) * 100;

        // Calculate initial grade using actual DepEd weights
        const initialGrade =
          (writtenWorkPS * WW_WEIGHT) / 100 +
          (perfTaskPS * PT_WEIGHT) / 100 +
          (quarterlyAssessPS * QA_WEIGHT) / 100;

        // Transmute
        const quarterlyGrade = findTransmutedGrade(initialGrade, transmutationTable);

        const remarks = getRemarks(quarterlyGrade);
        const qualitativeDescriptor = getQualitative(quarterlyGrade);

        await prisma.grade.create({
          data: {
            studentId: enrollment.studentId,
            classAssignmentId: ca.id,
            term,
            writtenWorkScores: wwScores,
            perfTaskScores: ptScores,
            quarterlyAssessScore: qaScore,
            quarterlyAssessMax: qaMax,
            writtenWorkPS: Math.round(writtenWorkPS * 100) / 100,
            perfTaskPS: Math.round(perfTaskPS * 100) / 100,
            quarterlyAssessPS: Math.round(quarterlyAssessPS * 100) / 100,
            initialGrade: Math.round(initialGrade * 100) / 100,
            quarterlyGrade,
            remarks,
            qualitativeDescriptor,
          },
        });
        totalGrades++;
      }
    }
  }

  console.log(`\nGrade seeding completed! Created ${totalGrades} grade records.`);
  console.log(`  ${enrollments.length} students × ${classAssignments.length} subjects × 3 terms = ${totalGrades}`);

  // Summary
  console.log("\nTier distribution:");
  const tierCounts: Record<string, number> = {};
  for (const t of studentTiers) {
    const label = TIERS[t].label;
    tierCounts[label] = (tierCounts[label] || 0) + 1;
  }
  for (const [label, count] of Object.entries(tierCounts)) {
    console.log(`  ${label}: ${count} student(s)`);
  }
}

main()
  .catch((e) => {
    console.error("Error during grade seeding:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
