/**
 * atlasSso.ts
 *
 * SMART -> ATLAS admin-only SSO routes (mounted under /api/auth).
 *
 *   POST /atlas/authorize   JWT-authenticated SMART ADMIN, issues the one-time code
 *   POST /atlas/exchange    Bearer ATLAS secret, returns the identity assertion
 *
 * Secrets, codes, and identity payloads are never logged.
 */

import { Router, Request, Response } from "express";
import { AuditAction, AuditSeverity } from "@prisma/client";
import { authenticateToken, AuthRequest } from "../middleware/auth";
import { createAuditLog } from "../lib/audit";
import { logger } from "../lib/logger";
import { CompanionSsoError } from "../lib/companionSso";
import { exchangeAtlasCode, issueAtlasAuthorizationCode } from "../services/atlasSsoService";
import { ssoAuthorizeLimiter, ssoExchangeLimiter } from "../middleware/rateLimiter";

const router = Router();

function errorBody(error: unknown): { status: number; code: string; message: string } {
  if (error instanceof CompanionSsoError) {
    return { status: error.statusCode, code: error.code, message: error.message };
  }
  return { status: 503, code: "COMPANION_SSO_UNREACHABLE", message: "Unexpected SSO failure." };
}

/**
 * Authorize: the SMART SPA calls this after ATLAS redirects the browser to
 * /auth/atlas/authorize. Only SMART ADMIN accounts are eligible.
 */
router.post(
  "/atlas/authorize",
  ssoAuthorizeLimiter,
  authenticateToken,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const ipAddress = req.ip || req.socket.remoteAddress;

    try {
      if (req.user?.role !== "ADMIN") {
        throw new CompanionSsoError(
          403,
          "COMPANION_REVERSE_SSO_ROLE_DENIED",
          "ATLAS is available to SMART administrators only.",
        );
      }

      const body = req.body ?? {};
      const { redirectUrl } = await issueAtlasAuthorizationCode(req.user!.id, {
        responseType: String(body.responseType ?? ""),
        clientId: String(body.clientId ?? ""),
        redirectUri: String(body.redirectUri ?? ""),
        state: String(body.state ?? ""),
      });

      await createAuditLog(
        AuditAction.LOGIN,
        req.user!,
        "SSO: ATLAS",
        "Auth",
        "ATLAS SSO authorization code issued",
        ipAddress,
        AuditSeverity.INFO,
        undefined,
        undefined,
        "success",
      );

      logger.info(`[AtlasSSO] Authorize succeeded for SMART user ${req.user!.id}.`);
      res.json({ redirectUrl });
    } catch (error) {
      const { status, code, message } = errorBody(error);
      if (status >= 500) logger.error("[AtlasSSO] Authorize failed:", error);
      else logger.warn(`[AtlasSSO] Authorize rejected with ${code}`);

      try {
        await createAuditLog(
          AuditAction.LOGIN,
          req.user ?? { firstName: "ATLAS", lastName: "SSO", role: "UNKNOWN" },
          "SSO: ATLAS",
          "Auth",
          `ATLAS SSO authorization denied (${code})`,
          ipAddress,
          AuditSeverity.WARNING,
          undefined,
          undefined,
          "failure",
        );
      } catch {
        // Best-effort audit only.
      }

      res.status(status).json({ code, message });
    }
  },
);

/**
 * Exchange: ATLAS calls this exactly once with the Bearer shared secret and
 * the code it received on its callback.
 */
router.post("/atlas/exchange", ssoExchangeLimiter, async (req: Request, res: Response): Promise<void> => {
  const ipAddress = req.ip || req.socket.remoteAddress;
  const authHeader = req.headers.authorization ?? "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  const body = req.body ?? {};

  try {
    const result = await exchangeAtlasCode({
      bearer,
      code: body.code,
      clientId: body.clientId,
      redirectUri: body.redirectUri,
    });

    const userId = result.identity.subject.replace(/^SMART_USER:/, "");
    await createAuditLog(
      AuditAction.LOGIN,
      {
        id: userId,
        firstName: result.identity.firstName,
        lastName: result.identity.lastName,
        role: "ADMIN",
      },
      `SSO: ${result.identity.accountName}`,
      "Auth",
      `ATLAS SSO exchange (subject ${result.identity.subject})`,
      ipAddress,
      AuditSeverity.INFO,
      undefined,
      undefined,
      "success",
    );

    res.json(result);
  } catch (error) {
    const { status, code, message } = errorBody(error);
    if (status >= 500) logger.error("[AtlasSSO] Exchange failed:", error);
    else logger.warn(`[AtlasSSO] Exchange rejected with ${code}`);

    try {
      await createAuditLog(
        AuditAction.LOGIN,
        { firstName: "ATLAS", lastName: "SSO", role: "UNKNOWN" },
        "SSO: ATLAS",
        "Auth",
        `ATLAS SSO exchange denied (${code})`,
        ipAddress,
        AuditSeverity.WARNING,
        undefined,
        undefined,
        "failure",
      );
    } catch {
      // Best-effort audit only.
    }

    res.status(status).json({ code, message });
  }
});

export default router;
