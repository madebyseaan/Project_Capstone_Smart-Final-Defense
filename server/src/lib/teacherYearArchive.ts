/**
 * teacherYearArchive.ts
 *
 * Per-teacher, per-school-year compressed archive bundles.
 *
 * Design:
 *   - Read-only builder from live tables (no source mutation).
 *   - gzip-compressed JSON stored in TeacherYearArchive.payload.
 *   - Generation runs after the year archive transaction commits; it must never
 *     affect the archive outcome (see rollover.ts).
 *   - `TEACHER_ARCHIVE_ENABLED=false` disables queueing/generation only.
 */

import { createHash } from "crypto";
import { gzipSync, gunzipSync } from "zlib";
import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "./prisma";
import { logger } from "./logger";

export const TEACHER_ARCHIVE_SCHEMA_VERSION = 1;
export const TEACHER_ARCHIVE_ENCODING = "gzip";
export const TEACHER_ARCHIVE_MAX_RAW_BYTES = 10 * 1024 * 1024;
export const EOSY_SNAPSHOT_SOURCE = "EOSY_FINALIZE";

const LOG_PREFIX = "[TeacherArchive]";

type Db = PrismaClient | Prisma.TransactionClient;

export type TeacherArchiveSource = "ROLLOVER" | "MANUAL_ARCHIVE" | "BACKFILL";
export type TeacherArchiveStatus = "PENDING" | "COMPLETE" | "FAILED";

export interface ExpectedTeacher {
  teacherId: string;
  teacherUserId: string | null;
  employeeId: string | null;
  teacherName: string;
  specialization: string | null;
}

export interface TeacherArchiveGenerationSummary {
  schoolYearId: string;
  schoolYear: string;
  considered: number;
  completed: number;
  failed: number;
  skipped: number;
  rawBytes: number;
  compressedBytes: number;
  durationMs: number;
}

const generationInFlight = new Set<string>();

export function isTeacherArchiveEnabled(): boolean {
  return (process.env.TEACHER_ARCHIVE_ENABLED ?? "true").trim().toLowerCase() !== "false";
}

function teacherNameFrom(user: { firstName: string | null; lastName: string | null; username: string } | null): string | null {
  if (!user) return null;
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return name || user.username || null;
}

const teacherSelect = {
  id: true,
  userId: true,
  employeeId: true,
  specialization: true,
  user: { select: { firstName: true, lastName: true, username: true } },
} satisfies Prisma.TeacherSelect;

/**
 * Every teacher with any year-scoped signal: assignment, schedule, workload, or
 * advisory section. Archived/inactive assignments are included because they may
 * still own grades.
 */
export async function collectExpectedTeachers(db: Db, yearLabel: string): Promise<ExpectedTeacher[]> {
  const [assignments, schedules, workloads, advisorSections] = await Promise.all([
    db.classAssignment.findMany({
      where: { schoolYear: yearLabel },
      select: { teacher: { select: teacherSelect } },
    }),
    db.scheduleEntry.findMany({
      where: { schoolYear: yearLabel },
      select: { teacher: { select: teacherSelect } },
    }),
    db.workloadEntry.findMany({
      where: { schoolYear: yearLabel },
      select: { teacher: { select: teacherSelect } },
    }),
    db.section.findMany({
      where: { schoolYear: yearLabel, adviserId: { not: null } },
      select: { adviser: { select: teacherSelect } },
    }),
  ]);

  const byId = new Map<string, ExpectedTeacher>();
  const add = (teacher: (typeof assignments)[number]["teacher"] | (typeof advisorSections)[number]["adviser"] | null) => {
    if (!teacher) return;
    if (byId.has(teacher.id)) return;
    byId.set(teacher.id, {
      teacherId: teacher.id,
      teacherUserId: teacher.userId,
      employeeId: teacher.employeeId,
      teacherName:
        teacherNameFrom(teacher.user) ??
        `Teacher ${teacher.employeeId || teacher.id}`,
      specialization: teacher.specialization,
    });
  };

  for (const row of assignments) add(row.teacher);
  for (const row of schedules) add(row.teacher);
  for (const row of workloads) add(row.teacher);
  for (const row of advisorSections) add(row.adviser);

  return [...byId.values()].sort((a, b) => a.teacherName.localeCompare(b.teacherName));
}

export async function fetchYearData(db: Db, yearLabel: string) {
  const schoolYear = await db.schoolYear.findUnique({ where: { label: yearLabel } });
  if (!schoolYear) throw new Error(`School year not found: ${yearLabel}`);

  const [sections, assignments, grades, enrollments, attendance, schedules, workloads, snapshots, editRequests, observedValues] =
    await Promise.all([
      db.section.findMany({ where: { schoolYear: yearLabel } }),
      db.classAssignment.findMany({ where: { schoolYear: yearLabel }, include: { subject: true } }),
      db.grade.findMany({ where: { classAssignment: { schoolYear: yearLabel } } }),
      db.enrollment.findMany({
        where: { schoolYear: yearLabel },
        include: { student: true, remedialClasses: true },
      }),
      db.attendance.findMany({ where: { section: { schoolYear: yearLabel } } }),
      db.scheduleEntry.findMany({ where: { schoolYear: yearLabel } }),
      db.workloadEntry.findMany({ where: { schoolYear: yearLabel } }),
      db.gradeSnapshot.findMany({
        where: {
          schoolYear: yearLabel,
          snapshot: { path: ["source"], equals: EOSY_SNAPSHOT_SOURCE },
        },
      }),
      db.gradeEditRequest.findMany({ where: { schoolYear: yearLabel } }),
      db.studentObservedValue.findMany({ where: { schoolYear: yearLabel } }),
    ]);

  return {
    schoolYear,
    sections,
    assignments,
    grades,
    enrollments,
    attendance,
    schedules,
    workloads,
    snapshots,
    editRequests,
    observedValues,
  };
}

export type YearData = Awaited<ReturnType<typeof fetchYearData>>;

export interface BuildTeacherArchiveOptions {
  source?: TeacherArchiveSource;
  backfilled?: boolean;
  warnings?: string[];
}

export function buildTeacherArchivePayload(
  data: YearData,
  teacher: ExpectedTeacher,
  opts: BuildTeacherArchiveOptions = {},
): Record<string, unknown> {
  const myAssignments = data.assignments.filter((a) => a.teacherId === teacher.teacherId);
  const assignmentIds = new Set(myAssignments.map((a) => a.id));
  const taughtSectionIds = new Set(myAssignments.map((a) => a.sectionId));
  const advisorySections = data.sections.filter((s) => s.adviserId === teacher.teacherId);
  const advisorySectionIds = new Set(advisorySections.map((s) => s.id));
  const relevantSectionIds = new Set([...taughtSectionIds, ...advisorySectionIds]);

  const myGrades = data.grades.filter((g) => assignmentIds.has(g.classAssignmentId));
  const myEnrollments = data.enrollments.filter((e) => relevantSectionIds.has(e.sectionId));
  const myStudentIds = new Set(myEnrollments.map((e) => e.studentId));
  const advisoryStudentIds = new Set(
    data.enrollments
      .filter((e) => advisorySectionIds.has(e.sectionId))
      .map((e) => e.studentId),
  );

  const myAttendance = data.attendance.filter(
    (a) =>
      advisorySectionIds.has(a.sectionId) ||
      a.recordedBy === teacher.teacherId ||
      a.recordedBy === teacher.teacherUserId,
  );
  const mySchedules = data.schedules.filter((s) => s.teacherId === teacher.teacherId);
  const myWorkload = data.workloads.filter((w) => w.teacherId === teacher.teacherId);
  const mySnapshots = data.snapshots.filter((s) => s.teacherId === teacher.teacherId);
  const myRequests = data.editRequests.filter((r) => r.teacherId === teacher.teacherUserId);
  const myObservedValues = data.observedValues.filter((o) => advisoryStudentIds.has(o.studentId));

  const sectionRows = data.sections
    .filter((s) => relevantSectionIds.has(s.id))
    .map((s) => ({
      id: s.id,
      name: s.name,
      gradeLevel: s.gradeLevel,
      program: s.program,
      status: s.status,
      role: s.adviserId === teacher.teacherId ? "ADVISER" : "TEACHER",
    }));

  const studentRows = myEnrollments.map((e) => ({
    id: e.student.id,
    lrn: e.student.lrn,
    firstName: e.student.firstName,
    middleName: e.student.middleName,
    lastName: e.student.lastName,
    suffix: e.student.suffix,
    sectionId: e.sectionId,
    enrollment: {
      id: e.id,
      status: e.status,
      promotionStatus: e.promotionStatus,
      promotedToGradeLevel: e.promotedToGradeLevel,
      isArchived: e.isArchived,
    },
    remedialClasses: e.remedialClasses.map((r) => ({
      id: r.id,
      subjectCode: r.subjectCode,
      subjectName: r.subjectName,
      status: r.status,
      originalGrade: r.originalGrade,
      recomputedGrade: r.recomputedGrade,
      outcome: r.outcome,
    })),
  }));

  const assignmentRows = myAssignments.map((a) => ({
    id: a.id,
    subject: {
      id: a.subject.id,
      code: a.subject.code,
      name: a.subject.name,
      displayName: a.subject.displayName,
    },
    sectionId: a.sectionId,
    teachingMinutes: a.teachingMinutes,
    isActive: a.isActive,
    archivedAt: a.archivedAt,
    archivedReason: a.archivedReason,
    successorTeacherId: a.successorTeacherId,
    source: a.source,
  }));

  const eosyFinalization = mySnapshots.map((s) => {
    const snapshot = (s.snapshot ?? {}) as Record<string, unknown>;
    return {
      studentId: s.studentId,
      classAssignmentId: s.classAssignmentId,
      term: s.term,
      initialGrade: snapshot.initialGrade ?? null,
      quarterlyGrade: snapshot.quarterlyGrade ?? null,
      remarks: snapshot.remarks ?? null,
      finalizedAt: snapshot.finalizedAt ?? null,
      source: snapshot.source ?? EOSY_SNAPSHOT_SOURCE,
    };
  });

  const snapshotKeys = new Set(
    mySnapshots.map((s) => `${s.studentId}|${s.classAssignmentId}|${s.term}`),
  );
  const gradesWithSnapshot = myGrades.filter((g) =>
    snapshotKeys.has(`${g.studentId}|${g.classAssignmentId}|${g.term}`),
  ).length;

  const warnings = new Set<string>(opts.warnings ?? []);
  if (myGrades.length === 0) warnings.add("NO_GRADES");
  if (myEnrollments.length === 0) warnings.add("NO_STUDENTS");
  if (myAttendance.length === 0) warnings.add("NO_ATTENDANCE_ROWS");
  if (myGrades.length > 0 && mySnapshots.length === 0) warnings.add("NO_EOSY_SNAPSHOTS");
  if (mySnapshots.length > 0 && gradesWithSnapshot < myGrades.length) {
    warnings.add("PARTIAL_EOSY_SNAPSHOT_COVERAGE");
  }

  const payload: Record<string, unknown> = {
    schemaVersion: TEACHER_ARCHIVE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    source: opts.source ?? "ROLLOVER",
    dataQuality: {
      backfilled: opts.backfilled ?? false,
      warnings: [...warnings],
      snapshotCoverage: {
        grades: myGrades.length,
        eosySnapshots: mySnapshots.length,
        gradesWithSnapshot,
      },
    },
    schoolYear: {
      id: data.schoolYear.id,
      label: data.schoolYear.label,
      gradingMode: data.schoolYear.gradingMode,
      termLabels: {
        T1: data.schoolYear.termLabelT1,
        T2: data.schoolYear.termLabelT2,
        T3: data.schoolYear.termLabelT3,
      },
      startDate: data.schoolYear.startDate,
      endDate: data.schoolYear.endDate,
      schoolSettingsSnapshot: data.schoolYear.schoolSettingsSnapshot,
    },
    teacher: {
      id: teacher.teacherId,
      userId: teacher.teacherUserId,
      employeeId: teacher.employeeId,
      name: teacher.teacherName,
      specialization: teacher.specialization,
    },
    summary: {
      sections: sectionRows.length,
      subjects: new Set(myAssignments.map((a) => a.subjectId)).size,
      students: myStudentIds.size,
      assignments: assignmentRows.length,
      grades: myGrades.length,
      attendanceRows: myAttendance.length,
      schedules: mySchedules.length,
      workloadEntries: myWorkload.length,
      observedValues: myObservedValues.length,
      editRequests: myRequests.length,
      eosySnapshots: mySnapshots.length,
    },
    sections: sectionRows,
    students: studentRows,
    classAssignments: assignmentRows,
    grades: myGrades,
    eosyFinalization,
    attendance: myAttendance,
    attendanceScope: "ADVISORY_SECTIONS + RECORDED_BY_TEACHER",
    schedules: mySchedules,
    workload: myWorkload,
    editRequests: myRequests,
    observedValues: myObservedValues,
  };

  return payload;
}

export interface SerializedTeacherArchive {
  raw: Buffer;
  compressed: Buffer;
  checksum: string;
  rawBytes: number;
  compressedBytes: number;
  oversized: boolean;
}

export function serializeTeacherArchivePayload(payload: unknown): SerializedTeacherArchive {
  const raw = Buffer.from(JSON.stringify(payload), "utf8");
  const compressed = gzipSync(raw, { level: 9 });
  return {
    raw,
    compressed,
    checksum: createHash("sha256").update(raw).digest("hex"),
    rawBytes: raw.length,
    compressedBytes: compressed.length,
    oversized: raw.length > TEACHER_ARCHIVE_MAX_RAW_BYTES,
  };
}

/**
 * Create PENDING metadata rows for teachers with data in the year. Safe to call
 * repeatedly. Must be called AFTER the archive transaction commits so archive
 * behavior never depends on this feature.
 */
export async function ensureTeacherArchivesQueued(opts: {
  schoolYearId: string;
  yearLabel: string;
  source: TeacherArchiveSource;
  createdBy?: string;
}): Promise<number> {
  if (!isTeacherArchiveEnabled()) return 0;

  const teachers = await collectExpectedTeachers(prisma, opts.yearLabel);
  if (teachers.length === 0) return 0;

  const result = await prisma.teacherYearArchive.createMany({
    data: teachers.map((t) => ({
      schoolYearId: opts.schoolYearId,
      schoolYear: opts.yearLabel,
      teacherId: t.teacherId,
      teacherUserId: t.teacherUserId,
      employeeId: t.employeeId,
      teacherName: t.teacherName,
      status: "PENDING",
      schemaVersion: TEACHER_ARCHIVE_SCHEMA_VERSION,
      encoding: TEACHER_ARCHIVE_ENCODING,
      source: opts.source,
      createdBy: opts.createdBy,
    })),
    skipDuplicates: true,
  });

  logger.info(`${LOG_PREFIX} Queued ${result.count} teacher archive(s) for ${opts.yearLabel}.`);
  return result.count;
}

export async function generateTeacherYearArchives(
  schoolYearId: string,
  opts: { regenerate?: boolean; source?: TeacherArchiveSource; createdBy?: string } = {},
): Promise<TeacherArchiveGenerationSummary> {
  const startedAt = Date.now();
  const empty: TeacherArchiveGenerationSummary = {
    schoolYearId,
    schoolYear: "unknown",
    considered: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
    rawBytes: 0,
    compressedBytes: 0,
    durationMs: 0,
  };

  if (!isTeacherArchiveEnabled()) return empty;
  if (generationInFlight.has(schoolYearId)) {
    logger.warn(`${LOG_PREFIX} Generation already in progress for schoolYearId=${schoolYearId}; skipping.`);
    return empty;
  }

  generationInFlight.add(schoolYearId);
  try {
    const year = await prisma.schoolYear.findUnique({ where: { id: schoolYearId } });
    if (!year) {
      logger.warn(`${LOG_PREFIX} School year ${schoolYearId} no longer exists; skipping generation.`);
      return { ...empty, durationMs: Date.now() - startedAt };
    }

    const rows = await prisma.teacherYearArchive.findMany({
      where: {
        schoolYearId,
        ...(opts.regenerate ? {} : { status: { in: ["PENDING", "FAILED"] } }),
      },
      orderBy: { teacherName: "asc" },
    });

    if (rows.length === 0) {
      return { ...empty, schoolYear: year.label, durationMs: Date.now() - startedAt };
    }

    const [data, expectedTeachers] = await Promise.all([
      fetchYearData(prisma, year.label),
      collectExpectedTeachers(prisma, year.label),
    ]);
    const expectedById = new Map(expectedTeachers.map((t) => [t.teacherId, t]));

    let completed = 0;
    let failed = 0;
    let skipped = 0;
    let rawBytes = 0;
    let compressedBytes = 0;

    for (const row of rows) {
      const teacher =
        expectedById.get(row.teacherId) ??
        ({
          teacherId: row.teacherId,
          teacherUserId: row.teacherUserId,
          employeeId: row.employeeId,
          teacherName: row.teacherName,
          specialization: null,
        } satisfies ExpectedTeacher);

      try {
        const payload = buildTeacherArchivePayload(data, teacher, {
          source: opts.source ?? (row.source as TeacherArchiveSource),
          backfilled: (opts.source ?? row.source) === "BACKFILL",
        });
        const serialized = serializeTeacherArchivePayload(payload);

        const warnings = new Set<string>(
          ((payload.dataQuality as { warnings?: string[] } | undefined)?.warnings ?? []) as string[],
        );
        if (serialized.oversized) warnings.add("OVERSIZED_PAYLOAD");

        await prisma.teacherYearArchive.update({
          where: { id: row.id },
          data: {
            teacherName: teacher.teacherName,
            teacherUserId: teacher.teacherUserId,
            employeeId: teacher.employeeId,
            payload: Uint8Array.from(serialized.compressed),
            rawBytes: serialized.rawBytes,
            compressedBytes: serialized.compressedBytes,
            checksum: serialized.checksum,
            stats: (payload.summary as Prisma.InputJsonValue) ?? {},
            dataQuality: {
              ...(payload.dataQuality as Record<string, unknown>),
              warnings: [...warnings],
            } as Prisma.InputJsonValue,
            status: "COMPLETE",
            error: null,
            completedAt: new Date(),
            source: opts.source ?? row.source,
            encoding: TEACHER_ARCHIVE_ENCODING,
            schemaVersion: TEACHER_ARCHIVE_SCHEMA_VERSION,
          },
        });

        completed += 1;
        rawBytes += serialized.rawBytes;
        compressedBytes += serialized.compressedBytes;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        // Test cleanup (and any external year deletion) can remove the row while
        // a bundle is being built. That is not a data failure — skip quietly.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
          skipped += 1;
          logger.warn(`${LOG_PREFIX} Archive row ${row.id} disappeared during generation; skipped.`);
          continue;
        }

        failed += 1;
        await prisma.teacherYearArchive
          .update({
            where: { id: row.id },
            data: { status: "FAILED", error: message.slice(0, 500) },
          })
          .catch((updateError) => {
            if (updateError instanceof Prisma.PrismaClientKnownRequestError && updateError.code === "P2025") {
              logger.warn(`${LOG_PREFIX} Archive row ${row.id} disappeared before failure could be recorded.`);
            } else {
              logger.error(`${LOG_PREFIX} Failed to mark archive FAILED (${row.id}):`, updateError);
            }
          });
        logger.error(`${LOG_PREFIX} Teacher archive failed for ${teacher.teacherName} (${row.teacherId}): ${message}`);
      }
    }

    const summary: TeacherArchiveGenerationSummary = {
      schoolYearId,
      schoolYear: year.label,
      considered: rows.length,
      completed,
      failed,
      skipped,
      rawBytes,
      compressedBytes,
      durationMs: Date.now() - startedAt,
    };

    logger.info(
      `${LOG_PREFIX} ${year.label}: ${completed} complete, ${failed} failed, ${skipped} skipped; ` +
        `${rawBytes} raw -> ${compressedBytes} compressed bytes in ${summary.durationMs}ms`,
    );
    return summary;
  } finally {
    generationInFlight.delete(schoolYearId);
  }
}

export function deserializeTeacherArchive(row: {
  payload: Uint8Array | null;
  checksum?: string | null;
  status?: string | null;
}): unknown {
  if (!row.payload) throw new Error("Archive payload is missing");
  if (row.status && row.status !== "COMPLETE") throw new Error(`Archive is not complete: ${row.status}`);
  const raw = gunzipSync(row.payload);
  if (row.checksum) {
    const actual = createHash("sha256").update(raw).digest("hex");
    if (actual !== row.checksum) throw new Error("Archive checksum mismatch");
  }
  return JSON.parse(raw.toString("utf8"));
}

/**
 * Startup recovery: regenerate PENDING/FAILED rows for already-archived years.
 * Never scans or generates years that have no queued rows.
 */
export async function resumePendingTeacherArchives(): Promise<TeacherArchiveGenerationSummary[]> {
  if (!isTeacherArchiveEnabled()) return [];

  const pending = await prisma.teacherYearArchive.findMany({
    where: { status: { in: ["PENDING", "FAILED"] } },
    select: { schoolYearId: true },
    distinct: ["schoolYearId"],
    take: 10,
  });

  const results: TeacherArchiveGenerationSummary[] = [];
  for (const row of pending) {
    try {
      results.push(await generateTeacherYearArchives(row.schoolYearId));
    } catch (error) {
      logger.error(`${LOG_PREFIX} Resume failed for schoolYearId=${row.schoolYearId}:`, error);
    }
  }
  return results;
}
