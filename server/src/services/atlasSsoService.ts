/**
 * atlasSsoService.ts
 *
 * SMART -> ATLAS admin-only SSO.
 *
 * SMART is the issuer: it authenticates a SMART ADMIN, issues a 60-second
 * single-use code, and ATLAS exchanges it server-to-server for a minimized
 * identity assertion. ATLAS creates and owns its own admin session.
 *
 * Only SMART ADMIN accounts are eligible. No other SMART role may receive a
 * code, and the assertion always contains exactly one role: SYSTEM_ADMIN.
 */

import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";
import { getActiveSchoolYear } from "../lib/schoolYearResolver";
import {
  CompanionSsoError,
  SMART_SYSTEM,
  SSO_CODE_TTL_MS,
  generateAuthorizationCode,
  hashCode,
  isValidCodeShape,
  secretsMatch,
} from "../lib/companionSso";

export const ATLAS_AUDIENCE = "atlas";
export const ATLAS_SMART_CLIENT_ID = "smart";

export interface AtlasAuthorizeRequestParams {
  responseType: string;
  clientId: string;
  redirectUri: string;
  state: string;
}

export interface AtlasIdentity {
  subject: string;
  employeeId: string | null;
  lrn: null;
  accountName: string;
  email: string | null;
  firstName: string;
  middleName: null;
  lastName: string;
  roles: string[];
}

export interface AtlasExchangeResponse {
  success: true;
  issuer: string;
  identity: AtlasIdentity;
  activeSchoolYear: { id: number; yearLabel: string };
  authenticatedAt: string;
}

function isValidAtlasUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Exact ATLAS callback registered for SMART-issued codes. */
export function getAtlasSsoCallbackUrl(): string | null {
  const value = (process.env.ATLAS_SSO_CALLBACK_URL ?? "").trim();
  if (!value || !isValidAtlasUrl(value)) return null;
  return value;
}

/** Secret ATLAS presents as a Bearer token at the exchange. */
export function getAtlasSsoClientSecret(): string | null {
  const value = (process.env.ATLAS_SSO_CLIENT_SECRET ?? "").trim();
  return value.length > 0 ? value : null;
}

/** ATLAS entry point used by the SMART admin sidebar. */
export function getAtlasSsoStartUrl(): string | null {
  const value = (process.env.ATLAS_SSO_START_URL ?? "").trim();
  if (!value || !isValidAtlasUrl(value)) return null;
  return value;
}

export function getAtlasSsoConfig(): {
  callback: string | null;
  secret: string | null;
  startUrl: string | null;
  configured: boolean;
} {
  const callback = getAtlasSsoCallbackUrl();
  const secret = getAtlasSsoClientSecret();
  const startUrl = getAtlasSsoStartUrl();
  return { callback, secret, startUrl, configured: Boolean(callback && secret) };
}

/**
 * Issue a one-time code for ATLAS and build the exact callback redirect.
 * State is echoed unchanged; SMART never interprets it.
 */
export async function issueAtlasAuthorizationCode(
  userId: string,
  params: AtlasAuthorizeRequestParams,
): Promise<{ redirectUrl: string }> {
  const { callback, secret } = getAtlasSsoConfig();
  if (!secret || !callback) {
    throw new CompanionSsoError(503, "COMPANION_REVERSE_SSO_NOT_CONFIGURED", "ATLAS SSO is not configured.");
  }

  if (params.responseType !== "code") {
    throw new CompanionSsoError(400, "COMPANION_REVERSE_SSO_CALLBACK_INVALID", "Unsupported response_type.");
  }
  if (params.clientId !== ATLAS_SMART_CLIENT_ID) {
    throw new CompanionSsoError(400, "COMPANION_REVERSE_SSO_CALLBACK_INVALID", "Unknown client_id.");
  }
  if (params.redirectUri !== callback) {
    throw new CompanionSsoError(400, "COMPANION_REVERSE_SSO_CALLBACK_INVALID", "Unregistered redirect_uri.");
  }
  if (typeof params.state !== "string" || params.state.length < 1 || params.state.length > 2048) {
    throw new CompanionSsoError(400, "COMPANION_REVERSE_SSO_CALLBACK_INVALID", "Missing or malformed state.");
  }

  // Defense in depth: never issue a code for a non-admin, even if a caller
  // bypasses the route-level role check.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, status: true },
  });
  if (!user || user.status !== "ACTIVE") {
    throw new CompanionSsoError(403, "COMPANION_REVERSE_SSO_ACCOUNT_UNAVAILABLE", "The SMART account is not active.");
  }
  if (user.role !== "ADMIN") {
    throw new CompanionSsoError(
      403,
      "COMPANION_REVERSE_SSO_ROLE_DENIED",
      "ATLAS is available to SMART administrators only.",
    );
  }

  // Rows are hashed security records and are retained for audit; they are
  // never usable after `expiresAt` (enforced atomically on exchange).
  const code = generateAuthorizationCode();
  await prisma.companionSsoCode.create({
    data: {
      codeHash: hashCode(code),
      userId,
      audience: ATLAS_AUDIENCE,
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
 * Exchange a SMART-issued ATLAS code for the admin identity assertion.
 * One code -> one success, ever (atomic claim inside a single UPDATE).
 */
export async function exchangeAtlasCode(input: {
  bearer: string | null;
  code: unknown;
  clientId: unknown;
  redirectUri: unknown;
}): Promise<AtlasExchangeResponse> {
  const { callback, secret } = getAtlasSsoConfig();
  if (!secret || !callback) {
    throw new CompanionSsoError(503, "COMPANION_REVERSE_SSO_NOT_CONFIGURED", "ATLAS SSO is not configured.");
  }

  if (!secretsMatch(input.bearer, secret)) {
    throw new CompanionSsoError(401, "COMPANION_SSO_CLIENT_INVALID", "Invalid ATLAS SSO client secret.");
  }

  // Unknown, expired, replayed, or mismatched codes share one public error.
  const invalidCode = () => new CompanionSsoError(
    401,
    "COMPANION_SSO_CODE_INVALID",
    "The SSO authorization code is invalid, expired, or already used.",
  );

  if (!isValidCodeShape(input.code)) throw invalidCode();
  if (input.clientId !== ATLAS_SMART_CLIENT_ID) throw invalidCode();
  if (input.redirectUri !== callback) throw invalidCode();

  const codeHash = hashCode(input.code);
  const now = new Date();

  // Atomic single-use claim: concurrent exchanges race on the row lock and exactly one wins.
  const claimed = await prisma.companionSsoCode.updateMany({
    where: {
      codeHash,
      consumedAt: null,
      expiresAt: { gt: now },
      audience: ATLAS_AUDIENCE,
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
  if (user.role !== "ADMIN") {
    throw new CompanionSsoError(
      403,
      "COMPANION_REVERSE_SSO_ROLE_DENIED",
      "ATLAS is available to SMART administrators only.",
    );
  }

  // Admin accounts may have no teacher profile. employeeId is informational
  // only; ATLAS must key the account link on identity.subject.
  const employeeId = user.teacher?.employeeId
    ?? (user.username.includes("@") ? null : user.username);

  const activeYear = await getActiveSchoolYear();
  if (activeYear.externalId == null) {
    throw new CompanionSsoError(
      409,
      "ACTIVE_SCHOOL_YEAR_REQUIRED",
      "SMART's active school year has no mirrored EnrollPro year ID.",
    );
  }

  logger.info(`[AtlasSSO] Issued identity assertion for SMART user ${user.id} (subject SMART_USER:${user.id}).`);

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
      roles: ["SYSTEM_ADMIN"],
    },
    activeSchoolYear: {
      id: activeYear.externalId,
      yearLabel: activeYear.label,
    },
    authenticatedAt: new Date().toISOString(),
  };
}
