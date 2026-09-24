# AI Handoff — SMART Modals & Drawers Design for MRF

**How to use this document:** paste it into the MRF-side AI coding agent as the task brief. It is fully self-contained: the agent does not need access to the SMART repository. MRF supplies its own dialog content, forms, and data; the visual design (containers, headers, footers, body components, motion, overlay behavior) must match this spec exactly.

Companion docs:
- `AI_HANDOFF_SIDEBAR_TOPBAR.md` — app shell
- `AI_HANDOFF_TABLES.md` — data table system

---

## 0. Task brief for the agent

Implement two overlay systems for MRF:

1. **Modal system** — a base dialog primitive + a rich "app modal" composition (`AppModal`) with header icon tile, body building blocks, and a confirmation footer. Plus a `ConfirmDialog` wrapper for destructive/confirm flows.
2. **Drawer system** — right-side slide-over panels: a standard 440px sheet and a wide (up to 1100px) multi-tab "records vault" panel.

Use MRF's own content, labels, forms, and data. The source-of-truth code is embedded in §7–§9; keep the structure, class strings, and motion values.

Deliverables:
1. Dialog primitive (or adapter over MRF's existing one) matching §4.
2. `AppModal` + `InfoCard`, `StatTile`, `AlertBanner`, `StepCards`, `ModalSection` per §5/§8.
3. `ConfirmDialog` per §8.
4. `RightDrawer` (standard sheet) and a vault-style wide drawer per §6/§9.
5. Acceptance checklist in §10 verified.

Stack used by the reference: React + Tailwind CSS + `lucide-react`, dialog primitive from `@base-ui/react` wrapped shadcn-style. If MRF uses Radix, Headless UI, or a native `<dialog>`, keep the classes and behavior — only the primitive wiring changes.

---

## 1. Hard rules

### 1.1 KEEP (do not alter)
- Modals are **centered** with a full-screen overlay; drawers are **right-anchored** full-height panels.
- Standard dialog container: `rounded-xl` (16.8px in this theme), `bg-popover`, `ring-1 ring-foreground/10`, `padding: 16px`, `gap: 16px`, default max-width 384px, centered via translate.
- Overlay: `rgba(0,0,0,0.10)` for standard dialogs, `rgba(0,0,0,0.40)` for app modals and drawers; drawers blur the page, standard dialogs do not (app modals do not blur either).
- Open/close motion: standard dialog **100ms** fade + `zoom 95%`; app modal inherits it; drawer slides `translateX(100%) → 0` in **200ms** with the overlay fading in the same 200ms.
- Modal header pattern: **tinted square icon tile** (48px, 12px radius, white icon, `shadow-lg`) beside a 20–24px bold title and 14px muted description — this is the signature look.
- Modal footer: top border, right-aligned (reversed to primary-below on mobile), `Cancel` = outline, confirm = themed filled button, both fully rounded to 12px.
- Drawer header: title 18px bold `tracking-tight`, one-line 12px muted meta line, optional outline badge, ghost close button; body scrolls independently; header stays fixed.
- Escape closes overlays; clicking the overlay closes them (unless a task is in progress — see progress modal).
- Focus is trapped, background scroll is locked, and the overlay is portaled so it paints above the app shell.

### 1.2 REPLACE (MRF content)
- Titles, descriptions, icons, form fields, data lists, badge text, action labels.
- Data source and submit handlers.
- Whether a given flow is a modal or a drawer (use §3 to choose).

### 1.3 DO NOT
- Do not use native `window.confirm` / `alert`; all confirmations use `ConfirmDialog`.
- Do not put long multi-section content in the small standard dialog; use `AppModal` (sizes `lg`/`xl`) or a drawer.
- Do not stack two modals; stack a modal over a drawer only when required (see §2.1 z-index).
- Do not animate with spring/bounce, scale from a corner, or durations above 200ms.
- Do not add a colored header band; the icon tile carries the color.
- Do not use `rounded-lg` (12px) for the standard dialog container; it is 16.8px (`rounded-xl`), while app modals are 16.8px on mobile and 21.6px on desktop.

---

## 2. Tokens

| Token | Value |
|---|---|
| Standard dialog width | `calc(100% - 32px)` on mobile, `sm:max-w-sm` (384px) default; overrides `sm:max-w-lg` (512px), `max-w-2xl` (672px) |
| Standard dialog radius | 16.8px (`rounded-xl`), footer bottom corners match |
| Standard dialog padding | 16px all sides; footer bleeds to edges via `-mx-4 -mb-4` and re-pads 16px |
| Standard dialog header gap | 8px between title and description |
| Overlay (standard) | `rgba(0,0,0,0.10)` |
| Overlay (app modal / drawer) | `rgba(0,0,0,0.40)` |
| Standard dialog motion | 100ms; open `fade-in` + `zoom-in-95`; close `fade-out` + `zoom-out-95` |
| App modal padding | 16px mobile, 24px ≥640px, 32px ≥768px |
| App modal radius | 16.8px mobile, 21.6px ≥640px |
| App modal max height | `90vh` (scrolls internally) |
| App modal sizes | `sm` 448px · `md` 672px · `lg` 672→768px · `xl` 768→1024px (breakpoint-scaled) |
| Icon tile | 48px visual (icon 24px + 12px padding), radius 12px, `shadow-lg`, bg theme primary or `#dc2626` for destructive |
| App modal title | 20px mobile / 24px desktop, bold, `leading-tight` |
| App modal footer | 16px top padding, 16px top margin, 1px top border, 8px gap |
| Drawer (standard) | width 100%; `sm:max-w-[440px]`; full height; left border; `shadow-2xl` |
| Drawer (vault) | width 100%; `max-w-[1100px]`; full height; `shadow-2xl` |
| Drawer motion | 200ms `transform` + overlay `opacity` |
| Drawer header padding | 16px mobile / 24px ≥1024px sides; 16px top |
| Drawer body padding | 16px mobile, 24px desktop, `overflow-y: auto` |
| Z-index | topbar 30 · backdrop 40 · sidebar 50 · dialog 50 · vault drawer 60 · progress modal 100 |

### 2.1 Stacking and portals

- Render overlays in a **portal to `document.body`**; the app shell’s content wrapper creates a stacking context, so an in-tree overlay can never paint above the fixed sidebar.
- Vault drawer uses `z-[60]` because it may open from a page that already has dialogs at `z-50`.
- A modal opened **over** the vault drawer must render after it in the DOM (both portal to body) and use `z-50` with its own overlay.
- Add a `print-hide` class to overlay roots so forms/printing views are unaffected.

---

## 3. Choosing modal vs drawer

| Use a **standard dialog** when… | Use an **AppModal** when… | Use a **drawer** when… |
|---|---|---|
| Simple 1–3 field form | Rich multi-section content (info cards, stats, steps, banners) | Inspecting a record while keeping the list visible |
| Short confirmation | Destructive flow needing an icon, warning banner, and consequence details | Multi-tab detail view with independent scroll |
| Small read-only info | Size needs to grow to `lg`/`xl` | Content is tall (forms with many rows, previews, logs) |
| Max width ≤ 512px | Up to ~1024px | Width 440–1100px |

---

## 4. Standard dialog spec (base primitive)

Required class strings (Tailwind):

**Overlay**
```
fixed inset-0 isolate z-50 bg-black/10 duration-100
supports-backdrop-filter:backdrop-blur-xs
data-open:animate-in data-open:fade-in-0
data-closed:animate-out data-closed:fade-out-0
```

**Content**
```
fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2
gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground
ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-sm
data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95
data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95
```

**Header / Title / Description**
```
header:      flex flex-col gap-2
title:       text-base leading-none font-medium   (inherits DM Sans)
description: text-sm text-muted-foreground
```

**Footer**
```
-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end
```

**Close button** — ghost icon button (`size-7`, rounded 12px) absolutely at `top-2 right-2`; 16px `X` icon; `sr-only` “Close”.

**Production container recipes** (copy one per dialog):

| Intent | `DialogContent` override |
|---|---|
| Default small form | (none — `sm:max-w-sm`) |
| Comfortable form | `sm:max-w-lg` |
| Tall form / wizard | `max-w-2xl max-h-[90dvh] overflow-y-auto` |
| Large viewer (table/sections) | `sm:!max-w-4xl lg:!max-w-5xl max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden border-0 shadow-2xl bg-card rounded-xl sm:rounded-2xl` |
| Mobile-first editor | `rounded-[2rem] border-0 shadow-2xl p-0 overflow-hidden max-w-md bg-white` |

---

## 5. App modal system (signature rich modal)

**Sizes**

```
sm: sm:!max-w-md
md: sm:!max-w-2xl
lg: sm:!max-w-2xl md:!max-w-3xl
xl: sm:!max-w-3xl md:!max-w-4xl lg:!max-w-5xl
```

**Content container**

```
<SIZE> max-h-[90vh] overflow-y-auto overflow-x-hidden p-4 sm:p-6 md:p-8
border-0 shadow-2xl bg-card rounded-xl sm:rounded-2xl gap-0
```

**Header** — `padding-bottom: 16px` (20px ≥640px):

```
row:   flex items-start gap-3 sm:gap-4
tile:  p-3 rounded-xl text-white shadow-lg shrink-0
       bg = #dc2626 (destructive) | theme primary (colors.primary)
title: text-xl sm:text-2xl font-bold text-foreground leading-tight
desc:  mt-1 text-sm text-muted-foreground
```

**Footer** — the confirm button carries the intent:

```
wrapper:  flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-4 mt-4 border-t border-border
cancel:   Button variant="outline" className="rounded-xl"
confirm:  Button className="rounded-xl" (inline style bg = #dc2626 | theme primary, white text)
icon:     Loader2 w-4 h-4 mr-2 animate-spin (loading) | CheckCircle2 w-4 h-4 mr-2 (idle)
```

**Body building blocks** (use these to compose modal content):

| Component | Design |
|---|---|
| `InfoCard` | 16px padding, 12px radius, `shadow-sm`, background = tone color at ~4% alpha; label 10px bold uppercase `tracking-wider` in tone color; body 14px |
| `StatTile` | 12px radius, 2px border in tone at ~19% alpha, background tone at ~3% alpha, padding 10–12px; icon + 10–11px semibold uppercase label in tone color; value 20–24px bold `tabular-nums`; optional 10–12px muted hint |
| `AlertBanner` | 12px radius, 2px border, 16px/12px padding; icon 20px; optional 14px bold title; body 12px `leading-relaxed`; variants: danger (`red-50/red-200/red-700`), warning (`amber-50/amber-200/amber-700`), info (`blue-50/blue-200/blue-700`) |
| `StepCards` | 1→3 column grid, 12px gap; each card 12px radius, 2px tinted border, tone at ~3% alpha, 12px padding; numbered circle 24px in tone color, white 12px bold; title 14px semibold; optional 12px muted hint |
| `ModalSection` | `bg-background border-2 border-border rounded-xl overflow-hidden`; header row 16px/12px padding with 2px bottom border; title 14–16px bold; optional trailing badge; children edge-to-edge (usable for small tables/lists) |

**Tones** — `primary` = theme primary; `secondary` and `accent` = theme secondary/accent from branding. Alpha suffixes used: `0A` (≈4%) for InfoCard, `08`/`30` (≈3%/19%) for StatTile and StepCards.

---

## 6. Drawer spec

### 6.1 Standard sheet (`RightDrawer`, 440px)

```
root:    fixed inset-0 z-50 print-hide  (+ pointer-events-none when closed, aria-hidden)
overlay: absolute inset-0 bg-black/40 transition-opacity duration-200  (opacity 0→100)
panel:   absolute inset-y-0 right-0 w-full sm:max-w-[440px] bg-background
         border-l border-border shadow-2xl flex flex-col
         transition-transform duration-200  (translate-x-full → translate-x-0)
```

Use for: reference panels, inspectors, quick forms, previews.

### 6.2 Wide vault drawer (up to 1100px, multi-tab)

```
root:    fixed inset-0 z-[60] flex justify-end print-hide  (portaled to body)
         role="dialog" aria-modal="true" aria-label="…"
overlay: absolute inset-0 bg-black/40  (click closes)
panel:   relative h-full w-full max-w-[1100px] bg-background shadow-2xl flex flex-col
         animate-in slide-in-from-right-2 duration-200
header:  px-4 lg:px-6 pt-4 pb-0 border-b border-border
         title: text-lg font-bold tracking-tight text-foreground truncate
         meta:  text-xs text-muted-foreground truncate
         right: Badge variant="outline" className="text-[11px] font-medium"
                close: p-2 rounded-lg text-muted-foreground hover:bg-muted transition-colors
tabs:    nav flex items-center gap-1 mt-3 -mb-px overflow-x-auto
         tab:  flex items-center gap-1.5 px-3 h-9 rounded-t-lg text-xs font-medium border-b-2
               active:   border-primary text-foreground
               inactive: border-transparent text-muted-foreground hover:text-foreground
         count: px-1.5 py-0.5 text-[10px] rounded-full font-semibold bg-muted text-muted-foreground tabular-nums
body:    flex-1 overflow-y-auto p-4 lg:p-6
loading: centered Loader2 w-4 h-4 animate-spin + 14px muted text, py-24
```

Behavior: `Escape` closes; header stays fixed while only the body scrolls; tab content is MRF’s own. For content heavier than a few panels, split each tab into its own component file (SMART keeps `records/` tab modules).

---

## 7. Reference code — dialog + AppModal

`src/components/ui/dialog.tsx` (primitive; adapt to MRF’s UI library, keep classes):

```tsx
import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & { showCloseButton?: boolean }) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={<Button variant="ghost" className="absolute top-2 right-2" size="icon-sm" />}
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="dialog-header" className={cn("flex flex-col gap-2", className)} {...props} />
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & { showCloseButton?: boolean }) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>Close</DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("font-heading text-base leading-none font-medium", className)}
      {...props}
    />
  )
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground", className)}
      {...props}
    />
  )
}

export {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogOverlay, DialogPortal, DialogTitle, DialogTrigger,
}
```

`src/components/app-modal/index.tsx` (composition layer):

```tsx
import type { ReactNode } from "react";
import { memo } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/contexts/ThemeContext";

export type ModalTone = "primary" | "secondary" | "accent";
export type ModalSize = "sm" | "md" | "lg" | "xl";
export type AlertVariant = "danger" | "warning" | "info";

const SIZE_CLASSES: Record<ModalSize, string> = {
  sm: "sm:!max-w-md",
  md: "sm:!max-w-2xl",
  lg: "sm:!max-w-2xl md:!max-w-3xl",
  xl: "sm:!max-w-3xl md:!max-w-4xl lg:!max-w-5xl",
};

const ALERT_CONFIG: Record<AlertVariant, { bg: string; border: string; text: string; iconBg: string; icon: typeof AlertTriangle }> = {
  danger: { bg: "bg-red-50", border: "border-red-200", text: "text-red-700", iconBg: "text-red-600", icon: AlertTriangle },
  warning: { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", iconBg: "text-amber-600", icon: AlertTriangle },
  info: { bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-700", iconBg: "text-blue-600", icon: Info },
};

export interface AppModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  icon: ReactNode;
  title: string;
  description?: ReactNode;
  size?: ModalSize;
  confirmLabel?: string;
  onConfirm?: () => void;
  confirmDisabled?: boolean;
  destructive?: boolean;
  loading?: boolean;
  hideFooter?: boolean;
  children?: ReactNode;
}

export function AppModal({
  open,
  onOpenChange,
  icon,
  title,
  description,
  size = "md",
  confirmLabel = "Confirm",
  onConfirm,
  confirmDisabled = false,
  destructive = false,
  loading = false,
  hideFooter = false,
  children,
}: AppModalProps) {
  const { colors } = useTheme();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={`${SIZE_CLASSES[size]} max-h-[90vh] overflow-y-auto overflow-x-hidden p-4 sm:p-6 md:p-8 border-0 shadow-2xl bg-card rounded-xl sm:rounded-2xl gap-0`}
      >
        <div className="pb-4 sm:pb-5">
          <div className="flex items-start gap-3 sm:gap-4">
            <div
              className="p-3 rounded-xl text-white shadow-lg shrink-0"
              style={{ backgroundColor: destructive ? "#dc2626" : colors.primary }}
            >
              {icon}
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-xl sm:text-2xl font-bold text-foreground leading-tight">
                {title}
              </DialogTitle>
              {description && (
                <DialogDescription className="mt-1 text-sm text-muted-foreground">
                  {description}
                </DialogDescription>
              )}
            </div>
          </div>
        </div>

        {children}

        {!hideFooter && (
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-4 mt-4 border-t border-border">
            <Button variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)} disabled={loading}>
              Cancel
            </Button>
            <Button
              className="rounded-xl"
              style={
                destructive
                  ? { backgroundColor: "#dc2626", color: "white" }
                  : { backgroundColor: colors.primary, color: "white" }
              }
              disabled={loading || confirmDisabled}
              onClick={() => onConfirm?.()}
            >
              {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
              {confirmLabel}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export const InfoCard = memo(function InfoCard({
  tone = "primary",
  label,
  children,
}: {
  tone?: ModalTone;
  label: string;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  const color = colors[tone];
  return (
    <div className="p-4 rounded-xl min-w-0 shadow-sm" style={{ backgroundColor: `${color}0A` }}>
      <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color }}>
        {label}
      </p>
      {children}
    </div>
  );
});

export const StatTile = memo(function StatTile({
  tone = "secondary",
  icon,
  label,
  value,
  hint,
}: {
  tone?: ModalTone;
  icon: ReactNode;
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  const { colors } = useTheme();
  const color = colors[tone];
  return (
    <div
      className="rounded-xl border-2 px-3 sm:px-4 py-2.5 sm:py-3 overflow-hidden"
      style={{ backgroundColor: `${color}08`, borderColor: `${color}30` }}
    >
      <div className="flex items-center gap-1.5 mb-1" style={{ color }}>
        {icon}
        <span className="text-[10px] sm:text-[11px] font-semibold uppercase">{label}</span>
      </div>
      <p className="text-xl sm:text-2xl font-bold text-foreground tabular-nums leading-none">{value}</p>
      {hint && <p className="text-[10px] sm:text-xs text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
});

export const AlertBanner = memo(function AlertBanner({
  variant = "warning",
  title,
  children,
}: {
  variant?: AlertVariant;
  title?: string;
  children?: ReactNode;
}) {
  const config = ALERT_CONFIG[variant];
  const Icon = config.icon;
  return (
    <div className={`flex items-start gap-3 rounded-xl border-2 ${config.bg} ${config.border} ${config.text} px-4 py-3`}>
      <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${config.iconBg}`} />
      <div className="min-w-0">
        {title && <h4 className={`text-sm font-bold ${config.text}`}>{title}</h4>}
        <div className="text-xs leading-relaxed">{children}</div>
      </div>
    </div>
  );
});

export const StepCards = memo(function StepCards({
  steps,
  tones = ["primary", "secondary", "accent"],
}: {
  steps: { title: string; hint?: string }[];
  tones?: ModalTone[];
}) {
  const { colors } = useTheme();
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {steps.map((step, i) => {
        const color = colors[tones[i % tones.length]];
        return (
          <div
            key={step.title}
            className="p-3 rounded-xl border-2"
            style={{ backgroundColor: `${color}08`, borderColor: `${color}30` }}
          >
            <span
              className="inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold text-white mb-2"
              style={{ backgroundColor: color }}
            >
              {i + 1}
            </span>
            <p className="text-sm font-semibold text-foreground leading-snug">{step.title}</p>
            {step.hint && <p className="text-xs text-muted-foreground mt-1">{step.hint}</p>}
          </div>
        );
      })}
    </div>
  );
});

export const ModalSection = memo(function ModalSection({
  title,
  badge,
  children,
}: {
  title?: ReactNode;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="bg-background border-2 border-border rounded-xl overflow-hidden">
      {(title || badge) && (
        <div className="px-4 py-3 border-b-2 border-border flex items-center justify-between gap-2">
          {title && <p className="font-bold text-foreground text-sm sm:text-base">{title}</p>}
          {badge}
        </div>
      )}
      {children}
    </div>
  );
});
```

Notes:
- `colors.primary/secondary/accent` come from MRF branding; expose the equivalents as `--theme-primary`, `--theme-secondary`, `--theme-accent` and read them once per component.
- Tinted alpha suffixes: `0A` ≈ 4%, `08` ≈ 3%, `30` ≈ 19%. If MRF stores colors as hex, appending a 2-digit hex alpha works; if RGB, use `rgba(color, α)`.

---

## 8. Reference code — ConfirmDialog

```tsx
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { AppModal } from "@/components/app-modal";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  onConfirm: () => void;
  destructive?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  children?: ReactNode;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  onConfirm,
  destructive = false,
  loading = false,
  icon,
  children,
}: ConfirmDialogProps) {
  return (
    <AppModal
      open={open}
      onOpenChange={onOpenChange}
      icon={icon ?? (destructive ? <AlertTriangle className="w-6 h-6" /> : <CheckCircle2 className="w-6 h-6" />)}
      title={title}
      description={description}
      size="sm"
      confirmLabel={confirmLabel}
      onConfirm={onConfirm}
      destructive={destructive}
      loading={loading}
    >
      {children}
    </AppModal>
  );
}
```

---

## 9. Reference code — drawers

Standard sheet:

```tsx
function RightDrawer({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={`fixed inset-0 z-50 print-hide ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
      <div
        className={`absolute inset-0 bg-black/40 transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0"}`}
        onClick={onClose}
      />
      <div
        className={`absolute inset-y-0 right-0 w-full sm:max-w-[440px] bg-background border-l border-border shadow-2xl flex flex-col transition-transform duration-200 ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        {children}
      </div>
    </div>
  );
}
```

Vault drawer (structure; MRF supplies tabs/content):

```tsx
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Loader2, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface VaultTab { key: string; label: string; icon: LucideIcon }

export function RecordDrawer({
  open,
  onClose,
  title,
  meta,
  statusLabel,
  tabs,
  activeTab,
  onTabChange,
  loading,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  meta: string;
  statusLabel?: string;
  tabs: VaultTab[];
  activeTab: string;
  onTabChange: (key: string) => void;
  loading?: boolean;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex justify-end print-hide"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />

      <div className="relative h-full w-full max-w-[1100px] bg-background shadow-2xl flex flex-col animate-in slide-in-from-right-2 duration-200">
        <header className="px-4 lg:px-6 pt-4 pb-0 border-b border-border">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-bold tracking-tight text-foreground truncate">{title}</h2>
              <p className="text-xs text-muted-foreground truncate">{meta}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {statusLabel && (
                <Badge variant="outline" className="text-[11px] font-medium">
                  {statusLabel}
                </Badge>
              )}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="p-2 rounded-lg text-muted-foreground hover:bg-muted transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <nav className="flex items-center gap-1 mt-3 -mb-px overflow-x-auto" aria-label="Sections">
            {tabs.map(({ key, label, icon: Icon }) => {
              const isActive = activeTab === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onTabChange(key)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 h-9 rounded-t-lg text-xs font-medium whitespace-nowrap border-b-2 transition-colors",
                    isActive
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </button>
              );
            })}
          </nav>
        </header>

        <div className="flex-1 overflow-y-auto p-4 lg:p-6">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-24 text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading…
            </div>
          ) : (
            children
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
```

---

## 10. Acceptance criteria

- [ ] Standard dialog: centered, 384px default (mobile: viewport minus 32px), 16.8px radius, `bg-popover`, `ring-1 ring-foreground/10`, 16px padding, footer bleeding to edges with a tinted 50%-muted background and top border.
- [ ] Standard dialog motion: 100ms fade + zoom from 95%; overlay `rgba(0,0,0,0.10)` with backdrop blur where supported; close button is a ghost icon button at top-right with an accessible label.
- [ ] App modal: icon tile 48px, 12px radius, white icon, `shadow-lg`, theme primary (or `#dc2626` destructive); title 20/24px bold; description 14px muted.
- [ ] App modal padding 16/24/32px across breakpoints; radius 16.8px mobile, 21.6px ≥640px; max height 90vh with internal scroll; size variants reach the specified max widths.
- [ ] App modal footer: 16px gap above a 1px top border; Cancel outline, confirm filled with a leading icon spinner when loading; on mobile the confirm stacks above Cancel (column-reverse).
- [ ] Body blocks match: InfoCard ~4% tint with 10px tone label; StatTile 2px tone border/pale fill with `tabular-nums` value; AlertBanner 2px red/amber/blue border pair; StepCards 24px numbered circles; ModalSection 2px border with edge-to-edge children.
- [ ] ConfirmDialog renders `AlertTriangle` + red confirm for destructive, `CheckCircle2` + primary for normal, size `sm`.
- [ ] Drawer: overlay `rgba(0,0,0,0.40)` fades in 200ms; panel slides from the right in 200ms; standard sheet max 440px with left border and `shadow-2xl`; vault panel max 1100px.
- [ ] Vault header: 18px bold truncated title, 12px muted meta line, optional outline badge, ghost close; tab strip with 36px tabs, 2px active bottom border in primary, inactive transparent border, horizontal scroll on overflow.
- [ ] Drawer body scrolls independently; header and tabs stay fixed; Escape closes; overlay click closes; `role="dialog"` + `aria-modal` set; content portaled to body with correct z-index.
- [ ] No native `confirm`/`alert` remains for user-facing confirmations; no modal wider than 512px without an explicit size prop; no animation over 200ms.

---

## 11. Appendix — motion & portability

Motion summary:

| Element | Open | Close |
|---|---|---|
| Standard dialog | overlay fade + panel fade/zoom-95, 100ms | reverse, 100ms |
| App modal | same as standard (inherits) | same |
| Drawer overlay | opacity 0→1, 200ms | opacity 1→0, 200ms |
| Drawer panel | `translateX(100%)→0`, 200ms | `translateX(0)→100%`, 200ms |
| Vault drawer panel | `translateX(16px)→0` + fade (slide-in-from-right-2), 200ms | unmount |

For non-Tailwind stacks, translate classes as:

| Class | Value |
|---|---|
| `rounded-xl` (theme) | 16.8px |
| `rounded-2xl` (theme) | 21.6px (or 24px if using default scale) |
| `rounded-[2rem]` | 32px |
| `sm:max-w-sm/md/lg/xl/2xl/3xl/4xl/5xl` | 384 / 448 / 512 / 576 / 672 / 768 / 896 / 1024 px |
| `p-4 / sm:p-6 / md:p-8` | 16 / 24 / 32 px |
| `max-h-[90vh]`, `max-h-[90dvh]`, `max-h-[85vh]` | viewport-relative caps |
| `ring-1 ring-foreground/10` | `box-shadow: 0 0 0 1px rgb(from currentColor r g b / 0.10)` (or 1px border at 10% foreground) |
| `shadow-2xl` | `0 25px 50px -12px rgb(0 0 0 / 0.25)` |
| `bg-muted/50` | muted color at 50% alpha |
| `animate-in zoom-in-95` | `transform: scale(0.95) → scale(1)` with opacity 0→1 |
