/**
 * useNotifications.ts
 *
 * Derives role-scoped notifications from data the app already has — no DB,
 * no new endpoints. Offline alerts come from the layout's SSE stream; the
 * rest come from light, role-authorized endpoints via React Query.
 *
 * IMPORTANT (e2e gate): only endpoints the current role is authorized for may
 * be called. A cross-role call returns 403 and is counted as a regression by
 * e2e/portals.spec.ts. The `enabled` guards below enforce that.
 */
import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { gradesApi, registrarApi, type PortalRole } from "@/lib/api";
import {
  readDismissed,
  writeDismissed,
  type AppNotification,
  type NotificationSeverity,
} from "@/lib/notifications";

const POLL_MS = 60_000;

interface UseNotificationsParams {
  portal: PortalRole;
  userId: string | null;
  atlasOffline: boolean;
  enrollproOffline: boolean;
}

export interface UseNotificationsResult {
  notifications: AppNotification[];
  isLoading: boolean;
  dismiss: (id: string) => void;
  dismissAll: () => void;
}

function termLabel(term: string): string {
  if (term === "T1") return "Term 1";
  if (term === "T2") return "Term 2";
  if (term === "T3") return "Term 3";
  return term;
}

function offlineHref(portal: PortalRole): string {
  if (portal === "admin") return "/admin/health";
  if (portal === "registrar") return "/registrar";
  return "/teacher/schedule";
}

export function useNotifications({
  portal,
  userId,
  atlasOffline,
  enrollproOffline,
}: UseNotificationsParams): UseNotificationsResult {
  const enabled = !!userId;
  const currentKey = userId ? `${portal}:${userId}` : "";

  // Dismissals are reloaded synchronously when portal/user changes (the user
  // resolves asynchronously in the layouts) — no effect needed.
  const [dismissState, setDismissState] = useState(() => ({
    key: currentKey,
    ids: userId ? readDismissed(portal, userId) : new Set<string>(),
  }));

  if (dismissState.key !== currentKey) {
    setDismissState({
      key: currentKey,
      ids: userId ? readDismissed(portal, userId) : new Set<string>(),
    });
  }

  const dismissed = dismissState.ids;

  // ── Teacher: grade deadline (TEACHER-only, light) ──────────────────────────
  const deadlineQuery = useQuery({
    queryKey: ["notifications", "deadline", userId],
    queryFn: async () => (await gradesApi.getDeadlineStatus()).data.gradeDeadline,
    enabled: enabled && portal === "teacher",
    retry: 0,
    staleTime: POLL_MS,
    refetchInterval: POLL_MS,
  });

  // ── Admin: pending grade edit requests (ADMIN-only, DB-only) ───────────────
  const editRequestsQuery = useQuery({
    queryKey: ["notifications", "admin-edit-requests", userId],
    queryFn: async () => (await gradesApi.getAdminEditRequests("PENDING")).data.requests,
    enabled: enabled && portal === "admin",
    retry: 0,
    staleTime: POLL_MS,
    refetchInterval: POLL_MS,
  });

  // ── Registrar: pending remedial (REGISTRAR-only) ───────────────────────────
  const remedialQuery = useQuery({
    queryKey: ["notifications", "registrar-remedial", userId],
    queryFn: async () => (await registrarApi.getRemedialPending({ page: 1, limit: 1 })).data,
    enabled: enabled && portal === "registrar",
    retry: 0,
    staleTime: POLL_MS,
    refetchInterval: POLL_MS,
  });

  // ── Registrar: sync freshness (REGISTRAR-only) ─────────────────────────────
  const syncQuery = useQuery({
    queryKey: ["notifications", "registrar-sync", userId],
    queryFn: async () => (await registrarApi.getSyncStatus()).data,
    enabled: enabled && portal === "registrar",
    retry: 0,
    staleTime: POLL_MS,
    refetchInterval: POLL_MS,
  });

  const all = useMemo<AppNotification[]>(() => {
    const items: AppNotification[] = [];
    const push = (n: AppNotification) => items.push(n);

    // Offline signals are shared by all portals.
    if (atlasOffline) {
      push({
        id: "atlas-offline",
        severity: "warning",
        title: "ATLAS is unreachable",
        description: "Teaching load and class lists may be outdated.",
        href: offlineHref(portal),
      });
    }
    if (enrollproOffline) {
      push({
        id: "enrollpro-offline",
        severity: "warning",
        title: "EnrollPro is unreachable",
        description: "Student and enrollment data may be stale.",
        href: offlineHref(portal),
      });
    }

    if (portal === "teacher") {
      const d = deadlineQuery.data;
      if (d?.hasIncompleteClasses && d.urgencyLevel !== "none") {
        const term = termLabel(d.currentTerm);
        const countText = `${d.incompleteCount} class${d.incompleteCount !== 1 ? "es" : ""} incomplete`;
        let severity: NotificationSeverity = "warning";
        let title = `${term} grades due`;
        let description = countText;

        if (d.urgencyLevel === "overdue") {
          severity = "critical";
          title = `${term} grades overdue`;
          description = `${Math.abs(d.daysRemaining ?? 0)}d overdue · ${countText}`;
        } else if (d.urgencyLevel === "critical") {
          severity = "critical";
          title = d.daysRemaining === 0 ? `${term} grades due today` : `${term} grades due tomorrow`;
          description = countText;
        } else {
          title = `${term} grades due in ${d.daysRemaining}d`;
        }

        push({
          id: `deadline:${d.currentTerm}:${d.termEndDate?.slice(0, 10) ?? "none"}`,
          severity,
          title,
          description,
          href: "/teacher/classes",
        });
      }
    }

    if (portal === "admin") {
      const reqs = editRequestsQuery.data ?? [];
      if (reqs.length > 0) {
        push({
          id: `edit-requests:${reqs.length}`,
          severity: "warning",
          title: `${reqs.length} pending grade edit request${reqs.length !== 1 ? "s" : ""}`,
          description: "Teacher requests awaiting approval",
          href: "/admin/edit-requests",
        });
      }
    }

    if (portal === "registrar") {
      const remedial = remedialQuery.data as
        | { items?: unknown[]; meta?: { total?: number } }
        | undefined;
      const total = remedial?.meta?.total ?? remedial?.items?.length ?? 0;
      if (total > 0) {
        push({
          id: `remedial:${total}`,
          severity: "warning",
          title: `${total} pending remedial record${total !== 1 ? "s" : ""}`,
          description: "Conditionally promoted learners needing remedial",
          href: "/registrar/remedial",
        });
      }

      const sync = syncQuery.data;
      if (sync && sync.status !== "fresh") {
        const stale = sync.status === "stale";
        push({
          id: `sync:${sync.status}`,
          severity: stale ? "warning" : "info",
          title: stale ? "EnrollPro sync is stale" : "EnrollPro has not synced yet",
          description:
            stale && sync.minutesSinceLastSync != null
              ? `Last sync ${sync.minutesSinceLastSync}m ago`
              : "Registrar data may be out of date",
          href: "/registrar",
        });
      }
    }

    return items;
  }, [
    portal,
    atlasOffline,
    enrollproOffline,
    deadlineQuery.data,
    editRequestsQuery.data,
    remedialQuery.data,
    syncQuery.data,
  ]);

  const notifications = useMemo(
    () => all.filter((n) => !dismissed.has(n.id)),
    [all, dismissed],
  );

  const dismiss = useCallback(
    (id: string) => {
      if (!userId) return;
      setDismissState((prev) => {
        const next = new Set(prev.ids).add(id);
        writeDismissed(portal, userId, next);
        return { key: `${portal}:${userId}`, ids: next };
      });
    },
    [portal, userId],
  );

  const dismissAll = useCallback(() => {
    if (!userId) return;
    const next = new Set(all.map((n) => n.id));
    writeDismissed(portal, userId, next);
    setDismissState({ key: `${portal}:${userId}`, ids: next });
  }, [portal, userId, all]);

  const isLoading =
    deadlineQuery.isLoading ||
    editRequestsQuery.isLoading ||
    remedialQuery.isLoading ||
    syncQuery.isLoading;

  return { notifications, isLoading, dismiss, dismissAll };
}
