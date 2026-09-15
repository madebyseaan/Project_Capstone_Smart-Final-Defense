/**
 * sso.ts
 *
 * EnrollPro companion SSO routes (mounted under /api/auth).
 *
 * Flow A (EnrollPro launches SMART):
 *   GET  /enrollpro/callback   browser callback, exchanges the code server-side
 *   POST /enrollpro/session    SPA session bootstrap after the callback set the cookie
 *
 * Flow B (SMART launches EnrollPro):
 *   POST /sso/authorize        JWT-authenticated, issues the one-time code
 *   POST /sso/exchange         Bearer reverse secret, returns the identity assertion
 *
 * Secrets, codes, and identity payloads are never logged.
 */

import { Router, Request, Response } from "express";
import { AuditAction, AuditSeverity } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { authenticateToken, AuthRequest } from "../middleware/auth";
import { createAuditLog } from "../lib/audit";
import { logger } from "../lib/logger";
import { CompanionSsoError, isValidCodeShape } from "../lib/companionSso";
import {
  signAccessToken,
  generateRefreshTokenPair,
  REFRESH_COOKIE_OPTIONS,
  ACCESS_COOKIE_OPTIONS,
} from "../lib/tokens";
import { exchangeCompanionCode, resolveEnrollProIdentityUser } from "../services/enrollproSsoService";
import { exchangeReverseCode, issueAuthorizationCode } from "../services/enrollproReverseSsoService";
import { ssoAuthorizeLimiter, ssoExchangeLimiter } from "../middleware/rateLimiter";

const router = Router();

// In-memory guard: a code must be processed at most once per process.
// React StrictMode remounts and browser reloads cannot re-exchange a consumed code.
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
  res.redirect(302, `/auth/enrollpro/error?code=${encodeURIComponent(code)}`);
}

function errorBody(error: unknown): { status: number; code: string; message: string } {
  if (error instanceof CompanionSsoError) {
    return { status: error.statusCode, code: error.code, message: error.message };
  }
  return { status: 500, code: "COMPANION_SSO_UNREACHABLE", message: "Unexpected SSO failure." };
}

/**
 * Flow A — browser callback.
 * Exchanges the EnrollPro-issued code, reconciles the identity to a SMART
 * account, and sets a short-lived SMART access cookie. The SPA boot route
 * (see /enrollpro/session) then completes the local session.
 */
router.get("/enrollpro/callback", ssoExchangeLimiter, async (req: Request, res: Response): Promise<void> => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const ipAddress = req.ip || req.socket.remoteAddress;

  if (!isValidCodeShape(code) || !claimCodeForProcessing(code)) {
    redirectToErrorPage(res, "COMPANION_SSO_CODE_INVALID");
    return;
  }

  try {
    const exchange = await exchangeCompanionCode(code);
    const user = await resolveEnrollProIdentityUser(exchange.identity);

    if (user.role === "TEACHER") {
      const sysSettings = await prisma.systemSettings.findUnique({ where: { id: "main" } });
      if (sysSettings?.transitionLock) {
        throw new CompanionSsoError(403, "COMPANION_SSO_ACCOUNT_UNAVAILABLE", "School year transition in progress.");
      }
    }

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
      `EnrollPro SSO login (subject ${exchange.identity.subject})`,
      ipAddress,
      AuditSeverity.INFO,
      undefined,
      undefined,
      "success",
    );

    logger.info(`[CompanionSSO] Flow A success for SMART user ${user.id}`);
    res.redirect(302, "/auth/enrollpro/session");
  } catch (error) {
    const { code: stableCode } = errorBody(error);
    logger.warn(`[CompanionSSO] Flow A denied with ${stableCode}`);
    try {
      await createAuditLog(
        AuditAction.LOGIN,
        { firstName: "EnrollPro", lastName: "SSO", role: "UNKNOWN" },
        "SSO launch denied",
        "Auth",
        `EnrollPro SSO launch denied (${stableCode})`,
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
});

/**
 * Flow A — SPA session bootstrap.
 * Authenticated by the access cookie set by the callback. Issues a fresh
 * SMART access token plus a refresh token pair (role-specific session storage
 * is populated by the SPA), then the SPA redirects to the role dashboard.
 */
router.post("/enrollpro/session", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
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

    if (!user || user.status !== "ACTIVE") {
      res.status(401).json({ code: "COMPANION_SSO_ACCOUNT_UNAVAILABLE", message: "Account is not active." });
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
    logger.error("[CompanionSSO] Session bootstrap failed:", error);
    res.status(500).json({ code: "COMPANION_SSO_UNREACHABLE", message: "Session bootstrap failed." });
  }
});

/**
 * Flow B — authorize. The SPA (which holds the JWT) calls this after
 * EnrollPro redirects the browser to /auth/enrollpro/authorize.
 */
router.post(
  "/sso/authorize",
  ssoAuthorizeLimiter,
  authenticateToken,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const body = req.body ?? {};
      const { redirectUrl } = await issueAuthorizationCode(req.user!.id, {
        responseType: String(body.responseType ?? ""),
        clientId: String(body.clientId ?? ""),
        redirectUri: String(body.redirectUri ?? ""),
        state: String(body.state ?? ""),
      });
      logger.info(`[ReverseSSO] Authorize succeeded for user ${req.user!.id} — one-time code issued.`);
      res.json({ redirectUrl });
    } catch (error) {
      const { status, code, message } = errorBody(error);
      if (status >= 500) logger.error("[ReverseSSO] Authorize failed:", error);
      else logger.warn(`[ReverseSSO] Authorize rejected with ${code}`);
      res.status(status).json({ code, message });
    }
  },
);

/**
 * Flow B — exchange. EnrollPro's backend calls this exactly once with the
 * Bearer reverse secret and the code it received on its callback.
 */
router.post("/sso/exchange", ssoExchangeLimiter, async (req: Request, res: Response): Promise<void> => {
  // Diagnostic breadcrumb only — never log the code, body, or secret.
  logger.info(`[ReverseSSO] Exchange request received (path ${req.path}).`);
  const authHeader = req.headers.authorization ?? "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  const body = req.body ?? {};

  try {
    const result = await exchangeReverseCode({
      bearer,
      code: body.code,
      clientId: body.clientId,
      redirectUri: body.redirectUri,
    });
    res.json(result);
  } catch (error) {
    const { status, code, message } = errorBody(error);
    if (status >= 500) logger.error("[ReverseSSO] Exchange failed:", error);
    else logger.warn(`[ReverseSSO] Exchange rejected with ${code}`);

    // EnrollPro expects this exact JSON shape for an invalid code.
    if (code === "COMPANION_SSO_CODE_INVALID") {
      res.status(401).json({
        code: "COMPANION_SSO_CODE_INVALID",
        message: "The SSO authorization code is invalid, expired, or already used.",
      });
      return;
    }
    res.status(status).json({ code, message });
  }
});

export default router;
