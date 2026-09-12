import { AsyncLocalStorage } from "async_hooks";
import type { Request } from "express";

/**
 * Request-scoped audit context.
 *
 * A single middleware builds this from the incoming request and runs the rest
 * of the request inside an AsyncLocalStorage scope, so `createAuditLog()` can
 * enrich every log with "who / from where / on what device" without changing
 * any of the ~50 existing call sites.
 */
export interface AuditContext {
  ip: string;
  userAgent: string | null;
  browser: string | null;
  os: string | null;
  deviceType: string;
  network: string;
  method: string;
  path: string;
}

const storage = new AsyncLocalStorage<AuditContext>();

export function runWithAuditContext<T>(ctx: AuditContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getAuditContext(): AuditContext | undefined {
  return storage.getStore();
}

/**
 * Normalize a raw address: take the first hop of an X-Forwarded-For list,
 * unwrap IPv4-mapped IPv6, and map loopback `::1` to `127.0.0.1`.
 */
export function normalizeIp(raw?: string | null): string {
  if (!raw) return "unknown";
  let ip = raw.trim();
  if (ip.includes(",")) ip = ip.split(",")[0].trim();
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  if (ip === "::1") ip = "127.0.0.1";
  return ip || "unknown";
}

function isPrivate172(ip: string): boolean {
  const m = ip.match(/^172\.(\d+)\./);
  if (!m) return false;
  const second = Number(m[1]);
  return second >= 16 && second <= 31;
}

/**
 * Classify an address into the network it came from.
 * Tailscale uses the CGNAT range 100.64.0.0/10.
 */
export function classifyNetwork(ip: string): string {
  if (!ip || ip === "unknown") return "Unknown";

  // Tailscale CGNAT: 100.64.0.0 – 100.127.255.255 (second octet 64–127)
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)) return "Tailscale";

  if (ip === "127.0.0.1") return "Localhost";
  if (/^10\./.test(ip)) return "School LAN";
  if (/^192\.168\./.test(ip)) return "School LAN";
  if (isPrivate172(ip)) return "School LAN";

  // IPv6 unique-local / link-local
  if (/^(fc|fd|fe80)/i.test(ip)) return "School LAN";

  return "Public Internet";
}

export interface ParsedUserAgent {
  browser: string | null;
  os: string | null;
  deviceType: string;
}

/**
 * Minimal dependency-free User-Agent parser — enough to answer
 * "which browser, which OS, what kind of device".
 */
export function parseUserAgent(uaRaw?: string | null): ParsedUserAgent {
  const ua = (uaRaw || "").trim();
  if (!ua) return { browser: null, os: null, deviceType: "Unknown" };

  let browser: string | null = null;
  let majorVersion = "";

  // Order matters: Edge/Opera/Samsung before Chrome; Chrome before Safari.
  const checks: Array<[RegExp, string]> = [
    [/Edg(?:e|A|iOS)?\/([\d.]+)/, "Edge"],
    [/OPR\/([\d.]+)/, "Opera"],
    [/Opera[/ ]([\d.]+)/, "Opera"],
    [/SamsungBrowser\/([\d.]+)/, "Samsung Internet"],
    [/Firefox\/([\d.]+)/, "Firefox"],
    [/CriOS\/([\d.]+)/, "Chrome"],
    [/Chrome\/([\d.]+)/, "Chrome"],
    [/Version\/([\d.]+).*Safari/, "Safari"],
  ];

  for (const [re, name] of checks) {
    const m = ua.match(re);
    if (m) {
      browser = name;
      majorVersion = (m[1] || "").split(".")[0];
      break;
    }
  }

  let os: string | null = null;
  if (/Windows NT 10\.0/.test(ua)) os = "Windows 10/11";
  else if (/Windows NT 6\.3/.test(ua)) os = "Windows 8.1";
  else if (/Windows NT 6\.1/.test(ua)) os = "Windows 7";
  else if (/Windows/.test(ua)) os = "Windows";
  else if (/Android/.test(ua)) os = "Android";
  else if (/(iPhone|iPad|iPod).*OS/.test(ua)) os = "iOS";
  else if (/Mac OS X/.test(ua)) os = "macOS";
  else if (/CrOS/.test(ua)) os = "ChromeOS";
  else if (/Linux/.test(ua)) os = "Linux";

  let deviceType = "Desktop";
  if (/bot|crawler|spider|crawling/i.test(ua)) deviceType = "Bot";
  else if (/iPad|Tablet|PlayBook|Silk/i.test(ua)) deviceType = "Tablet";
  else if (/Mobi|iPhone|iPod|Android/i.test(ua)) deviceType = "Mobile";

  return {
    browser: browser ? `${browser}${majorVersion ? ` ${majorVersion}` : ""}` : null,
    os,
    deviceType,
  };
}

/** Build the audit context from an Express request. */
export function buildAuditContext(req: Request): AuditContext {
  const forwarded = req.headers["x-forwarded-for"];
  const forwardedIp = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const ip = normalizeIp(
    (forwardedIp && forwardedIp.split(",")[0]) || req.ip || req.socket?.remoteAddress
  );

  const userAgentHeader = req.headers["user-agent"];
  const userAgent = (Array.isArray(userAgentHeader) ? userAgentHeader[0] : userAgentHeader) || null;
  const parsed = parseUserAgent(userAgent);

  const url = req.originalUrl || req.url || "";
  const path = url.split("?")[0];

  return {
    ip,
    userAgent,
    browser: parsed.browser,
    os: parsed.os,
    deviceType: parsed.deviceType,
    network: classifyNetwork(ip),
    method: req.method,
    path,
  };
}
