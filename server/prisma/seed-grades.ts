/**
 * seed-grades.ts
 *
 * Standalone script that:
 *  1. Syncs teachers, sections, students from EnrollPro
 *  2. Syncs subjects, class assignments from Atlas
 *  3. Generates grades for ALL students × ALL class assignments × ALL terms (T1, T2, T3)
 *  4. Covers 8 test scenarios + edge cases
 *  5. Produces a navigation report (GRADE_SEED_REPORT.md)
 *
 * Usage:  npx ts-node prisma/seed-grades.ts
 */

import "dotenv/config";
import { PrismaClient, GradeLevel, Term, AuditAction, AuditSeverity } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import https from "https";
import http from "http";
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
// HTTP helpers
// ---------------------------------------------------------------------------
function httpGet(url: string, headers: Record<string, string> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === "https:" ? https : http;
    const reqOptions: Record<string, any> = {
      hostname: parsed.hostname,
      port: parsed.port ? parseInt(parsed.port) : parsed.protocol === "https:" ? 443 : 80,
      path: parsed.pathname + parsed.search,
      method: "GET",
      rejectUnauthorized: false,
      headers: { "Content-Type": "application/json", ...headers },
    };
    const req = (lib as any).request(reqOptions, (res: any) => {
      let body = "";
      res.on("data", (c: any) => (body += c));
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`HTTP ${res.statusCode} ${url}: ${body.slice(0, 300)}`));
        }
        try { resolve(JSON.parse(body)); } catch { resolve(body); }
      });
    });
    req.on("error", reject);
    req.setTimeout(30000, () => { req.destroy(new Error(`Timeout: ${url}`)); });
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const ENROLLPRO_BASE = (process.env.ENROLLPRO_URL ?? process.env.ENROLLPRO_BASE_URL ?? "https://dev-jegs.buru-degree.ts.net/api").replace(/\/$/, "");
const ATLAS_BASE = (process.env.ATLAS_URL ?? process.env.ATLAS_BASE_URL ?? "https://njgrm.buru-degree.ts.net/api/v1").replace(/\/$/, "");
const ATLAS_SCHOOL_ID = Number(process.env.ATLAS_SCHOOL_ID ?? "1");
const ATLAS_SCHOOL_YEAR_ID = parseInt(process.env.ATLAS_SCHOOL_YEAR_ID ?? "3", 10);
const ATLAS_TOKEN = process.env.ATLAS_SYSTEM_TOKEN ?? "";
const EP_ACCOUNT_NAME = process.env.ENROLLPRO_ACCOUNT_NAME ?? "1000001";
const EP_PASSWORD = process.env.ENROLLPRO_PASSWORD ?? "";

// ---------------------------------------------------------------------------
// Grade level mapping
// ---------------------------------------------------------------------------
function mapGradeLevel(name: string | null | undefined): GradeLevel | null {
  const n = (name ?? "").toLowerCase();
  if (n.includes("10")) return "GRADE_10";
  if (n.includes("7")) return "GRADE_7";
  if (n.includes("8")) return "GRADE_8";
  if (n.includes("9")) return "GRADE_9";
  return null;
}

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
// Grade calculation (DepEd formula)
// ---------------------------------------------------------------------------
function calculateGrades(
  writtenWorkScores: Array<{ name: string; score: number; maxScore: number }> | null,
  perfTaskScores: Array<{ name: string; score: number; maxScore: number }> | null,
  quarterlyAssessScore: number | null,
  quarterlyAssessMax: number,
  wwWeight: number,
  ptWeight: number,
  qaWeight: number,
) {
  let writtenWorkPS: number | null = null;
  if (writtenWorkScores && writtenWorkScores.length > 0) {
    const totalScore = writtenWorkScores.reduce((s, i) => s + i.score, 0);
    const totalMax = writtenWorkScores.reduce((s, i) => s + i.maxScore, 0);
    writtenWorkPS = totalMax > 0 ? (totalScore / totalMax) * 100 : 0;
  }
  let perfTaskPS: number | null = null;
  if (perfTaskScores && perfTaskScores.length > 0) {
    const totalScore = perfTaskScores.reduce((s, i) => s + i.score, 0);
    const totalMax = perfTaskScores.reduce((s, i) => s + i.maxScore, 0);
    perfTaskPS = totalMax > 0 ? (totalScore / totalMax) * 100 : 0;
  }
  let quarterlyAssessPS: number | null = null;
  if (quarterlyAssessScore !== null && quarterlyAssessMax > 0) {
    quarterlyAssessPS = (quarterlyAssessScore / quarterlyAssessMax) * 100;
  }
  let initialGrade: number | null = null;
  if (writtenWorkPS !== null && perfTaskPS !== null && quarterlyAssessPS !== null) {
    initialGrade = (writtenWorkPS * wwWeight) / 100 + (perfTaskPS * ptWeight) / 100 + (quarterlyAssessPS * qaWeight) / 100;
  }
  let quarterlyGrade: number | null = null;
  if (initialGrade !== null) quarterlyGrade = transmute(initialGrade);
  return { writtenWorkPS, perfTaskPS, quarterlyAssessPS, initialGrade, quarterlyGrade };
}

// ---------------------------------------------------------------------------
// Score generators
// ---------------------------------------------------------------------------
function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateWWScores(count: number, maxPerItem: number, scoreRatio: number): Array<{ name: string; score: number; maxScore: number }> {
  return Array.from({ length: count }, (_, i) => {
    const maxScore = maxPerItem;
    const score = Math.round(maxScore * scoreRatio * (0.85 + Math.random() * 0.3));
    return { name: `WW ${i + 1}`, score: Math.min(score, maxScore), maxScore };
  });
}

function generatePTScores(count: number, maxPerItem: number, scoreRatio: number): Array<{ name: string; score: number; maxScore: number }> {
  return Array.from({ length: count }, (_, i) => {
    const maxScore = maxPerItem;
    const score = Math.round(maxScore * scoreRatio * (0.85 + Math.random() * 0.3));
    return { name: `PT ${i + 1}`, score: Math.min(score, maxScore), maxScore };
  });
}

// ---------------------------------------------------------------------------
// Scenario types
// ---------------------------------------------------------------------------
type Scenario =
  | "COMPLETE"
  | "MISSING_T3"
  | "MISSING_T1"
  | "EMPTY_SCORES"
  | "FAILING"
  | "PERFECT"
  | "PARTIAL_WW_ONLY"
  | "PARTIAL_NO_QA";

// ---------------------------------------------------------------------------
// Scenario configuration — realistic distribution
// ---------------------------------------------------------------------------
const DESIGNATED_SECTION = "Makatao";

// Edge-case subjects (only these subjects get error scenarios for students 1-3)
const EDGE_CASE_SUBJECTS = ["Math", "Sci", "English"];

// Per-student scenario map for designated section students
// Student 0: ALL subjects have EMPTY_SCORES (fully blank)
// Student 1: 3 subjects get MISSING_T3, rest COMPLETE
// Student 2: 2 subjects get FAILING, rest COMPLETE
// Student 3: 2 subjects get PARTIAL_WW_ONLY, 1 gets PARTIAL_NO_QA, rest COMPLETE
const DESIGNATED_STUDENT_SCENARIOS: Record<number, Record<string, Scenario>> = {
  0: Object.fromEntries(EDGE_CASE_SUBJECTS.map((s) => [s, "EMPTY_SCORES"])),
  1: { Math: "MISSING_T3", Sci: "MISSING_T3", English: "MISSING_T3" },
  2: { Math: "FAILING", Sci: "FAILING" },
  3: { Math: "PARTIAL_WW_ONLY", Sci: "PARTIAL_WW_ONLY", English: "PARTIAL_NO_QA" },
};

// 5 specific students (first 5 globally) get one error scenario each
const EDGE_CASE_STUDENTS: Scenario[] = [
  "MISSING_T1", "MISSING_T3", "FAILING", "PARTIAL_WW_ONLY", "PARTIAL_NO_QA",
];

const SCENARIO_LIST: Scenario[] = [
  "COMPLETE", "MISSING_T3", "MISSING_T1", "EMPTY_SCORES",
  "FAILING", "PERFECT", "PARTIAL_WW_ONLY", "PARTIAL_NO_QA",
];

// ---------------------------------------------------------------------------
// Grade generation per scenario
// ---------------------------------------------------------------------------
function buildGradeData(
  scenario: Scenario,
  term: Term,
  weights: { ww: number; pt: number; qa: number },
): {
  writtenWorkScores: Array<{ name: string; score: number; maxScore: number }> | null;
  perfTaskScores: Array<{ name: string; score: number; maxScore: number }> | null;
  quarterlyAssessScore: number | null;
  quarterlyAssessMax: number;
  computed: ReturnType<typeof calculateGrades>;
} {
  const wwCount = randomBetween(3, 5);
  const ptCount = randomBetween(3, 5);
  const wwMax = 10;
  const ptMax = 20;
  const qaMax = 100;

  let wwScores: Array<{ name: string; score: number; maxScore: number }> | null = null;
  let ptScores: Array<{ name: string; score: number; maxScore: number }> | null = null;
  let qaScore: number | null = null;

  switch (scenario) {
    case "COMPLETE":
      wwScores = generateWWScores(wwCount, wwMax, 0.75);
      ptScores = generatePTScores(ptCount, ptMax, 0.75);
      qaScore = Math.round(qaMax * 0.75 * (0.85 + Math.random() * 0.3));
      qaScore = Math.min(qaScore, qaMax);
      break;
    case "MISSING_T3":
      if (term === "T3") {
        // Return empty — no grade row for this term
        return buildEmptyGradeData(weights);
      }
      wwScores = generateWWScores(wwCount, wwMax, 0.70);
      ptScores = generatePTScores(ptCount, ptMax, 0.70);
      qaScore = Math.round(qaMax * 0.70 * (0.85 + Math.random() * 0.3));
      qaScore = Math.min(qaScore, qaMax);
      break;
    case "MISSING_T1":
      if (term === "T1") {
        return buildEmptyGradeData(weights);
      }
      wwScores = generateWWScores(wwCount, wwMax, 0.70);
      ptScores = generatePTScores(ptCount, ptMax, 0.70);
      qaScore = Math.round(qaMax * 0.70 * (0.85 + Math.random() * 0.3));
      qaScore = Math.min(qaScore, qaMax);
      break;
    case "EMPTY_SCORES":
      // Grade row exists but all scores null
      break;
    case "FAILING":
      wwScores = generateWWScores(wwCount, wwMax, 0.20);
      ptScores = generatePTScores(ptCount, ptMax, 0.15);
      qaScore = Math.round(qaMax * 0.10);
      break;
    case "PERFECT":
      wwScores = generateWWScores(wwCount, wwMax, 1.0);
      ptScores = generatePTScores(ptCount, ptMax, 1.0);
      qaScore = qaMax;
      break;
    case "PARTIAL_WW_ONLY":
      wwScores = generateWWScores(wwCount, wwMax, 0.75);
      break;
    case "PARTIAL_NO_QA":
      wwScores = generateWWScores(wwCount, wwMax, 0.75);
      ptScores = generatePTScores(ptCount, ptMax, 0.75);
      break;
  }

  const computed = calculateGrades(wwScores, ptScores, qaScore, qaMax, weights.ww, weights.pt, weights.qa);
  return { writtenWorkScores: wwScores, perfTaskScores: ptScores, quarterlyAssessScore: qaScore, quarterlyAssessMax: qaMax, computed };
}

function buildEmptyGradeData(weights: { ww: number; pt: number; qa: number }) {
  const computed = calculateGrades(null, null, null, 100, weights.ww, weights.pt, weights.qa);
  return { writtenWorkScores: null, perfTaskScores: null, quarterlyAssessScore: null, quarterlyAssessMax: 100, computed };
}

// ---------------------------------------------------------------------------
// Report entry type
// ---------------------------------------------------------------------------
interface ReportEntry {
  sectionName: string;
  gradeLevel: string;
  subjectCode: string;
  subjectName: string;
  teacherName: string;
  studentName: string;
  studentLRN: string;
  t1Grade: number | null;
  t2Grade: number | null;
  t3Grade: number | null;
  finalRating: number | null;
  finalRemarks: string | null;
  scenario: Scenario;
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------
async function main() {
  const startTime = Date.now();
  console.log("=== SMART Grade Seed Script ===");
  console.log(`Started at: ${new Date().toISOString()}\n`);

  // ------------------------------------------------------------------
  // PHASE 1: Sync from EnrollPro
  // ------------------------------------------------------------------
  console.log("--- Phase 1: Syncing from EnrollPro ---");

  // 1a. Resolve school year (multi-step fallback matching enrollproClient.ts)
  const settings = await prisma.systemSettings.findUnique({ where: { id: "main" }, select: { currentSchoolYear: true } });
  const preferredLabel = process.env.ENROLLPRO_SCHOOL_YEAR_LABEL ?? settings?.currentSchoolYear;
  let schoolYearLabel = preferredLabel ?? "2026-2027";
  let enrollProSchoolYearId: number | null = null;
  const envSYId = parseInt(process.env.ENROLLPRO_SCHOOL_YEAR_ID ?? "38", 10);

  // Step 1: Try integration v1 active school year
  try {
    const syResult = await httpGet(`${ENROLLPRO_BASE}/integration/v1/school-year`);
    const syData = syResult?.data ?? syResult;
    if (syData?.id && syData?.yearLabel) {
      enrollProSchoolYearId = syData.id;
      schoolYearLabel = syData.yearLabel;
      console.log(`  Active SY (integration v1): ${schoolYearLabel} (id=${enrollProSchoolYearId})`);
    }
  } catch (err: any) {
    console.warn(`  Integration v1 SY fetch failed: ${err.message}`);
  }

  // Step 2: Try /school-years endpoint
  if (!enrollProSchoolYearId) {
    try {
      const syList = await httpGet(`${ENROLLPRO_BASE}/school-years`);
      const years = Array.isArray(syList) ? syList : (syList?.data ?? []);
      if (years.length > 0) {
        const wanted = (preferredLabel ?? "").trim();
        const byLabel = wanted ? years.find((sy: any) => String(sy.yearLabel ?? sy.label ?? "").trim() === wanted) : undefined;
        const active = years.find((sy: any) => (sy.status ?? "").toUpperCase() === "ACTIVE");
        const latest = [...years].sort((a: any, b: any) => (b.id ?? 0) - (a.id ?? 0))[0];
        const picked = byLabel ?? active ?? latest;
        if (picked?.id) {
          enrollProSchoolYearId = picked.id;
          schoolYearLabel = picked.yearLabel ?? picked.label ?? schoolYearLabel;
          console.log(`  Active SY (school-years): ${schoolYearLabel} (id=${enrollProSchoolYearId})`);
        }
      }
    } catch (err: any) {
      console.warn(`  School-years fetch failed: ${err.message}`);
    }
  }

  // Step 3: Env fallback
  if (!enrollProSchoolYearId) {
    enrollProSchoolYearId = Number.isFinite(envSYId) ? envSYId : 3;
    console.log(`  Using env/default SY: ${schoolYearLabel} (id=${enrollProSchoolYearId})`);
  }

  // Update local settings
  await prisma.systemSettings.upsert({
    where: { id: "main" },
    update: { currentSchoolYear: schoolYearLabel },
    create: { id: "main", currentSchoolYear: schoolYearLabel },
  });

  // 1b. Fetch teachers from EnrollPro
  console.log("\n  Fetching EnrollPro teachers...");
  let epTeachers: any[] = [];
  try {
    const data = await httpGet(`${ENROLLPRO_BASE}/integration/v1/faculty?schoolYearId=${enrollProSchoolYearId}&page=1&limit=500`);
    epTeachers = data?.faculty ?? data?.data ?? data ?? [];
    if (!Array.isArray(epTeachers)) epTeachers = [];
    // Paginate if needed
    if (data?.pagination?.totalPages > 1) {
      for (let p = 2; p <= data.pagination.totalPages; p++) {
        const pageData = await httpGet(`${ENROLLPRO_BASE}/integration/v1/faculty?schoolYearId=${enrollProSchoolYearId}&page=${p}&limit=500`);
        const pageFaculty = pageData?.faculty ?? pageData?.data ?? pageData ?? [];
        if (Array.isArray(pageFaculty)) epTeachers.push(...pageFaculty);
      }
    }
  } catch (err: any) {
    console.warn(`  Faculty fetch failed: ${err.message}`);
  }
  console.log(`  Found ${epTeachers.length} EnrollPro teachers`);

  // 1c. Upsert teachers into local DB
  const epTeacherIdToEmpId = new Map<number, string>();
  const empIdToSmartTeacherId = new Map<string, string>();

  for (const ep of epTeachers) {
    const empId = String(ep.employeeId ?? "").trim();
    if (!empId) continue;
    epTeacherIdToEmpId.set(Number(ep.id ?? ep.teacherId), empId);

    const firstName = ep.firstName ?? "";
    const lastName = ep.lastName ?? "";
    const email = ep.email ?? `${empId}@deped.gov.ph`;

    try {
      const user = await prisma.user.findFirst({ where: { OR: [{ username: empId }, { email }] } });
      let userId = user?.id;
      if (!user) {
        const bcrypt = await import("bcryptjs");
        const hashed = await bcrypt.hash("password123", 10);
        const created = await prisma.user.create({ data: { username: empId, email, password: hashed, role: "TEACHER", firstName, lastName } });
        userId = created.id;
      } else {
        await prisma.user.update({ where: { id: user.id }, data: { firstName, lastName } });
      }
      if (userId) {
        const teacher = await prisma.teacher.upsert({
          where: { employeeId: empId },
          update: { userId },
          create: { employeeId: empId, userId },
        });
        empIdToSmartTeacherId.set(empId, teacher.id);
      }
    } catch (err: any) {
      console.warn(`  Teacher ${empId} error: ${err.message}`);
    }
  }
  console.log(`  Synced ${empIdToSmartTeacherId.size} teachers to local DB`);

  // 1d. Fetch sections from EnrollPro
  console.log("\n  Fetching EnrollPro sections...");
  let epSections: any[] = [];
  try {
    let page = 1;
    let hasMore = true;
    while (hasMore) {
      const data = await httpGet(`${ENROLLPRO_BASE}/integration/v1/sections?schoolYearId=${enrollProSchoolYearId}&page=${page}&limit=200`);
      const sections = data?.sections ?? data?.data ?? data ?? [];
      const arr = Array.isArray(sections) ? sections : [];
      epSections.push(...arr);
      hasMore = arr.length === 200;
      page++;
    }
  } catch (err: any) {
    console.warn(`  Sections fetch failed: ${err.message}`);
  }
  console.log(`  Found ${epSections.length} EnrollPro sections`);

  // 1e. Upsert sections
  const epSectionKeyToSmartId = new Map<string, string>();
  for (const epSec of epSections) {
    const gradeLevel = mapGradeLevel(epSec.gradeLevel?.name ?? epSec.gradeLevelName ?? "");
    if (!gradeLevel) continue;
    const name = epSec.name;
    if (!name) continue;

    const epAdviserId = epSec.advisingTeacher?.id ?? epSec.adviser?.id ?? epSec.adviserId;
    const adviserEmpId = epAdviserId ? epTeacherIdToEmpId.get(Number(epAdviserId)) : undefined;
    const teacherId = adviserEmpId ? (empIdToSmartTeacherId.get(adviserEmpId) ?? null) : null;

    try {
      const section = await (prisma.section as any).upsert({
        where: { name_gradeLevel_schoolYear: { name, gradeLevel, schoolYear: schoolYearLabel } },
        update: { adviserId: teacherId },
        create: { name, gradeLevel, schoolYear: schoolYearLabel, adviserId: teacherId },
      });
      epSectionKeyToSmartId.set(`${name}:${gradeLevel}`, section.id);
    } catch (err: any) {
      console.warn(`  Section "${name}" error: ${err.message}`);
    }
  }
  console.log(`  Synced ${epSectionKeyToSmartId.size} sections to local DB`);

  // 1f. Fetch students from EnrollPro
  console.log("\n  Fetching EnrollPro students...");
  let allLearners: any[] = [];
  try {
    let page = 1;
    let hasMore = true;
    while (hasMore) {
      const data = await httpGet(`${ENROLLPRO_BASE}/integration/v1/learners?schoolYearId=${enrollProSchoolYearId}&page=${page}&limit=200`);
      const learners = data?.learners ?? data?.data ?? data ?? [];
      const arr = Array.isArray(learners) ? learners : [];
      allLearners.push(...arr);
      hasMore = arr.length === 200;
      page++;
    }
  } catch (err: any) {
    console.warn(`  Learners fetch failed: ${err.message}`);
  }
  console.log(`  Found ${allLearners.length} EnrollPro learners`);

  // 1g. Upsert students and enrollments
  let studentsSynced = 0;
  let enrollmentsCreated = 0;
  const syncedStudentsPerSection = new Map<string, Set<string>>();

  for (const record of allLearners) {
    const statusUpper = String(record.status ?? "").toUpperCase();
    if (statusUpper !== "ENROLLED" && statusUpper !== "OFFICIALLY_ENROLLED" && statusUpper !== "SECTIONED") continue;

    const learner = record.learner;
    if (!learner) continue;
    const lrn = String(learner.lrn ?? "").trim();
    if (!lrn) continue;

    const sectionName = record.section?.name ?? "";
    const gradeLevelName = record.gradeLevel?.name ?? "";
    const gradeLevel = mapGradeLevel(gradeLevelName);
    if (!gradeLevel || !sectionName) continue;

    const sectionKey = `${sectionName}:${gradeLevel}`;
    const sectionId = epSectionKeyToSmartId.get(sectionKey);
    if (!sectionId) continue;

    const firstName = learner.firstName ?? "";
    const lastName = learner.lastName ?? "";
    const middleName = learner.middleName ?? null;
    const gender = learner.gender ?? null;
    const birthDate = learner.birthDate ? new Date(learner.birthDate) : null;
    const address = learner.address ?? null;
    const guardianName = learner.guardianName ?? null;
    const guardianContact = learner.guardianContact ?? null;

    try {
      const student = await prisma.student.upsert({
        where: { lrn },
        update: { firstName, lastName, middleName, gender, birthDate, address, guardianName, guardianContact },
        create: { lrn, firstName, lastName, middleName, gender, birthDate, address, guardianName, guardianContact },
      });

      await prisma.enrollment.upsert({
        where: { studentId_sectionId_schoolYear: { studentId: student.id, sectionId, schoolYear: schoolYearLabel } },
        update: { status: "ENROLLED" },
        create: { studentId: student.id, sectionId, schoolYear: schoolYearLabel, status: "ENROLLED" },
      });

      if (!syncedStudentsPerSection.has(sectionId)) syncedStudentsPerSection.set(sectionId, new Set());
      syncedStudentsPerSection.get(sectionId)!.add(student.id);
      studentsSynced++;
    } catch (err: any) {
      // Skip duplicates
    }
  }
  console.log(`  Synced ${studentsSynced} students and enrollments`);

  // ------------------------------------------------------------------
  // PHASE 2: Sync from Atlas
  // ------------------------------------------------------------------
  console.log("\n--- Phase 2: Syncing from Atlas ---");

  if (!ATLAS_TOKEN) {
    console.warn("  ATLAS_SYSTEM_TOKEN not set — skipping Atlas sync");
  } else {
    const authHeader = { Authorization: `Bearer ${ATLAS_TOKEN}` };

    // 2a. Fetch subjects from Atlas
    console.log("  Fetching Atlas subjects...");
    let atlasSubjects: any[] = [];
    try {
      const data = await httpGet(`${ATLAS_BASE}/subjects?schoolId=${ATLAS_SCHOOL_ID}`, authHeader);
      atlasSubjects = data?.subjects ?? data?.data ?? data ?? [];
    } catch (err: any) {
      console.warn(`  Atlas subjects fetch failed: ${err.message}`);
    }

    const existingSubjects = await prisma.subject.findMany({ select: { code: true } });
    const existingCodes = new Set(existingSubjects.map((s) => s.code));
    let subjectsCreated = 0;

    for (const as of atlasSubjects) {
      if (!as.code || !as.name) continue;
      const code = as.code.trim().toUpperCase();
      // Check grade-suffixed variants
      const hasSuffixed = ["7", "8", "9", "10"].some((g) => existingCodes.has(code + g));
      if (hasSuffixed) continue;
      if (existingCodes.has(code)) continue;

      try {
        await prisma.subject.create({
          data: { code, name: as.name, type: "CORE", rotationTermGroupId: as.rotationTermGroupId ?? null, rotationTermRank: as.rotationTermRank ?? null, rotationOutputLabel: as.outputLabel ?? null },
        });
        existingCodes.add(code);
        subjectsCreated++;
      } catch {}
    }
    console.log(`  Created ${subjectsCreated} new subjects from Atlas`);

    // 2b. Fetch EnrollPro sections for Atlas section ID mapping
    const epSectionById = new Map<number, any>();
    for (const [key, id] of epSectionKeyToSmartId) {
      // We need the EnrollPro integer ID — re-fetch from the original data
    }
    // Rebuild from the original fetch (we stored them in the loop above but need integer IDs)
    // Let's re-fetch sections with integer IDs
    try {
      let page = 1;
      let hasMore = true;
      while (hasMore) {
        const data = await httpGet(`${ENROLLPRO_BASE}/integration/v1/sections?schoolYearId=${enrollProSchoolYearId}&page=${page}&limit=200`);
        const sections = data?.sections ?? data?.data ?? data ?? [];
        const arr = Array.isArray(sections) ? sections : [];
        for (const s of arr) {
          if (s.id) epSectionById.set(Number(s.id), s);
        }
        hasMore = arr.length === 200;
        page++;
      }
    } catch {}

    // 2c. Fetch Atlas faculty
    console.log("  Fetching Atlas faculty...");
    let atlasFaculty: any[] = [];
    try {
      const data = await httpGet(`${ATLAS_BASE}/faculty?schoolId=${ATLAS_SCHOOL_ID}`, authHeader);
      atlasFaculty = data?.faculty ?? data?.data ?? data ?? [];
    } catch (err: any) {
      console.warn(`  Atlas faculty fetch failed: ${err.message}`);
    }

    // Match Atlas faculty → SMART teachers
    const enrollProTeachers = epTeachers;
    const atlasIdToSmartTeacherId = new Map<number, string>();
    for (const af of atlasFaculty) {
      const externalId = Number(af.externalId ?? NaN);
      const externalMatch = Number.isFinite(externalId)
        ? enrollProTeachers.find((t: any) => Number(t.id) === externalId)
        : undefined;
      const extEmpId = externalMatch?.employeeId ? String(externalMatch.employeeId).trim() : undefined;
      const extTid = extEmpId ? empIdToSmartTeacherId.get(extEmpId) : undefined;
      const directEmpId = af.employeeId ? empIdToSmartTeacherId.get(String(af.employeeId).trim()) : undefined;
      const tid = extTid ?? directEmpId;
      if (tid) atlasIdToSmartTeacherId.set(af.id, tid);
    }
    console.log(`  Matched ${atlasIdToSmartTeacherId.size} Atlas faculty to SMART teachers`);

    // 2d. Fetch teaching loads and create class assignments
    console.log("  Fetching Atlas teaching loads...");
    const allSubjects = await prisma.subject.findMany();
    const subjectByCode = new Map(allSubjects.map((s) => [s.code, s]));
    const allSections = await prisma.section.findMany({ where: { schoolYear: schoolYearLabel } });
    const sectionByNameGrade = new Map(allSections.map((s) => [`${s.name.trim()}:${s.gradeLevel}`, s]));
    let assignmentsCreated = 0;

    for (const af of atlasFaculty) {
      const smartTeacherId = atlasIdToSmartTeacherId.get(af.id);
      if (!smartTeacherId) continue;

      let assignments: any[] = [];
      try {
        const detail = await httpGet(`${ATLAS_BASE}/faculty-assignments/${af.id}?schoolYearId=${ATLAS_SCHOOL_YEAR_ID}`, authHeader);
        const payload = detail?.assignments ?? detail?.data ?? detail ?? [];
        assignments = Array.isArray(payload) ? payload : [];
      } catch {}

      // Fallback school years
      if (!assignments.some((a: any) => a?.sectionIds?.length > 0 || a?.sections?.length > 0)) {
        for (const fallbackSY of [3, 6, 1, 8].filter((id) => id !== ATLAS_SCHOOL_YEAR_ID)) {
          try {
            const fb = await httpGet(`${ATLAS_BASE}/faculty-assignments/${af.id}?schoolYearId=${fallbackSY}`, authHeader);
            const fbPayload = fb?.assignments ?? fb?.data ?? fb ?? [];
            const fbArr = Array.isArray(fbPayload) ? fbPayload : [];
            if (fbArr.some((a: any) => a?.sectionIds?.length > 0 || a?.sections?.length > 0)) {
              assignments = fbArr;
              break;
            }
          } catch {}
        }
      }

      // Also try published schedule
      if (!assignments.some((a: any) => a?.sectionIds?.length > 0 || a?.sections?.length > 0 || a?.sectionId)) {
        try {
          const pub = await httpGet(`${ATLAS_BASE}/schools/${ATLAS_SCHOOL_ID}/schedules/published/faculty/${af.id}`, authHeader);
          const entries = Array.isArray(pub?.entries) ? pub.entries : [];
          const seen = new Set<string>();
          const pubAssignments: any[] = [];
          for (const e of entries) {
            const code = (e?.subjectCode ?? "").trim().toUpperCase();
            const secId = Number(e?.sectionId);
            const key = `${code}:${secId}`;
            if (!code || !Number.isFinite(secId) || seen.has(key)) continue;
            seen.add(key);
            pubAssignments.push({ subjectCode: code, sectionId: secId });
          }
          if (pubAssignments.length > 0) assignments = pubAssignments;
        } catch {}
      }

      // Process assignments
      for (const a of assignments) {
        let subjectCode = (a?.subjectCode ?? a?.subject?.code ?? "").trim().toUpperCase();
        if (!subjectCode) continue;

        // Collect section IDs
        const sectionIds: number[] = [];
        if (a?.sectionId) sectionIds.push(Number(a.sectionId));
        if (Array.isArray(a?.sectionIds)) sectionIds.push(...a.sectionIds.map(Number));
        if (Array.isArray(a?.sections)) {
          for (const s of a.sections) {
            if (s?.id) sectionIds.push(Number(s.id));
            if (s?.name) {
              // Direct name match
              const gl = mapGradeLevel(s.gradeLevelName ?? s.name);
              if (gl) {
                const sectionKey = `${s.name.trim()}:${gl}`;
                const section = sectionByNameGrade.get(sectionKey);
                if (section) {
                  const gradeSuffix = gl.replace("GRADE_", "");
                  const smartCode = subjectCode + gradeSuffix;
                  let subject = subjectByCode.get(smartCode) ?? subjectByCode.get(subjectCode);
                  if (!subject) {
                    try {
                      subject = await prisma.subject.upsert({
                        where: { code: smartCode },
                        update: {},
                        create: { code: smartCode, name: a?.subject?.name ?? subjectCode, type: "CORE" },
                      });
                      subjectByCode.set(smartCode, subject);
                    } catch { continue; }
                  }
                  try {
                    await prisma.classAssignment.upsert({
                      where: { teacherId_subjectId_sectionId_schoolYear: { teacherId: smartTeacherId, subjectId: subject.id, sectionId: section.id, schoolYear: schoolYearLabel } },
                      update: { isActive: true, archivedAt: null, archivedReason: null },
                      create: { teacherId: smartTeacherId, subjectId: subject.id, sectionId: section.id, schoolYear: schoolYearLabel, isActive: true },
                    });
                    assignmentsCreated++;
                  } catch {}
                }
              }
            }
          }
        }

        // Process integer section IDs
        for (const secId of sectionIds) {
          const epSec = epSectionById.get(secId);
          if (!epSec?.name) continue;
          const gl = mapGradeLevel(epSec.gradeLevel?.name ?? epSec.gradeLevelName ?? epSec.name);
          if (!gl) continue;

          const sectionKey = `${epSec.name.trim()}:${gl}`;
          const section = sectionByNameGrade.get(sectionKey);
          if (!section) continue;

          const gradeSuffix = gl.replace("GRADE_", "");
          const smartCode = subjectCode + gradeSuffix;
          let subject = subjectByCode.get(smartCode) ?? subjectByCode.get(subjectCode);
          if (!subject) {
            try {
              const autoName = smartCode.startsWith("HG") ? "Homeroom Guidance" : subjectCode.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c: string) => c.toUpperCase());
              subject = await prisma.subject.upsert({
                where: { code: smartCode },
                update: {},
                create: { code: smartCode, name: autoName, type: "CORE" },
              });
              subjectByCode.set(smartCode, subject);
            } catch { continue; }
          }

          try {
            await prisma.classAssignment.upsert({
              where: { teacherId_subjectId_sectionId_schoolYear: { teacherId: smartTeacherId, subjectId: subject.id, sectionId: section.id, schoolYear: schoolYearLabel } },
              update: { isActive: true, archivedAt: null, archivedReason: null },
              create: { teacherId: smartTeacherId, subjectId: subject.id, sectionId: section.id, schoolYear: schoolYearLabel, isActive: true },
            });
            assignmentsCreated++;
          } catch {}
        }
      }
    }
    console.log(`  Created/updated ${assignmentsCreated} class assignments`);
  }

  // ------------------------------------------------------------------
  // PHASE 3: Generate grades
  // ------------------------------------------------------------------
  console.log("\n--- Phase 3: Generating grades ---");

  const classAssignments = await prisma.classAssignment.findMany({
    where: { schoolYear: schoolYearLabel, isActive: true },
    include: { teacher: { include: { user: true } }, subject: true, section: true },
  });
  console.log(`  Found ${classAssignments.length} active class assignments`);

  const terms: Term[] = ["T1", "T2", "T3"];
  const reportEntries: ReportEntry[] = [];
  let gradesCreated = 0;
  let snapshotsCreated = 0;
  let globalStudentIndex = 0;
  const scenarioCounts = new Map<Scenario, number>();

  for (const ca of classAssignments) {
    // Get enrolled students for this section
    const enrollments = await prisma.enrollment.findMany({
      where: { sectionId: ca.sectionId, schoolYear: schoolYearLabel, status: "ENROLLED" },
      include: { student: true },
    });

    if (enrollments.length === 0) continue;

    const isHG = ca.subject.code.startsWith("HG");
    const weights = { ww: ca.subject.writtenWorkWeight, pt: ca.subject.perfTaskWeight, qa: ca.subject.quarterlyAssessWeight };

    for (let i = 0; i < enrollments.length; i++) {
      const enrollment = enrollments[i];
      const student = enrollment.student;
      // Assign scenario: realistic distribution
      let scenario: Scenario;
      const isDesignatedSection = ca.section.name === DESIGNATED_SECTION;
      if (isDesignatedSection) {
        // Check if this student has a specific scenario for this subject
        const studentScenarios = DESIGNATED_STUDENT_SCENARIOS[i];
        scenario = studentScenarios?.[ca.subject.name] ?? "COMPLETE";
      } else if (globalStudentIndex < EDGE_CASE_STUDENTS.length) {
        scenario = EDGE_CASE_STUDENTS[globalStudentIndex];
      } else {
        scenario = "COMPLETE";
      }
      globalStudentIndex++;

      // Generate and save grades for each term
      for (const term of terms) {
        let gradeData;
        if (isHG) {
          const descriptors = ["No Improvement", "Needs Improvement", "Developing", "Sufficiently Developed"];
          const descriptor = descriptors[randomBetween(0, 3)];
          gradeData = {
            writtenWorkScores: null, perfTaskScores: null, quarterlyAssessScore: null, quarterlyAssessMax: 100,
            computed: { writtenWorkPS: null, perfTaskPS: null, quarterlyAssessPS: null, initialGrade: null, quarterlyGrade: null },
            qualitativeDescriptor: descriptor,
          };
        } else {
          gradeData = buildGradeData(scenario, term, weights);
        }

        // Skip creating a grade row for missing terms (MISSING_T1, MISSING_T3)
        // The ABSENCE of the row IS the missing term — don't create a row with null scores
        const isMissingTerm =
          (scenario === "MISSING_T1" && term === "T1") ||
          (scenario === "MISSING_T3" && term === "T3");
        if (isMissingTerm) continue;

        // Compute remarks: Failed if quarterlyGrade < 75, Passed otherwise
        const qg = gradeData.computed.quarterlyGrade;
        const remarks = qg !== null ? (qg < 75 ? "Failed" : "Passed") : null;

        try {
          const gradeRecord = await prisma.grade.upsert({
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
          gradesCreated++;

          try {
            await prisma.gradeSnapshot.create({
              data: {
                gradeId: gradeRecord.id, studentId: student.id, classAssignmentId: ca.id,
                teacherId: ca.teacherId, subjectCode: ca.subject.code, subjectName: ca.subject.name,
                sectionId: ca.sectionId, sectionName: ca.section.name,
                schoolYear: schoolYearLabel, term, snapshot: gradeRecord as any,
              },
            });
            snapshotsCreated++;
          } catch {}
        } catch {}
      }

      // Fetch actual grades from DB and create one report entry per student-assignment
      const dbGrades = await prisma.grade.findMany({
        where: { studentId: student.id, classAssignmentId: ca.id },
        select: { term: true, quarterlyGrade: true, remarks: true },
      });
      const gradeMap = new Map(dbGrades.map((g) => [g.term, g.quarterlyGrade]));
      // Final rating = average of available term grades
      const availGrades = dbGrades.filter((g) => g.quarterlyGrade !== null).map((g) => g.quarterlyGrade as number);
      const finalRating = availGrades.length > 0 ? Math.round(availGrades.reduce((a, b) => a + b, 0) / availGrades.length) : null;
      const finalRemarks = finalRating !== null ? (finalRating < 75 ? "Failed" : "Passed") : null;

      scenarioCounts.set(scenario, (scenarioCounts.get(scenario) ?? 0) + 1);
      reportEntries.push({
        sectionName: ca.section.name,
        gradeLevel: ca.section.gradeLevel,
        subjectCode: ca.subject.code,
        subjectName: ca.subject.name,
        teacherName: `${ca.teacher.user.firstName ?? ""} ${ca.teacher.user.lastName ?? ""}`.trim(),
        studentName: `${student.firstName} ${student.lastName}`,
        studentLRN: student.lrn,
        t1Grade: gradeMap.get("T1") ?? null,
        t2Grade: gradeMap.get("T2") ?? null,
        t3Grade: gradeMap.get("T3") ?? null,
        finalRating,
        finalRemarks,
        scenario,
      });
    }
  }

  console.log(`  Created ${gradesCreated} grade records`);
  console.log(`  Created ${snapshotsCreated} grade snapshots`);

  // ------------------------------------------------------------------
  // PHASE 4: Generate report
  // ------------------------------------------------------------------
  console.log("\n--- Phase 4: Generating report ---");

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  const totalTeachers = empIdToSmartTeacherId.size;
  const totalSections = epSectionKeyToSmartId.size;
  const totalStudents = studentsSynced;
  const totalAssignments = classAssignments.length;

  // Scenario distribution
  const scenarioCountsForReport = new Map<Scenario, number>();
  for (const g of reportEntries) {
    scenarioCountsForReport.set(g.scenario, (scenarioCountsForReport.get(g.scenario) ?? 0) + 1);
  }

  // Group by section
  const bySection = new Map<string, ReportEntry[]>();
  for (const g of reportEntries) {
    const key = `${g.gradeLevel} — ${g.sectionName}`;
    if (!bySection.has(key)) bySection.set(key, []);
    bySection.get(key)!.push(g);
  }

  let report = `# Grade Seed Report\n\n`;
  report += `**School Year:** ${schoolYearLabel} | **Generated:** ${new Date().toISOString()} | **Duration:** ${duration}s\n\n`;
  report += `## Summary\n\n`;
  report += `| Metric | Count |\n|--------|-------|\n`;
  report += `| Teachers synced | ${totalTeachers} |\n`;
  report += `| Sections synced | ${totalSections} |\n`;
  report += `| Students synced | ${totalStudents} |\n`;
  report += `| Class Assignments | ${totalAssignments} |\n`;
  report += `| Grades created | ${gradesCreated} |\n`;
  report += `| Grade Snapshots | ${snapshotsCreated} |\n`;
  report += `| Terms | T1, T2, T3 |\n\n`;

  report += `## Scenario Distribution\n\n`;
  report += `| Scenario | Students | Description |\n|----------|----------|-------------|\n`;
  for (const s of SCENARIO_LIST) {
    const count = scenarioCountsForReport.get(s) ?? 0;
    const pct = reportEntries.length > 0 ? ((count / reportEntries.length) * 100).toFixed(1) : "0";
    const desc: Record<Scenario, string> = {
      COMPLETE: "Full WW + PT + QA, all 3 terms",
      MISSING_T3: "T1 + T2 present, T3 missing",
      MISSING_T1: "T1 missing, T2 + T3 present",
      EMPTY_SCORES: "Grade rows exist, all scores null",
      FAILING: "Very low scores → transmutes to 60-65",
      PERFECT: "Max scores → transmutes to 98-100",
      PARTIAL_WW_ONLY: "Only written work scores, no PT/QA",
      PARTIAL_NO_QA: "WW + PT present, no quarterly assessment",
    };
    report += `| ${s} | ${count} (${pct}%) | ${desc[s]} |\n`;
  }

  report += `\n---\n\n## By Section\n\n`;
  for (const [sectionKey, entries] of bySection) {
    report += `### ${sectionKey}\n\n`;
    report += `| Student | LRN | Subject | Teacher | T1 | T2 | T3 | Final Rating | Remarks | Scenario |\n`;
    report += `|---------|-----|---------|---------|----|----|----|--------------|---------|----------|\n`;
    for (const e of entries) {
      report += `| ${e.studentName} | ${e.studentLRN} | ${e.subjectName} | ${e.teacherName} | ${e.t1Grade ?? "-"} | ${e.t2Grade ?? "-"} | ${e.t3Grade ?? "-"} | ${e.finalRating ?? "-"} | ${e.finalRemarks ?? "-"} | ${e.scenario} |\n`;
    }
    report += `\n`;
  }

  // Write report
  const reportPath = join(__dirname, "GRADE_SEED_REPORT.md");
  writeFileSync(reportPath, report, "utf-8");
  console.log(`  Report written to: ${reportPath}`);

  // ------------------------------------------------------------------
  // Done
  // ------------------------------------------------------------------
  console.log(`\n=== Done in ${duration}s ===`);
  console.log(`Teachers: ${totalTeachers} | Sections: ${totalSections} | Students: ${totalStudents}`);
  console.log(`Class Assignments: ${totalAssignments} | Grades: ${gradesCreated} | Snapshots: ${snapshotsCreated}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  prisma.$disconnect();
  process.exit(1);
});
