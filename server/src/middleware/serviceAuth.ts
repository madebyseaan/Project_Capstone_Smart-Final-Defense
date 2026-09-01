import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

const ENROLLPRO_API_KEY = process.env.ENROLLPRO_API_KEY ?? "";

function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return crypto.timingSafeEqual(bufA, bufB);
}

export function serviceAuth(req: Request, res: Response, next: NextFunction): void {
  if (!ENROLLPRO_API_KEY) {
    next();
    return;
  }
  const provided = req.headers["x-enrollpro-api-key"] as string | undefined;
  if (!provided || !constantTimeCompare(provided, ENROLLPRO_API_KEY)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}
