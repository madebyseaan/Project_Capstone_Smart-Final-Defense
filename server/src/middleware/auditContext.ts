import type { NextFunction, Request, Response } from "express";
import { buildAuditContext, runWithAuditContext } from "../lib/requestContext";

/**
 * Runs each request inside an AsyncLocalStorage scope carrying its audit
 * context (IP, network, device, request path). `createAuditLog()` reads it
 * automatically, so existing call sites need no changes.
 */
export function auditContextMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  runWithAuditContext(buildAuditContext(req), () => next());
}
