import crypto from "crypto";
import { Request, Response, NextFunction } from "express";
import { CSRF_COOKIE_OPTIONS } from "../lib/tokens";

const CSRF_SECRET = process.env.CSRF_SECRET || process.env.JWT_SECRET || "csrf-fallback-secret";

/**
 * Generates a signed CSRF token (HMAC of timestamp + random nonce).
 * Sets it as a readable cookie and returns it for the response body.
 */
export function generateCsrfToken(): string {
  const nonce = crypto.randomBytes(16).toString("hex");
  const timestamp = Date.now().toString();
  const payload = `${timestamp}.${nonce}`;
  const signature = crypto.createHmac("sha256", CSRF_SECRET).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

/**
 * Validates a CSRF token: checks HMAC signature and freshness (15 min max age).
 */
function validateCsrfToken(token: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;

  const [timestamp, nonce, signature] = parts;
  const payload = `${timestamp}.${nonce}`;
  const expectedSignature = crypto.createHmac("sha256", CSRF_SECRET).update(payload).digest("hex");

  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSignature);
  if (sigBuf.length !== expectedBuf.length) return false;

  // Constant-time comparison to prevent timing attacks
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return false;
  }

  // Check freshness (15 minutes)
  const tokenAge = Date.now() - parseInt(timestamp, 10);
  if (tokenAge > 15 * 60 * 1000) return false;

  return true;
}

/**
 * Middleware: sets CSRF cookie on GET requests, validates token on state-changing requests.
 * Exempt: GET, HEAD, OPTIONS (safe methods), and webhook endpoints (authenticated by API key).
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  const method = req.method.toUpperCase();
  const path = req.path;

  // Exempt auth routes — no session exists yet during login, and refresh uses httpOnly cookie
  if (path.startsWith("/api/auth")) {
    next();
    return;
  }

  // Exempt webhook endpoints — authenticated by API key, not cookies
  if (path.includes("/sync-grades") || path.includes("-webhook")) {
    next();
    return;
  }

  // Exempt admin settings — protected by admin role + JWT
  if (path.includes("/admin/settings")) {
    next();
    return;
  }

  // Safe methods — no CSRF risk, but set the cookie so frontend can read it
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    const existingToken = req.cookies?.["x-csrf-token"];
    if (!existingToken) {
      const token = generateCsrfToken();
      res.cookie("x-csrf-token", token, CSRF_COOKIE_OPTIONS);
    }
    next();
    return;
  }

  // State-changing methods — validate the token
  const token = req.headers["x-csrf-token"] as string | undefined;
  if (!token || !validateCsrfToken(token)) {
    res.status(403).json({ error: "Invalid or missing CSRF token" });
    return;
  }

  next();
}
