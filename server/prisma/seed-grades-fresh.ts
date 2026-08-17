/**
 * seed-grades-fresh.ts
 *
 * Standalone script that generates FRESH, REALISTIC grade data for ALL sections.
 * - Clears ALL existing grade data (Grade + GradeSnapshot)
 * - Generates grades for ALL class assignments across ALL sections (Grade 7-10)
 * - Diamond (Grade 7) gets 4 designated scenarios: Highest Honors, High Honors, Honors, Failed
 * - All other sections get realistic grade distribution
 * - Rotation subjects (Science, TLE) handled correctly per term
 * - All teachers get grades for ALL their subjects
 *
 * Usage:  npx ts-node prisma/seed-grades-fresh.ts
 */

import "dotenv/config";
import { PrismaClient, GradeLevel, Term, SubjectType } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { writeFileSync } from "fs";
import { join } from "path";

// ---------------------------------------------------------------------------
// Prisma
// ---------------------------------------------------------------------------
const connectionString = process.env.DATABASE_URL!;
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

// ---------------------------------------------------------------------------
// DepEd Transmutation Table (Revised Guidelines 2026)
// ---------------------------------------------------------------------------
function transmute(initialGrade: number): number {
  const roundedGrade = Math.round(initialGrade * 100) / 100;
  if (roundedGrade >= 99.5) return 100;
  const table: [number, number, number][] = [
    [97.5, 99.49, 99], [96.0, 97.49, 98], [95.0, 95.99, 97], [94.0, 94.99, 96],
    [93.0, 93.99, 95], [92.0, 92.99, 94], [91.0, 91.99, 93], [90.0, 90.99, 92],
    [89.0, 89.99, 91], [88.0, 88.99, 90], [87.0, 87.99, 89], [86.0, 86.99, 88],
    [85.0, 85.99, 87], [84.0, 84.99, 86], [83.0, 83.99, 85], [82.0, 82.99, 84],
    [81.0, 81.99, 83], [80.0, 80.99, 82], [79.0, 79.99, 81], [78.0, 78.99, 80],
    [77.0, 77.99, 79], [76.0, 76.99, 78], [75.0, 75.99, 77], [73.0, 74.99, 76],
    [70.0, 72.99, 75], [68.0, 69.99, 74], [66.0, 67.99, 73], [64.0, 65.99, 72],
    [62.0, 63.99, 71], [60.0, 61.99, 70], [58.0, 59.99, 69], [56.0, 57.99, 68],
    [54.0, 55.99, 67], [52.0, 53.99, 66], [50.0, 51.99, 65], [48.0, 49.99, 64],
    [46.0, 47.99, 63], [43.0, 45.99, 62], [40.0, 42.99, 61], [25.0, 39.99, 60],
    [0.0, 24.99, 60],
  ];
  for (const [min, max, grade] of table) {
    if (roundedGrade >= min && roundedGrade <= max) return grade;
  }
  return 60;
}

// ---------------------------------------------------------------------------
// Find initial grade that transmutes to target quarterly grade
// ---------------------------------------------------------------------------
function findInitialGradeForTarget(targetQG: number): number {
  let low = 0;
  let high = 100;
  let best = 50;
  for (let i = 0; i < 50; i++) {
    const mid = (low + high) / 2;
    if (transmute(mid) === targetQG) { best = mid; low = mid + 0.01; }
    else if (transmute(mid) < targetQG) low = mid + 0.01;
    else high = mid - 0.01;
  }
  if (transmute(best) === targetQG) return best;
  for (let ig = 0; ig <= 100; ig += 0.01) {
    if (transmute(ig) === targetQG) return ig;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Grade calculation (DepEd formula)
// ---------------------------------------------------------------------------
function calculateGrades(
  wwScores: Array<{ name: string; score: number; maxScore: number }> | null,
  ptScores: Array<{ name: string; score: number; maxScore: number }> | null,
  qaScore: number | null,
  qaMax: number,
  wwWeight: number,
  ptWeight: number,
  qaWeight: number,
) {
  let wwPS: number | null = null;
  if (wwScores && wwScores.length > 0) {
    const total = wwScores.reduce((s, i) => s + i.score, 0);
    const max = wwScores.reduce((s, i) => s + i.maxScore, 0);
    wwPS = max > 0 ? (total / max) * 100 : 0;
  }
  let ptPS: number | null = null;
  if (ptScores && ptScores.length > 0) {
    const total = ptScores.reduce((s, i) => s + i.score, 0);
    const max = ptScores.reduce((s, i) => s + i.maxScore, 0);
    ptPS = max > 0 ? (total / max) * 100 : 0;
  }
  let qaPS: number | null = null;
  if (qaScore !== null && qaMax > 0) qaPS = (qaScore / qaMax) * 100;
  let ig: number | null = null;
  if (wwPS !== null && ptPS !== null && qaPS !== null) {
    ig = (wwPS * wwWeight) / 100 + (ptPS * ptWeight) / 100 + (qaPS * qaWeight) / 100;
  }
  let qg: number | null = null;
  if (ig !== null) qg = transmute(ig);
  return { writtenWorkPS: wwPS, perfTaskPS: ptPS, quarterlyAssessPS: qaPS, initialGrade: ig, quarterlyGrade: qg };
}

// ---------------------------------------------------------------------------
// Score generators
// ---------------------------------------------------------------------------
function genWW(count: number, max: number, targetPS: number) {
  return Array.from({ length: count }, (_, i) => {
    const v = 1 + ((i % 3 === 0 ? -0.02 : i % 3 === 1 ? 0.01 : 0));
    return { name: `WW ${i + 1}`, score: Math.round(Math.max(0, Math.min(max, max * (targetPS / 100) * v))), maxScore: max };
  });
}
function genPT(count: number, max: number, targetPS: number) {
  return Array.from({ length: count }, (_, i) => {
    const v = 1 + ((i % 3 === 0 ? -0.015 : i % 3 === 1 ? 0.01 : 0.005));
    return { name: `PT ${i + 1}`, score: Math.round(Math.max(0, Math.min(max, max * (targetPS / 100) * v))), maxScore: max };
  });
}

// ---------------------------------------------------------------------------
// Build grade data for a target quarterly grade
// ---------------------------------------------------------------------------
function buildGradeForTarget(targetQG: number, weights: { ww: number; pt: number; qa: number }) {
  const targetInitial = findInitialGradeForTarget(targetQG);
  const wwPS = Math.min(100, Math.max(0, targetInitial + 1.5));
  const ptPS = Math.min(100, Math.max(0, targetInitial - 0.5));
  const qaPS = Math.min(100, Math.max(0, targetInitial + 0.3));
  const wwScores = genWW(4, 10, wwPS);
  const ptScores = genPT(4, 20, ptPS);
  const qaScore = Math.round(100 * (qaPS / 100));
  const computed = calculateGrades(wwScores, ptScores, qaScore, 100, weights.ww, weights.pt, weights.qa);
  return { writtenWorkScores: wwScores, perfTaskScores: ptScores, quarterlyAssessScore: qaScore, quarterlyAssessMax: 100, computed };
}

// ---------------------------------------------------------------------------
// Performance tiers
// ---------------------------------------------------------------------------
type Tier = "HIGHEST_HONORS" | "HIGH_HONORS" | "HONORS" | "FAILED" | "ABOVE_AVG" | "AVERAGE" | "BELOW_AVG" | "AT_RISK";

const TIER_QG: Record<Tier, number[]> = {
  HIGHEST_HONORS: [98, 99, 98],
  HIGH_HONORS: [95, 96, 95],
  HONORS: [91, 90, 92],
  FAILED: [65, 63, 68],
  ABOVE_AVG: [93, 91, 92],
  AVERAGE: [84, 83, 85],
  BELOW_AVG: [77, 76, 78],
  AT_RISK: [70, 68, 72],
};

const TIER_RANGE: Record<Tier, { min: number; max: number }> = {
  HIGHEST_HONORS: { min: 98, max: 100 },
  HIGH_HONORS: { min: 95, max: 97 },
  HONORS: { min: 90, max: 94 },
  FAILED: { min: 62, max: 72 },
  ABOVE_AVG: { min: 90, max: 97 },
  AVERAGE: { min: 80, max: 89 },
  BELOW_AVG: { min: 75, max: 79 },
  AT_RISK: { min: 65, max: 74 },
};

function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

// ---------------------------------------------------------------------------
// Report types
// ---------------------------------------------------------------------------
interface SectionReport {
  section: string;
  gradeLevel: string;
  totalStudents: number;
  totalAssignments: number;
  gradesCreated: number;
  designatedScenarios?: { name: string; lrn: string; tier: string; gwa: number | null; honor: string }[];
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------
async function main() {
  const startTime = Date.now();
  console.log("=== SMART Fresh Grade Seed Script (ALL SECTIONS) ===\n");

  // ------------------------------------------------------------------
  // PHASE 1: Clear ALL existing grade data
  // ------------------------------------------------------------------
  console.log("--- Phase 1: Clearing ALL grade data ---");
  const delSnap = await prisma.gradeSnapshot.deleteMany({});
  const delGrade = await prisma.grade.deleteMany({});
  console.log(`  Deleted ${delGrade.count} grades, ${delSnap.count} snapshots`);

  // ------------------------------------------------------------------
  // PHASE 2: Load current school year and ALL sections
  // ------------------------------------------------------------------
  console.log("\n--- Phase 2: Loading sections ---");

  const settings = await prisma.systemSettings.findUnique({ where: { id: "main" } });
  const currentSchoolYear = settings?.currentSchoolYear ?? "2026-2027";
  console.log(`  Current school year: ${currentSchoolYear}`);

  const allSections = await prisma.section.findMany({
    where: { schoolYear: currentSchoolYear },
    orderBy: [{ gradeLevel: "asc" }, { name: "asc" }],
  });
  console.log(`  Found ${allSections.length} sections for SY ${currentSchoolYear}`);

  const terms: Term[] = ["T1", "T2", "T3"];
  const allReports: SectionReport[] = [];
  let totalGrades = 0;
  let totalSnapshots = 0;

  // ------------------------------------------------------------------
  // PHASE 3: Process each section
  // ------------------------------------------------------------------
  for (const sec of allSections) {
    console.log(`\n--- Processing: ${sec.gradeLevel} ${sec.name} ---`);

    // Get enrolled students
    const enrollments = await prisma.enrollment.findMany({
      where: { sectionId: sec.id, status: "ENROLLED" },
      include: { student: true },
    });
    if (enrollments.length === 0) {
      console.log(`  No enrolled students — skipping`);
      continue;
    }

    // Get class assignments
    const cas = await prisma.classAssignment.findMany({
      where: { sectionId: sec.id, isActive: true },
      include: { teacher: { include: { user: true } }, subject: true },
    });
    if (cas.length === 0) {
      console.log(`  No class assignments — skipping`);
      continue;
    }

    console.log(`  Students: ${enrollments.length} | Assignments: ${cas.length}`);

    // Sort students alphabetically for deterministic tier assignment
    const sorted = [...enrollments].sort((a, b) => {
      const cmp = (a.student.lastName ?? "").localeCompare(b.student.lastName ?? "");
      return cmp !== 0 ? cmp : (a.student.firstName ?? "").localeCompare(b.student.firstName ?? "");
    });

    // Assign tiers: Diamond Grade 7 gets designated scenarios, others get realistic distribution
    const isDiamond = sec.name === "Diamond" && sec.gradeLevel === "GRADE_7";
    const studentTiers = new Map<string, Tier>();

    if (isDiamond) {
      // Designated scenarios for first 4 students
      const designated: Tier[] = ["HIGHEST_HONORS", "HIGH_HONORS", "HONORS", "FAILED"];
      for (let i = 0; i < sorted.length; i++) {
        if (i < designated.length) {
          studentTiers.set(sorted[i].studentId, designated[i]);
        } else {
          const r = seededRandom(i * 137 + 42);
          studentTiers.set(sorted[i].studentId,
            r < 0.10 ? "AT_RISK" : r < 0.25 ? "BELOW_AVG" : r < 0.75 ? "AVERAGE" : r < 0.90 ? "ABOVE_AVG" : "HONORS"
          );
        }
      }
    } else {
      // Realistic distribution for all sections
      for (let i = 0; i < sorted.length; i++) {
        const r = seededRandom(i * 97 + sorted.length * 13 + sec.name.charCodeAt(0));
        let tier: Tier;
        if (r < 0.05) tier = "HIGHEST_HONORS";
        else if (r < 0.12) tier = "HIGH_HONORS";
        else if (r < 0.22) tier = "HONORS";
        else if (r < 0.35) tier = "ABOVE_AVG";
        else if (r < 0.70) tier = "AVERAGE";
        else if (r < 0.85) tier = "BELOW_AVG";
        else if (r < 0.93) tier = "AT_RISK";
        else tier = "FAILED";
        studentTiers.set(sorted[i].studentId, tier);
      }
    }

    // Log tier distribution
    const tierCounts = new Map<Tier, number>();
    for (const t of studentTiers.values()) tierCounts.set(t, (tierCounts.get(t) ?? 0) + 1);
    const tierStr = [...tierCounts.entries()].map(([t, c]) => `${t}:${c}`).join(" ");
    console.log(`  Tiers: ${tierStr}`);

    // Generate grades for each class assignment
    let sectionGrades = 0;
    for (const ca of cas) {
      const isRotation = ca.subject.rotationTermGroupId !== null;
      const rotRank = ca.subject.rotationTermRank;
      const isHG = ca.subject.code.startsWith("HG");
      const weights = { ww: ca.subject.writtenWorkWeight, pt: ca.subject.perfTaskWeight, qa: ca.subject.quarterlyAssessWeight };

      for (const enrollment of sorted) {
        const student = enrollment.student;
        const tier = studentTiers.get(student.id) ?? "AVERAGE";
        const qgTargets = TIER_QG[tier];

        if (isRotation) {
          // Rotation subject: generate grades for ALL 3 terms
          // (so dashboard shows them regardless of current term)
          for (const term of terms) {
            const termIdx = terms.indexOf(term);
            const qgTarget = qgTargets[termIdx];

            let gradeData;
            if (isHG) {
              const descs = ["No Improvement", "Needs Improvement", "Developing", "Sufficiently Developed"];
              const di = tier === "HIGHEST_HONORS" ? 3 : tier === "HIGH_HONORS" ? 2 : tier === "HONORS" ? 1 : 0;
              gradeData = {
                writtenWorkScores: null, perfTaskScores: null, quarterlyAssessScore: null, quarterlyAssessMax: 100,
                computed: { writtenWorkPS: null, perfTaskPS: null, quarterlyAssessPS: null, initialGrade: null, quarterlyGrade: null },
                qualitativeDescriptor: descs[di],
              };
            } else {
              gradeData = buildGradeForTarget(qgTarget, weights);
            }

            const qg = gradeData.computed.quarterlyGrade;
            const remarks = qg !== null ? (qg < 75 ? "Failed" : "Passed") : null;

            try {
              const gr = await prisma.grade.upsert({
                where: { studentId_classAssignmentId_term: { studentId: student.id, classAssignmentId: ca.id, term } },
                update: {
                  writtenWorkScores: gradeData.writtenWorkScores as any,
                  perfTaskScores: gradeData.perfTaskScores as any,
                  quarterlyAssessScore: gradeData.quarterlyAssessScore,
                  quarterlyAssessMax: gradeData.quarterlyAssessMax,
                  writtenWorkPS: gradeData.computed.writtenWorkPS,
                  perfTaskPS: gradeData.computed.perfTaskPS,
                  quarterlyAssessPS: gradeData.computed.quarterlyAssessPS,
                  initialGrade: gradeData.computed.initialGrade,
                  quarterlyGrade: gradeData.computed.quarterlyGrade,
                  remarks,
                  qualitativeDescriptor: (gradeData as any).qualitativeDescriptor ?? null,
                },
                create: {
                  studentId: student.id, classAssignmentId: ca.id, term,
                  writtenWorkScores: gradeData.writtenWorkScores as any,
                  perfTaskScores: gradeData.perfTaskScores as any,
                  quarterlyAssessScore: gradeData.quarterlyAssessScore,
                  quarterlyAssessMax: gradeData.quarterlyAssessMax,
                  writtenWorkPS: gradeData.computed.writtenWorkPS,
                  perfTaskPS: gradeData.computed.perfTaskPS,
                  quarterlyAssessPS: gradeData.computed.quarterlyAssessPS,
                  initialGrade: gradeData.computed.initialGrade,
                  quarterlyGrade: gradeData.computed.quarterlyGrade,
                  remarks,
                  qualitativeDescriptor: (gradeData as any).qualitativeDescriptor ?? null,
                },
              });
              sectionGrades++;

              try {
                await prisma.gradeSnapshot.create({
                  data: {
                    gradeId: gr.id, studentId: student.id, classAssignmentId: ca.id,
                    teacherId: ca.teacherId, subjectCode: ca.subject.code, subjectName: ca.subject.name,
                    sectionId: sec.id, sectionName: sec.name,
                    schoolYear: sec.schoolYear, term, snapshot: gr as any,
                  },
                });
                totalSnapshots++;
              } catch {}
            } catch {}
          }
        } else {
          // Standalone subject: all 3 terms
          for (const term of terms) {
            const termIdx = terms.indexOf(term);
            const qgTarget = qgTargets[termIdx];

            let gradeData;
            if (isHG) {
              const descs = ["No Improvement", "Needs Improvement", "Developing", "Sufficiently Developed"];
              const di = tier === "HIGHEST_HONORS" ? 3 : tier === "HIGH_HONORS" ? 2 : tier === "HONORS" ? 1 : 0;
              gradeData = {
                writtenWorkScores: null, perfTaskScores: null, quarterlyAssessScore: null, quarterlyAssessMax: 100,
                computed: { writtenWorkPS: null, perfTaskPS: null, quarterlyAssessPS: null, initialGrade: null, quarterlyGrade: null },
                qualitativeDescriptor: descs[di],
              };
            } else {
              gradeData = buildGradeForTarget(qgTarget, weights);
            }

            const qg = gradeData.computed.quarterlyGrade;
            const remarks = qg !== null ? (qg < 75 ? "Failed" : "Passed") : null;

            try {
              const gr = await prisma.grade.upsert({
                where: { studentId_classAssignmentId_term: { studentId: student.id, classAssignmentId: ca.id, term } },
                update: {
                  writtenWorkScores: gradeData.writtenWorkScores as any,
                  perfTaskScores: gradeData.perfTaskScores as any,
                  quarterlyAssessScore: gradeData.quarterlyAssessScore,
                  quarterlyAssessMax: gradeData.quarterlyAssessMax,
                  writtenWorkPS: gradeData.computed.writtenWorkPS,
                  perfTaskPS: gradeData.computed.perfTaskPS,
                  quarterlyAssessPS: gradeData.computed.quarterlyAssessPS,
                  initialGrade: gradeData.computed.initialGrade,
                  quarterlyGrade: gradeData.computed.quarterlyGrade,
                  remarks,
                  qualitativeDescriptor: (gradeData as any).qualitativeDescriptor ?? null,
                },
                create: {
                  studentId: student.id, classAssignmentId: ca.id, term,
                  writtenWorkScores: gradeData.writtenWorkScores as any,
                  perfTaskScores: gradeData.perfTaskScores as any,
                  quarterlyAssessScore: gradeData.quarterlyAssessScore,
                  quarterlyAssessMax: gradeData.quarterlyAssessMax,
                  writtenWorkPS: gradeData.computed.writtenWorkPS,
                  perfTaskPS: gradeData.computed.perfTaskPS,
                  quarterlyAssessPS: gradeData.computed.quarterlyAssessPS,
                  initialGrade: gradeData.computed.initialGrade,
                  quarterlyGrade: gradeData.computed.quarterlyGrade,
                  remarks,
                  qualitativeDescriptor: (gradeData as any).qualitativeDescriptor ?? null,
                },
              });
              sectionGrades++;

              try {
                await prisma.gradeSnapshot.create({
                  data: {
                    gradeId: gr.id, studentId: student.id, classAssignmentId: ca.id,
                    teacherId: ca.teacherId, subjectCode: ca.subject.code, subjectName: ca.subject.name,
                    sectionId: sec.id, sectionName: sec.name,
                    schoolYear: sec.schoolYear, term, snapshot: gr as any,
                  },
                });
                totalSnapshots++;
              } catch {}
            } catch {}
          }
        }
      }
    }

    totalGrades += sectionGrades;
    console.log(`  Grades created: ${sectionGrades}`);

    // Verify designated students (Diamond only)
    let designatedReport: { name: string; lrn: string; tier: string; gwa: number | null; honor: string }[] | undefined;
    if (isDiamond) {
      designatedReport = [];
      for (let i = 0; i < Math.min(4, sorted.length); i++) {
        const student = sorted[i].student;
        const tier = studentTiers.get(student.id)!;
        const targetRange = TIER_RANGE[tier];

        const studentGrades = await prisma.grade.findMany({
          where: { studentId: student.id },
          include: { classAssignment: { include: { subject: true } } },
        });

        const subjectFinals = new Map<string, number[]>();
        for (const g of studentGrades) {
          if (g.quarterlyGrade === null) continue;
          const key = g.classAssignment.subject.code;
          if (!subjectFinals.has(key)) subjectFinals.set(key, []);
          subjectFinals.get(key)!.push(g.quarterlyGrade);
        }

        const finals: number[] = [];
        for (const [, grades] of subjectFinals) {
          finals.push(Math.round(grades.reduce((a, b) => a + b, 0) / grades.length));
        }

        const gwa = finals.length > 0 ? Math.round((finals.reduce((a, b) => a + b, 0) / finals.length) * 100) / 100 : null;
        const honor = gwa !== null
          ? gwa >= 98 ? "With Highest Honors" : gwa >= 95 ? "With High Honors" : gwa >= 90 ? "With Honors" : gwa >= 85 ? "With Honors (Special)" : "No Honors"
          : "N/A";

        const pass = gwa !== null && gwa >= targetRange.min && gwa <= targetRange.max;
        console.log(`  ${pass ? "✓" : "✗"} ${student.firstName} ${student.lastName} | GWA: ${gwa} | Target: ${targetRange.min}-${targetRange.max} | ${honor}`);
        designatedReport.push({ name: `${student.firstName} ${student.lastName}`, lrn: student.lrn, tier, gwa, honor });
      }
    }

    allReports.push({
      section: sec.name,
      gradeLevel: sec.gradeLevel,
      totalStudents: sorted.length,
      totalAssignments: cas.length,
      gradesCreated: sectionGrades,
      designatedScenarios: designatedReport,
    });
  }

  // ------------------------------------------------------------------
  // PHASE 4: Summary report
  // ------------------------------------------------------------------
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("\n=== SUMMARY ===");
  console.log(`Duration: ${duration}s`);
  console.log(`Sections: ${allReports.length}`);
  console.log(`Total grades: ${totalGrades}`);
  console.log(`Total snapshots: ${totalSnapshots}`);

  // Teacher coverage check
  const teacherGrades = await prisma.classAssignment.findMany({
    where: { isActive: true },
    include: {
      teacher: { include: { user: true } },
      subject: true,
      section: { select: { name: true, gradeLevel: true } },
      _count: { select: { grades: true } },
    },
  });

  const teacherMap = new Map<string, { name: string; assignments: number; withGrades: number; withoutGrades: number }>();
  for (const ca of teacherGrades) {
    const key = ca.teacherId;
    const existing = teacherMap.get(key) ?? { name: `${ca.teacher.user.firstName} ${ca.teacher.user.lastName}`, assignments: 0, withGrades: 0, withoutGrades: 0 };
    existing.assignments++;
    if (ca._count.grades > 0) existing.withGrades++;
    else existing.withoutGrades++;
    teacherMap.set(key, existing);
  }

  console.log("\n=== TEACHER COVERAGE ===");
  let allCovered = true;
  for (const [, t] of teacherMap) {
    const status = t.withoutGrades === 0 ? "✓" : `✗ MISSING ${t.withoutGrades}`;
    if (t.withoutGrades > 0) allCovered = false;
    console.log(`  ${status} ${t.name} | assignments: ${t.assignments} | with grades: ${t.withGrades}`);
  }
  console.log(`\nAll teachers covered: ${allCovered ? "YES ✓" : "NO ✗"}`);

  // Write report file
  let report = `# Fresh Grade Seed Report (All Sections)\n\n`;
  report += `**Generated:** ${new Date().toISOString()} | **Duration:** ${duration}s\n\n`;
  report += `## Summary\n\n`;
  report += `| Metric | Count |\n|--------|-------|\n`;
  report += `| Sections | ${allReports.length} |\n`;
  report += `| Total Grades | ${totalGrades} |\n`;
  report += `| Snapshots | ${totalSnapshots} |\n\n`;

  report += `## Per Section\n\n`;
  report += `| Section | Grade Level | Students | Assignments | Grades |\n`;
  report += `|---------|-------------|----------|-------------|--------|\n`;
  for (const r of allReports) {
    report += `| ${r.section} | ${r.gradeLevel} | ${r.totalStudents} | ${r.totalAssignments} | ${r.gradesCreated} |\n`;
  }

  report += `\n## Diamond Designated Students\n\n`;
  const diamondReport = allReports.find((r) => r.section === "Diamond" && r.gradeLevel === "GRADE_7");
  if (diamondReport?.designatedScenarios) {
    report += `| Student | LRN | Tier | GWA | Honor |\n`;
    report += `|---------|-----|------|-----|-------|\n`;
    for (const d of diamondReport.designatedScenarios) {
      report += `| ${d.name} | ${d.lrn} | ${d.tier} | ${d.gwa ?? "N/A"} | ${d.honor} |\n`;
    }
  }

  report += `\n## Teacher Coverage\n\n`;
  report += `| Teacher | Assignments | With Grades | Status |\n`;
  report += `|---------|-------------|-------------|--------|\n`;
  for (const [, t] of teacherMap) {
    report += `| ${t.name} | ${t.assignments} | ${t.withGrades} | ${t.withoutGrades === 0 ? "✓ Complete" : "✗ Missing"} |\n`;
  }

  const reportPath = join(__dirname, "GRADE_SEED_FRESH_REPORT.md");
  writeFileSync(reportPath, report, "utf-8");
  console.log(`\nReport: ${reportPath}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  prisma.$disconnect();
  process.exit(1);
});
