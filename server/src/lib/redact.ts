/**
 * redact.ts — P1-9 log redaction helpers.
 *
 * Masks identifiers (LRN, employee id, email) before they reach logs, while
 * keeping enough of the value for correlation.
 */

export function maskId(value: string | null | undefined, visible = 4): string {
  if (!value) return "(none)";
  const s = String(value);
  if (s.length <= visible) return "*".repeat(s.length) || "(none)";
  return `${"*".repeat(s.length - visible)}${s.slice(-visible)}`;
}

export function maskEmail(value: string | null | undefined): string {
  if (!value) return "(none)";
  const s = String(value);
  const at = s.indexOf("@");
  if (at <= 0) return maskId(s);
  const local = s.slice(0, at);
  const domain = s.slice(at);
  const head = local.slice(0, 2);
  return `${head}${"*".repeat(Math.max(local.length - 2, 1))}${domain}`;
}
