import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function aimsServiceAuth(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.AIMS_SERVICE_API_KEY ?? "";
  if (!expected) {
    res.status(401).json({
      code: "UNAUTHORIZED",
      message: "AIMS integration auth is not configured.",
    });
    return;
  }

  const provided = String(req.headers["x-api-key"] ?? "");
  if (!provided || !constantTimeCompare(provided, expected)) {
    res.status(401).json({
      code: "UNAUTHORIZED",
      message: "A valid x-api-key is required.",
    });
    return;
  }

  next();
}
