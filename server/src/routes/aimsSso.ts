import { Router, Request, Response } from "express";
import { AuditAction, AuditSeverity } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { createAuditLog } from "../lib/audit";
import { logger } from "../lib/logger";
import { generateRefreshTokenPair, signAccessToken } from "../lib/tokens";
import { ssoExchangeLimiter } from "../middleware/rateLimiter";
import { AimsSsoError, exchangeAimsCode } from "../services/aimsSsoService";

const router = Router();

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

router.post("/aims/exchange", ssoExchangeLimiter, async (req: Request, res: Response): Promise<void> => {
  const ipAddress = req.ip || req.socket.remoteAddress;
  const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";

  if (!code || code.length > 2048) {
    res.status(400).json({
      success: false,
      code: "INVALID_CODE",
      error: "A sign-in code is required.",
    });
    return;
  }

  if (!claimCodeForProcessing(code)) {
    res.status(409).json({
      success: false,
      code: "CODE_ALREADY_USED",
      error: "This sign-in link was already used.",
    });
    return;
  }

  try {
    const result = await exchangeAimsCode(code);
    const user = result.user;

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

    await createAuditLog(
      AuditAction.LOGIN,
      { id: user.id, firstName: user.firstName, lastName: user.lastName, role: user.role },
      `SSO: ${user.username}`,
      "Auth",
      `AIMS SSO login (identity ${result.identity.id ?? "unlinked"})`,
      ipAddress,
      AuditSeverity.INFO,
      undefined,
      undefined,
      "success",
    );

    res.json({
      success: true,
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
      redirectTo: result.redirectTo,
    });
  } catch (error) {
    const stable = error instanceof AimsSsoError
      ? error
      : new AimsSsoError(502, "AIMS_EXCHANGE_FAILED", "AIMS sign-in could not be completed.");

    if (stable.statusCode >= 500 && stable.code !== "SSO_NOT_CONFIGURED") {
      logger.error("[AimsSSO] Exchange failed:", stable.code);
    } else {
      logger.warn(`[AimsSSO] Exchange rejected with ${stable.code}`);
    }

    try {
      await createAuditLog(
        AuditAction.LOGIN,
        stable.identity
          ? {
              firstName: stable.identity.firstName,
              lastName: stable.identity.lastName,
              role: stable.identity.role,
            }
          : { firstName: "AIMS", lastName: "SSO", role: "UNKNOWN" },
        "SSO: AIMS",
        "Auth",
        `AIMS SSO denied (${stable.code})`,
        ipAddress,
        AuditSeverity.WARNING,
        undefined,
        undefined,
        "failure",
      );
    } catch {
      // Best-effort audit only.
    }

    res.status(stable.statusCode).json({
      success: false,
      code: stable.code,
      error: stable.message,
      ...(stable.identity ? { identity: stable.identity } : {}),
    });
  }
});

export default router;
