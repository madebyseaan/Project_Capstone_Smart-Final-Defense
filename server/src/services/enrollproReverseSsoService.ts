/**
 * enrollproReverseSsoService.ts
 *
 * Flow B — SMART launches EnrollPro (reverse SSO).
 *
 * SMART authenticates its local user, issues a 43-char single-use code
 * (SHA-256 hashed at rest, 60s TTL, audience + redirect-URI bound), and
 * EnrollPro's backend exchanges it for a minimized identity assertion.
 *
 * EnrollPro creates its own session from this assertion. SMART roles never
 * elevate EnrollPro permissions.
 */

import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";
import { getActiveSchoolYear } from "../lib/schoolYearResolver";
import {
  CompanionSsoError,
  ENROLLPRO_CLIENT_ID,
  SMART_SYSTEM,
  SSO_CODE_TTL_MS,
  generateAuthorizationCode,
  getEnrollProReverseCallbackUrl,
  getOutboundClientSecret,
  getReverseClientSecret,
  hashCode,
  isAcceptedEnrollProClientId,
  isValidCodeShape,
  secretsMatch,
} from "../lib/companionSso";

export interface AuthorizeRequestParams {
  responseType: string;
  clientId: string;
  redirectUri: string;
  state: string;
}

export interface ReverseIdentity {
  subject: string;
  employeeId: string;
  lrn: null;
  accountName: string;
  email: string | null;
  firstName: string;
  middleName: string | null;
  lastName: string;
  roles: string[];
}

export interface ReverseExchangeResponse {
  success: true;
  issuer: string;
  identity: ReverseIdentity;
  activeSchoolYear: { id: number; yearLabel: string };
  authenticatedAt: string;
}

export function getReverseSsoConfig(): { secret: string | null; callback: string | null; configured: boolean } {
  const secret = getReverseClientSecret();
  const callback = getEnrollProReverseCallbackUrl();
  return { secret, callback, configured: Boolean(secret && callback) };
}

/**
 * Issue a one-time code for EnrollPro and build the exact callback redirect.
 * State is echoed unchanged; SMART never interprets it.
 */
export async function issueAuthorizationCode(
  userId: string,
  params: AuthorizeRequestParams,
): Promise<{ redirectUrl: string }> {
  const { secret, callback } = getReverseSsoConfig();
  if (!secret || !callback) {
    throw new CompanionSsoError(503, "COMPANION_REVERSE_SSO_NOT_CONFIGURED", "Reverse SSO is not configured.");
  }

  if (params.responseType !== "code") {
    throw new CompanionSsoError(400, "COMPANION_REVERSE_SSO_CALLBACK_INVALID", "Unsupported response_type.");
  }
  if (!isAcceptedEnrollProClientId(params.clientId)) {
    throw new CompanionSsoError(400, "COMPANION_REVERSE_SSO_CALLBACK_INVALID", "Unknown client_id.");
  }
  if (params.redirectUri !== callback) {
    throw new CompanionSsoError(400, "COMPANION_REVERSE_SSO_CALLBACK_INVALID", "Unregistered redirect_uri.");
  }
  if (typeof params.state !== "string" || params.state.length < 1 || params.state.length > 2048) {
    throw new CompanionSsoError(400, "COMPANION_REVERSE_SSO_CALLBACK_INVALID", "Missing or malformed state.");
  }

  // Rows are hashed security records and are retained for audit; they are
  // never usable after `expiresAt` (enforced atomically on exchange).
  const code = generateAuthorizationCode();
  await prisma.companionSsoCode.create({
    data: {
      codeHash: hashCode(code),
      userId,
      audience: ENROLLPRO_CLIENT_ID,
      redirectUri: callback,
      expiresAt: new Date(Date.now() + SSO_CODE_TTL_MS),
    },
  });

  const redirect = new URL(callback);
  redirect.searchParams.set("code", code);
  redirect.searchParams.set("state", params.state);
  return { redirectUrl: redirect.toString() };
}

/**
 * Exchange a SMART-issued code for the identity assertion.
 * One code → one success, ever (atomic claim inside a single UPDATE).
 */
export async function exchangeReverseCode(input: {
  bearer: string | null;
  code: unknown;
  clientId: unknown;
  redirectUri: unknown;
}): Promise<ReverseExchangeResponse> {
  const { secret, callback } = getReverseSsoConfig();
  if (!secret || !callback) {
    throw new CompanionSsoError(503, "COMPANION_REVERSE_SSO_NOT_CONFIGURED", "Reverse SSO is not configured.");
  }

  if (!secretsMatch(input.bearer, secret)) {
    // Non-sensitive diagnostic: detect a swapped outbound/reverse secret.
    const presentedOutbound = secretsMatch(input.bearer, getOutboundClientSecret());
    logger.warn(
      presentedOutbound
        ? "[ReverseSSO] Exchange secret mismatch: EnrollPro presented the OUTBOUND secret for the reverse exchange — their reverse secret is set to the wrong value."
        : "[ReverseSSO] Exchange secret mismatch: the presented reverse secret does not match SMART's reverse secret.",
    );
    throw new CompanionSsoError(401, "COMPANION_SSO_CLIENT_INVALID", "Invalid reverse SSO client secret.");
  }

  // Unknown, expired, replayed, or mismatched codes share one public error.
  const invalidCode = () => new CompanionSsoError(
    401,
    "COMPANION_SSO_CODE_INVALID",
    "The SSO authorization code is invalid, expired, or already used.",
  );

  if (!isValidCodeShape(input.code)) throw invalidCode();
  if (!isAcceptedEnrollProClientId(input.clientId)) throw invalidCode();
  if (input.redirectUri !== callback) throw invalidCode();

  const codeHash = hashCode(input.code);
  const now = new Date();

  // Atomic single-use claim: concurrent exchanges race on the row lock and exactly one wins.
  const claimed = await prisma.companionSsoCode.updateMany({
    where: {
      codeHash,
      consumedAt: null,
      expiresAt: { gt: now },
      audience: ENROLLPRO_CLIENT_ID,
      redirectUri: callback,
    },
    data: { consumedAt: now },
  });
  if (claimed.count !== 1) throw invalidCode();

  const record = await prisma.companionSsoCode.findUnique({
    where: { codeHash },
    include: { user: { include: { teacher: true } } },
  });
  const user = record?.user;
  if (!user) throw invalidCode();

  if (user.status !== "ACTIVE") {
    throw new CompanionSsoError(403, "COMPANION_REVERSE_SSO_ACCOUNT_UNAVAILABLE", "The SMART account is not active.");
  }

  const employeeId = user.teacher?.employeeId
    ?? (user.username.includes("@") ? "" : user.username);
  if (!employeeId) {
    throw new CompanionSsoError(
      403,
      "COMPANION_REVERSE_SSO_ACCOUNT_UNAVAILABLE",
      "The SMART account has no employee ID to reconcile with EnrollPro.",
    );
  }

  const roleMap: Record<string, string> = {
    ADMIN: "SYSTEM_ADMIN",
    REGISTRAR: "HEAD_REGISTRAR",
    TEACHER: "TEACHER",
  };
  const mappedRole = roleMap[user.role];
  if (!mappedRole) {
    throw new CompanionSsoError(403, "COMPANION_REVERSE_SSO_ROLE_DENIED", "No EnrollPro workspace role maps to this SMART account.");
  }

  const activeYear = await getActiveSchoolYear();
  if (activeYear.externalId == null) {
    throw new CompanionSsoError(
      409,
      "COMPANION_REVERSE_SSO_SCHOOL_YEAR_MISMATCH",
      "SMART's active school year has no mirrored EnrollPro year ID.",
    );
  }

  const roles = [mappedRole];
  if (user.role === "TEACHER" && user.teacher) {
    const advisory = await prisma.section.findFirst({
      where: { adviserId: user.teacher.id, schoolYear: activeYear.label },
      select: { id: true },
    });
    if (advisory) roles.push("CLASS_ADVISER");
  }

  logger.info(`[ReverseSSO] Issued identity assertion for SMART user ${user.id} (subject SMART_USER:${user.id}).`);

  return {
    success: true,
    issuer: SMART_SYSTEM,
    identity: {
      subject: `SMART_USER:${user.id}`,
      employeeId,
      lrn: null,
      accountName: user.username,
      email: user.email ?? null,
      firstName: user.firstName ?? "",
      middleName: null,
      lastName: user.lastName ?? "",
      roles,
    },
    activeSchoolYear: {
      id: activeYear.externalId,
      yearLabel: activeYear.label,
    },
    authenticatedAt: new Date().toISOString(),
  };
}
