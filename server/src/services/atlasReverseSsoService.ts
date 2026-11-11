/**
 * atlasReverseSsoService.ts
 *
 * ATLAS -> SMART SSO (reverse direction).
 *
 * ATLAS is the issuer. SMART is the relying party. SMART generates a signed
 * state, sends the browser to ATLAS's authorize endpoint, and exchanges the
 * ATLAS-issued code server-to-server. Only ATLAS SYSTEM_ADMIN maps to SMART
 * ADMIN. No SMART account is ever auto-created from SSO.
 */

import crypto from "crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";
import { getActiveSchoolYear } from "../lib/schoolYearResolver";
import { getJwtSecret } from "../config/env";
import { CompanionSsoError, type CompanionSsoErrorCode } from "../lib/companionSso";

export const ATLAS_ISSUER = "ATLAS";
export const ATLAS_REVERSE_CLIENT_ID = "smart";
export const ATLAS_REVERSE_STATE_COOKIE = "atlas_sso_state";
export const ATLAS_REVERSE_STATE_TTL_MS = 5 * 60 * 1000;
export const ATLAS_REVERSE_CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const atlasAssertionSchema = z.object({
  success: z.literal(true),
  issuer: z.literal(ATLAS_ISSUER),
  identity: z.object({
    subject: z.string().min(1),
    employeeId: z.string().nullish(),
    lrn: z.string().nullish(),
    accountName: z.string().nullish(),
    email: z.string().nullish(),
    firstName: z.string().nullish(),
    middleName: z.string().nullish(),
    lastName: z.string().nullish(),
    roles: z.array(z.string()),
  }),
  activeSchoolYear: z.object({
    id: z.number(),
    yearLabel: z.string().min(1),
  }),
  authenticatedAt: z.string().optional(),
});

export interface AtlasReverseAssertion {
  subject: string;
  roles: string[];
  activeSchoolYear: { id: number; yearLabel: string };
}

const KNOWN_REVERSE_ERROR_CODES = new Set<string>([
  "COMPANION_SSO_CLIENT_INVALID",
  "COMPANION_SSO_CODE_INVALID",
  "COMPANION_SSO_ACCOUNT_UNAVAILABLE",
  "COMPANION_SSO_ROLE_DENIED",
  "COMPANION_SSO_NOT_CONFIGURED",
  "COMPANION_SSO_UNREACHABLE",
  "COMPANION_REVERSE_SSO_NOT_CONFIGURED",
  "COMPANION_REVERSE_SSO_CALLBACK_INVALID",
  "COMPANION_REVERSE_SSO_STATE_INVALID",
  "COMPANION_REVERSE_SSO_CODE_INVALID",
  "COMPANION_REVERSE_SSO_UNAVAILABLE",
  "COMPANION_REVERSE_SSO_RESPONSE_INVALID",
  "COMPANION_REVERSE_SSO_LINK_REQUIRED",
  "COMPANION_REVERSE_SSO_IDENTITY_CONFLICT",
  "COMPANION_REVERSE_SSO_ACCOUNT_UNAVAILABLE",
  "COMPANION_REVERSE_SSO_ROLE_DENIED",
  "COMPANION_REVERSE_SSO_SCHOOL_YEAR_MISMATCH",
  "ACTIVE_SCHOOL_YEAR_REQUIRED",
  "ACTIVE_SCHOOL_YEAR_CONFLICT",
]);

function normalizeErrorCode(value: unknown): CompanionSsoErrorCode {
  return typeof value === "string" && KNOWN_REVERSE_ERROR_CODES.has(value)
    ? (value as CompanionSsoErrorCode)
    : "COMPANION_REVERSE_SSO_UNAVAILABLE";
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

function readUrlEnv(name: string): string | null {
  const value = (process.env[name] ?? "").trim();
  if (!value || !isValidAtlasUrl(value)) return null;
  return value;
}

/** ATLAS authorize endpoint where SMART sends the browser. */
export function getAtlasReverseAuthorizeUrl(): string | null {
  return readUrlEnv("ATLAS_SSO_REVERSE_AUTHORIZE_URL");
}

/** ATLAS exchange endpoint SMART calls server-to-server. */
export function getAtlasReverseExchangeUrl(): string | null {
  return readUrlEnv("ATLAS_SSO_REVERSE_EXCHANGE_URL");
}

/** SMART's own callback, registered with ATLAS as the exact redirect_uri. */
export function getAtlasReverseCallbackUrl(): string | null {
  return readUrlEnv("ATLAS_SSO_REVERSE_CALLBACK_URL");
}

/** Shared secret SMART presents to ATLAS at the exchange. */
export function getAtlasReverseClientSecret(): string | null {
  const value = (
    process.env.ATLAS_SSO_REVERSE_CLIENT_SECRET
    || process.env.ATLAS_SMART_SSO_REVERSE_CLIENT_SECRET
    || ""
  ).trim();
  return value.length > 0 ? value : null;
}

export function getAtlasReverseConfig(): {
  authorizeUrl: string | null;
  exchangeUrl: string | null;
  callbackUrl: string | null;
  secret: string | null;
  configured: boolean;
} {
  const authorizeUrl = getAtlasReverseAuthorizeUrl();
  const exchangeUrl = getAtlasReverseExchangeUrl();
  const callbackUrl = getAtlasReverseCallbackUrl();
  const secret = getAtlasReverseClientSecret();
  return {
    authorizeUrl,
    exchangeUrl,
    callbackUrl,
    secret,
    configured: Boolean(authorizeUrl && exchangeUrl && callbackUrl && secret),
  };
}

/** Signed, time-limited state echoed by ATLAS and bound to an HTTP-only cookie. */
export function createAtlasReverseState(): string {
  const payload = `${Date.now()}.${crypto.randomBytes(16).toString("base64url")}`;
  const signature = crypto.createHmac("sha256", getJwtSecret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function isValidAtlasReverseState(state: unknown, cookieState: unknown): boolean {
  if (typeof state !== "string" || typeof cookieState !== "string") return false;
  if (state.length === 0 || state.length !== cookieState.length) return false;

  const stateBuf = Buffer.from(state);
  const cookieBuf = Buffer.from(cookieState);
  if (!crypto.timingSafeEqual(stateBuf, cookieBuf)) return false;

  const parts = state.split(".");
  if (parts.length !== 3) return false;

  const [timestampRaw, nonce, signature] = parts;
  const timestamp = Number(timestampRaw);
  if (!Number.isFinite(timestamp)) return false;
  if (Date.now() - timestamp > ATLAS_REVERSE_STATE_TTL_MS) return false;

  const payload = `${timestampRaw}.${nonce}`;
  const expected = crypto.createHmac("sha256", getJwtSecret()).update(payload).digest("base64url");
  const providedBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

export function isValidAtlasReverseCodeShape(code: unknown): code is string {
  return typeof code === "string" && ATLAS_REVERSE_CODE_PATTERN.test(code);
}

/**
 * Exchange an ATLAS-issued code for the minimized identity assertion.
 * The ATLAS exchange is the only source of identity; browser input is never trusted.
 */
export async function exchangeAtlasReverseCode(input: {
  code: string;
  redirectUri: string;
}): Promise<AtlasReverseAssertion> {
  const { exchangeUrl, secret } = getAtlasReverseConfig();
  if (!exchangeUrl || !secret) {
    throw new CompanionSsoError(503, "COMPANION_REVERSE_SSO_NOT_CONFIGURED", "ATLAS reverse SSO is not configured.");
  }

  let response: Response;
  try {
    response = await fetch(exchangeUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        code: input.code,
        clientId: ATLAS_REVERSE_CLIENT_ID,
        redirectUri: input.redirectUri,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new CompanionSsoError(503, "COMPANION_REVERSE_SSO_UNAVAILABLE", "ATLAS could not be reached.");
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new CompanionSsoError(502, "COMPANION_REVERSE_SSO_RESPONSE_INVALID", "ATLAS returned an invalid response.");
  }

  if (!response.ok) {
    const payload = body as { code?: unknown; message?: unknown };
    throw new CompanionSsoError(
      response.status >= 400 ? response.status : 502,
      normalizeErrorCode(payload.code),
      typeof payload.message === "string" ? payload.message : "ATLAS rejected the exchange.",
    );
  }

  const parsed = atlasAssertionSchema.safeParse(body);
  if (!parsed.success) {
    throw new CompanionSsoError(
      502,
      "COMPANION_REVERSE_SSO_RESPONSE_INVALID",
      "ATLAS returned an invalid identity assertion.",
    );
  }

  const roles = parsed.data.identity.roles;
  if (roles.length !== 1 || roles[0] !== "SYSTEM_ADMIN") {
    throw new CompanionSsoError(
      403,
      "COMPANION_REVERSE_SSO_ROLE_DENIED",
      "Only ATLAS administrators may sign in to SMART.",
    );
  }

  logger.info(`[AtlasReverseSSO] Validated ATLAS assertion for subject ${parsed.data.identity.subject}.`);

  return {
    subject: parsed.data.identity.subject,
    roles,
    activeSchoolYear: parsed.data.activeSchoolYear,
  };
}

/** Resolve one explicit SMART account link. Never create or relink silently. */
export async function resolveAtlasReverseUser(subject: string) {
  const user = await prisma.user.findUnique({
    where: { atlasSubject: subject },
    include: { teacher: true },
  });

  if (!user) {
    throw new CompanionSsoError(
      403,
      "COMPANION_REVERSE_SSO_LINK_REQUIRED",
      "This ATLAS identity is not linked to a SMART account.",
    );
  }
  if (user.status !== "ACTIVE") {
    throw new CompanionSsoError(
      403,
      "COMPANION_REVERSE_SSO_ACCOUNT_UNAVAILABLE",
      "The linked SMART account is not active.",
    );
  }
  if (user.role !== "ADMIN") {
    throw new CompanionSsoError(
      403,
      "COMPANION_REVERSE_SSO_ROLE_DENIED",
      "Only a SMART administrator can be linked to ATLAS.",
    );
  }

  return user;
}

/** ATLAS and SMART must agree on the active school year before a session is issued. */
export async function validateAtlasReverseSchoolYear(assertionYear: {
  id: number;
  yearLabel: string;
}): Promise<void> {
  const activeYear = await getActiveSchoolYear();
  if (activeYear.externalId == null) {
    throw new CompanionSsoError(
      409,
      "ACTIVE_SCHOOL_YEAR_REQUIRED",
      "SMART's active school year has no mirrored EnrollPro year ID.",
    );
  }
  if (activeYear.externalId !== assertionYear.id || activeYear.label !== assertionYear.yearLabel) {
    throw new CompanionSsoError(
      409,
      "ACTIVE_SCHOOL_YEAR_CONFLICT",
      "ATLAS and SMART do not have the same active school year.",
    );
  }
}
