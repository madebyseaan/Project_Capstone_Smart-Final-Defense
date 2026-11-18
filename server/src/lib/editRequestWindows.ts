/**
 * editRequestWindows.ts — Temporary unfinalization windows for finalized grades.
 *
 * Flow: teacher requests -> admin approves -> registrar opens a timed window
 * (FINALIZED -> DRAFT) -> teacher edits -> window closes/expires -> registrar
 * reviews and re-finalizes. Grades never auto-re-finalize.
 */

import { Prisma, type GradeEditRequest, type Term } from "@prisma/client";
import { prisma } from "./prisma";
import { getSectionEosyStatus } from "./promotion";

export type CorrectionDisplayStatus =
  | "APPROVED"
  | "WINDOW_OPEN"
  | "EXPIRED"
  | "REFINALIZED"
  | "DECLINED";

export interface CorrectionRequestItem {
  id: string;
  teacherId: string;
  teacherName: string;
  schoolYear: string;
  term: string;
  classAssignmentId: string | null;
  section: string | null;
  subject: string | null;
  gradeLevel: string | null;
  reason: string;
  status: string;
  displayStatus: CorrectionDisplayStatus;
  approvedByName: string | null;
  approvedHours: number | null;
  expiresAt: string | null;
  windowOpenedAt: string | null;
  windowClosedAt: string | null;
  refinalizedAt: string | null;
  refinalizedByName: string | null;
  declineReason: string | null;
  unfinalizedGradeCount: number;
  minutesRemaining: number | null;
  createdAt: string;
}

export interface CorrectionSummary {
  awaitingWindow: number;
  windowOpen: number;
  needsRefinalization: number;
  total: number;
}

interface BaselineGrade {
  id: string;
  studentId: string;
  studentName: string;
  writtenWorkScores: unknown;
  perfTaskScores: unknown;
  examScores: unknown;
  quarterlyAssessScore: number | null;
  quarterlyAssessMax: number | null;
  writtenWorkPS: number | null;
  perfTaskPS: number | null;
  quarterlyAssessPS: number | null;
  initialGrade: number | null;
  quarterlyGrade: number | null;
}

const COMPARED_FIELDS = [
  "writtenWorkScores",
  "perfTaskScores",
  "examScores",
  "quarterlyAssessScore",
  "quarterlyAssessMax",
  "writtenWorkPS",
  "perfTaskPS",
  "quarterlyAssessPS",
  "initialGrade",
  "quarterlyGrade",
] as const;

type CorrectionErrorCode =
  | "NOT_FOUND"
  | "NOT_WINDOW_REQUEST"
  | "INVALID_STATE"
  | "YEAR_ARCHIVED"
  | "EOSY_STARTED"
  | "NO_FINALIZED_GRADES"
  | "NO_ASSIGNMENT";

export type CorrectionActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: CorrectionErrorCode; message: string };

function displayStatusFor(request: GradeEditRequest, now = new Date()): CorrectionDisplayStatus {
  if (request.status === "WINDOW_OPEN" && request.expiresAt && request.expiresAt.getTime() <= now.getTime()) {
    return "EXPIRED";
  }
  if (request.status === "WINDOW_OPEN") return "WINDOW_OPEN";
  if (request.status === "APPROVED") return "APPROVED";
  if (request.status === "DECLINED") return "DECLINED";
  if (request.status === "REFINALIZED") return "REFINALIZED";
  return "EXPIRED";
}

function toItem(request: GradeEditRequest): CorrectionRequestItem {
  const now = new Date();
  const displayStatus = displayStatusFor(request, now);
  const minutesRemaining =
    displayStatus === "WINDOW_OPEN" && request.expiresAt
      ? Math.max(0, Math.ceil((request.expiresAt.getTime() - now.getTime()) / 60000))
      : null;
  return {
    id: request.id,
    teacherId: request.teacherId,
    teacherName: request.teacherName,
    schoolYear: request.schoolYear,
    term: request.term,
    classAssignmentId: request.classAssignmentId,
    section: request.section,
    subject: request.subject,
    gradeLevel: request.gradeLevel,
    reason: request.reason,
    status: request.status,
    displayStatus,
    approvedByName: request.approvedByName,
    approvedHours: request.approvedHours,
    expiresAt: request.expiresAt?.toISOString() ?? null,
    windowOpenedAt: request.windowOpenedAt?.toISOString() ?? null,
    windowClosedAt: request.windowClosedAt?.toISOString() ?? null,
    refinalizedAt: request.refinalizedAt?.toISOString() ?? null,
    refinalizedByName: request.refinalizedByName,
    declineReason: request.declineReason,
    unfinalizedGradeCount: request.unfinalizedGradeCount,
    minutesRemaining,
    createdAt: request.createdAt.toISOString(),
  };
}

export async function listCorrectionRequests(opts: {
  schoolYear: string;
  includeClosed?: boolean;
}): Promise<{ items: CorrectionRequestItem[]; summary: CorrectionSummary }> {
  const requests = await prisma.gradeEditRequest.findMany({
    where: {
      windowRequired: true,
      schoolYear: opts.schoolYear,
      ...(opts.includeClosed
        ? {}
        : { status: { in: ["APPROVED", "WINDOW_OPEN", "EXPIRED"] } }),
    },
    orderBy: { createdAt: "desc" },
  });

  const items = requests.map(toItem);
  const summary: CorrectionSummary = {
    awaitingWindow: items.filter((item) => item.displayStatus === "APPROVED").length,
    windowOpen: items.filter((item) => item.displayStatus === "WINDOW_OPEN").length,
    needsRefinalization: items.filter((item) => item.displayStatus === "EXPIRED").length,
    total: items.length,
  };
  return { items, summary };
}

export async function getCorrectionSummary(schoolYear: string): Promise<CorrectionSummary> {
  return (await listCorrectionRequests({ schoolYear })).summary;
}

function snapshotOf(grade: {
  writtenWorkScores: unknown;
  perfTaskScores: unknown;
  examScores: unknown;
  quarterlyAssessScore: number | null;
  quarterlyAssessMax: number | null;
  writtenWorkPS: number | null;
  perfTaskPS: number | null;
  quarterlyAssessPS: number | null;
  initialGrade: number | null;
  quarterlyGrade: number | null;
}) {
  return {
    writtenWorkScores: grade.writtenWorkScores,
    perfTaskScores: grade.perfTaskScores,
    examScores: grade.examScores,
    quarterlyAssessScore: grade.quarterlyAssessScore,
    quarterlyAssessMax: grade.quarterlyAssessMax,
    writtenWorkPS: grade.writtenWorkPS,
    perfTaskPS: grade.perfTaskPS,
    quarterlyAssessPS: grade.quarterlyAssessPS,
    initialGrade: grade.initialGrade,
    quarterlyGrade: grade.quarterlyGrade,
  };
}

function equalField(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export async function openCorrectionWindow(opts: {
  requestId: string;
  actor: { id: string; name: string };
}): Promise<CorrectionActionResult<CorrectionRequestItem>> {
  const request = await prisma.gradeEditRequest.findUnique({ where: { id: opts.requestId } });
  if (!request) return { ok: false, code: "NOT_FOUND", message: "Edit request not found" };
  if (!request.windowRequired) {
    return { ok: false, code: "NOT_WINDOW_REQUEST", message: "This request does not use a correction window" };
  }
  if (request.status !== "APPROVED") {
    return { ok: false, code: "INVALID_STATE", message: `Request is ${request.status.toLowerCase()}, not approved` };
  }
  if (!request.classAssignmentId) {
    return { ok: false, code: "NO_ASSIGNMENT", message: "Request has no class assignment scope" };
  }

  const [classAssignment, year] = await Promise.all([
    prisma.classAssignment.findUnique({
      where: { id: request.classAssignmentId },
      include: { section: { select: { id: true, name: true } } },
    }),
    prisma.schoolYear.findUnique({ where: { label: request.schoolYear }, select: { status: true } }),
  ]);
  if (!classAssignment) {
    return { ok: false, code: "NO_ASSIGNMENT", message: "Class assignment not found" };
  }
  if (year?.status === "ARCHIVED") {
    return { ok: false, code: "YEAR_ARCHIVED", message: "This school year is archived" };
  }

  const eosy = await getSectionEosyStatus(classAssignment.sectionId, request.schoolYear);
  if (eosy && eosy.withStoredStatus > 0) {
    return { ok: false, code: "EOSY_STARTED", message: "Unfinalize EOSY before opening a correction window" };
  }

  const grades = await prisma.grade.findMany({
    where: {
      classAssignmentId: request.classAssignmentId,
      term: request.term as Term,
      status: "FINALIZED",
    },
    include: { student: { select: { firstName: true, lastName: true } } },
  });
  if (grades.length === 0) {
    return { ok: false, code: "NO_FINALIZED_GRADES", message: "No finalized grades found for this scope" };
  }

  const baseline: BaselineGrade[] = grades.map((grade) => ({
    id: grade.id,
    studentId: grade.studentId,
    studentName: `${grade.student.firstName} ${grade.student.lastName}`.trim(),
    ...snapshotOf(grade),
  }));

  const now = new Date();
  const hours = request.approvedHours ?? 24;
  const expiresAt = new Date(now.getTime() + hours * 60 * 60 * 1000);
  const gradeIds = grades.map((grade) => grade.id);

  const updated = await prisma.$transaction(async (tx) => {
    await tx.grade.updateMany({
      where: { id: { in: gradeIds }, status: "FINALIZED" },
      data: { status: "DRAFT", finalizedAt: null, finalizedBy: null },
    });
    return tx.gradeEditRequest.update({
      where: { id: request.id },
      data: {
        status: "WINDOW_OPEN",
        windowOpenedAt: now,
        windowOpenedById: opts.actor.id,
        windowOpenedByName: opts.actor.name,
        expiresAt,
        unfinalizedGradeCount: gradeIds.length,
        baseline: baseline as unknown as Prisma.InputJsonValue,
      },
    });
  });

  return { ok: true, data: toItem(updated) };
}

export async function closeCorrectionWindow(opts: {
  requestId: string;
  actor: { id: string; name: string };
}): Promise<CorrectionActionResult<CorrectionRequestItem>> {
  const request = await prisma.gradeEditRequest.findUnique({ where: { id: opts.requestId } });
  if (!request) return { ok: false, code: "NOT_FOUND", message: "Edit request not found" };
  if (!request.windowRequired) {
    return { ok: false, code: "NOT_WINDOW_REQUEST", message: "This request does not use a correction window" };
  }
  if (request.status !== "WINDOW_OPEN") {
    return { ok: false, code: "INVALID_STATE", message: `Request is ${request.status.toLowerCase()}, not open` };
  }
  const now = new Date();
  const updated = await prisma.gradeEditRequest.update({
    where: { id: request.id },
    data: {
      status: "EXPIRED",
      windowClosedAt: now,
      expiresAt: now,
    },
  });
  return { ok: true, data: toItem(updated) };
}

export async function declineCorrectionWindow(opts: {
  requestId: string;
  actor: { id: string; name: string };
  reason?: string;
}): Promise<CorrectionActionResult<CorrectionRequestItem>> {
  const request = await prisma.gradeEditRequest.findUnique({ where: { id: opts.requestId } });
  if (!request) return { ok: false, code: "NOT_FOUND", message: "Edit request not found" };
  if (!request.windowRequired) {
    return { ok: false, code: "NOT_WINDOW_REQUEST", message: "This request does not use a correction window" };
  }
  if (request.status !== "APPROVED") {
    return { ok: false, code: "INVALID_STATE", message: `Request is ${request.status.toLowerCase()}, not awaiting a window` };
  }
  const updated = await prisma.gradeEditRequest.update({
    where: { id: request.id },
    data: {
      status: "DECLINED",
      declineReason: opts.reason?.trim() || null,
    },
  });
  return { ok: true, data: toItem(updated) };
}

export async function refinalizeCorrectionWindow(opts: {
  requestId: string;
  actor: { id: string; name: string };
}): Promise<CorrectionActionResult<CorrectionRequestItem>> {
  const request = await prisma.gradeEditRequest.findUnique({ where: { id: opts.requestId } });
  if (!request) return { ok: false, code: "NOT_FOUND", message: "Edit request not found" };
  if (!request.windowRequired) {
    return { ok: false, code: "NOT_WINDOW_REQUEST", message: "This request does not use a correction window" };
  }
  if (request.status !== "EXPIRED") {
    return { ok: false, code: "INVALID_STATE", message: `Request is ${request.status.toLowerCase()}, not awaiting re-finalization` };
  }
  if (!request.classAssignmentId) {
    return { ok: false, code: "NO_ASSIGNMENT", message: "Request has no class assignment scope" };
  }

  const [classAssignment, year] = await Promise.all([
    prisma.classAssignment.findUnique({ where: { id: request.classAssignmentId } }),
    prisma.schoolYear.findUnique({ where: { label: request.schoolYear }, select: { status: true } }),
  ]);
  if (!classAssignment) {
    return { ok: false, code: "NO_ASSIGNMENT", message: "Class assignment not found" };
  }
  if (year?.status === "ARCHIVED") {
    return { ok: false, code: "YEAR_ARCHIVED", message: "This school year is archived" };
  }

  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    await tx.grade.updateMany({
      where: {
        classAssignmentId: request.classAssignmentId!,
        term: request.term as Term,
        status: "DRAFT",
      },
      data: { status: "FINALIZED", finalizedAt: now, finalizedBy: opts.actor.id },
    });
    return tx.gradeEditRequest.update({
      where: { id: request.id },
      data: {
        status: "REFINALIZED",
        refinalizedAt: now,
        refinalizedById: opts.actor.id,
        refinalizedByName: opts.actor.name,
      },
    });
  });

  return { ok: true, data: toItem(updated) };
}

export interface CorrectionReviewChange {
  field: string;
  label: string;
  category: string | null;
  kind: "input" | "computed" | "record";
  details: string[];
}

export interface CorrectionReviewStudent {
  studentId: string;
  studentName: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  changedFields: string[];
  changes: CorrectionReviewChange[];
}

const FIELD_META: Record<string, { label: string; category: string | null }> = {
  writtenWorkScores: { label: "Written Work", category: "Written Work" },
  writtenWorkPS: { label: "Written Work %", category: "Written Work" },
  perfTaskScores: { label: "Performance Task", category: "Performance Task" },
  perfTaskPS: { label: "Performance Task %", category: "Performance Task" },
  examScores: { label: "Term Assessment breakdown", category: "Term Assessment" },
  quarterlyAssessScore: { label: "Term Assessment score", category: "Term Assessment" },
  quarterlyAssessMax: { label: "Term Assessment max", category: "Term Assessment" },
  quarterlyAssessPS: { label: "Term Assessment %", category: "Term Assessment" },
  initialGrade: { label: "Initial Grade", category: "Initial Grade" },
  quarterlyGrade: { label: "Quarterly Grade", category: "Quarterly Grade" },
};

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "—";
    return String(Math.round(value * 100) / 100);
  }
  return String(value);
}

function scoreItemLabel(item: Record<string, unknown> | undefined, fallback: string): string {
  const name = item?.name;
  return typeof name === "string" && name.trim() ? name : fallback;
}

function scoreItemValue(item: Record<string, unknown> | undefined): string {
  if (!item) return "—";
  if (typeof item.status === "string" && item.status.trim()) return item.status;
  return `${formatValue(item.score)}/${formatValue(item.maxScore)}`;
}

function arrayDetails(
  label: string,
  beforeValue: unknown,
  afterValue: unknown,
): string[] {
  const before = Array.isArray(beforeValue) ? (beforeValue as Record<string, unknown>[]) : [];
  const after = Array.isArray(afterValue) ? (afterValue as Record<string, unknown>[]) : [];
  const details: string[] = [];
  const max = Math.max(before.length, after.length);
  for (let i = 0; i < max; i++) {
    const b = before[i];
    const a = after[i];
    const name = scoreItemLabel(a ?? b, `${label} ${i + 1}`);
    if (!b && a) {
      details.push(`Added ${name} (${scoreItemValue(a)})`);
    } else if (b && !a) {
      details.push(`Removed ${name}`);
    } else if (b && a && scoreItemValue(b) !== scoreItemValue(a)) {
      details.push(`${name}: ${scoreItemValue(b)} → ${scoreItemValue(a)}`);
    }
  }
  if (details.length > 8) {
    return [...details.slice(0, 8), `+${details.length - 8} more change(s)`];
  }
  return details;
}

const INPUT_FIELDS = new Set([
  "writtenWorkScores",
  "perfTaskScores",
  "examScores",
  "quarterlyAssessScore",
  "quarterlyAssessMax",
]);

function describeChange(
  field: string,
  beforeValue: unknown,
  afterValue: unknown,
): CorrectionReviewChange {
  const meta = FIELD_META[field] ?? { label: field, category: null };
  const isArray = field.endsWith("Scores");
  const details = isArray
    ? arrayDetails(meta.label, beforeValue, afterValue)
    : [`${meta.label}: ${formatValue(beforeValue)} → ${formatValue(afterValue)}`];
  return {
    field,
    label: meta.label,
    category: meta.category,
    kind: INPUT_FIELDS.has(field) ? "input" : "computed",
    details,
  };
}

const REASON_CATEGORY_PATTERNS: Array<{ category: string; pattern: RegExp }> = [
  { category: "Written Work", pattern: /\bww\b|written\s*work/i },
  { category: "Performance Task", pattern: /\bpt\b|performance\s*task/i },
  { category: "Term Assessment", pattern: /\bqa\b|\bta\b|term\s*assessment|exam|assessment/i },
  { category: "Initial Grade", pattern: /initial\s*grade/i },
  { category: "Quarterly Grade", pattern: /quarterly\s*grade|final\s*grade/i },
];

function categoriesInReason(reason: string): string[] {
  return REASON_CATEGORY_PATTERNS.filter(({ pattern }) => pattern.test(reason)).map(
    ({ category }) => category,
  );
}

export async function reviewCorrectionWindow(requestId: string): Promise<
  CorrectionActionResult<{
    request: CorrectionRequestItem;
    students: CorrectionReviewStudent[];
    changedCount: number;
    unchangedCount: number;
    changedCategories: string[];
    reasonCategories: string[];
    outsideReasonCategories: string[];
  }>
> {
  const request = await prisma.gradeEditRequest.findUnique({ where: { id: requestId } });
  if (!request) return { ok: false, code: "NOT_FOUND", message: "Edit request not found" };
  if (!request.windowRequired) {
    return { ok: false, code: "NOT_WINDOW_REQUEST", message: "This request does not use a correction window" };
  }
  if (!request.classAssignmentId) {
    return { ok: false, code: "NO_ASSIGNMENT", message: "Request has no class assignment scope" };
  }

  const current = await prisma.grade.findMany({
    where: {
      classAssignmentId: request.classAssignmentId,
      term: request.term as Term,
    },
    include: { student: { select: { firstName: true, lastName: true } } },
  });

  const baseline = Array.isArray(request.baseline)
    ? (request.baseline as unknown as BaselineGrade[])
    : [];
  const beforeByStudent = new Map(baseline.map((row) => [row.studentId, row]));
  const afterByStudent = new Map(current.map((row) => [row.studentId, row]));

  const studentIds = new Set<string>([
    ...beforeByStudent.keys(),
    ...afterByStudent.keys(),
  ]);

  const students: CorrectionReviewStudent[] = [];
  for (const studentId of studentIds) {
    const before = beforeByStudent.get(studentId) ?? null;
    const afterRow = afterByStudent.get(studentId) ?? null;
    const after = afterRow ? snapshotOf(afterRow) : null;
    const changedFields: string[] = [];
    const changes: CorrectionReviewChange[] = [];

    if (before && !after) {
      changedFields.push("DELETED");
      changes.push({
        field: "DELETED",
        label: "Grade record",
        category: null,
        kind: "record",
        details: ["Grade record was removed during the window."],
      });
    } else if (!before && after) {
      changedFields.push("ADDED");
      changes.push({
        field: "ADDED",
        label: "Grade record",
        category: null,
        kind: "record",
        details: ["A new grade record was added during the window."],
      });
    } else if (before && after) {
      for (const field of COMPARED_FIELDS) {
        const beforeValue = (before as unknown as Record<string, unknown>)[field];
        const afterValue = (after as Record<string, unknown>)[field];
        if (!equalField(beforeValue, afterValue)) {
          const change = describeChange(field, beforeValue, afterValue);
          if (change.details.length > 0) {
            changedFields.push(field);
            changes.push(change);
          }
        }
      }
    }

    students.push({
      studentId,
      studentName:
        before?.studentName ??
        (afterRow ? `${afterRow.student.firstName} ${afterRow.student.lastName}`.trim() : studentId),
      before: before ? snapshotOf(before) : null,
      after,
      changedFields,
      changes,
    });
  }

  students.sort((a, b) => a.studentName.localeCompare(b.studentName));
  const changedCount = students.filter((student) => student.changedFields.length > 0).length;
  const changedCategories = Array.from(
    new Set(
      students
        .flatMap((student) => student.changes)
        .map((change) => change.category)
        .filter((category): category is string => !!category),
    ),
  ).sort();
  const reasonCategories = categoriesInReason(request.reason);
  const directInputCategories = new Set(["Written Work", "Performance Task", "Term Assessment"]);
  const outsideReasonCategories =
    reasonCategories.length > 0
      ? changedCategories.filter(
          (category) =>
            directInputCategories.has(category) && !reasonCategories.includes(category),
        )
      : [];

  return {
    ok: true,
    data: {
      request: toItem(request),
      students,
      changedCount,
      unchangedCount: students.length - changedCount,
      changedCategories,
      reasonCategories,
      outsideReasonCategories,
    },
  };
}
