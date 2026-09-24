# AI Handoff — SMART Notifications & Feedback for MRF

**How to use this document:** paste it into the MRF-side AI coding agent as the task brief. It is fully self-contained: the agent does not need access to the SMART repository. MRF supplies its own notification sources, event rules, and copy; the visual design and interaction behavior must match this spec.

Companion docs: `AI_HANDOFF_SIDEBAR_TOPBAR.md` (shell, where the bell lives) · `AI_HANDOFF_TABLES.md` · `AI_HANDOFF_MODALS_DRAWERS.md` · `AI_HANDOFF_FORMS_CONTROLS.md` · `AI_HANDOFF_DATA_DISPLAY.md` · `AI_HANDOFF_PAGES_BRANDING.md`

---

## 0. Task brief for the agent

Implement MRF's system feedback layer:

1. **Notification bell** in the topbar — count badge, dropdown panel, severity icons, per-item dismiss, dismiss-all, empty state, click-through navigation.
2. **Toasts** — global Sonner setup (`richColors`, top-right) behind a small wrapper API.
3. **Inline banners** — form-level error/success blocks and page-level status rows.
4. **Loading indicators** — inline spinners, full-page loader, skeletons (pointer to tables doc).
5. **Page error block** — centered destructive tile with retry.

Use MRF's own notification rules, labels, and links. The reference code is embedded in §4, §5, §7, §8.

---

## 1. Hard rules

### 1.1 KEEP (do not alter)
- Bell is a **20px icon in a 12px-radius ghost button** (`p-2 rounded-xl`) in the topbar's right cluster, with `active:scale-95` press feedback.
- Badge: **destructive red pill**, min 16px, top-right of the bell, caps display at `9+`, hidden at zero.
- Panel: **320px wide** (`w-80`), `rounded-lg`, `bg-popover`, 1px 10%-foreground ring, `shadow-md`, 4px padding, opens bottom-end aligned.
- Items: icon + title + optional description, 2.5px gap, 10px vertical padding; **click dismisses and navigates**.
- Empty state: centered `CheckCircle2` + “You're all caught up”.
- Severity mapping: `critical` → `destructive` icon color, `warning` → `amber-600`, `info` → `muted-foreground`; icons `AlertCircle` / `AlertTriangle` / `Info` at 16px.
- Dismissals persist **per portal + user** in `localStorage` — not in a database.
- Toasts are top-right, rich colored (Sonner defaults for success/error/warning/info iconography).
- Toasts never replace a destructiveness confirmation — those use `ConfirmDialog` (see modals doc).
- Inline banners use the tinted-border recipe: success = theme primary at 5% bg / 20% border; error = destructive at 5% bg / 20% border.

### 1.2 REPLACE (MRF content)
- Which conditions raise notifications, their titles/descriptions, and target routes.
- Toast messages and trigger points.
- Polling cadence and realtime source (SMART polls 60s and uses an SSE stream for offline flags).

### 1.3 DO NOT
- Do not use native `alert()` for feedback.
- Do not stack multiple toasts for the same event; one toast per outcome.
- Do not show a toast for successful navigation or layout events.
- Do not auto-dismiss error toasts faster than Sonner's defaults; users must be able to read and copy the message.
- Do not put long prose in the bell panel; title ≤ 60 chars, description ≤ 80.

---

## 2. Tokens

| Token | Value |
|---|---|
| Bell button | `p-2` (8px), radius 12px, icon 20px, `hover:bg-accent`, `active:scale-95` |
| Badge | min-width 16px, height 16px, horizontal padding 4px, `rounded-full`, bg `destructive`, white, 10px bold, text 9+ cap |
| Panel width | 320px (`w-80`), zero inner padding (`p-0` override) |
| Panel header | `padding: 8px 12px`, bottom border 1px; label 12px semibold uppercase `tracking-wide` muted |
| Dismiss-all link | 11px semibold, theme primary, underline on hover |
| Panel list | `max-height: 60vh`, `overflow-y: auto`, 4px vertical padding |
| Item | `padding: 10px 12px`, gap 10px, icon 16px top-aligned, title 14px medium, description 12px muted |
| Item hover/focus | `accent` background (dropdown-menu default) |
| Empty state | centered, `padding: 32px 16px`, icon 24px muted, text 14px muted |
| Panel motion | 100ms fade + zoom-95, slide 8px from the anchor side |
| Page banner | `padding: 16px`, radius 12px, 2px border, 16px gap between icon and text |
| Form banner | `padding: 12px`, radius 12px, 1px border, icon well 32px with 8px radius, enter animation 220ms |
| Toast position | `top-right`, `richColors` |

---

## 3. Notification anatomy

```
Bell button (relative, p-2, rounded-xl)
├── Bell icon (20px)
└── Badge (absolute top-0.5 right-0.5, 16px pill, red, 10px bold)

Panel (w-80, p-0, rounded-lg, bg-popover, ring 10%, shadow-md)
├── Header (px-3 py-2, border-b): "NOTIFICATIONS" label + "Dismiss all" link
├── List (max-h-[60vh], overflow-y-auto, py-1)
│   ├── Empty: CheckCircle2 + "You're all caught up"
│   └── Items
│       ├── Icon (w-4 h-4, severity color, mt-0.5)
│       └── Text stack: title (14px medium) + description (12px muted)
└── (no footer)
```

Severity matrix:

| Severity | Icon | Color | Use for |
|---|---|---|---|
| `critical` | `AlertCircle` | `text-destructive` | Overdue/blocking conditions |
| `warning` | `AlertTriangle` | `text-amber-600` | Degraded data, offline integrations, pending approvals |
| `info` | `Info` | `text-muted-foreground` | Neutral state notices (e.g., never synced) |

---

## 4. Reference code — NotificationBell

```tsx
import { Bell, AlertTriangle, AlertCircle, Info, CheckCircle2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type NotificationSeverity = "info" | "warning" | "critical";

export interface AppNotification {
  id: string;
  severity: NotificationSeverity;
  title: string;
  description?: string;
  href: string;
}

const SEVERITY_ICON: Record<NotificationSeverity, typeof Info> = {
  critical: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const SEVERITY_COLOR: Record<NotificationSeverity, string> = {
  critical: "text-destructive",
  warning: "text-amber-600",
  info: "text-muted-foreground",
};

interface NotificationBellProps {
  userId: string | null;
  notifications: AppNotification[];
  onDismiss: (id: string) => void;
  onDismissAll: () => void;
}

export default function NotificationBell({
  userId,
  notifications,
  onDismiss,
  onDismissAll,
}: NotificationBellProps) {
  const navigate = useNavigate();

  if (!userId) return null;

  const count = notifications.length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={count > 0 ? `Notifications, ${count} active` : "Notifications"}
            className="relative p-2 rounded-xl hover:bg-accent text-muted-foreground transition-all active:scale-95"
          />
        }
      >
        <Bell className="w-5 h-5" />
        {count > 0 && (
          <span className="absolute top-0.5 right-0.5 min-w-4 h-4 px-1 rounded-full bg-destructive text-white text-[10px] font-bold flex items-center justify-center">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Notifications
          </span>
          {count > 0 && (
            <button
              type="button"
              onClick={onDismissAll}
              className="text-[11px] font-semibold text-primary hover:underline"
            >
              Dismiss all
            </button>
          )}
        </div>

        <div className="max-h-[60vh] overflow-y-auto py-1">
          {count === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
              <CheckCircle2 className="w-6 h-6 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">You&apos;re all caught up</p>
            </div>
          ) : (
            notifications.map((n) => {
              const Icon = SEVERITY_ICON[n.severity];
              return (
                <DropdownMenuItem
                  key={n.id}
                  className="items-start gap-2.5 px-3 py-2.5"
                  onClick={() => {
                    onDismiss(n.id);
                    navigate(n.href);
                  }}
                >
                  <Icon className={cn("w-4 h-4 mt-0.5 shrink-0", SEVERITY_COLOR[n.severity])} />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium text-foreground leading-snug">{n.title}</span>
                    {n.description && (
                      <span className="text-xs text-muted-foreground leading-snug">{n.description}</span>
                    )}
                  </span>
                </DropdownMenuItem>
              );
            })
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

Required dropdown primitive classes (adapt to MRF's menu library):

```
content: z-50 max-h-(--available-height) w-(--anchor-width) min-w-32 rounded-lg bg-popover p-1
         text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 outline-none
         slide-in-from-* per side (8px), open: fade-in-0 + zoom-in-95, close: fade-out-0 + zoom-out-95
item:    relative flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm
         outline-hidden select-none focus:bg-accent focus:text-accent-foreground
         disabled: opacity-50
separator: -mx-1 my-1 h-px bg-border
```

### 4.1 Dismissal storage (per portal + user)

```ts
const DISMISS_PREFIX = "mrf_notif_dismissed";

function dismissKey(portal: string, userId: string) {
  return `${DISMISS_PREFIX}_${portal}_${userId}`;
}

export function readDismissed(portal: string, userId: string): Set<string> {
  try {
    const raw = localStorage.getItem(dismissKey(portal, userId));
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export function writeDismissed(portal: string, userId: string, ids: Set<string>): void {
  try {
    localStorage.setItem(dismissKey(portal, userId), JSON.stringify(Array.from(ids)));
  } catch {
    /* quota / private mode — dismissal is best-effort */
  }
}
```

Behavior contract:
- `id` must be **stable while the condition persists** and change when it resolves (e.g., `deadline:T2:2026-01-31`), so dismissals don't leak into new alerts.
- Notification list = derived candidates minus dismissed ids.
- Dismiss-all snapshots every current candidate id.
- Offline/degraded flags arrive from one shared realtime connection; counts refresh on a 60s poll in the reference.
- Cap title at ~60 chars and description at ~80; never show more than ~20 items (aggregate instead).

---

## 5. Toasts

Mount once at the app root, after your routes:

```tsx
import { Toaster } from "sonner";

<Toaster richColors position="top-right" />
```

Wrapper API (`src/lib/toast.ts`) — all feedback goes through this, never Sonner directly:

```ts
import { toast as sonnerToast } from "sonner";

type ToastMessage = string | React.ReactNode;

function success(message: ToastMessage) {
  sonnerToast.success(message);
}

function error(message: ToastMessage) {
  sonnerToast.error(message);
}

function promise<T>(
  promise: Promise<T>,
  opts: {
    loading: ToastMessage;
    success: ToastMessage | ((data: T) => ToastMessage);
    error: ToastMessage | ((err: unknown) => ToastMessage);
  }
) {
  return sonnerToast.promise(promise, opts);
}

function info(message: ToastMessage) {
  sonnerToast.info(message);
}

function warning(message: ToastMessage) {
  sonnerToast.warning(message);
}

function dismiss(id?: string | number) {
  sonnerToast.dismiss(id);
}

export const toast = { success, error, promise, info, warning, dismiss };
```

Usage rules:

| Situation | Call |
|---|---|
| Mutation succeeded | `toast.success("Work order saved")` |
| Mutation failed | `toast.error(serverMessage || "Failed to save work order")` |
| Long async with phases | `toast.promise(fn(), { loading, success, error })` |
| Non-blocking notice | `toast.info("Settings changed elsewhere — reload to see them")` |
| Degraded state | `toast.warning("Offline — showing cached data")` |
| Destructive decision | **not a toast** — use `ConfirmDialog` |

Never toast on mount/load success; inline states (skeletons/empties) handle those.

---

## 6. Inline banners

### 6.1 Form-level banners

Error:
```
mb-4 p-3 rounded-xl bg-red-50 border border-red-100
inner: flex items-center gap-2.5
icon well: w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center flex-shrink-0
icon: AlertCircle w-4 h-4 text-red-600
text: text-sm font-bold text-red-700
enter: 220ms ease-out (opacity 0→1, scale 0.98→1)
```

Success:
```
mb-4 p-3 rounded-xl border flex items-center gap-2.5
container: bg-primary/10 border-primary/25
icon well: w-8 h-8 rounded-lg bg-primary/15
icon: CheckCircle w-4 h-4 text-primary
title: text-sm font-semibold text-primary
sub: text-xs text-muted-foreground (or slate-500)
enter: 220ms ease-out (opacity 0→1, scale 0.98→1)
```

### 6.2 Page-level status row

```
p-4 rounded-xl flex items-center gap-2 border-2
success:     bg-primary/5 border-primary/20 text-primary
destructive: bg-destructive/5 border-destructive/20 text-destructive
icon: w-4 h-4 shrink-0 (CheckCircle2 | AlertTriangle)
text: text-sm font-medium
dismiss: Button variant="ghost" size="sm" className="ml-auto h-7 text-xs"
```

For warning callouts inside modals use `AlertBanner` from `AI_HANDOFF_MODALS_DRAWERS.md` (§5).

---

## 7. Loading indicators

| Scope | Recipe |
|---|---|
| Inline (list loading text) | `flex items-center justify-center gap-2 py-24 text-muted-foreground text-sm` + `<Loader2 className="w-4 h-4 animate-spin" />` |
| Button busy | Spinner **before** label: `<Loader2 className="w-4 h-4 mr-2 animate-spin" />` + label change (“Saving…”) |
| Full-page gate (auth resolving) | centered 48px ring spinner, canonical: `w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin` + `text-muted-foreground font-medium` on the page background. (SMART legacy uses emerald/gray here — do not copy the raw palette.) |
| Table loading | Skeleton rows — see `AI_HANDOFF_TABLES.md` §5 |
| Overlay progress | Progress modal — see `AI_HANDOFF_MODALS_DRAWERS.md` §3 (icon tile + step list) |

---

## 8. Page error block

```tsx
import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PageErrorProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  icon?: ReactNode;
}

export function PageError({
  title = "Something went wrong",
  message,
  onRetry,
  retryLabel = "Try Again",
  icon,
}: PageErrorProps) {
  return (
    <div className="flex flex-col items-center justify-center h-64 text-center">
      <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mb-4">
        {icon ?? <AlertTriangle className="w-8 h-8 text-destructive" />}
      </div>
      <h2 className="text-xl font-semibold text-foreground mb-2">{title}</h2>
      <p className="text-muted-foreground mb-4">{message}</p>
      {onRetry && (
        <Button onClick={onRetry} variant="outline">
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
```

Place `PageError` as the whole page body when a page-level query fails; table-level failures use the in-table `ErrorState` instead.

---

## 9. Acceptance criteria

- [ ] Bell sits in the topbar right cluster as a 20px icon in an 8px-padded 12px-radius button; hover uses `accent`; press scales to 95%.
- [ ] Unread badge is a red 16px-min pill at top-right, shows `9+` over nine, disappears at zero; bell has an `aria-label` with the count.
- [ ] Panel is 320px, opens bottom-end with a 4px offset, `rounded-lg`, `bg-popover`, 1px 10% ring, `shadow-md`, no inner padding, 100ms fade/zoom motion.
- [ ] Header shows a 12px uppercase muted label and (when non-empty) an 11px primary “Dismiss all” link.
- [ ] Items show a 16px severity icon at the correct color, a 14px medium title, an optional 12px muted description; clicking dismisses and navigates.
- [ ] Empty state centers a 24px muted `CheckCircle2` and “You're all caught up”.
- [ ] Dismissals persist per portal+user across reloads; notification ids are stable per condition.
- [ ] Toaster is mounted once (`richColors`, top-right); all toasts route through the wrapper; failures surface server messages with a fallback.
- [ ] No toast is used for destructive confirmations; no native `alert()` remains.
- [ ] Error/success banners match the tinted recipes and animate in over 220ms; page status rows use 5%/20% primary or destructive tints with a 2px border.
- [ ] Inline spinning uses `Loader2` at 16px beside the message; the full-page gate is a 48px ring spinner in theme primary.
- [ ] `PageError` is a centered 256px-tall block with a 64px `destructive/10` circle, 20px semibold title, muted message, and an outline retry button.
