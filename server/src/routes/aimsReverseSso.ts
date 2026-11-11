import { Router, Request, Response } from "express";
import { AuditAction, AuditSeverity } from "@prisma/client";
import { createAuditLog } from "../lib/audit";
import { logger } from "../lib/logger";
import { authenticateToken, AuthRequest } from "../middleware/auth";
import { ssoAuthorizeLimiter, ssoExchangeLimiter } from "../middleware/rateLimiter";
import {
  AimsReverseSsoError,
  exchangeAimsReverseCode,
  issueAimsReverseCode,
} from "../services/aimsReverseSsoService";

export const aimsReverseSessionRouter = Router();
export const aimsReverseAliasRouter = Router();

function errorBody(error: unknown): { status: number; code: string; message: string } {
  if (error instanceof AimsReverseSsoError) {
    return { status: error.statusCode, code: error.code, message: error.message };
  }
  return { status: 503, code: "EXCHANGE_FAILED", message: "AIMS sign-in could not be completed." };
}

async function handleExchange(req: Request, res: Response): Promise<void> {
  const ipAddress = req.ip || req.socket.remoteAddress;
  const clientId = String(req.headers["x-aims-client-id"] ?? "").trim();
  const clientSecret = String(req.headers["x-aims-client-secret"] ?? "").trim();
  const code = req.body?.code;

  try {
    const result = await exchangeAimsReverseCode({ clientId, clientSecret, code });

    await createAuditLog(
      AuditAction.LOGIN,
      {
        id: result.userId,
        firstName: result.data.identity.firstName,
        lastName: result.data.identity.lastName,
        role: result.data.identity.role,
      },
      `SSO: ${result.data.identity.username}`,
      "Auth",
      `AIMS reverse SSO exchange (identity ${result.data.identity.id ?? "unlinked"})`,
      ipAddress,
      AuditSeverity.INFO,
      undefined,
      undefined,
      "success",
    );

    res.json({ success: true, data: result.data });
  } catch (error) {
    const { status, code: stableCode, message } = errorBody(error);
    if (status >= 500 && stableCode !== "SSO_NOT_CONFIGURED") {
      logger.error("[AimsReverseSSO] Exchange failed:", stableCode);
    } else {
      logger.warn(`[AimsReverseSSO] Exchange rejected with ${stableCode}`);
    }

    try {
      await createAuditLog(
        AuditAction.LOGIN,
        { firstName: "AIMS", lastName: "SSO", role: "UNKNOWN" },
        "SSO: AIMS",
        "Auth",
        `AIMS reverse SSO exchange denied (${stableCode})`,
        ipAddress,
        AuditSeverity.WARNING,
        undefined,
        undefined,
        "failure",
      );
    } catch {
      // Best-effort audit only.
    }

    res.status(status).json({ success: false, error: message, code: stableCode });
  }
}

aimsReverseSessionRouter.post(
  "/aims/reverse/authorize",
  ssoAuthorizeLimiter,
  authenticateToken,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      if (req.user?.role !== "ADMIN" && req.user?.role !== "TEACHER") {
        throw new AimsReverseSsoError(403, "ROLE_UNSUPPORTED", "AIMS sign-in is available to teachers and administrators only.");
      }

      const { launchUrl } = await issueAimsReverseCode(req.user!.id);
      res.json({ success: true, launchUrl });
    } catch (error) {
      const { status, code, message } = errorBody(error);
      if (status >= 500 && code !== "SSO_NOT_CONFIGURED") {
        logger.error("[AimsReverseSSO] Authorize failed:", code);
      } else {
        logger.warn(`[AimsReverseSSO] Authorize rejected with ${code}`);
      }
      res.status(status).json({ success: false, error: message, code });
    }
  },
);

aimsReverseSessionRouter.post("/aims/reverse/exchange", ssoExchangeLimiter, handleExchange);
aimsReverseAliasRouter.post("/aims/exchange", ssoExchangeLimiter, handleExchange);
