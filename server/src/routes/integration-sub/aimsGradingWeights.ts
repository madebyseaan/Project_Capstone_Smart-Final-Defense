import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { aimsServiceAuth } from "../../middleware/aimsServiceAuth";
import { aimsGradingWeightsQuerySchema } from "../../schemas/aims";
import {
  resolveEffectiveWeightsForClassAssignment,
  type EffectiveWeights,
} from "../grades-sub/helpers";

const MAX_BATCH = 50;

type GradingWeightSource = "SUBJECT_DEFAULT" | "GROUP_DEFAULT" | "GENERIC_FALLBACK";

interface LinkedAssignment {
  id: string;
  aimsCourseId: string | null;
  schoolYear: string;
  isActive: boolean;
  updatedAt: Date;
  subject: { code: string; name: string };
  section: { name: string; gradeLevel: string };
  teacher: { employeeId: string };
}

interface LookupResult {
  assignment: LinkedAssignment | null;
  ambiguous: boolean;
}

const assignmentInclude = {
  subject: { select: { code: true, name: true } },
  section: { select: { name: true, gradeLevel: true } },
  teacher: { select: { employeeId: true } },
};

export function mapEffectiveWeightsSource(source: EffectiveWeights["source"]): GradingWeightSource {
  if (source === "subject-override") return "SUBJECT_DEFAULT";
  if (source === "subject-type") return "GROUP_DEFAULT";
  return "GENERIC_FALLBACK";
}

export function normalizeAimsTerm(
  raw?: string,
): { ok: true; value: string | null } | { ok: false } {
  if (!raw) return { ok: true, value: null };
  const term = raw.trim().toUpperCase();
  if (term === "1" || term === "T1") return { ok: true, value: "T1" };
  if (term === "2" || term === "T2") return { ok: true, value: "T2" };
  if (term === "3" || term === "T3") return { ok: true, value: "T3" };
  return { ok: false };
}

function sendError(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ code, message });
}

function pickSingle(rows: LinkedAssignment[]): LookupResult {
  if (rows.length === 0) return { assignment: null, ambiguous: false };
  if (rows.length === 1) return { assignment: rows[0], ambiguous: false };
  const active = rows.filter((row) => row.isActive);
  if (active.length === 1) return { assignment: active[0], ambiguous: false };
  return { assignment: null, ambiguous: true };
}

async function findLinkedAssignment(aimsCourseId: string, schoolYear?: string): Promise<LookupResult> {
  const rows = await prisma.classAssignment.findMany({
    where: {
      aimsCourseId,
      ...(schoolYear ? { schoolYear } : {}),
    },
    include: assignmentInclude,
    orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }],
    take: 2,
  });
  return pickSingle(rows as LinkedAssignment[]);
}

function courseCodeCandidates(raw: string): string[] {
  const candidates = [raw];
  const stripped = raw.match(/^EP-\d+-(.+)$/i);
  if (stripped?.[1]) candidates.push(stripped[1]);
  return candidates;
}

async function findByCourseCode(courseCode: string, schoolYear?: string): Promise<LookupResult> {
  for (const candidate of courseCodeCandidates(courseCode)) {
    const exact = await prisma.classAssignment.findMany({
      where: {
        ...(schoolYear ? { schoolYear } : {}),
        subject: { code: { equals: candidate, mode: "insensitive" } },
      },
      include: assignmentInclude,
      orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }],
      take: 2,
    });
    const result = pickSingle(exact as LinkedAssignment[]);
    if (result.assignment || result.ambiguous) return result;
  }

  for (const candidate of courseCodeCandidates(courseCode)) {
    const prefix = await prisma.classAssignment.findMany({
      where: {
        ...(schoolYear ? { schoolYear } : {}),
        subject: { code: { startsWith: candidate, mode: "insensitive" } },
      },
      include: assignmentInclude,
      orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }],
      take: 2,
    });
    const result = pickSingle(prefix as LinkedAssignment[]);
    if (result.assignment || result.ambiguous) return result;
  }

  return { assignment: null, ambiguous: false };
}

async function buildCoursePayload(
  assignment: LinkedAssignment,
  input: { courseCode?: string; term: string | null },
) {
  const effective = await resolveEffectiveWeightsForClassAssignment(assignment.id);
  const weightsSum = effective.ww + effective.pt + effective.qa;
  const source = mapEffectiveWeightsSource(effective.source);

  return {
    linked: true,
    aimsCourseId: assignment.aimsCourseId,
    classAssignmentId: assignment.id,
    courseCode: input.courseCode ?? null,
    subjectCode: assignment.subject.code,
    subjectName: assignment.subject.name,
    sectionName: assignment.section.name,
    gradeLevel: assignment.section.gradeLevel,
    schoolYear: assignment.schoolYear,
    teacherEmployeeId: assignment.teacher.employeeId ?? null,
    isActive: assignment.isActive,
    term: input.term,
    termScoped: false,
    source,
    isFallback: source === "GENERIC_FALLBACK",
    weights: { ww: effective.ww, pt: effective.pt, qa: effective.qa },
    weightsSum,
    weightsValid: weightsSum === 100,
    updatedAt: (effective.updatedAt ?? assignment.updatedAt).toISOString(),
  };
}

async function handleGradingWeights(req: Request, res: Response): Promise<void> {
  const parsed = aimsGradingWeightsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    sendError(
      res,
      400,
      "INVALID_QUERY",
      parsed.error.issues[0]?.message ?? "Invalid query parameters.",
    );
    return;
  }

  const query = parsed.data;
  const term = normalizeAimsTerm(query.term);
  if (!term.ok) {
    sendError(res, 400, "INVALID_QUERY", "term must be 1, 2, 3, T1, T2, or T3.");
    return;
  }

  try {
    if (query.aimsCourseIds) {
      const rawIds = query.aimsCourseIds
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);

      if (rawIds.length === 0) {
        sendError(res, 400, "INVALID_QUERY", "aimsCourseIds must contain at least one ID.");
        return;
      }
      if (rawIds.length > MAX_BATCH) {
        sendError(res, 400, "TOO_MANY_COURSES", `At most ${MAX_BATCH} course IDs are allowed per request.`);
        return;
      }

      const ids = [...new Set(rawIds)];
      const invalid = ids.find((id) => !z.string().uuid().safeParse(id).success);
      if (invalid) {
        sendError(res, 400, "INVALID_QUERY", `Invalid AIMS course ID format: ${invalid}`);
        return;
      }

      const results = [];
      for (const id of ids) {
        const { assignment, ambiguous } = await findLinkedAssignment(id, query.schoolYear);
        if (ambiguous) {
          results.push({
            aimsCourseId: id,
            error: {
              code: "AMBIGUOUS_AIMS_COURSE_LINK",
              message: "This AIMS course is linked to more than one SMART class assignment. Send schoolYear or relink it.",
            },
          });
          continue;
        }
        if (!assignment) {
          results.push({
            aimsCourseId: id,
            error: {
              code: "AIMS_COURSE_NOT_LINKED",
              message: `AIMS course ${id} is not linked to any SMART class assignment.`,
            },
          });
          continue;
        }
        results.push(
          await buildCoursePayload(assignment, {
            courseCode: query.courseCode,
            term: term.value,
          }),
        );
      }

      res.json({ results });
      return;
    }

    let lookup: LookupResult = { assignment: null, ambiguous: false };
    if (query.aimsCourseId) {
      lookup = await findLinkedAssignment(query.aimsCourseId, query.schoolYear);
    } else if (query.courseCode) {
      lookup = await findByCourseCode(query.courseCode, query.schoolYear);
    }

    if (lookup.ambiguous) {
      sendError(
        res,
        409,
        "AMBIGUOUS_AIMS_COURSE_LINK",
        "This AIMS course is linked to more than one SMART class assignment. Send schoolYear or relink it.",
      );
      return;
    }

    if (!lookup.assignment) {
      const key = query.aimsCourseId ?? query.courseCode ?? "unknown";
      sendError(
        res,
        404,
        "AIMS_COURSE_NOT_LINKED",
        `AIMS course ${key} is not linked to any SMART class assignment.`,
      );
      return;
    }

    res.json(
      await buildCoursePayload(lookup.assignment, {
        courseCode: query.courseCode,
        term: term.value,
      }),
    );
  } catch (error) {
    logger.error("[AIMS Grading Weights] Failed to resolve weights:", error);
    sendError(res, 500, "INTERNAL_ERROR", "Failed to resolve grading weights.");
  }
}

export default function registerAimsGradingWeights(router: Router): void {
  router.get("/aims/grading-weights", aimsServiceAuth, handleGradingWeights);
}
