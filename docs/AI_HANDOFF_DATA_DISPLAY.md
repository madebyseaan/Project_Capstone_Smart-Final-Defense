# AI Handoff — SMART Data Display & Menus for MRF

**How to use this document:** paste it into the MRF-side AI coding agent as the task brief. It is fully self-contained: the agent does not need access to the SMART repository. MRF supplies its own content and data; the visual design of cards, stat tiles, badges, avatars, tabs, dropdown menus, separators and scroll areas must match this spec.

Companion docs: `AI_HANDOFF_SIDEBAR_TOPBAR.md` · `AI_HANDOFF_TABLES.md` · `AI_HANDOFF_MODALS_DRAWERS.md` · `AI_HANDOFF_NOTIFICATIONS_FEEDBACK.md` · `AI_HANDOFF_FORMS_CONTROLS.md` · `AI_HANDOFF_PAGES_BRANDING.md`

---

## 0. Task brief for the agent

Implement MRF's data-display and menu primitives: the `Card` family, `StatCard` with count-up, `Badge`, `Avatar`, `Tabs`, `DropdownMenu`, `Separator`, and `ScrollArea`. Use MRF's own content; keep every class string and behavior.

Reference stack: React + Tailwind + `class-variance-authority` + `lucide-react` + `@base-ui/react` primitives wrapped shadcn-style. Radix/native equivalents are fine.

---

## 1. Hard rules

### 1.1 KEEP (do not alter)
- Cards: `rounded-xl` (16.8px in this theme), 1px `border`, layered soft shadow, `py-0 gap-0`, content padding 24px/20px (`px-6 py-5`).
- Card headers, when present, sit on a `muted/50` band with a 1px bottom border and 24px/16px padding.
- Stat tiles: borderless `shadow-lg` cards with 16px padding, 12px muted label, 24px bold value, optional 32px muted icon tile on the right, optional bottom-bordered trend row.
- Stat numbers animate with a **800ms ease-out cubic count-up** and respect `prefers-reduced-motion`.
- Badges are 20px pills (`rounded-4xl`), 12px medium, with 6px radius variants for chips; destructive/outline/ghost variants as specified.
- Avatars are circular, 32px default (24px small, 40px large), with a 1px `border` inner ring and muted fallback.
- Tabs: 32px list in a `muted` track with 3px padding, active tab raised on `bg-background` with `shadow-sm`; a `line` variant exists for underline tabs.
- Dropdown menus: 4px-padded popover, 6px-radius items with 6px vertical padding, `accent` highlight on focus, destructive items in red tint, 8px slide + 100ms fade/zoom.
- Separators are 1px `border`; scroll areas use a 10px track with a `border`-colored rounded thumb.

### 1.2 REPLACE (MRF content)
- Card titles/descriptions, stat labels/values/icons, tab labels, menu items, avatar sources.

### 1.3 DO NOT
- Do not use colored left borders or colored header bands on cards.
- Do not use `font-black` or `font-light`.
- Do not animate values above 800ms or with bounce/spring easing.
- Do not use icon-only buttons without `aria-label`.
- Do not mix the `default` and `line` tab variants within one tab group.

---

## 2. Tokens

| Element | Value |
|---|---|
| Card radius | 16.8px (`rounded-xl`) |
| Card shadow | `0 2px 8px -3px rgb(0 0 0 / 0.06), 0 10px 22px -6px rgb(0 0 0 / 0.04)` |
| Card content padding | 24px horizontal, 20px vertical (small size: 16px/12px) |
| Card header band | `muted/50`, 1px bottom border, 24px/16px padding |
| Card title | 16px semibold `tracking-tight` |
| Card description | 12px medium `tracking-wide` uppercase muted |
| Card footer | top border, `muted/50`, 16px padding |
| Stat tile | 12px radius, 16px padding, `shadow-lg` in muted tint |
| Stat label | 12px medium muted |
| Stat value | 24px bold foreground |
| Stat icon tile | 32px visual, 8px radius, `bg-muted` |
| Stat trend row | 8px top margin, 8px top padding, 1px top border, 12px medium |
| Badge | height 20px, radius 9999px (`rounded-4xl`), padding 8px/2px, 12px medium, icon 12px |
| Avatar | 32px default / 24px sm / 40px lg, round, 1px `border` inner ring |
| Tabs list | 32px tall, radius 12px, `muted` track, 3px padding |
| Tab trigger | 100% list height minus 1px, radius 6px, 14px medium, 60% foreground at rest |
| Menu content | 4px padding, 12px radius, `bg-popover`, 1px 10% ring, `shadow-md` |
| Menu item | 4px/6px padding, 6px radius, 14px, `focus:bg-accent` |
| Separator | 1px `border` |
| Scrollbar | 10px track, `bg-border` rounded thumb, 1px transparent border |

Motion: menus 100ms; tabs/colors 150ms; count-up 800ms cubic ease-out.

---

## 3. Card family

Base card classes:

```
group/card flex flex-col overflow-hidden rounded-xl bg-card text-sm text-card-foreground
border border-border
shadow-[0_2px_8px_-3px_rgba(0,0,0,0.06),0_10px_22px_-6px_rgba(0,0,0,0.04)]
transition-shadow duration-200 py-0 gap-0
```

Card header: `grid auto-rows-min items-start gap-1 rounded-t-xl px-6 py-4 bg-muted/50 border-b border-border`
Card title: `text-base leading-snug font-semibold tracking-tight text-foreground`
Card description: `text-xs tracking-wide font-medium text-muted-foreground uppercase`
Card content: `px-6 py-5` (small: `px-4 py-3`)
Card footer: `flex items-center rounded-b-xl border-t bg-muted/50 p-4`
Card action: `col-start-2 row-span-2 row-start-1 self-start justify-self-end`

Note: DataTable and StatCard intentionally override the base card with `p-0` and their own padding/edges (see the tables doc).

```tsx
import * as React from "react"
import { cn } from "@/lib/utils"

function Card({ className, size = "default", ...props }: React.ComponentProps<"div"> & { size?: "default" | "sm" }) {
  return (
    <div
      data-slot="card"
      data-size={size}
      className={cn(
        "group/card flex flex-col overflow-hidden rounded-xl bg-card text-sm text-card-foreground",
        "border border-border",
        "shadow-[0_2px_8px_-3px_rgba(0,0,0,0.06),0_10px_22px_-6px_rgba(0,0,0,0.04)]",
        "transition-shadow duration-200",
        "py-0 gap-0",
        "has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0",
        "data-[size=sm]:gap-0 data-[size=sm]:py-0",
        "*:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "group/card-header @container/card-header",
        "grid auto-rows-min items-start gap-1",
        "rounded-t-xl px-6 py-4",
        "bg-muted/50",
        "border-b border-border",
        "has-data-[slot=card-action]:grid-cols-[1fr_auto]",
        "has-data-[slot=card-description]:grid-rows-[auto_auto]",
        "group-data-[size=sm]/card:px-4 group-data-[size=sm]/card:py-3",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("font-sans text-base leading-snug font-semibold tracking-tight text-foreground", "group-data-[size=sm]/card:text-sm", className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("font-sans text-xs tracking-wide font-medium text-muted-foreground uppercase", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="card-action" className={cn("col-start-2 row-span-2 row-start-1 self-start justify-self-end", className)} {...props} />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-6 py-5", "group-data-[size=sm]/card:px-4 group-data-[size=sm]/card:py-3", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center rounded-b-xl border-t bg-muted/50 p-4 group-data-[size=sm]/card:p-3", className)}
      {...props}
    />
  )
}

export { Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent }
```

---

## 4. StatCard + count-up

```tsx
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { useCountUp } from "@/hooks/useCountUp";

interface StatCardProps {
  label: string;
  value: ReactNode;
  numericValue?: number;
  icon?: ReactNode;
  iconClassName?: string;
  trend?: {
    value: string;
    direction: "up" | "down" | "neutral";
    hint?: string;
  };
  className?: string;
}

export function StatCard({ label, value, numericValue, icon, iconClassName, trend, className }: StatCardProps) {
  const animated = useCountUp(numericValue ?? 0, 800, numericValue !== undefined);

  const displayValue = numericValue !== undefined ? animated.toLocaleString() : value;

  return (
    <Card className={cn("border-0 shadow-lg shadow-muted/50 rounded-xl bg-card p-0", className)}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold text-foreground">{displayValue}</p>
          </div>
          {icon && (
            <div className={cn("p-2 rounded-lg bg-muted", iconClassName)}>
              {icon}
            </div>
          )}
        </div>
        {trend && (
          <div className="mt-2 pt-2 border-t border-border">
            <span
              className={cn(
                "inline-flex items-center text-xs font-medium",
                trend.direction === "up" && "text-emerald-600",
                trend.direction === "down" && "text-red-600",
                trend.direction === "neutral" && "text-muted-foreground"
              )}
            >
              {trend.value}
            </span>
            {trend.hint && <span className="text-xs text-muted-foreground ml-1">{trend.hint}</span>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

Count-up hook (800ms cubic ease-out, reduced-motion aware):

```tsx
import { useEffect, useRef, useState } from "react";

export function useCountUp(target: number, duration = 800, enabled = true): number {
  const [value, setValue] = useState(enabled ? 0 : target);
  const rafRef = useRef<number>(0);
  const startRef = useRef<number>(0);
  const prefersReduced =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    if (!enabled) {
      setValue(target);
      return;
    }

    if (prefersReduced || target === 0) {
      setValue(target);
      return;
    }

    setValue(0);
    startRef.current = performance.now();

    function tick(now: number) {
      const elapsed = now - startRef.current;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(eased * target));

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration, enabled, prefersReduced]);

  return value;
}
```

Stat grid layout: `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4` (2/3/4-up depending on count); icon tiles get a tone via `iconClassName`, e.g. `bg-primary/10 text-primary`.

---

## 5. Badge

Variants: `default` (primary fill), `secondary` (muted fill), `destructive` (10% red fill + red text), `outline` (border + foreground, hover muted), `ghost` (hover muted), `link` (primary underlined).

Base: `inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all [&>svg]:size-3!`

Table status usage: `variant="outline"` + `text-[11px] font-medium px-2 py-0.5 rounded-full` + a tinted tone class (see tables doc §4).

```tsx
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        secondary: "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        destructive: "bg-destructive/10 text-destructive [a]:hover:bg-destructive/20",
        outline: "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        ghost: "hover:bg-muted hover:text-muted-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
    },
    defaultVariants: { variant: "default" },
  }
)

function Badge({ className, variant = "default", render, ...props }: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">({ className: cn(badgeVariants({ variant }), className) }, props),
    render,
    state: { slot: "badge", variant },
  })
}

export { Badge, badgeVariants }
```

---

## 6. Avatar

Sizes: `sm` 24px, `default` 32px, `lg` 40px. Round, `select-none`, inner 1px `border` overlay (darken blend in light mode). Fallback: centered, `bg-muted`, 14px muted (12px when small). Optional status `AvatarBadge` 8–12px dot bottom-right with a 2px background ring. `AvatarGroup` overlaps avatars by 8px and adds a 2px ring per avatar.

```tsx
import * as React from "react"
import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar"
import { cn } from "@/lib/utils"

function Avatar({ className, size = "default", ...props }: AvatarPrimitive.Root.Props & { size?: "default" | "sm" | "lg" }) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      data-size={size}
      className={cn(
        "group/avatar relative flex size-8 shrink-0 rounded-full select-none after:absolute after:inset-0 after:rounded-full after:border after:border-border after:mix-blend-darken data-[size=lg]:size-10 data-[size=sm]:size-6",
        className
      )}
      {...props}
    />
  )
}

function AvatarImage({ className, ...props }: AvatarPrimitive.Image.Props) {
  return <AvatarPrimitive.Image data-slot="avatar-image" className={cn("aspect-square size-full rounded-full object-cover", className)} {...props} />
}

function AvatarFallback({ className, ...props }: AvatarPrimitive.Fallback.Props) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn("flex size-full items-center justify-center rounded-full bg-muted text-sm text-muted-foreground group-data-[size=sm]/avatar:text-xs", className)}
      {...props}
    />
  )
}

function AvatarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="avatar-group"
      className={cn("group/avatar-group flex -space-x-2 *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:ring-background", className)}
      {...props}
    />
  )
}

export { Avatar, AvatarImage, AvatarFallback, AvatarGroup }
```

App-shell usage: initial-based fallback, 36px, `ring-2 ring-slate-100 ring-offset-2` (see shell doc). Table usage: 32px avatar cells use the `avatar` skeleton hint.

---

## 7. Tabs

Two variants:
- `default` — `muted` track, 32px tall, 3px padding, active tab on `bg-background` with `shadow-sm`.
- `line` — transparent track with a 2px foreground underline that fades in on the active tab (used for underline navigation).

```
list:    inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground
         h-8 (horizontal); bg-muted (default) | gap-1 bg-transparent rounded-none (line)
trigger: relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5
         rounded-md border border-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap
         text-foreground/60 transition-all hover:text-foreground
         active: bg-background text-foreground shadow-sm
         focus-visible: border-ring + 3px ring at 50%
         line active: underline bar 2px foreground, opacity 0→100
content: flex-1 text-sm outline-none
```

```tsx
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

function Tabs({ className, orientation = "horizontal", ...props }: TabsPrimitive.Root.Props) {
  return <TabsPrimitive.Root data-slot="tabs" data-orientation={orientation} className={cn("group/tabs flex gap-2 data-horizontal:flex-col", className)} {...props} />
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-horizontal/tabs:h-8 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent",
      },
    },
    defaultVariants: { variant: "default" },
  }
)

function TabsList({ className, variant = "default", ...props }: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return <TabsPrimitive.List data-slot="tabs-list" data-variant={variant} className={cn(tabsListVariants({ variant }), className)} {...props} />
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap text-foreground/60 transition-all group-data-[variant=line]/tabs-list:flex-none hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
        "data-active:bg-background data-active:text-foreground",
        "after:absolute after:bg-foreground after:opacity-0 after:transition-opacity group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:bottom-[-5px] group-data-horizontal/tabs:after:h-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return <TabsPrimitive.Panel data-slot="tabs-content" className={cn("flex-1 text-sm outline-none", className)} {...props} />
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
```

Note: the vault drawer uses a custom underline tab strip (36px tall, `rounded-t-lg`, 2px active bottom border in primary) — see the modals/drawers doc; do not substitute the Tabs primitive there unless the geometry is preserved.

---

## 8. Dropdown menu

Required classes:

```
content:   z-50 max-h-(--available-height) w-(--anchor-width) min-w-32 rounded-lg bg-popover p-1
           text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 outline-none
           slide-in-from-* 8px per side; open fade+zoom-95; close fade+zoom-95
label:     px-1.5 py-1 text-xs font-medium text-muted-foreground
item:      relative flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm
           outline-hidden select-none focus:bg-accent focus:text-accent-foreground
           disabled:pointer-events-none disabled:opacity-50
destructive item: text-destructive, focus:bg-destructive/10 focus:text-destructive
checkbox/radio item: as item + pr-8, indicator CheckIcon absolute right-2
separator: -mx-1 my-1 h-px bg-border
shortcut:  ml-auto text-xs tracking-widest text-muted-foreground
sub-trigger: as item + ml-auto ChevronRight 16px
```

The notification panel (see notifications doc) uses `DropdownMenuContent align="end" className="w-80 p-0"` with `items-start gap-2.5 px-3 py-2.5` items.

---

## 9. Separator & ScrollArea

Separator: `shrink-0 bg-border` + `h-px w-full` (horizontal) or `w-px self-stretch` (vertical). Use for section breaks inside card bodies and menus; never as a decorative border (cards already have borders).

ScrollArea: relative root, viewport `size-full rounded-[inherit]`, vertical bar 10px wide with a transparent 1px left border, thumb `flex-1 rounded-full bg-border`; horizontal bar is 10px tall. The sidebar uses the lighter `custom-scrollbar` (4px, `#e2e8f0` thumb) instead — see the shell doc.

```tsx
import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area"
import { cn } from "@/lib/utils"

function ScrollArea({ className, children, ...props }: ScrollAreaPrimitive.Root.Props) {
  return (
    <ScrollAreaPrimitive.Root data-slot="scroll-area" className={cn("relative", className)} {...props}>
      <ScrollAreaPrimitive.Viewport data-slot="scroll-area-viewport" className="size-full rounded-[inherit] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

function ScrollBar({ className, orientation = "vertical", ...props }: ScrollAreaPrimitive.Scrollbar.Props) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        "flex touch-none p-px transition-colors select-none data-horizontal:h-2.5 data-horizontal:flex-col data-vertical:h-full data-vertical:w-2.5",
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb data-slot="scroll-area-thumb" className="relative flex-1 rounded-full bg-border" />
    </ScrollAreaPrimitive.Scrollbar>
  )
}

export { ScrollArea, ScrollBar }
```

---

## 10. Acceptance criteria

- [ ] Cards use the 16.8px radius, 1px border, layered soft shadow, zero vertical padding; content is 24px/20px padded; headers sit on a `muted/50` band with a 1px bottom border.
- [ ] Stat cards are borderless with `shadow-lg` in a muted tint, 16px padding, 12px muted label above a 24px bold value, optional 32px muted icon tile, optional top-bordered trend row with emerald/red/neutral tones.
- [ ] Numeric stats count up over 800ms with cubic ease-out and skip animation under `prefers-reduced-motion`.
- [ ] Badges are 20px pills at 12px medium with 12px icons; destructive uses 10% red fill; outline adds a border.
- [ ] Avatars are circular with a 1px inner border ring; fallbacks are muted with the correct size-based font; groups overlap by 8px.
- [ ] Tabs list is a 32px `muted` track with 3px padding; the active tab is a raised `bg-background` with `shadow-sm`; the `line` variant shows a 2px underline.
- [ ] Menus open with an 8px slide + 100ms fade/zoom, 4px padding, 6px-radius items, `accent` focus, red tint for destructive items, and `border` separators.
- [ ] Separators are exactly 1px in `border` color; scroll areas show a 10px track with a rounded `border`-colored thumb.
- [ ] No card uses a colored border band; no text uses `font-black`/`font-light`; no animation exceeds 800ms.
