/**
 * Token utility functions for JWT signing/verification and refresh token management.
 */

import jwt from "jsonwebtoken";
import crypto from "crypto";
import { getJwtSecret } from "../config/env";

const ACCESS_TOKEN_EXPIRY = "15m";
const REFRESH_TOKEN_EXPIRY_DAYS = 7;

export interface AccessTokenPayload {
  id: string;
  username: string;
  email?: string;
  role: string;
  isDeveloper?: boolean;
}

/**
 * Sign a short-lived access token (15 minutes).
 */
export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: ACCESS_TOKEN_EXPIRY });
}

/**
 * Verify an access token and return the decoded payload.
 */
export function verifyAccessToken(token: string): AccessTokenPayload | null {
  try {
    return jwt.verify(token, getJwtSecret()) as AccessTokenPayload;
  } catch {
    return null;
  }
}

/**
 * Hash a raw refresh token using SHA-256 for secure DB storage.
 */
export function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

/**
 * Generate a new refresh token pair (raw token + hashed version for DB).
 * Returns the raw token (to set in cookie), hashed token (to store in DB),
 * expiration date, and a family ID for token rotation tracking.
 */
export function generateRefreshTokenPair(familyId?: string): {
  raw: string;
  hashed: string;
  expiresAt: Date;
  familyId: string;
} {
  const raw = crypto.randomBytes(40).toString("hex");
  const hashed = hashToken(raw);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);
  const id = familyId || crypto.randomUUID();

  return { raw, hashed, expiresAt, familyId: id };
}

/**
 * Cookie configuration for refresh token.
 */
export const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/api/auth",
  maxAge: REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
};
