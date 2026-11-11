/**
 * atlasReverseSso.ts
 *
 * ATLAS -> SMART SSO routes (reverse direction).
 *
 *   GET  /auth/atlas/start      browser entry point from the ATLAS sidebar
 *   GET  /auth/atlas/callback   browser callback; exchanges the ATLAS code server-side
 *   POST /api/auth/atlas/session SPA bootstrap after the callback set the access cookie
 *
 * Secrets, codes, state values, and identity payloads are never logged.
 */

import { Router, Request, Response } from "express";
import { AuditAction, AuditSeverity } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { createAuditLog } from "../lib/audit";
import { logger } from "../lib/logger";
import { CompanionSsoError } from "../lib/companionSso";
import {
  ACCESS_COOKIE_OPTIONS,
  REFRESH_COOKIE_OPTIONS,
  generateRefreshTokenPair,
  signAccessToken,
} from "../lib/tokens";
import { authenticateToken, AuthRequest } from "../middleware/auth";
import { ssoAuthorizeLimiter, ssoExchangeLimiter } from "../middleware/rateLimiter";
import {
  ATLAS_REVERSE_STATE_COOKIE,
  ATLAS_REVERSE_STATE_TTL_MS,
  createAtlasReverseState,
  exchangeAtlasReverseCode,
  getAtlasReverseCallbackUrl,
  getAtlasReverseConfig,
  isValidAtlasReverseCodeShape,
  isValidAtlasReverseState,
  resolveAtlasReverseUser,
  validateAtlasReverseSchoolYear,
} from "../services/atlasReverseSsoService";

export const atlasReverseStartRouter = Router();
export const atlasReverseSessionRouter = Router();

// In-memory guard: a code must be processed at most once per process.
// A browser reload or back navigation cannot re-exchange a consumed code.
const processedCodes = new Map<string, number>();
const PROCESSED_CODE_TTL_MS = 5 * 60 * 1000;

function claimCodeForProcessing(code: string): boolean {
  const now = Date.now();
  for (const [key, timestamp] of processedCodes) {
    if (now - timestamp > PROCESSED_CODE_TTL_MS) processedCodes.delete(key);
  }
  if (processedCodes.has(code)) return false;
  processedCodes.set(code, now);
  return true;
}

function redirectToErrorPage(res: Response, code: string): void {
  res.redirect(302, `/auth/atlas/error?code=${encodeURIComponent(code)}`);
}

function errorCode(error: unknown): string {
  if (error instanceof CompanionSsoError) return error.code;
  return "COMPANION_REVERSE_SSO_UNAVAILABLE";
}

/**
 * Start: the ATLAS sidebar opens this route. It sets a signed state cookie and
 * sends the browser to ATLAS's authorize endpoint. ATLAS owns the session check.
 */
atlasReverseStartRouter.get("/atlas/start", ssoAuthorizeLimiter, (_req: Request, res: Response): void => {
  const { authorizeUrl, callbackUrl, secret } = getAtlasReverseConfig();
  if (!authorizeUrl || !callbackUrl || !secret) {
    res.status(503).json({
      code: "COMPANION_REVERSE_SSO_NOT_CONFIGURED",
      message: "SMART sign-in is not configured for ATLAS.",
    });
    return;
  }

  const state = createAtlasReverseState();
  res.cookie(ATLAS_REVERSE_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/auth/atlas",
    maxAge: ATLAS_REVERSE_STATE_TTL_MS,
  });

  const redirect = new URL(authorizeUrl);
  redirect.searchParams.set("response_type", "code");
  redirect.searchParams.set("client_id", "smart");
  redirect.searchParams.set("redirect_uri", callbackUrl);
  redirect.searchParams.set("state", state);
  res.redirect(302, redirect.toString());
});

/**
 * Callback: validates the signed state, exchanges the ATLAS code server-to-server,
 * links the ATLAS subject to one existing SMART ADMIN, and sets a SMART access
 * cookie. The SPA boot route then completes the role-specific session.
 */
atlasReverseStartRouter.get(
  "/atlas/callback",
  ssoExchangeLimiter,
  async (req: Request, res: Response): Promise<void> => {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
    const cookieState = cookies?.[ATLAS_REVERSE_STATE_COOKIE];
    const ipAddress = req.ip || req.socket.remoteAddress;

    if (!isValidAtlasReverseCodeShape(code)) {
      redirectToErrorPage(res, "COMPANION_REVERSE_SSO_CALLBACK_INVALID");
      return;
    }

    if (!isValidAtlasReverseState(state, cookieState)) {
      redirectToErrorPage(res, "COMPANION_REVERSE_SSO_STATE_INVALID");
      return;
    }

    res.clearCookie(ATLAS_REVERSE_STATE_COOKIE, { path: "/auth/atlas" });

    if (!claimCodeForProcessing(code)) {
      redirectToErrorPage(res, "COMPANION_REVERSE_SSO_CODE_INVALID");
      return;
    }

    try {
      const callbackUrl = getAtlasReverseCallbackUrl();
      if (!callbackUrl) {
        throw new CompanionSsoError(
          503,
          "COMPANION_REVERSE_SSO_NOT_CONFIGURED",
          "ATLAS reverse SSO is not configured.",
        );
      }

      const assertion = await exchangeAtlasReverseCode({ code, redirectUri: callbackUrl });
      await validateAtlasReverseSchoolYear(assertion.activeSchoolYear);
      const user = await resolveAtlasReverseUser(assertion.subject);

      const accessToken = signAccessToken({
        id: user.id,
        username: user.username,
        email: user.email ?? undefined,
        role: user.role,
      });
      res.cookie("accessToken", accessToken, ACCESS_COOKIE_OPTIONS);

      await createAuditLog(
        AuditAction.LOGIN,
        { id: user.id, firstName: user.firstName, lastName: user.lastName, role: user.role },
        `SSO: ${user.username}`,
        "Auth",
        `ATLAS reverse SSO login (subject ${assertion.subject})`,
        ipAddress,
        AuditSeverity.INFO,
        undefined,
        undefined,
        "success",
      );

      logger.info(`[AtlasReverseSSO] Callback success for SMART user ${user.id}.`);
      res.redirect(302, "/auth/atlas/session");
    } catch (error) {
      const stableCode = errorCode(error);
      logger.warn(`[AtlasReverseSSO] Callback denied with ${stableCode}`);

      try {
        await createAuditLog(
          AuditAction.LOGIN,
          { firstName: "ATLAS", lastName: "SSO", role: "UNKNOWN" },
          "SSO: ATLAS",
          "Auth",
          `ATLAS reverse SSO denied (${stableCode})`,
          ipAddress,
          AuditSeverity.WARNING,
          undefined,
          undefined,
          "failure",
        );
      } catch {
        // Best-effort audit only.
      }

      redirectToErrorPage(res, stableCode);
    }
  },
);

/**
 * Session bootstrap: authenticated by the access cookie set by the callback.
 * Issues a fresh SMART access token plus a refresh token pair so the SPA can
 * populate the admin session storage and land on /admin.
 */
atlasReverseSessionRouter.post(
  "/atlas/session",
  ssoAuthorizeLimiter,
  authenticateToken,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user?.id },
        select: {
          id: true,
          username: true,
          role: true,
          status: true,
          firstName: true,
          lastName: true,
          email: true,
        },
      });

      if (!user || user.status !== "ACTIVE" || user.role !== "ADMIN") {
        res.status(401).json({
          code: "COMPANION_REVERSE_SSO_ACCOUNT_UNAVAILABLE",
          message: "Account is not active.",
        });
        return;
      }

      const accessToken = signAccessToken({
        id: user.id,
        username: user.username,
        email: user.email ?? undefined,
        role: user.role,
      });

      const { raw: refreshRaw, hashed: refreshHashed, expiresAt, familyId } = generateRefreshTokenPair();
      await prisma.refreshToken.create({
        data: { token: refreshHashed, userId: user.id, familyId, expiresAt },
      });

      res.cookie("refreshToken", refreshRaw, REFRESH_COOKIE_OPTIONS);
      res.cookie("accessToken", accessToken, ACCESS_COOKIE_OPTIONS);

      res.json({
        token: accessToken,
        refreshToken: refreshRaw,
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          role: user.role,
          firstName: user.firstName,
          lastName: user.lastName,
        },
      });
    } catch (error) {
      logger.error("[AtlasReverseSSO] Session bootstrap failed:", error);
      res.status(500).json({
        code: "COMPANION_REVERSE_SSO_UNAVAILABLE",
        message: "Session bootstrap failed.",
      });
    }
  },
);
