/**
 * enrollproSsoService.ts
 *
 * Flow A — EnrollPro launches SMART.
 *
 * The browser callback hands us a short-lived one-time code. We exchange it
 * server-to-server with EnrollPro (Bearer outbound secret), validate the
 * minimized identity assertion, reconcile it to exactly one local account,
 * and bind the stable EnrollPro subject for future logins.
 *
 * We never receive an EnrollPro password, JWT, or session cookie.
 */

import { Prisma } from "@prisma/client";
import type { User } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";
import { getEnrollProEffectiveBaseUrl } from "../lib/enrollproClient";
import {
  CompanionSsoError,
  SMART_SYSTEM,
  getOutboundClientSecret,
  isValidCodeShape,
  type CompanionSsoErrorCode,
} from "../lib/companionSso";

export interface EnrollProIdentity {
  subject: string;
  userId?: number | null;
  employeeId?: string | null;
  lrn?: string | null;
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  roles?: unknown;
}

export interface EnrollProExchangeResult {
  identity: EnrollProIdentity;
  activeSchoolYear: { id: number; yearLabel: string } | null;
  authenticatedAt: string | null;
}

// EnrollPro staff-workspace roles permitted to open SMART.
const ALLOWED_ENROLLPRO_ROLES = new Set([
  "SYSTEM_ADMIN",
  "SUPER_ADMIN",
  "ADMIN",
  "HEAD_REGISTRAR",
  "SCHOOL_REGISTRAR",
  "REGISTRAR",
  "REGISTRATION_OFFICER",
  "TEACHER",
  "CLASS_ADVISER",
]);

function normalizeRoleList(roles: unknown): string[] {
  if (!Array.isArray(roles)) return [];
  return roles.map((role) => String(role ?? "").trim().toUpperCase()).filter(Boolean);
}

export function hasAllowedEnrollProRole(roles: unknown): boolean {
  return normalizeRoleList(roles).some((role) => ALLOWED_ENROLLPRO_ROLES.has(role));
}

function normalizeName(value: string | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function namesReconcile(user: Pick<User, "firstName" | "lastName">, identity: EnrollProIdentity): boolean {
  const localFirst = normalizeName(user.firstName);
  const localLast = normalizeName(user.lastName);
  const assertedFirst = normalizeName(identity.firstName);
  const assertedLast = normalizeName(identity.lastName);

  // Missing names on either side cannot disprove the match; supplied names must agree.
  const firstOk = !localFirst || !assertedFirst || localFirst === assertedFirst;
  const lastOk = !localLast || !assertedLast || localLast === assertedLast;
  return firstOk && lastOk;
}

/**
 * Validate the EnrollPro exchange response (HTTP 200 body).
 * Fails closed on anything ambiguous.
 */
export function validateExchangeResponse(body: unknown): EnrollProExchangeResult {
  const payload = body as Record<string, unknown> | null;

  if (!payload || payload.success !== true) {
    throw new CompanionSsoError(503, "COMPANION_SSO_UNREACHABLE", "EnrollPro returned an unexpected response.");
  }

  if (String(payload.companion ?? "").toUpperCase() !== SMART_SYSTEM) {
    throw new CompanionSsoError(404, "COMPANION_SSO_SYSTEM_NOT_FOUND", "EnrollPro returned an assertion for another system.");
  }

  const identity = payload.identity as EnrollProIdentity | undefined;
  const subject = typeof identity?.subject === "string" ? identity.subject.trim() : "";
  if (!identity || !subject) {
    throw new CompanionSsoError(403, "COMPANION_SSO_IDENTITY_INCOMPLETE", "EnrollPro identity assertion is incomplete.");
  }

  if (!hasAllowedEnrollProRole(identity.roles)) {
    throw new CompanionSsoError(403, "COMPANION_SSO_ROLE_DENIED", "This EnrollPro account has no SMART-eligible role.");
  }

  const schoolYear = payload.activeSchoolYear as { id?: unknown; yearLabel?: unknown } | undefined;
  const yearId = Number(schoolYear?.id);
  const yearLabel = String(schoolYear?.yearLabel ?? "").trim();
  if (!Number.isFinite(yearId) || !yearLabel) {
    throw new CompanionSsoError(409, "ACTIVE_SCHOOL_YEAR_REQUIRED", "EnrollPro did not provide an active school year.");
  }

  return {
    identity: { ...identity, subject },
    activeSchoolYear: { id: yearId, yearLabel },
    authenticatedAt: typeof payload.authenticatedAt === "string" ? payload.authenticatedAt : null,
  };
}

/**
 * Exchange an authorization code with EnrollPro. The code is single-use:
 * an ambiguous network result is treated as consumed and never retried.
 */
export async function exchangeCompanionCode(code: string): Promise<EnrollProExchangeResult> {
  if (!isValidCodeShape(code)) {
    throw new CompanionSsoError(401, "COMPANION_SSO_CODE_INVALID", "The authorization code is malformed.");
  }

  const secret = getOutboundClientSecret();
  if (!secret) {
    throw new CompanionSsoError(503, "COMPANION_SSO_NOT_CONFIGURED", "ENROLLPRO_SSO_CLIENT_SECRET is not configured.");
  }

  let response: Response;
  try {
    const base = await getEnrollProEffectiveBaseUrl();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      response = await fetch(`${base}/auth/companion-sso/smart/exchange`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${secret}`,
        },
        body: JSON.stringify({ code }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    logger.warn(`[CompanionSSO] EnrollPro exchange request failed: ${(error as Error).message}`);
    throw new CompanionSsoError(503, "COMPANION_SSO_UNREACHABLE", "EnrollPro could not be reached.");
  }

  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (!response.ok) {
    const bodyCode = (body as { code?: unknown } | null)?.code;
    const stableCode: CompanionSsoErrorCode = typeof bodyCode === "string" && bodyCode.startsWith("COMPANION_SSO")
      ? (bodyCode as CompanionSsoErrorCode)
      : response.status === 401
        ? "COMPANION_SSO_CODE_INVALID"
        : "COMPANION_SSO_UNREACHABLE";
    logger.warn(`[CompanionSSO] EnrollPro exchange rejected (HTTP ${response.status}, code ${stableCode}).`);
    throw new CompanionSsoError(response.status, stableCode, `EnrollPro rejected the exchange (${stableCode}).`);
  }

  return validateExchangeResponse(body);
}

/**
 * Reconcile the EnrollPro identity to exactly one active SMART account.
 *
 * Priority 1: the bound EnrollPro subject (stable external key).
 * Priority 2 (first login only): exact employee ID + matching name.
 * Accounts are never created, renamed, or re-linked automatically.
 */
export async function resolveEnrollProIdentityUser(identity: EnrollProIdentity): Promise<User> {
  const subject = identity.subject.trim();

  if (!hasAllowedEnrollProRole(identity.roles)) {
    throw new CompanionSsoError(403, "COMPANION_SSO_ROLE_DENIED", "This EnrollPro account has no SMART-eligible role.");
  }

  const boundUser = await prisma.user.findUnique({ where: { enrollproSubject: subject } });
  if (boundUser) {
    if (boundUser.status !== "ACTIVE") {
      throw new CompanionSsoError(401, "COMPANION_SSO_ACCOUNT_UNAVAILABLE", "The linked SMART account is not active.");
    }
    return boundUser;
  }

  const employeeId = String(identity.employeeId ?? "").trim();
  if (!employeeId) {
    throw new CompanionSsoError(403, "COMPANION_SSO_IDENTITY_INCOMPLETE", "EnrollPro did not supply an employee ID.");
  }

  const candidates = new Map<string, User>();
  const userByUsername = await prisma.user.findUnique({ where: { username: employeeId } });
  if (userByUsername) candidates.set(userByUsername.id, userByUsername);

  const teacher = await prisma.teacher.findUnique({
    where: { employeeId },
    include: { user: true },
  });
  if (teacher?.user) candidates.set(teacher.user.id, teacher.user);

  if (candidates.size !== 1) {
    throw new CompanionSsoError(
      401,
      "COMPANION_SSO_ACCOUNT_UNAVAILABLE",
      candidates.size === 0
        ? "No SMART account is linked to this EnrollPro employee ID."
        : "Multiple SMART accounts match this EnrollPro employee ID.",
    );
  }

  const candidate = [...candidates.values()][0];

  if (candidate.status !== "ACTIVE") {
    throw new CompanionSsoError(401, "COMPANION_SSO_ACCOUNT_UNAVAILABLE", "The matched SMART account is not active.");
  }

  if (candidate.enrollproSubject && candidate.enrollproSubject !== subject) {
    logger.warn(
      `[CompanionSSO] Identity conflict: SMART user ${candidate.id} is linked to a different EnrollPro subject.`,
    );
    throw new CompanionSsoError(401, "COMPANION_SSO_ACCOUNT_UNAVAILABLE", "This SMART account is linked to another EnrollPro identity.");
  }

  if (!namesReconcile(candidate, identity)) {
    throw new CompanionSsoError(403, "COMPANION_SSO_IDENTITY_INCOMPLETE", "EnrollPro identity does not match the SMART account.");
  }

  try {
    return await prisma.user.update({
      where: { id: candidate.id },
      data: { enrollproSubject: subject },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // Concurrent first login bound this subject elsewhere between our read and write.
      logger.warn("[CompanionSSO] Concurrent subject binding detected — first login conflict.");
      throw new CompanionSsoError(401, "COMPANION_SSO_ACCOUNT_UNAVAILABLE", "This EnrollPro identity was linked concurrently.");
    }
    throw error;
  }
}
