/**
 * notifications.ts — shared types and localStorage dismiss-state for the
 * derived notification bell.
 *
 * No database: notifications are computed from data the app already fetches.
 * "Read" state is per-user dismissals stored locally, matching the existing
 * banner-dismiss pattern in GradeDeadlineBanner.
 */
import type { PortalRole } from "./api";

export type NotificationSeverity = "info" | "warning" | "critical";

export interface AppNotification {
  /** Stable across renders so dismissals persist; changes when the alert changes. */
  id: string;
  severity: NotificationSeverity;
  title: string;
  description?: string;
  href: string;
}

const DISMISS_PREFIX = "smart_notif_dismissed";

function dismissKey(portal: PortalRole, userId: string): string {
  return `${DISMISS_PREFIX}_${portal}_${userId}`;
}

export function readDismissed(portal: PortalRole, userId: string): Set<string> {
  try {
    const raw = localStorage.getItem(dismissKey(portal, userId));
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return new Set(
      Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [],
    );
  } catch {
    return new Set();
  }
}

export function writeDismissed(portal: PortalRole, userId: string, ids: Set<string>): void {
  try {
    localStorage.setItem(dismissKey(portal, userId), JSON.stringify(Array.from(ids)));
  } catch {
    // Ignore quota / private-mode failures — dismissal is best-effort.
  }
}

export function clearDismissed(portal: PortalRole, userId: string): void {
  try {
    localStorage.removeItem(dismissKey(portal, userId));
  } catch {
    // Ignore.
  }
}
