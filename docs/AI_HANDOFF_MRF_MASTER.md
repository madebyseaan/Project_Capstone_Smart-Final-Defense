# SMART UI Design — Master Handoff for MRF

**Attach only this file.** It is the complete, self-contained UI design extraction of the SMART system for the MRF codebase. Each part embeds the reference code, exact class strings, design tokens, motion values, and an acceptance checklist.

**Scope: Admin and MRF staff portals only.** MRF's landing/login page serves students and teachers — it must **not** be modified. Do not share components, routes, or styles with that page.

**Already delivered:** the sidebar/topbar shell handoff defines the global foundation — DM Sans font, design tokens, icon rules, and layout geometry. This document builds on it; do not redefine those tokens.

---

## Execution rules

1. **Use MRF's own content.** Navigation items, table columns, labels, notification rules, actions, and data shown in this document are placeholders. Replace them with MRF's real content, data sources, routes, and auth. Do not invent content from the examples.
2. **Keep every visual specification exactly.** Class strings, dimensions, colors/design tokens, radii, spacing, durations, easings, and icon sizes are not suggestions. Do not restyle, "improve", or substitute your own design choices.
3. **Obey the Hard rules / KEEP / DO NOT sections.** These are the review criteria; they exist because those are the most common points of design drift.
4. **Do not modify MRF's student/teacher landing/login page** and do not share components with it.
5. **Adapt the stack, not the design.** If MRF does not use React/Tailwind/Base UI, implement with MRF's stack but keep every computed value and class recipe identical — the docs include computed values for this reason.
6. **No new primitives beyond what the docs specify.** In particular, MRF has no data-entry forms — do not add labels, checkbox/radio, help tooltips, or validation-layout primitives.
7. **Follow the part order below.** Each part is independently implementable, but start with Part 1 (it defines the branding variables and page scaffolding the rest read from).

## Anti-hallucination rules (non-negotiable)

1. **Copy, never recall.** Every class string, dimension, color, duration, and icon size must be copied from this document. If a value is not in this document, do not invent it — record it under "Open questions".
2. **No invented APIs or dependencies.** Use only libraries already present in the MRF codebase or named in this document (e.g., `lucide-react`). If a dependency is missing, propose it in the report — never silently add packages, invent component props, or guess exports.
3. **Read before claiming.** Never state that a file, component, or behavior exists without having read it. Every claim needs `path:line` evidence. If you cannot point to the code, it is not done.
4. **No simulated results.** Build/typecheck/lint/test output must be pasted from the actual command run. If a command is unavailable, write "not run — <reason>". Never fabricate command output or checks you did not execute.
5. **Ambiguity goes to "Open questions".** Never guess and proceed silently. Every deviation requires four fields: what, why, where (`file:line`), impact.
6. **Transcribe checklists verbatim.** Do not paraphrase, merge, or skip acceptance items. Report them in their original order and wording.
7. **Placeholders stay placeholders.** If MRF's real data, labels, or copy are unavailable, leave a clearly named `TODO(<owner>)` — never fabricate content that could ship.

## Gates (hard checkpoints — do not skip)

### Gate 0 — Pre-flight, before writing any code
- Confirm the target stack and libraries.
- List every file you will add or modify (including existing primitives you adapt).
- Confirm MRF's landing/login (student/teacher) files are not in that list.
- Output the plan, then start. Do not begin coding before the plan exists.

### Gate 1 — Per part, after implementing
- Run that part's acceptance checklist **verbatim** (item counts are fixed — see the index below).
- Run MRF's build, typecheck, and lint (or its `verify` script) and paste the real output tail.
- Produce an evidence table: `item | PASS/FAIL/N/A | evidence path:line | note`.
- A part is **complete** only when every item is PASS or N/A-with-reason. If any item is FAIL or unknown, mark the part `PARTIAL`, list the blocker, and either fix it or stop and report.

### Gate 2 — Cross-part consistency, after all parts
- Search for banned patterns (adapt paths to MRF):
  - `rg -n "text-(gray|slate|zinc)-[0-9]|bg-(gray|slate|zinc)-[0-9]" <admin-portal-paths>`
  - `rg -n "#[0-9a-fA-F]{6}" <admin-portal-paths>` — hits are allowed **only** in branding defaults and the spots this document explicitly sanctions (status tones, alert banners, tooltip chrome, trend colors). Every other hit must be replaced with tokens.
  - `rg -n "TODO|FIXME|Lorem" <changed files>` — every TODO must be intentional and named.
- Confirm no primitive is implemented twice (one `Button`, one `Input`, one `Select` source of truth).
- Confirm every accent derives from `--theme-primary` / `--theme-primary-rgb`.
- `git diff --stat` gate: zero modifications under landing/login/student/teacher routes. Paste the diff stat as evidence.

### Gate 3 — Final handoff report
Deliver exactly one table:

| Part | Checklist items | PASS | FAIL | N/A | Deviations | Open questions |
|---|---|---|---|---|---|---|

Then: list every command you ran with its result, list all `TODO(...)` markers, and confirm the landing page is untouched. Any FAIL means the work is not done — return and fix before reporting completion.

### Checklist item counts (Gate 1 expects exactly these)

| Part | Items |
|---|---|
| 1 — Pages & Branding | 9 |
| 2 — Tables | 13 |
| 3 — Modals & Drawers | 11 |
| 4 — Notifications & Feedback | 12 |
| 5 — Buttons & Inputs | 9 |
| 6 — Data Display | 9 |
| **Total** | **63** |

If your report shows fewer items than the count for a part, you skipped items — go back and complete them.

---

## Table of contents

1. **Part 1 — Pages & Branding**: page scaffolding, `PageHeader`, loading gate, runtime branding (theme colors/logo/name, pixel-grid backdrop, favicon/title)
2. **Part 2 — Tables**: `DataTable` family — toolbar, column API, loading/empty/error states, pagination, cell/row conventions
3. **Part 3 — Modals & Drawers**: standard dialog, rich `AppModal` system (+ InfoCard/StatTile/AlertBanner/StepCards/ModalSection), `ConfirmDialog`, 440px sheet + 1100px vault drawer
4. **Part 4 — Notifications & Feedback**: notification bell + dropdown panel, severity model, dismiss persistence, toasts, inline banners, loading indicators, `PageError`
5. **Part 5 — Buttons & Inputs**: buttons (variants/sizes), Input, Textarea, Select (filters + page size), search-field recipe — controls used by tables, modals, and toolbars
6. **Part 6 — Data Display**: Card family, `StatCard` + count-up, Badge, Avatar, Tabs, DropdownMenu, Separator, ScrollArea

---

## Foundation facts (already established by the delivered shell handoff)

- **Font:** DM Sans (Google Fonts variable, weights 100–1000), `16px/1.6`, `letter-spacing: -0.011em`; root drops to 15px below 640px; sidebar hard-sets the family.
- **Icons:** `lucide-react`; nav 20px / nested 16px at `strokeWidth 2.2`; chrome icons default stroke.
- **Accent:** one runtime variable `--theme-primary` (+ `--theme-primary-rgb`, `--theme-primary-text` for contrast). Never hardcode a brand hex in components.
- **Neutrals:** sidebar `#fafafa`; nav text `#0F1729` with 70/60/50% opacity tiers; hover `white/80`; borders `slate-200`/`slate-100`; topbar `white/80` + 12px blur.
- **Layout:** sidebar 280/70px, logo header 96px, topbar 64px, main padding 16/32px, content max-width 1400px.
- **Motion:** shell 200ms `cubic-bezier(0.4,0,0.2,1)`; dialogs/menus 100ms zoom+fade; drawers 200ms slide; count-up 800ms cubic; page fade 400ms.
- **Radii:** pills `9999px`, cards 16.8px, buttons/inputs 12px, badges 20px-height pills.
- **Stack reference:** React + Tailwind + `@base-ui/react` (shadcn-style wrappers) + `class-variance-authority` + `lucide-react` + Sonner. Any equivalent stack is fine.

## Intentionally not included

- MRF's student/teacher landing & login page — out of scope, kept as-is.
- Form-specific primitives (labels, checkbox/radio, help tooltips, multi-field validation layouts) — MRF has no data-entry forms; Part 5 covers the controls that are actually used.
- Domain-specific SMART layouts (class-record ledger, SF form grids, Excel viewer, attendance sheets) — content, not reusable design.
- Backend, auth flows, data-fetching patterns, API contracts.
- Dark mode (the app ships light-only chrome).

---

**Start with Part 1: give a short implementation plan (files to add/change), then implement.**

---

# Part 1 — Pages & Branding

**Scope: Admin and MRF staff portals only.** MRF's landing/login page serves students and teachers — it must **not** be modified by this handoff.

---

## 0. Task brief for the agent

Implement MRF's page-level shell pieces inside the authenticated Admin/MRF portal:

1. **Page scaffolding** — consistent page root, spacing, max width, entrance animation.
2. **PageHeader** — title + optional badge + description + actions.
3. **Loading gate** — full-page loader while auth/session resolves.
4. **Runtime branding** — configurable primary/secondary/accent colors, logo, name; applied via CSS variables; pixel-grid backdrop; document title/favicon.

Out of scope: MRF's landing/login page (student and teacher entry point) stays untouched. Do not restyle, wrap, or share components with it.

---

## 1. Hard rules

### 1.1 KEEP (do not alter)
- Page root: `space-y-6` vertical rhythm, centered `max-w-[1400px]` content width, `0.4s ease-out` fade-in entrance on mount.
- Page title: **24px bold** (`text-2xl font-bold tracking-tight text-foreground`).
- Page description: 14px `muted-foreground`, hidden on mobile when it competes with actions.
- Actions cluster: `flex items-center gap-3`; primary page action is a small button with a 16px icon and `mr-1.5`.
- Content inside main is padded 16px mobile / 32px desktop by the shell (do not re-add page padding).
- Branding is runtime-configurable: one `--theme-primary` variable drives accents everywhere; the app never hardcodes a brand hex outside defaults.
- Background: `#f8fafc` base with an 8%-alpha primary pixel grid at 80×80 tiles (authenticated portal backdrop only).

### 1.2 REPLACE (MRF content)
- Page names/descriptions, logo, organization name.
- Branding defaults (SMART defaults to emerald; MRF picks its own).

### 1.3 DO NOT
- Do not touch MRF's landing/login page (student/teacher entry).
- Do not add page-level horizontal padding inside routes (the shell's `main` handles it).
- Do not use breadcrumbs or nested page headers — one `PageHeader` per page.
- Do not hardcode the brand color in components; always read `--theme-primary` (or the branding context).
- Do not use a full-page loader for in-page data; only for the auth/session gate (in-page uses skeletons).

---

## 2. Page scaffolding

```tsx
export default function SomePage() {
  return (
    <div className="space-y-6 animate-fade-in max-w-[1400px] mx-auto w-full">
      <PageHeader title="..." description="..." actions={<Button size="sm">...</Button>} />
      {/* content: DataTable, Cards, forms */}
    </div>
  );
}
```

| Concern | Value |
|---|---|
| Vertical rhythm | 24px between page sections (`space-y-6`) |
| Max content width | 1400px centered |
| Page entrance | `fadeIn 0.4s ease-out forwards` (utility `.animate-fade-in`) |
| Main padding | shell provides `p-4 lg:p-8` |
| Narrow single-column pages | `max-w-[900px]` (forms, lists) or `max-w-[860px]` |
| Dense/wide pages | `max-w-7xl mx-auto pb-12` (teacher portal pattern) |

---

## 3. PageHeader

```tsx
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  badge?: ReactNode;
  className?: string;
}

export function PageHeader({ title, description, actions, badge, className }: PageHeaderProps) {
  return (
    <div className={cn("flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4", className)}>
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
        {badge}
      </div>
      <div className="flex items-center gap-3">
        {description && (
          <p className="text-sm text-muted-foreground hidden sm:block">{description}</p>
        )}
        {actions}
      </div>
    </div>
  );
}
```

Rules:
- `badge` sits inline after the title (e.g., a count pill or status chip).
- Description hides below 640px to protect the actions; keep it under ~80 characters.
- Actions: primary first (`Button size="sm" className="font-semibold text-xs shadow-sm shadow-primary/20"` + icon), secondary `outline`, icon-only `ghost` with `aria-label`.

---

## 4. Loading gate

While the session/user is resolving, render a centered gate — never a blank screen:

```tsx
<div className="min-h-screen flex items-center justify-center bg-[var(--bg)]">
  <div className="flex flex-col items-center gap-4" role="status" aria-label="Loading">
    <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
    <p className="text-muted-foreground font-medium">Loading...</p>
  </div>
</div>
```

SMART's legacy version uses `bg-slate-100`, an emerald border, and gray text — replace with the semantic recipe above when porting.

In-page data loading uses skeletons, empty states, and page error blocks (see tables/feedback docs).

---

## 5. Runtime branding

### 5.1 Theme contract

Defaults (replace with MRF's):

```ts
const defaultColors = {
  primary: "#10b981",   // emerald-500
  secondary: "#34d399", // emerald-400
  accent: "#6ee7b7",    // emerald-300
};
```

On load (and on settings change), set on `document.documentElement`:

```
--theme-primary, --theme-secondary, --theme-accent        (raw brand colors)
--theme-primary-light / -dark                              (±40 per RGB channel)
--theme-primary-rgb                                        ("16, 185, 129" for alpha math)
--theme-primary-text                                       auto contrast: #1f2937 or #ffffff
--primary, --color-primary, --primary-foreground, --ring   (mirror into Tailwind tokens)
--chart-1                                                  (charts follow the brand)
```

Contrast helper: compute luminance `(0.299R + 0.587G + 0.114B) / 255`; if > 0.5 use dark text, else white.

Branding context exposes: `colors`, `logoUrl`, `schoolName` (org name), plus optional address/division/region/id and current school year. Cache to `localStorage` and apply before first paint to avoid a flash; refresh from a public settings endpoint and subscribe to a realtime settings stream if available.

Document metadata:
- Title: `<org name> | MRF` (fallback `MRF — <tagline>`).
- Favicon: swap `<link rel="icon">` to the uploaded logo when present.

Applying the brand accent to a subtree is done with inline CSS vars (used on scoped screens, not the landing page):

```tsx
style={{ "--primary": "var(--theme-primary)", "--accent": "var(--theme-accent)" } as React.CSSProperties}
```

### 5.2 Pixel grid backdrop (authenticated portal)

```tsx
export default function PixelGridBackground() {
  return (
    <div
      className="pointer-events-none fixed inset-0 -z-10"
      style={{
        backgroundImage:
          "linear-gradient(to bottom right, #f8fafc 0%, rgba(var(--theme-primary-rgb), 0.08) 50%, rgba(var(--theme-primary-rgb), 0.06) 100%)",
      }}
      aria-hidden="true"
    >
      <svg className="absolute inset-0 h-full w-full opacity-[0.08]" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="app-pixel-grid" x="0" y="0" width="80" height="80" patternUnits="userSpaceOnUse">
            <rect x="2" y="2" width="36" height="36" rx="2" fill="none" stroke="var(--theme-primary)" strokeWidth="1.5" />
            <rect x="42" y="2" width="36" height="36" rx="2" fill="none" stroke="var(--theme-primary)" strokeWidth="1.5" />
            <rect x="2" y="42" width="36" height="36" rx="2" fill="none" stroke="var(--theme-primary)" strokeWidth="1.5" />
            <rect x="42" y="42" width="36" height="36" rx="2" fill="none" stroke="var(--theme-primary)" strokeWidth="1.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#app-pixel-grid)" />
      </svg>
    </div>
  );
}
```

---

## 6. Utilities

| Utility | Definition | Use |
|---|---|---|
| `.animate-fade-in` | `fadeIn 0.4s ease-out forwards` (opacity 0→1) | Every page root |
| `.print-hide` | hides element in print | Overlays, drawers, side panels |
| `.custom-scrollbar` | 4px light track/thumb | Sidebar only |
| Font sizes | root 16px, 15px below 640px | Global (defined in the already-delivered shell handoff) |

Fonts: **DM Sans** (Google Fonts, variable) with system fallbacks; sidebar hard-sets it — see the delivered shell handoff.

---

## 7. Acceptance criteria

- [ ] Every page root uses `space-y-6`, is centered with `max-w-[1400px]`, and fades in over 400ms.
- [ ] Main content padding comes only from the shell (`p-4 lg:p-8`).
- [ ] `PageHeader` renders a 24px bold title with optional inline badge, right-aligned actions with 12px gaps, and a 14px muted description that hides below 640px.
- [ ] The loading gate is a centered 48px primary ring spinner with a status label, not a blank screen.
- [ ] Branding: changing the primary color updates the portal buttons, active states, pixel grid, and chart color 1 without touching component code; contrast text flips automatically for light primaries.
- [ ] Logo, org name, and favicon update from the branding source; document title follows `<org> | MRF`.
- [ ] Pixel grid: 80×80 SVG tile, 36px rounded squares (rx 2) with 1.5px primary stroke at 8% opacity over a slate-to-primary gradient.
- [ ] `print-hide` is applied to overlays and drawers; no raw brand hex appears in components (defaults only).
- [ ] MRF's landing/login page (student/teacher entry) is untouched — no shared components, routes, or styles were modified there.

---

# Part 2 — Tables

---

## 0. Task brief for the agent

Implement the MRF list-view table system: a reusable `DataTable<T>` family with toolbar (search + filters + actions), loading/empty/error states, pagination footer, and consistent row-action conventions. Use MRF's own data, columns, and labels. The source-of-truth code is embedded in §10; keep the class strings and structure, replace content.

Deliverables:
1. `types.ts` (column/filter/skeleton types), `usePagination.ts`, `Dash.tsx`, `TableStates.tsx`, `TableToolbar.tsx`, `TablePagination.tsx`, `DataTable.tsx`.
2. At least one MRF list page using: page header + toolbar + `DataTable` + `ConfirmDialog` for destructive row actions.
3. Acceptance checklist in §12 verified.

Stack used by the reference: React + Tailwind CSS + `lucide-react` icons + shadcn-style primitives (`Card`, `Table`, `Button`, `Input`, `Select`, `Skeleton`). If MRF has equivalents, map imports; the required primitive styling is specified in §13.

---

## 1. Hard rules

### 1.1 KEEP (do not alter)
- All tables live inside a **Card**: `border border-border shadow-sm bg-card overflow-hidden rounded-xl p-0`.
- Header row: background `muted/50`, full 1px bottom border, head cells **11px semibold uppercase**, `tracking-wider`, `muted-foreground`, padding `14px 16px`.
- Body rows: separated by a **20%-alpha border** (`border-border/20`), hover `muted/50` across the whole row, cells 14px `foreground`, padding `14px 16px`, `align-middle`, `whitespace-nowrap`.
- Numeric data (scores, counts, averages, LRN) always uses `tabular-nums`; identifiers use `font-mono text-[13px] text-muted-foreground`.
- Body text never wraps; the table wrapper scrolls horizontally instead.
- Loading = skeleton rows with per-column hints; never a spinner replacing the table.
- Empty and error states render **inside the table body** as a full-width cell (`colSpan`), centered, with a 48px tinted icon circle and `56px` vertical padding.
- Pagination is hidden entirely when total rows ≤ 10.
- Rows per page options: **10 (default), 25, 50, 100**; pagination is **1-based** externally.
- All state text uses semantic tokens (`foreground`, `muted-foreground`, `border`, `destructive`), never raw palette colors in the system chrome.

### 1.2 REPLACE (MRF content)
- Column headers, cell renderers, row data, filters, search placeholder, empty/error copy, action buttons.
- Data fetching (React Query in SMART; use MRF's equivalent).
- Route names and permission checks.

### 1.3 DO NOT
- Do not substitute a plain `<table>` without the Card wrapper, toolbar slot, and state handling.
- Do not use zebra striping, vertical grid lines, or `border` on every cell.
- Do not sort/filter/paginate server-side by default; the reference slices client-side via `usePagination`.
- Do not use full-page spinners, centered pagination, or page-size text inputs.
- Do not use `text-gray-*`/`text-slate-*` for table chrome.

---

## 2. Dimensions & tokens

| Token | Value |
|---|---|
| Card radius | `rounded-xl` = 16.8px in this theme (`--radius: 0.75rem`, `xl = radius × 1.4`) |
| Card border | 1px `border` |
| Card shadow | `shadow-sm` |
| Card header block | `padding: 16px 24px`, bottom border 1px |
| Head cell padding | `14px 16px` (`py-3.5 px-4`) |
| Body cell padding | `14px 16px` (`py-3.5 px-4`) |
| Head font | 11px, weight 600, uppercase, `letter-spacing: 0.05em` (`tracking-wider`), `muted-foreground` |
| Body font | 14px, weight 400, `foreground` |
| Header block title | 16px semibold `foreground` |
| Header block description | 14px `muted-foreground` |
| Row hover | `muted` at 50% alpha; transition `colors` |
| Row divider | `border` at 20% alpha |
| Skeleton base | `animate-pulse rounded-md bg-muted`, container opacity `0.6` |
| Empty/error vertical padding | `56px` (`py-14`) |
| Icon circle (empty/error) | 48px, radius full, bg `muted` / `destructive` at 10% |
| Pagination footer | `padding: 16px 8px`, top border 1px |
| Pagination buttons | 32×32px (`h-8 w-8`), radius 12px (`rounded-lg`) |
| Search input | height 36px (`h-9`), width 224px (`w-56`), radius 12px, 12px text, icon inset 12px left |
| Filter select | width 144px (`w-36`) in toolbars, height 40px default / 32px `sm` |
| Toolbar gaps | 16px between groups, 12px within a group |
| Motion | row/button color transitions 150ms; no layout animations |

### 2.1 Icon spec

Library `lucide-react`. Sizes: search icon 14px (`w-3.5 h-3.5`) inline and 16px in the toolbar recipe; pagination chevrons 16px; empty-state `Inbox` 20px at `muted-foreground/60`; error `AlertTriangle` 20px `destructive`; row action icons 16px. Default stroke width.

---

## 3. Anatomy

```
Card (rounded-xl, border, shadow-sm, p-0)
├── Header block (px-6 py-4, border-b)              [optional]
│   ├── Title (16px semibold) + Description (14px muted)
│   └── Toolbar (right on lg: search · filters · actions)
├── CardContent (p-0)
│   ├── div.overflow-x-auto
│   │   └── Table (w-full text-sm)
│   │       ├── TableHeader
│   │       │   └── Row (bg-muted/50, border-b)
│   │       │       └── Th (11px semibold uppercase, py-3.5 px-4)
│   │       └── TableBody
│   │           ├── Loading: skeleton rows (6–10)
│   │           ├── Error: AlertTriangle + message + Retry (outline, sm)
│   │           ├── Empty: Inbox circle + title + hint + optional action
│   │           └── Data rows (border-border/20, hover muted/50)
│   └── TablePagination (px-2 py-4, border-t)       [only if rows > 10]
```

Table container has NO outer `overflow-hidden` on the scroll div — the Card clips corners; the inner wrapper is `overflow-x-auto`.

---

## 4. Cell content conventions

| Content type | Recipe |
|---|---|
| Primary text | `font-medium text-foreground` |
| Secondary text | `text-sm text-muted-foreground` |
| Identifier (LRN, codes) | `font-mono text-[13px] text-muted-foreground tabular-nums` |
| Number/score | `tabular-nums`, optional `font-semibold text-foreground` |
| Status | `Badge variant="outline"` with `text-[11px] font-medium px-2 py-0.5 rounded-full` + status tone |
| Missing value | `<Dash />` (em dash at `muted-foreground/40`, non-selectable) |
| Row actions | Right-aligned `flex items-center justify-end gap-2 whitespace-nowrap`; `Button size="sm" variant="outline" className="h-8 text-xs"` for actions; destructive icon action = `variant="ghost"` + `text-destructive hover:text-destructive`, `w-4 h-4` icon, `aria-label` with the row identifier |
| Person cell | Avatar/initials or name + muted subline (e.g., LRN), stacked with `leading-tight` |

Status tone recipe used in SMART (map to MRF semantics): active = `bg-primary/10 text-primary border-primary/20`; draft/closed = `bg-muted text-muted-foreground`; completed = `bg-blue-50 text-blue-700 border-blue-200`; archived = `bg-amber-50 text-amber-700 border-amber-200`. The full pattern appears in the §11 example.

---

## 5. State rules

| State | Trigger | Render |
|---|---|---|
| Loading | `loading === true` | `rowsPerPage` skeleton rows (clamped 6–10), each cell picks a skeleton hint shape |
| Error | `error` string | Icon circle (`destructive/10`), message 14px semibold, optional `Retry` outline `size="sm"` |
| Empty | `rows.length === 0` after filtering | Icon circle (`muted`), title, hint (max 320px, centered), optional action node |
| Empty + search | `emptySearchTerm` provided | Title becomes `No results for "<term>"`; hint defaults to `Try adjusting your search or filter criteria.` |
| Data | rows available | Sliced rows via pagination |

Skeleton hint shapes (one per column via `skeleton` key):

| Hint | Shape |
|---|---|
| `name` (default) | `h-4 w-28` |
| `pill` | `h-6 w-16 rounded-full` |
| `badge` | `h-5 w-14 rounded-md` |
| `number` | `h-4 w-10` |
| `date` | `h-4 w-20` |
| `avatar` | `h-8 w-8 rounded-full` |

---

## 6. Pagination rules

- Hidden when `totalRows <= 10`.
- Left: `Showing <start> to <end> of <total> results` — numbers in `font-medium text-foreground`, rest `text-sm text-muted-foreground`.
- Right: `Rows per page:` label + 80px select (size `sm`, height 32px) + 4 nav buttons (`h-8 w-8`, outline) + page number buttons (`h-8 w-8`; active = `variant="default"`).
- Page number algorithm: if `totalPages <= 7`, show all; else always show first and last, `...` gaps, and a window of `page-1 … page+1`.
- Changing rows-per-page resets to page 1.
- `setPage` clamps to `[1, totalPages]`.

---

## 7. Toolbar rules

Two canonically equivalent recipes; use one consistently:

1. **`TableToolbar` (inside card header):** search input `pl-9 w-full sm:w-64` with a 16px `Search` icon absolutely positioned at `left-3`; filters = `Select` triggers `w-36`; `actions` slot on the right (`flex items-center gap-3`). Layout `flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4`.
2. **`SearchInput` (page-level, e.g. in `PageHeader` actions):** 36px tall, 224px wide, 12px text, 14px icon at `left-3`, input `pl-8 h-9 w-56 rounded-lg text-xs`.

Filter dropdown styling: trigger `border border-input bg-background text-sm`, height 40px (default) / 32px (small), radius 12px; popup `rounded-md bg-popover border border-border shadow-md`, items 14px with a `CheckIcon` indicator, searchable automatically when > 6 items.

---

## 8. Page composition

```tsx
<div className="space-y-6 animate-fade-in max-w-[1400px] mx-auto w-full">
  <PageHeader title="..." description="..." actions={<Button size="sm" .../>} />
  <DataTable ... />
  <ConfirmDialog ... />
</div>
```

- Page header: title 24px bold `tracking-tight`; description 14px muted; actions right-aligned, `gap-3`.
- Primary action button: `size="sm"`, `text-xs font-semibold`, optional `shadow-sm shadow-primary/20`, icon 16px with `mr-1.5`.
- Delete/destructive flows always go through `ConfirmDialog`, never `window.confirm`.

---

## 9. API types

```ts
export type SkeletonHint = "name" | "pill" | "badge" | "number" | "date" | "avatar";

export interface TableColumn<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
  align?: "left" | "center" | "right";
  skeleton?: SkeletonHint;
}

export interface TableFilter {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { label: string; value: string }[];
}
```

`DataTable` props: `columns`, `rows`, `loading?`, `error?`, `title?`, `description?`, `emptyTitle?`, `emptyHint?`, `emptySearchTerm?`, `rowKey`, `onRowClick?`, `toolbar?`, `pagination` (from `usePagination`), `onRetry?`.

---

## 10. Reference implementation

`types.ts` + `Dash.tsx`:

```tsx
import type { ReactNode } from "react";

export type SkeletonHint = "name" | "pill" | "badge" | "number" | "date" | "avatar";

export interface TableColumn<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
  align?: "left" | "center" | "right";
  skeleton?: SkeletonHint;
}

export interface TableFilter {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { label: string; value: string }[];
}

export function Dash() {
  return <span className="text-muted-foreground/40 select-none">&mdash;</span>;
}
```

`usePagination.ts`:

```tsx
import { useState, useMemo, useCallback } from "react";

const ROWS_PER_PAGE_OPTIONS = [10, 25, 50, 100] as const;
const DEFAULT_ROWS_PER_PAGE = 10;

interface UsePaginationOptions {
  totalRows: number;
  initialRowsPerPage?: number;
}

interface UsePaginationReturn {
  page: number;
  totalPages: number;
  rowsPerPage: number;
  totalRows: number;
  setPage: (page: number) => void;
  setRowsPerPage: (rows: number) => void;
  slice: <T>(rows: T[]) => T[];
}

export function usePagination({
  totalRows,
  initialRowsPerPage = DEFAULT_ROWS_PER_PAGE,
}: UsePaginationOptions): UsePaginationReturn {
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(initialRowsPerPage);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(totalRows / rowsPerPage)),
    [totalRows, rowsPerPage]
  );

  const handleSetPage = useCallback(
    (newPage: number) => {
      setPage(Math.max(1, Math.min(newPage, totalPages)));
    },
    [totalPages]
  );

  const handleSetRowsPerPage = useCallback((rows: number) => {
    setRowsPerPage(rows);
    setPage(1);
  }, []);

  const slice = useCallback(
    <T,>(rows: T[]): T[] => {
      const start = (page - 1) * rowsPerPage;
      return rows.slice(start, start + rowsPerPage);
    },
    [page, rowsPerPage]
  );

  return {
    page: Math.min(page, totalPages),
    totalPages,
    rowsPerPage,
    totalRows,
    setPage: handleSetPage,
    setRowsPerPage: handleSetRowsPerPage,
    slice,
  };
}

export { ROWS_PER_PAGE_OPTIONS, DEFAULT_ROWS_PER_PAGE };
```

`TableStates.tsx`:

```tsx
import { AlertTriangle, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TableCell, TableRow } from "@/components/ui/table";
import type { SkeletonHint } from "./types";

function SkeletonCell({ hint }: { hint?: SkeletonHint }) {
  const classes: Record<SkeletonHint, string> = {
    name: "h-4 w-28",
    pill: "h-6 w-16 rounded-full",
    badge: "h-5 w-14 rounded-md",
    number: "h-4 w-10",
    date: "h-4 w-20",
    avatar: "h-8 w-8 rounded-full",
  };

  return <Skeleton className={classes[hint ?? "name"]} style={{ opacity: 0.6 }} />;
}

interface LoadingSkeletonProps {
  columnCount: number;
  rowCount?: number;
  skeletonHints?: (SkeletonHint | undefined)[];
}

export function LoadingSkeleton({
  columnCount,
  rowCount = 5,
  skeletonHints,
}: LoadingSkeletonProps) {
  const rows = Math.min(Math.max(rowCount, 6), 10);

  return (
    <>
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <TableRow key={rowIdx} className="border-0 hover:bg-transparent">
          {Array.from({ length: columnCount }).map((_, colIdx) => (
            <TableCell key={colIdx} className="border-0 py-3.5">
              <SkeletonCell hint={skeletonHints?.[colIdx]} />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

interface EmptyStateProps {
  title?: string;
  hint?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  columnCount: number;
  searchTerm?: string;
}

export function EmptyState({
  title,
  hint,
  icon,
  action,
  columnCount,
  searchTerm,
}: EmptyStateProps) {
  const displayTitle = searchTerm
    ? `No results for "${searchTerm}"`
    : title ?? "No results found";
  const displayHint = searchTerm
    ? hint ?? "Try adjusting your search or filter criteria."
    : hint;

  return (
    <TableRow>
      <TableCell colSpan={columnCount} className="py-14 text-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
            {icon || <Inbox className="h-5 w-5 text-muted-foreground/60" />}
          </div>
          <p className="text-sm font-semibold text-foreground">{displayTitle}</p>
          {displayHint && (
            <p className="text-sm text-muted-foreground max-w-xs">{displayHint}</p>
          )}
          {action}
        </div>
      </TableCell>
    </TableRow>
  );
}

interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
  columnCount: number;
}

export function ErrorState({
  message = "Something went wrong",
  onRetry,
  columnCount,
}: ErrorStateProps) {
  return (
    <TableRow>
      <TableCell colSpan={columnCount} className="py-14 text-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
            <AlertTriangle className="h-5 w-5 text-destructive" />
          </div>
          <p className="text-sm font-semibold text-foreground">{message}</p>
          {onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              Retry
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
```

`TableToolbar.tsx`:

```tsx
import { useState, useCallback } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TableFilter } from "./types";

interface TableToolbarProps {
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  filters?: TableFilter[];
  actions?: React.ReactNode;
}

export function TableToolbar({
  searchPlaceholder = "Search...",
  searchValue: controlledSearch,
  onSearchChange,
  filters,
  actions,
}: TableToolbarProps) {
  const [internalSearch, setInternalSearch] = useState("");
  const isControlled = controlledSearch !== undefined && onSearchChange !== undefined;
  const searchValue = isControlled ? controlledSearch : internalSearch;

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (isControlled) {
        onSearchChange(e.target.value);
      } else {
        setInternalSearch(e.target.value);
      }
    },
    [isControlled, onSearchChange]
  );

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder={searchPlaceholder}
            value={searchValue}
            onChange={handleSearchChange}
            className="pl-9 w-full sm:w-64"
          />
        </div>
        {filters?.map((filter) => (
          <Select
            key={filter.label}
            value={filter.value}
            onValueChange={(val) => val && filter.onChange(val)}
          >
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {filter.options.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ))}
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  );
}
```

`TablePagination.tsx`:

```tsx
import { useMemo } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ROWS_PER_PAGE_OPTIONS } from "./usePagination";

interface TablePaginationProps {
  page: number;
  totalPages: number;
  totalRows: number;
  rowsPerPage: number;
  onPageChange: (page: number) => void;
  onRowsPerPageChange: (rows: number) => void;
}

export function TablePagination({
  page,
  totalPages,
  totalRows,
  rowsPerPage,
  onPageChange,
  onRowsPerPageChange,
}: TablePaginationProps) {
  const startItem = totalRows === 0 ? 0 : (page - 1) * rowsPerPage + 1;
  const endItem = Math.min(page * rowsPerPage, totalRows);

  const pageNumbers = useMemo(() => {
    const pages: (number | "...")[] = [];
    const maxVisible = 5;

    if (totalPages <= maxVisible + 2) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (page > 3) pages.push("...");
      const start = Math.max(2, page - 1);
      const end = Math.min(totalPages - 1, page + 1);
      for (let i = start; i <= end; i++) pages.push(i);
      if (page < totalPages - 2) pages.push("...");
      pages.push(totalPages);
    }
    return pages;
  }, [page, totalPages]);

  if (totalRows <= ROWS_PER_PAGE_OPTIONS[0]) return null;

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-2 py-4 border-t border-border">
      <p className="text-sm text-muted-foreground">
        Showing <span className="font-medium text-foreground">{startItem}</span>{" "}
        to <span className="font-medium text-foreground">{endItem}</span> of{" "}
        <span className="font-medium text-foreground">{totalRows}</span> results
      </p>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Rows per page:</span>
          <Select
            value={String(rowsPerPage)}
            onValueChange={(v) => onRowsPerPageChange(Number(v))}
          >
            <SelectTrigger className="w-20" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROWS_PER_PAGE_OPTIONS.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => onPageChange(1)} disabled={page === 1}>
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => onPageChange(page - 1)} disabled={page === 1}>
            <ChevronLeft className="h-4 w-4" />
          </Button>

          {pageNumbers.map((p, idx) =>
            p === "..." ? (
              <span key={`ellipsis-${idx}`} className="px-1 text-muted-foreground">
                ...
              </span>
            ) : (
              <Button
                key={p}
                variant={page === p ? "default" : "outline"}
                size="icon"
                className="h-8 w-8"
                onClick={() => onPageChange(p)}
              >
                {p}
              </Button>
            )
          )}

          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => onPageChange(page + 1)} disabled={page === totalPages}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => onPageChange(totalPages)} disabled={page === totalPages}>
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
```

`DataTable.tsx`:

```tsx
import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { TableColumn } from "./types";
import { LoadingSkeleton, EmptyState, ErrorState } from "./TableStates";
import { TablePagination } from "./TablePagination";
import type { usePagination } from "./usePagination";

interface DataTableProps<T> {
  columns: TableColumn<T>[];
  rows: T[];
  loading?: boolean;
  error?: string | null;
  title?: string;
  description?: string;
  emptyTitle?: string;
  emptyHint?: string;
  emptySearchTerm?: string;
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  toolbar?: ReactNode;
  pagination: ReturnType<typeof usePagination>;
  onRetry?: () => void;
}

const HEAD_CLASS =
  "text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4";
const CELL_CLASS =
  "py-3.5 px-4 text-sm text-foreground align-middle whitespace-nowrap";

export function DataTable<T>({
  columns,
  rows,
  loading,
  error,
  title,
  description,
  emptyTitle,
  emptyHint,
  emptySearchTerm,
  rowKey,
  onRowClick,
  toolbar,
  pagination,
  onRetry,
}: DataTableProps<T>) {
  const { page, totalPages, rowsPerPage, totalRows, setPage, setRowsPerPage, slice } =
    pagination;

  const displayRows = slice(rows);
  const hasHeader = Boolean(title || description || toolbar);

  return (
    <Card className="border border-border shadow-sm bg-card overflow-hidden rounded-xl p-0">
      {hasHeader && (
        <div className="px-6 py-4 border-b border-border flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          {(title || description) && (
            <div>
              {title && <h2 className="text-base font-semibold text-foreground">{title}</h2>}
              {description && <p className="text-sm text-muted-foreground">{description}</p>}
            </div>
          )}
          {toolbar && <div className="min-w-0">{toolbar}</div>}
        </div>
      )}
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-muted/50 border-b border-border bg-muted/50">
                {columns.map((col) => (
                  <TableHead key={col.key} className={cn(HEAD_CLASS, col.className)}>
                    {col.header}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <LoadingSkeleton
                  columnCount={columns.length}
                  rowCount={rowsPerPage}
                  skeletonHints={columns.map((c) => c.skeleton)}
                />
              ) : error ? (
                <ErrorState message={error} columnCount={columns.length} onRetry={onRetry} />
              ) : displayRows.length === 0 ? (
                <EmptyState
                  title={emptyTitle}
                  hint={emptyHint}
                  columnCount={columns.length}
                  searchTerm={emptySearchTerm}
                />
              ) : (
                displayRows.map((row) => (
                  <TableRow
                    key={rowKey(row)}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={cn(
                      "border-b border-border/20 hover:bg-muted/50 transition-colors",
                      onRowClick && "cursor-pointer"
                    )}
                  >
                    {columns.map((col) => (
                      <TableCell
                        key={col.key}
                        className={cn(CELL_CLASS, col.className)}
                        style={
                          col.align === "right"
                            ? { textAlign: "right" }
                            : col.align === "center"
                            ? { textAlign: "center" }
                            : undefined
                        }
                      >
                        {col.cell(row)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        {!loading && !error && totalRows > 0 && (
          <TablePagination
            page={page}
            totalPages={totalPages}
            totalRows={totalRows}
            rowsPerPage={rowsPerPage}
            onPageChange={setPage}
            onRowsPerPageChange={setRowsPerPage}
          />
        )}
      </CardContent>
    </Card>
  );
}
```

Barrel export:

```ts
export { DataTable } from "./DataTable";
export { TableToolbar } from "./TableToolbar";
export { TablePagination } from "./TablePagination";
export { LoadingSkeleton, EmptyState, ErrorState } from "./TableStates";
export { Dash } from "./Dash";
export { usePagination, ROWS_PER_PAGE_OPTIONS } from "./usePagination";
export type { TableColumn, TableFilter, SkeletonHint } from "./types";
```

---

## 11. Usage example (MRF replaces content)

```tsx
import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { DataTable, TableToolbar, usePagination, type TableColumn } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { PageHeader } from "@/components/layout/PageHeader";

interface WorkOrder {
  id: string;
  code: string;
  title: string;
  status: "OPEN" | "IN_PROGRESS" | "CLOSED";
  createdAt: string;
}

const STATUS_COLORS: Record<WorkOrder["status"], string> = {
  OPEN: "bg-primary/10 text-primary border-primary/20",
  IN_PROGRESS: "bg-blue-50 text-blue-700 border-blue-200",
  CLOSED: "bg-muted text-muted-foreground",
};

export default function WorkOrdersPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [deleteTarget, setDeleteTarget] = useState<WorkOrder | null>(null);

  const orders: WorkOrder[] = [];

  const filtered = useMemo(
    () =>
      orders.filter(
        (o) =>
          (!search ||
            o.title.toLowerCase().includes(search.toLowerCase()) ||
            o.code.toLowerCase().includes(search.toLowerCase())) &&
          (status === "ALL" || o.status === status)
      ),
    [orders, search, status]
  );

  const pagination = usePagination({ totalRows: filtered.length });

  const columns: TableColumn<WorkOrder>[] = [
    { key: "code", header: "Order #", skeleton: "name",
      cell: (o) => <span className="font-mono text-[13px] text-muted-foreground tabular-nums">{o.code}</span> },
    { key: "title", header: "Title", skeleton: "name",
      cell: (o) => <span className="font-medium text-foreground">{o.title}</span> },
    { key: "status", header: "Status", skeleton: "badge",
      cell: (o) => (
        <Badge variant="outline" className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[o.status]}`}>
          {o.status}
        </Badge>
      ) },
    { key: "created", header: "Created", skeleton: "date",
      cell: (o) => new Date(o.createdAt).toLocaleDateString() },
    { key: "actions", header: "Actions", align: "right", className: "text-right",
      cell: (o) => (
        <div className="flex items-center justify-end gap-2 whitespace-nowrap">
          <Button size="sm" variant="outline" className="h-8 text-xs">View</Button>
          <Button size="sm" variant="ghost" className="h-8 px-2 text-destructive hover:text-destructive"
            onClick={() => setDeleteTarget(o)} aria-label={`Delete ${o.code}`}>
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      ) },
  ];

  return (
    <div className="space-y-6 animate-fade-in max-w-[1400px] mx-auto w-full">
      <PageHeader
        title="Work Orders"
        description="Track and manage maintenance requests"
        actions={
          <Button size="sm" className="font-semibold text-xs shadow-sm shadow-primary/20">
            <Plus className="w-4 h-4 mr-1.5" /> New Order
          </Button>
        }
      />

      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(o) => o.id}
        pagination={pagination}
        emptyTitle="No work orders yet"
        emptyHint="Create your first work order to get started."
        emptySearchTerm={search || undefined}
        toolbar={
          <TableToolbar
            searchPlaceholder="Search work orders..."
            searchValue={search}
            onSearchChange={setSearch}
            filters={[
              {
                label: "status",
                value: status,
                onChange: setStatus,
                options: [
                  { label: "All statuses", value: "ALL" },
                  { label: "Open", value: "OPEN" },
                  { label: "In progress", value: "IN_PROGRESS" },
                  { label: "Closed", value: "CLOSED" },
                ],
              },
            ]}
          />
        }
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete work order"
        description={`Delete ${deleteTarget?.code ?? ""}? This action cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => setDeleteTarget(null)}
      />
    </div>
  );
}
```

---

## 12. Acceptance criteria

- [ ] Tables render inside a Card with 16.8px radius, 1px border, `shadow-sm`, zero inner padding.
- [ ] Card header block (when present): 16px/24px padding, title 16px semibold, description 14px muted, bottom border, toolbar right-aligned on desktop.
- [ ] Header row background is `muted/50`; head cells are 11px, semibold, uppercase, `tracking-wider`, muted, `14px 16px` padding.
- [ ] Body cells are 14px `foreground`, `14px 16px` padding, vertically centered, no wrapping; horizontal overflow scrolls the wrapper.
- [ ] Row dividers are 20%-alpha borders; hover highlights the full row in `muted/50`.
- [ ] Missing values render as a muted em dash, not empty space.
- [ ] Numeric columns use `tabular-nums`; identifier columns use the mono 13px muted recipe.
- [ ] Loading shows 6–10 skeleton rows with per-column hint shapes at 60% opacity; no spinner.
- [ ] Empty state shows a 48px muted circle with a 20px `Inbox` icon, semibold title, muted hint capped at 320px, centered with 56px vertical padding; search-aware copy.
- [ ] Error state shows a 48px `destructive/10` circle with `AlertTriangle` and an outline Retry button.
- [ ] Pagination appears only above 10 rows; shows correct "Showing X to Y of Z results"; 32px square buttons with 12px radius; active page uses the primary variant; first/last/prev/next disable at bounds; rows-per-page select is 80px wide and resets to page 1.
- [ ] Toolbar: search icon inset 16px left with `pl-9`; search is 256px wide on ≥640px; filters are 144px selects; actions right-aligned.
- [ ] All chrome colors come from semantic tokens; no raw gray/slate/zinc classes.

---

## 13. Appendix — required primitive styling

The reference code assumes these shadcn-style primitives. If MRF has equivalents, ensure they match:

**Card** — `flex flex-col overflow-hidden rounded-xl bg-card text-sm text-card-foreground border border-border shadow-sm; padding: 0; gap: 0`
**CardContent** — `px-6 py-5` (DataTable overrides to `p-0`)

**Table** — container `relative w-full`; `table { width: 100%; caption-side: bottom; font-size: 14px }`
**TableRow** — `border-b transition-colors hover:bg-muted/50`
**TableHead** — `h-11 px-4 py-3 text-left align-middle font-semibold text-xs uppercase tracking-wide text-muted-foreground whitespace-nowrap`
**TableCell** — `px-4 py-3 align-middle whitespace-nowrap`
(DataTable’s `HEAD_CLASS` / `CELL_CLASS` override padding and typography as specified in §2.)

**Skeleton** — `animate-pulse rounded-md bg-muted`

**Button** — `inline-flex items-center justify-center rounded-lg border border-transparent text-sm font-medium transition-all active:translate-y-px disabled:pointer-events-none disabled:opacity-50`
- `default`: `bg-primary text-primary-foreground`
- `outline`: `border-border bg-background hover:bg-muted hover:text-foreground`
- `ghost`: `hover:bg-muted hover:text-foreground`
- `destructive`: `bg-destructive/10 text-destructive hover:bg-destructive/20`
- Sizes: `default h-8 px-2.5 gap-1.5`, `sm h-7 px-2.5 text-[0.8rem] gap-1`, `icon size-8`, `icon-sm size-7`

**Input** — `h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-base md:text-sm; focus: border-ring + 3px ring at 50%; placeholder: muted-foreground; disabled: opacity 50%`

**Select trigger** — full height 40px (default) / 32px (sm); `rounded-md border border-border bg-background px-3 text-sm`; chevron 16px at right; popup `rounded-md bg-popover border border-border shadow-md`; item height ~32px with check indicator on the selected row. Note: the SMART legacy trigger uses zinc/blue colors — **do not copy that**; use the semantic recipe above.

**Radius scale (this theme)** — `sm 7.2px`, `md 9.6px`, `lg 12px`, `xl 16.8px`, `2xl 21.6px` (derived from `--radius: 0.75rem`). If MRF uses default Tailwind radii, keep the **visual** sizes by using explicit values: pills `9999px`, card `17px`, buttons/inputs `12px`.

---

# Part 3 — Modals & Drawers

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

---

# Part 4 — Notifications & Feedback

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

---

# Part 5 — Buttons & Inputs

**Scope: Admin and MRF staff portals only.** MRF has no data-entry forms, so this document covers only the shared controls used by tables, modals, toolbars, and the shell: **buttons, text inputs, textareas, and selects**. Form-specific patterns (labels, checkboxes, help tooltips, multi-field validation layouts) are intentionally excluded.

---

## 0. Task brief for the agent

Implement the control primitives used across MRF's list views, modals, and toolbars:

1. `Button` — variants and sizes for table actions, modal footers, toolbar actions, and icon buttons.
2. `Input` — search fields and modal text fields.
3. `Textarea` — multi-line note/description fields where used.
4. `Select` — table filters and the rows-per-page control.

Use MRF's own labels and data. Reference code is embedded in §6.

Stack used by the reference: React + Tailwind + `class-variance-authority` (button variants) + `@base-ui/react` primitives wrapped shadcn-style. Radix or native elements are fine — keep the class strings.

---

## 1. Hard rules

### 1.1 KEEP (do not alter)
- Default control height **32px** (`h-8`); comfortable height **36px** (`h-9`); large/hero height **44px** (`h-11`); toolbar selects **32px** (`h-8`) / default **40px** (`h-10`).
- Radius **12px** (`rounded-lg`) for buttons, inputs, textareas; **6–8px** for select triggers/popups per §5.
- Buttons are **14px / medium (500)**; small buttons **12.8px** (`text-[0.8rem]`); icon buttons are perfectly square.
- Focus ring: **3px ring at 50% of `--ring`** (`focus-visible:ring-3 ring-ring/50`) plus border color switch to `--ring`.
- Invalid/error state (where validated): border `destructive`, ring `destructive/20` via `aria-invalid`.
- Disabled: `opacity 50%`, `pointer-events: none` on buttons; `cursor-not-allowed` + 50% on inputs.
- Placeholder color is `muted-foreground`; input text is `foreground`.
- Press feedback on buttons: `translateY(1px)` (`active:translate-y-px`); icon buttons may use `active:scale-95`.

### 1.2 REPLACE (MRF content)
- Button labels, icons, search placeholders, filter options.

### 1.3 DO NOT
- Do not use pill (`rounded-full`) buttons except for explicit chip/filter patterns.
- Do not use heights above 32px for toolbar/dense-table actions, or below 32px for primary actions.
- Do not color borders with raw palette classes; use `border-input`, `border-ring`, `border-destructive`.
- Do not place labels inside inputs (floating labels).
- Do not add checkbox, radio, or help-tooltip primitives — MRF has no forms; if a future flow needs them, port them from the source system separately.

---

## 2. Tokens

| Element | Height | Radius | Padding | Text |
|---|---|---|---|---|
| Button default | 32px | 12px | 10px horizontal | 14px / 500 |
| Button `sm` | 28px | 12px | 10px horizontal | 12.8px / 500 |
| Button `lg` | 36px | 12px | 10px horizontal | 14px / 500 |
| Button `xs` | 24px | 10px | 8px horizontal | 12px / 500 |
| Icon button | 32px (`icon`), 28px (`icon-sm`), 24px (`icon-xs`), 36px (`icon-lg`) | 10–12px | — | — |
| Input | 32px | 12px | 10px horizontal, 4px vertical | 16px mobile → 14px `md:` |
| Textarea | min 64px | 12px | 12px horizontal, 8px vertical | same as input |
| Search input (page/toolbar) | 36px | 12px | `pl-8`, width 224px | 12px |
| Select trigger | 40px default / 32px `sm` | 6px | 12px horizontal | 14px / 500 |

Color tokens (semantic only): `border-input`, `bg-transparent`/`bg-background`, `text-foreground`, `placeholder:text-muted-foreground`, `ring-ring/50`, `bg-primary`/`text-primary-foreground`, `bg-destructive/10` + `text-destructive`, `bg-muted` hover, `focus:bg-accent` for menu/popup rows.

Motion: controls transition colors/box-shadow at default speed; press feedback is instant.

---

## 3. Buttons

### 3.1 Variants

| Variant | Classes (visual) | Use for |
|---|---|---|
| `default` | `bg-primary text-primary-foreground` | Primary action (one per view) |
| `outline` | `border-border bg-background hover:bg-muted hover:text-foreground` | Secondary actions, Cancel, Retry, paging |
| `secondary` | `bg-secondary text-secondary-foreground hover:bg-secondary/80` | Tertiary emphasis |
| `ghost` | `hover:bg-muted hover:text-foreground` | Icon actions, dismiss, row actions |
| `destructive` | `bg-destructive/10 text-destructive hover:bg-destructive/20` | Delete/remove |
| `link` | `text-primary underline-offset-4 hover:underline` | Inline links |

### 3.2 Base recipe

```
inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent
bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none
focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50
active:not-aria-[haspopup]:translate-y-px
disabled:pointer-events-none disabled:opacity-50
[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4
```

Sizes: `default h-8 gap-1.5 px-2.5` · `xs h-6 gap-1 px-2 text-xs` · `sm h-7 gap-1 px-2.5 text-[0.8rem]` · `lg h-9 gap-1.5 px-2.5` · `icon size-8` · `icon-xs size-6` · `icon-sm size-7` · `icon-lg size-9`.

### 3.3 Rules
- One `default` (primary) button per view/section; everything else is `outline`/`ghost`.
- Destructive confirmation always uses `ConfirmDialog` where the confirm button is a **solid red** (`#dc2626`) or primary filled at modal scale — inline destructive buttons use the `destructive` variant.
- Loading: prepend `Loader2` spinner 16px with `mr-2`, keep the button disabled.
- Icon + label: icon first, 6px gap (`gap-1.5`); trailing icon only for disclosure chevrons.
- Small table actions: `size="sm" variant="outline" className="h-8 text-xs"`.
- Icon-only buttons require `aria-label`; topbar-style icon buttons use `p-2 rounded-xl` with `hover:bg-slate-100`/`hover:bg-accent`.

---

## 4. Text inputs, textareas, search fields

Base input:

```
h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base
transition-colors outline-none
placeholder:text-muted-foreground
focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50
disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50
aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20
md:text-sm
```

Base textarea:

```
flex min-h-16 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-base
transition-colors outline-none placeholder:text-muted-foreground
focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50
disabled:cursor-not-allowed disabled:opacity-50
aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20
md:text-sm
```

Search input recipe (page headers, table toolbars):

```tsx
<div className="relative">
  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
  <Input placeholder="Search..." className="pl-8 h-9 w-56 rounded-lg text-xs" />
</div>
```

Toolbar variant (inside card headers) uses a 16px icon and `pl-9 w-full sm:w-64` — see the tables doc.

---

## 5. Select

Required classes (canonical, semantic):

```
trigger:  flex w-full items-center justify-between gap-2 rounded-md border border-border
          bg-background py-2 px-3 text-sm font-medium whitespace-nowrap shadow-sm
          transition-all outline-none select-none
          hover:border-ring/60 focus:ring-1 focus:ring-ring focus:border-ring
          disabled:cursor-not-allowed disabled:opacity-50
          data-placeholder:text-muted-foreground
          default height 40px (h-10) · sm height 32px (h-8)
popup:    z-50 max-h-(--available-height) w-(--anchor-width) min-w-(--anchor-width)
          rounded-md bg-popover border border-border shadow-md ring-1 ring-foreground/10
          overflow-y-auto duration-100 (slide 8px + fade + zoom-95)
item:     relative flex w-full cursor-default items-center gap-1.5 rounded-md py-1.5 pr-8 pl-2.5
          text-sm outline-hidden select-none
          focus:bg-accent focus:text-accent-foreground
          disabled:pointer-events-none disabled:opacity-50
indicator: absolute right-2 size-4 CheckIcon on the selected row
search:   when options > 6, show a sticky search row (border-b, 12px icon, 12px input)
```

Notes:
- The SMART legacy trigger uses `zinc`/`blue` classes — **do not copy**; use the semantic recipe above.
- Chevron icon: 16px, muted, pointer-events none.
- Toolbar filters are 144px wide (`w-36`); pagination rows-per-page select is 80px (`w-20`, size `sm`).
- Used only for filtering and page-size control in MRF — no form validation states required.

---

## 6. Reference code

`Button`:

```tsx
import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        outline: "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80 aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost: "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
        destructive: "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-8",
        "icon-xs": "size-6 rounded-[min(var(--radius-md),10px)] [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7 rounded-[min(var(--radius-md),12px)]",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
)

function Button({ className, variant = "default", size = "default", ...props }: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return <ButtonPrimitive data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />
}

export { Button, buttonVariants }
```

`Input`:

```tsx
import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Input }
```

`Textarea`:

```tsx
import * as React from "react"
import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-16 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
```

---

## 7. Acceptance criteria

- [ ] Default control height is 32px; comfortable 36px; large 44px; radius 12px; icon buttons are square.
- [ ] Buttons: one primary per view; `outline` for secondary/cancel/retry; `ghost` for icon actions; `destructive` for inline deletes; press shifts down 1px; disabled at 50% with no pointer events.
- [ ] Focus visible on every control as a 3px ring at 50% `--ring` plus border-color change.
- [ ] Inputs show `muted-foreground` placeholders; disabled inputs are non-interactive at 50% opacity.
- [ ] Textareas are at least 64px tall with 12px horizontal padding.
- [ ] Search fields use the inset-icon recipe (14px icon, `pl-8`, 36px tall, 224px wide) or the toolbar variant (16px icon, `pl-9`, 256px wide).
- [ ] Select trigger is 40px default / 32px small, `bg-background`, `border-border`, semantic tokens only (no zinc/blue), with a 16px muted chevron and an 8px-offset popup with a check indicator; filters are 144px wide and the page-size select is 80px.
- [ ] Table and modal docs' button usages (row actions, pagination, footers) match §3 exactly.
- [ ] No form-specific primitives were added (no checkbox/radio/help-tooltip), and MRF's landing/login page is untouched.

---

# Part 6 — Data Display

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
