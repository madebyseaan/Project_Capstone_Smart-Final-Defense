import type { NextFunction, Request, Response } from "express";
import { logger } from "../lib/logger";

/**
 * P1-5: global error handler.
 *
 * Logs the full error server-side and returns a generic JSON body — never a
 * stack trace or internal error message. Must be registered AFTER all routes.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function globalErrorHandler(err: any, _req: Request, res: Response, _next: NextFunction): void {
  logger.error(`[global-error-handler] ${err?.stack ?? err?.message ?? err}`);
  if (res.headersSent) return;
  const status = typeof err?.status === "number" ? err.status : 500;
  res.status(status).json({ message: "Internal server error" });
}

/**
 * P1-5: JSON 404 for unknown API routes. Without this the SPA fallback serves
 * index.html with HTTP 200 for mistyped API paths.
 */
export function apiNotFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ message: "API route not found" });
}
