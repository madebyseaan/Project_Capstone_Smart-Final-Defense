/**
 * companionSso.ts
 *
 * Shared configuration and crypto helpers for EnrollPro companion SSO.
 *
 * Two flows:
 *   A. EnrollPro → SMART (outbound launch): SMART consumes a code EnrollPro issued.
 *   B. SMART → EnrollPro (reverse): SMART issues a code EnrollPro exchanges.
 *
 * Secrets live server-side only. Codes are 43-char base64url, 60s TTL,
 * single-use, and stored only as SHA-256 hashes.
 */

import crypto from "crypto";

export const SMART_SYSTEM = "SMART";
export const SMART_SYSTEM_SLUG = "smart";
export const ENROLLPRO_CLIENT_ID = "enrollpro";
// Known EnrollPro client_id value observed in the deployed reverse config.
// `enrollpro` is canonical; the alias keeps the flow working while EnrollPro's
// server settings are corrected.
export const ENROLLPRO_CLIENT_ID_ALIASES = ["enrollpro", "enrollpro_client_id"];
export const SSO_CODE_TTL_MS = 60 * 1000;
export const SSO_CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isAcceptedEnrollProClientId(value: unknown): boolean {
  return typeof value === "string" && ENROLLPRO_CLIENT_ID_ALIASES.includes(value);
}

const DEFAULT_ENROLLPRO_BASE = "https://dev-jegs.buru-degree.ts.net/api";

/**
 * Stable public error codes shared with EnrollPro and the SMART SPA.
 * Branch on these — never parse user-facing messages.
 */
export type CompanionSsoErrorCode =
  | "COMPANION_SSO_CLIENT_INVALID"
  | "COMPANION_SSO_CODE_INVALID"
  | "COMPANION_SSO_ACCOUNT_UNAVAILABLE"
  | "COMPANION_SSO_ROLE_DENIED"
  | "COMPANION_SSO_COMPLETER_BLOCKED"
  | "COMPANION_SSO_IDENTITY_INCOMPLETE"
  | "COMPANION_SSO_SYSTEM_NOT_FOUND"
  | "COMPANION_SSO_NOT_CONFIGURED"
  | "COMPANION_SSO_UNREACHABLE"
  | "ACTIVE_SCHOOL_YEAR_REQUIRED"
  | "ACTIVE_SCHOOL_YEAR_CONFLICT"
  | "PASSWORD_CHANGE_REQUIRED"
  | "COMPANION_REVERSE_SSO_NOT_CONFIGURED"
  | "COMPANION_REVERSE_SSO_CALLBACK_INVALID"
  | "COMPANION_REVERSE_SSO_ACCOUNT_UNAVAILABLE"
  | "COMPANION_REVERSE_SSO_ROLE_DENIED"
  | "COMPANION_REVERSE_SSO_SCHOOL_YEAR_MISMATCH";

export class CompanionSsoError extends Error {
  statusCode: number;
  code: CompanionSsoErrorCode;

  constructor(statusCode: number, code: CompanionSsoErrorCode, message?: string) {
    super(message ?? code);
    this.name = "CompanionSsoError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

/** Public EnrollPro origin (no `/api` suffix) used for browser redirects and the sidebar item. */
export function getEnrollProPublicUrl(): string {
  const explicit = (process.env.ENROLLPRO_PUBLIC_URL ?? "").trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const base = (
    process.env.ENROLLPRO_BASE_URL
    || process.env.ENROLLPRO_URL
    || DEFAULT_ENROLLPRO_BASE
  ).trim();
  return base.replace(/\/api\/?$/, "").replace(/\/+$/, "");
}

/** Outbound secret SMART sends when exchanging an EnrollPro-issued code. */
export function getOutboundClientSecret(): string | null {
  const value = process.env.ENROLLPRO_SSO_CLIENT_SECRET || process.env.SMART_SSO_CLIENT_SECRET;
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Reverse secret EnrollPro sends when exchanging a SMART-issued code. */
export function getReverseClientSecret(): string | null {
  const value = process.env.SMART_SSO_REVERSE_CLIENT_SECRET || process.env.ENROLLPRO_REVERSE_CLIENT_SECRET;
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Exact EnrollPro reverse callback registered with EnrollPro (`redirect_uri` binding). */
export function getEnrollProReverseCallbackUrl(): string | null {
  const explicit = (process.env.ENROLLPRO_SSO_CALLBACK_URL ?? "").trim();
  const candidate = explicit || `${getEnrollProPublicUrl()}/api/auth/companion-sso/${SMART_SYSTEM_SLUG}/reverse/callback`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      return null;
    }
    return candidate;
  } catch {
    return null;
  }
}

/** 32 random bytes → 43 base64url characters. */
export function generateAuthorizationCode(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

export function isValidCodeShape(code: unknown): code is string {
  return typeof code === "string" && SSO_CODE_PATTERN.test(code);
}

/** Constant-time secret comparison with a length guard. */
export function secretsMatch(provided: string | null | undefined, expected: string | null | undefined): boolean {
  if (!provided || !expected) return false;
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}
