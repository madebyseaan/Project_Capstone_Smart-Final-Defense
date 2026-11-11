import { Prisma, type User } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";
import { getActiveSchoolYear } from "../lib/schoolYearResolver";
import { normalizeSubjectName } from "../lib/aimsCourseMatch";

const DEFAULT_AIMS_BASE = "http://100.92.245.14:5000/api/v1";

export interface AimsIdentitySummary {
  id: string | null;
  role: string;
  firstName: string;
  lastName: string;
  email: string | null;
  username: string | null;
  lrn: string | null;
}

export class AimsSsoError extends Error {
  statusCode: number;
  code: string;
  identity?: AimsIdentitySummary;

  constructor(statusCode: number, code: string, message: string, identity?: AimsIdentitySummary) {
    super(message);
    this.name = "AimsSsoError";
    this.statusCode = statusCode;
    this.code = code;
    this.identity = identity;
  }
}

const aimsIdentitySchema = z.object({
  id: z.string().trim().min(1).nullish(),
  role: z.string().trim().min(1),
  firstName: z.string().nullish(),
  lastName: z.string().nullish(),
  email: z.string().nullish(),
  username: z.string().nullish(),
  lrn: z.string().nullish(),
});

const aimsClassSchema = z.object({
  courseId: z.string().nullish(),
  courseCode: z.string().nullish(),
  subject: z.string().nullish(),
  gradeLevel: z.string().nullish(),
  sectionId: z.number().int().nullish(),
  sectionName: z.string().nullish(),
});

const aimsContextSchema = z.object({
  school: z
    .object({
      id: z.string().nullish(),
      name: z.string().nullish(),
      shortName: z.string().nullish(),
    })
    .nullish(),
  term: z
    .object({
      schoolYear: z.string().nullish(),
      termIndex: z.number().int().min(1).max(3).nullish(),
    })
    .nullish(),
  class: aimsClassSchema.nullish(),
  teacher: z
    .object({
      userId: z.string().nullish(),
      employeeId: z.string().nullish(),
    })
    .nullish(),
});

const aimsExchangeSchema = z.object({
  success: z.literal(true),
  data: z.object({
    identity: aimsIdentitySchema,
    context: aimsContextSchema.nullish(),
    expiresAt: z.string().nullish(),
  }),
});

type AimsContext = z.infer<typeof aimsContextSchema>;

export interface AimsExchangeResult {
  user: User & { teacher: { id: string; employeeId: string } | null };
  identity: AimsIdentitySummary;
  redirectTo: string;
}

function aimsBaseUrl(): string {
  const configured = (process.env.AIMS_URL ?? process.env.AIMS_BASE_URL ?? DEFAULT_AIMS_BASE).trim();
  return configured.replace(/\/+$/, "");
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function getAimsSsoConfig(): {
  exchangeUrl: string | null;
  clientId: string;
  clientSecret: string | null;
  configured: boolean;
} {
  const explicit = (process.env.AIMS_SSO_EXCHANGE_URL ?? "").trim();
  const candidate = explicit || `${aimsBaseUrl()}/integrations/smart/sso/exchange`;
  const exchangeUrl = candidate && isValidUrl(candidate) ? candidate : null;
  const clientId = (process.env.AIMS_SSO_CLIENT_ID ?? "smart").trim() || "smart";
  const clientSecret = (process.env.AIMS_SSO_CLIENT_SECRET ?? "").trim() || null;
  return {
    exchangeUrl,
    clientId,
    clientSecret,
    configured: Boolean(exchangeUrl && clientSecret),
  };
}

function identitySummary(identity: z.infer<typeof aimsIdentitySchema>): AimsIdentitySummary {
  return {
    id: identity.id?.trim() || null,
    role: identity.role.trim().toUpperCase(),
    firstName: identity.firstName?.trim() ?? "",
    lastName: identity.lastName?.trim() ?? "",
    email: identity.email?.trim() || null,
    username: identity.username?.trim() || null,
    lrn: identity.lrn?.trim() || null,
  };
}

function normalizeName(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function namesReconcile(user: Pick<User, "firstName" | "lastName">, identity: AimsIdentitySummary): boolean {
  const localFirst = normalizeName(user.firstName);
  const localLast = normalizeName(user.lastName);
  const assertedFirst = normalizeName(identity.firstName);
  const assertedLast = normalizeName(identity.lastName);
  const firstOk = !localFirst || !assertedFirst || localFirst === assertedFirst;
  const lastOk = !localLast || !assertedLast || localLast === assertedLast;
  return firstOk && lastOk;
}

function smartRoleForAimsRole(role: string): "TEACHER" | "ADMIN" {
  if (role === "TEACHER") return "TEACHER";
  if (role === "ADMIN") return "ADMIN";
  if (role === "STUDENT") {
    throw new AimsSsoError(403, "AIMS_STUDENT_UNSUPPORTED", "SMART does not provide a student portal.");
  }
  throw new AimsSsoError(403, "AIMS_ROLE_UNSUPPORTED", "The AIMS role is not supported by SMART.");
}

async function findAimsUser(identity: AimsIdentitySummary): Promise<(User & { teacher: { id: string; employeeId: string } | null }) | null> {
  const include = { teacher: true } as const;

  if (identity.id) {
    const bound = await prisma.user.findUnique({
      where: { aimsUserId: identity.id },
      include,
    });
    if (bound) return bound;
  }

  if (identity.email) {
    const byEmail = await prisma.user.findMany({
      where: { email: identity.email },
      include,
      take: 2,
    });
    if (byEmail.length > 1) {
      throw new AimsSsoError(
        403,
        "AIMS_IDENTITY_AMBIGUOUS",
        "More than one SMART account uses this email address.",
        identity,
      );
    }
    if (byEmail.length === 1) return byEmail[0];
  }

  if (identity.username) {
    const byUsername = await prisma.user.findUnique({
      where: { username: identity.username },
      include,
    });
    if (byUsername) return byUsername;

    const byEmployeeId = await prisma.teacher.findUnique({
      where: { employeeId: identity.username },
      include: { user: { include } },
    });
    if (byEmployeeId?.user) return byEmployeeId.user;
  }

  return null;
}

async function bindAimsUserId(userId: string, aimsUserId: string | null): Promise<void> {
  if (!aimsUserId) return;
  try {
    await prisma.user.update({
      where: { id: userId },
      data: { aimsUserId },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AimsSsoError(
        403,
        "AIMS_IDENTITY_CONFLICT",
        "This AIMS identity is already linked to another SMART account.",
      );
    }
    throw error;
  }
}

function gradeLevelFromAims(value: string | null | undefined): "GRADE_7" | "GRADE_8" | "GRADE_9" | "GRADE_10" | null {
  const match = String(value ?? "").match(/(7|8|9|10)/);
  if (!match) return null;
  return `GRADE_${match[1]}` as "GRADE_7" | "GRADE_8" | "GRADE_9" | "GRADE_10";
}

function termFromIndex(index: number | null | undefined): "T1" | "T2" | "T3" | null {
  if (index === 1) return "T1";
  if (index === 2) return "T2";
  if (index === 3) return "T3";
  return null;
}

function subjectMatches(
  subject: { name: string; displayName: string | null },
  assertedSubject: string | null | undefined,
): boolean {
  if (!assertedSubject) return false;
  const base = normalizeSubjectName(assertedSubject).base;
  return [subject.name, subject.displayName]
    .filter((value): value is string => Boolean(value))
    .some((value) => normalizeSubjectName(value).base === base);
}

async function resolveAimsLanding(user: User & { teacher: { id: string } | null }, context: AimsContext | null | undefined): Promise<string> {
  if (user.role === "ADMIN") return "/admin";
  if (user.role === "REGISTRAR") return "/registrar";
  if (user.role !== "TEACHER" || !user.teacher || !context?.class) return "/teacher/records";

  let fallbackSchoolYear = "";
  if (!context.term?.schoolYear?.trim()) {
    try {
      fallbackSchoolYear = (await getActiveSchoolYear()).label;
    } catch {
      fallbackSchoolYear = "";
    }
  }
  const schoolYear = context.term?.schoolYear?.trim() || fallbackSchoolYear;
  if (!schoolYear) return "/teacher/records";
  const classContext = context.class;
  const include = { section: true, subject: true } as const;
  const baseWhere = { teacherId: user.teacher.id, schoolYear };

  let assignments: Array<{
    id: string;
    isActive: boolean;
    section: { name: string; gradeLevel: string; enrollproSectionId: number | null };
    subject: { name: string; displayName: string | null };
  }> = [];

  if (classContext.courseId) {
    assignments = await prisma.classAssignment.findMany({
      where: { ...baseWhere, aimsCourseId: classContext.courseId },
      include,
    });
  }

  if (assignments.length === 0 && classContext.sectionId != null) {
    assignments = await prisma.classAssignment.findMany({
      where: { ...baseWhere, section: { enrollproSectionId: classContext.sectionId } },
      include,
    });
  }

  if (assignments.length === 0 && classContext.sectionName) {
    const gradeLevel = gradeLevelFromAims(classContext.gradeLevel);
    assignments = await prisma.classAssignment.findMany({
      where: {
        ...baseWhere,
        section: {
          name: { equals: classContext.sectionName, mode: "insensitive" },
          ...(gradeLevel ? { gradeLevel } : {}),
        },
      },
      include,
    });
  }

  if (assignments.length === 0) return "/teacher/records";

  const subjectFiltered = classContext.subject
    ? assignments.filter((assignment) => subjectMatches(assignment.subject, classContext.subject))
    : [];
  const pool = subjectFiltered.length > 0 ? subjectFiltered : assignments;
  const chosen = pool.find((assignment) => assignment.isActive) ?? pool[0];
  if (!chosen) return "/teacher/records";

  const term = termFromIndex(context.term?.termIndex);
  return `/teacher/records/${chosen.id}${term ? `?term=${term}` : ""}`;
}

export async function exchangeAimsCode(code: string): Promise<AimsExchangeResult> {
  const { exchangeUrl, clientId, clientSecret, configured } = getAimsSsoConfig();
  if (!configured || !exchangeUrl || !clientSecret) {
    throw new AimsSsoError(503, "SSO_NOT_CONFIGURED", "AIMS SSO is not configured.");
  }

  let response: Response;
  try {
    response = await fetch(exchangeUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-smart-client-id": clientId,
        "x-smart-client-secret": clientSecret,
      },
      body: JSON.stringify({ code }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new AimsSsoError(503, "AIMS_UNREACHABLE", "AIMS could not be reached.");
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new AimsSsoError(502, "AIMS_RESPONSE_INVALID", "AIMS returned an invalid response.");
  }

  if (!response.ok) {
    const payload = body as { code?: unknown; error?: unknown };
    const fallback =
      response.status === 400
        ? "INVALID_CODE"
        : response.status === 401
          ? "INVALID_CLIENT"
          : response.status === 409
            ? "CODE_ALREADY_USED"
            : response.status === 410
              ? "CODE_EXPIRED"
              : response.status === 503
                ? "SSO_NOT_CONFIGURED"
                : "AIMS_EXCHANGE_FAILED";
    const stableCode = typeof payload.code === "string" && payload.code.trim() ? payload.code : fallback;
    throw new AimsSsoError(
      response.status >= 400 && response.status < 500 ? response.status : 502,
      stableCode,
      "AIMS rejected the sign-in code.",
    );
  }

  const parsed = aimsExchangeSchema.safeParse(body);
  if (!parsed.success) {
    throw new AimsSsoError(502, "AIMS_RESPONSE_INVALID", "AIMS returned an invalid identity assertion.");
  }

  const identity = identitySummary(parsed.data.data.identity);
  const smartRole = smartRoleForAimsRole(identity.role);

  const user = await findAimsUser(identity);
  if (!user) {
    throw new AimsSsoError(
      403,
      "AIMS_ACCOUNT_NOT_PROVISIONED",
      "No SMART account matches this AIMS identity.",
      identity,
    );
  }

  if (user.status !== "ACTIVE") {
    throw new AimsSsoError(403, "AIMS_ACCOUNT_UNAVAILABLE", "The SMART account is not active.", identity);
  }

  if (user.role !== smartRole) {
    throw new AimsSsoError(
      403,
      "AIMS_ROLE_MISMATCH",
      "The AIMS role does not match the SMART account role.",
      identity,
    );
  }

  if (!namesReconcile(user, identity)) {
    throw new AimsSsoError(
      403,
      "AIMS_IDENTITY_MISMATCH",
      "The AIMS identity does not match the SMART account.",
      identity,
    );
  }

  if (user.aimsUserId && identity.id && user.aimsUserId !== identity.id) {
    throw new AimsSsoError(
      403,
      "AIMS_IDENTITY_CONFLICT",
      "The SMART account is linked to a different AIMS identity.",
      identity,
    );
  }

  if (!user.aimsUserId && identity.id) {
    await bindAimsUserId(user.id, identity.id);
    user.aimsUserId = identity.id;
  }

  const redirectTo = await resolveAimsLanding(user, parsed.data.data.context);

  logger.info(`[AimsSSO] Exchange succeeded for SMART user ${user.id} (${smartRole}).`);

  return {
    user,
    identity,
    redirectTo,
  };
}
