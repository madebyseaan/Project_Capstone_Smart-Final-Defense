import "dotenv/config";
import { PrismaClient, AttendanceStatus } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashStr, seededRandom } from "./seedTeacherScoresCore";

const connectionString = process.env.DATABASE_URL!;
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

interface TermWindow {
  label: string;
  start: Date;
  end: Date;
}

type Persona = "PERFECT" | "REGULAR" | "LATE_PRONE" | "AT_RISK" | "TYPICAL";

const PERSONA_RATES: Record<Exclude<Persona, "PERFECT">, { absent: number; late: number; excused: number }> = {
  TYPICAL: { absent: 0.05, late: 0.08, excused: 0.03 },
  REGULAR: { absent: 0.02, late: 0.04, excused: 0.02 },
  LATE_PRONE: { absent: 0.04, late: 0.22, excused: 0.03 },
  AT_RISK: { absent: 0.12, late: 0.08, excused: 0.05 },
};

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    clear: args.includes("--clear"),
    dryRun: args.includes("--dry-run"),
    help: args.includes("--help"),
  };
}

function utcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addDays(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));
}

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function localTodayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

function buildSchoolDays(windows: TermWindow[], today: Date): Date[] {
  const seen = new Set<string>();
  const days: Date[] = [];
  for (const window of windows) {
    if (window.end < window.start) continue;
    const end = utcMidnight(window.end);
    let cur = utcMidnight(window.start);
    while (cur <= end) {
      const dow = cur.getUTCDay();
      if (dow >= 1 && dow <= 5 && cur <= today) {
        const key = dateKey(cur);
        if (!seen.has(key)) {
          seen.add(key);
          days.push(new Date(cur));
        }
      }
      cur = addDays(cur, 1);
    }
  }
  return days.sort((a, b) => a.getTime() - b.getTime());
}

function hashRank(id: string): number {
  return hashStr(`${id}|attendance-rank`);
}

function assignPersonas(studentIds: string[]): Map<string, Persona> {
  const personas = new Map<string, Persona>();
  if (studentIds.length === 0) return personas;
  if (studentIds.length === 1) {
    personas.set(studentIds[0], "TYPICAL");
    return personas;
  }

  const sorted = [...studentIds].sort((a, b) => hashRank(a) - hashRank(b) || a.localeCompare(b));
  personas.set(sorted[0], "PERFECT");
  personas.set(sorted[sorted.length - 1], "AT_RISK");
  if (sorted.length >= 3) personas.set(sorted[1], "LATE_PRONE");
  for (const id of sorted) {
    if (!personas.has(id)) personas.set(id, "REGULAR");
  }
  return personas;
}

function groupMonthIndices(days: Date[]): Array<{ key: string; indices: number[] }> {
  const groups = new Map<string, number[]>();
  days.forEach((d, i) => {
    const key = dateKey(d).slice(0, 7);
    const existing = groups.get(key);
    if (existing) existing.push(i);
    else groups.set(key, [i]);
  });
  return Array.from(groups, ([key, indices]) => ({ key, indices }));
}

function rollStatus(studentId: string, day: Date, rates: { absent: number; late: number; excused: number }): AttendanceStatus {
  const r = seededRandom(hashStr(`${studentId}|${dateKey(day)}`))();
  if (r < rates.absent) return "ABSENT";
  if (r < rates.absent + rates.late) return "LATE";
  if (r < rates.absent + rates.late + rates.excused) return "EXCUSED";
  return "PRESENT";
}

function generateStatuses(studentId: string, days: Date[], persona: Persona): AttendanceStatus[] {
  if (persona === "PERFECT" || days.length === 0) {
    return days.map(() => "PRESENT");
  }

  const rates = PERSONA_RATES[persona];
  const statuses = days.map((day) => rollStatus(studentId, day, rates));
  const months = groupMonthIndices(days);

  if (persona === "AT_RISK") {
    const rand = seededRandom(hashStr(`${studentId}|episodes`) || 1);
    for (const month of months) {
      if (!month.indices.some((i) => statuses[i] === "ABSENT")) {
        statuses[month.indices[Math.floor(rand() * month.indices.length)]] = "ABSENT";
      }
    }
    const streakMonth = [...months].reverse().find((m) => m.indices.length >= 5);
    if (streakMonth) {
      const start = streakMonth.indices[Math.floor(rand() * (streakMonth.indices.length - 4))];
      for (let i = start; i < start + 5; i++) statuses[i] = "ABSENT";
    }
    for (const month of months) {
      if (month.indices.some((i) => statuses[i] === "LATE")) continue;
      const candidates = month.indices.filter((i) => statuses[i] !== "ABSENT");
      if (candidates.length > 0) {
        statuses[candidates[Math.floor(rand() * candidates.length)]] = "LATE";
      }
    }
    for (const month of months) {
      if (month.indices.some((i) => statuses[i] === "EXCUSED")) continue;
      const candidates = month.indices.filter((i) => statuses[i] === "PRESENT");
      if (candidates.length > 0) {
        statuses[candidates[Math.floor(rand() * candidates.length)]] = "EXCUSED";
      }
    }
  }

  if (persona === "LATE_PRONE") {
    const rand = seededRandom(hashStr(`${studentId}|lates`) || 1);
    for (const month of months) {
      if (!month.indices.some((i) => statuses[i] === "LATE")) {
        statuses[month.indices[Math.floor(rand() * month.indices.length)]] = "LATE";
      }
    }
  }

  if (persona === "TYPICAL") {
    const rand = seededRandom(hashStr(`${studentId}|typical`) || 1);
    for (const month of months) {
      if (!month.indices.some((i) => statuses[i] === "ABSENT")) {
        statuses[month.indices[Math.floor(rand() * month.indices.length)]] = "ABSENT";
      }
      if (!month.indices.some((i) => statuses[i] === "LATE")) {
        statuses[month.indices[Math.floor(rand() * month.indices.length)]] = "LATE";
      }
    }
  }

  return statuses;
}

async function main() {
  const args = parseArgs();
  const startTime = Date.now();

  if (args.help) {
    console.log("Usage: npx ts-node prisma/seed-attendance.ts [flags]");
    console.log("Seeds SF2-aligned attendance (weekdays inside the EnrollPro-synced term");
    console.log("windows, from the start of the school year up to today) for every section");
    console.log("and enrolled learner in the active school year.");
    console.log("");
    console.log("Personas per section (deterministic): one perfect-attendance learner, one");
    console.log("frequently-absent learner with a 5+ day streak, a late-prone learner when");
    console.log("the section is big enough, and regular learners for the rest.");
    console.log("Flags:");
    console.log("  --clear     Delete existing attendance for the year first");
    console.log("  --dry-run   Print what would be seeded, write nothing");
    return;
  }

  console.log("=== SMART Attendance Seed Script ===");
  console.log(`Mode: ${args.dryRun ? "DRY RUN" : "WRITE"} | Clear first: ${args.clear}\n`);

  const settings = await prisma.systemSettings.findUnique({ where: { id: "main" } });
  if (!settings?.schoolYearId) {
    console.error("No active school year. Run EnrollPro sync first.");
    process.exit(1);
  }
  const sy = await prisma.schoolYear.findUnique({ where: { id: settings.schoolYearId } });
  if (!sy) {
    console.error("Active school year not found in DB.");
    process.exit(1);
  }
  const schoolYearLabel = sy.label;
  console.log(`Active school year: ${schoolYearLabel}`);

  const windows: TermWindow[] = [];
  if (settings.t1StartDate && settings.t1EndDate) windows.push({ label: "T1", start: settings.t1StartDate, end: settings.t1EndDate });
  if (settings.t2StartDate && settings.t2EndDate) windows.push({ label: "T2", start: settings.t2StartDate, end: settings.t2EndDate });
  if (settings.t3StartDate && settings.t3EndDate) windows.push({ label: "T3", start: settings.t3StartDate, end: settings.t3EndDate });
  if (windows.length === 0) {
    console.error("No term dates on SystemSettings. Run an EnrollPro sync first so the academic calendar is populated.");
    process.exit(1);
  }
  for (const w of windows) {
    console.log(`  ${w.label}: ${dateKey(w.start)} .. ${dateKey(w.end)}`);
  }
  if (settings.termDatesDerived) {
    console.log("  Note: term dates are DERIVED (approximate) — EnrollPro did not provide exact term windows.");
  }

  const today = localTodayUtc();
  const schoolDays = buildSchoolDays(windows, today);
  if (schoolDays.length === 0) {
    console.error("No weekdays in the term windows up to today — nothing to seed. Check the academic calendar.");
    process.exit(1);
  }
  console.log(`\nSchool days (weekdays in term windows, up to ${dateKey(today)}): ${schoolDays.length}`);
  console.log(`Range: ${dateKey(schoolDays[0])} .. ${dateKey(schoolDays[schoolDays.length - 1])}`);
  console.log("Note: weekends are never seeded. DepEd holidays are not modeled — weekdays are assumed school days.\n");

  const sections = await prisma.section.findMany({
    where: { schoolYear: schoolYearLabel, archivedAt: null },
    orderBy: [{ gradeLevel: "asc" }, { name: "asc" }],
    select: { id: true, name: true, gradeLevel: true, adviserId: true },
  });
  if (sections.length === 0) {
    console.error(`No active sections for ${schoolYearLabel}. Run EnrollPro enrollment sync first.`);
    process.exit(1);
  }
  console.log(`Found ${sections.length} section(s) for SY ${schoolYearLabel}`);

  if (args.clear && !args.dryRun) {
    const cleared = await prisma.attendance.deleteMany({ where: { section: { schoolYear: schoolYearLabel } } });
    console.log(`Cleared ${cleared.count} existing attendance record(s).\n`);
  }

  let totalStudents = 0;
  let totalRecords = 0;
  const statusCounts: Record<AttendanceStatus, number> = { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0 };
  const personaCounts: Record<Persona, number> = { PERFECT: 0, REGULAR: 0, LATE_PRONE: 0, AT_RISK: 0, TYPICAL: 0 };
  const sectionsWithoutStudents: string[] = [];

  for (const section of sections) {
    const enrollments = await prisma.enrollment.findMany({
      where: { sectionId: section.id, status: "ENROLLED", isArchived: false },
      select: { studentId: true },
    });
    if (enrollments.length === 0) {
      sectionsWithoutStudents.push(`${section.gradeLevel.replace("GRADE_", "G")}-${section.name}`);
      continue;
    }

    const personas = assignPersonas(enrollments.map((e) => e.studentId));
    const rows: {
      studentId: string;
      sectionId: string;
      date: Date;
      status: AttendanceStatus;
      recordedBy: string | null;
    }[] = [];

    for (const enrollment of enrollments) {
      const persona = personas.get(enrollment.studentId) ?? "REGULAR";
      personaCounts[persona]++;
      const statuses = generateStatuses(enrollment.studentId, schoolDays, persona);
      for (let i = 0; i < schoolDays.length; i++) {
        statusCounts[statuses[i]]++;
        rows.push({
          studentId: enrollment.studentId,
          sectionId: section.id,
          date: schoolDays[i],
          status: statuses[i],
          recordedBy: section.adviserId ?? null,
        });
      }
    }

    if (!args.dryRun) {
      const CHUNK = 2000;
      for (let i = 0; i < rows.length; i += CHUNK) {
        await prisma.attendance.createMany({ data: rows.slice(i, i + CHUNK), skipDuplicates: true });
      }
    }

    totalStudents += enrollments.length;
    totalRecords += rows.length;
    console.log(`  ${section.gradeLevel.replace("GRADE_", "G")}-${section.name}: ${enrollments.length} learner(s) x ${schoolDays.length} day(s) = ${rows.length} record(s)`);
  }

  if (sectionsWithoutStudents.length > 0) {
    console.log(`\nSections skipped (no enrolled learners): ${sectionsWithoutStudents.join(", ")}`);
  }

  const summary = {
    schoolYear: schoolYearLabel,
    sections: sections.length - sectionsWithoutStudents.length,
    students: totalStudents,
    schoolDays: schoolDays.length,
    from: dateKey(schoolDays[0]),
    to: dateKey(schoolDays[schoolDays.length - 1]),
    records: totalRecords,
    statusCounts,
    personaCounts,
    termDatesDerived: settings.termDatesDerived,
    clearFirst: args.clear,
    dryRun: args.dryRun,
  };

  console.log(`\n--- Summary ---`);
  console.log(`Sections: ${summary.sections} | Students: ${summary.students} | School days: ${summary.schoolDays} | Records: ${totalRecords}`);
  console.log(`Statuses: PRESENT=${statusCounts.PRESENT}, ABSENT=${statusCounts.ABSENT}, LATE=${statusCounts.LATE}, EXCUSED=${statusCounts.EXCUSED}`);
  console.log(`Personas: ${JSON.stringify(personaCounts)}`);
  console.log(args.dryRun ? "DRY RUN — nothing written." : "Attendance seeded.");
  console.log(`Done in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  console.log(`SEED_ATTENDANCE_SUMMARY ${JSON.stringify(summary)}`);
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
