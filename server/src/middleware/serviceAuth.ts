import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return crypto.timingSafeEqual(bufA, bufB);
}

export function serviceAuth(req: Request, res: Response, next: NextFunction): void {
  // P1-3: read at call time (testable) and FAIL CLOSED — an unconfigured key
  // must never open the integration endpoints.
  const ENROLLPRO_API_KEY = process.env.ENROLLPRO_API_KEY ?? "";
  if (!ENROLLPRO_API_KEY) {
    res.status(401).json({ error: "Integration authentication is not configured" });
    return;
  }
  const provided = req.headers["x-enrollpro-api-key"] as string | undefined;
  if (!provided || !constantTimeCompare(provided, ENROLLPRO_API_KEY)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}
