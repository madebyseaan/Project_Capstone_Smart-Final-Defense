# SMART UI Consistency & DataTable Standardization Plan

> **Status:** PLANNING ONLY — do not treat as implemented. This document is the execution spec for the implementing agent.
> **Scope:** Professional, consistent shadcn look. Not a full polish/rebrand. **Zero new dependencies.**

---

## Why this plan exists (audit findings)

A live audit of the codebase found:

- **Headers:** 33 `<h1>` elements with 4 size variants (`text-2xl` → `text-5xl`), 3 weights (`bold`/`black`/`semibold`), and 4 different color methods (`text-slate-900`, `text-gray-900`, inline `style={{ color: '#111827' }}`, default). No `PageHeader` component exists.
- **Tokens bypassed:** `index.css` has proper shadcn oklch tokens + `@theme` font mapping, but pages hardcode grays. `ui/table.tsx` hardcodes `text-zinc-500`; `ui/pagination.tsx` hardcodes `bg-blue-600`.
- **Tables:** 17 files import `ui/table` primitives, but every page hand-rolls its own toolbar/search/pagination.
- **Dead code:** `ui/pagination.tsx` is imported by **zero** pages — 5+ pages roll their own pagination with conflicting conventions:
  - `AlumniStudents.tsx` — 0-based pages, default 50 rows
  - `RemedialTracker.tsx` — 1-based pages, default 25 rows
  - `SectionRosterViewer.tsx` / `StudentRecords.tsx` — 1-based, custom inline footers
  - Different button variants (`ghost` vs `outline`), different count labels
- **Search bars:** 14 hand-rolled search inputs with inconsistent widths, rounding, and placeholders.
- **No state components:** No skeleton, empty-state, or error-state components exist anywhere in `src/`.

---

## Phase 0 — Ground Rules & Inventory (half day)

### 0.1 Define the "tokens of truth"

The ONLY allowed styling sources after migration:

- **Colors:** shadcn semantic tokens — `text-foreground`, `text-muted-foreground`, `bg-card`, `border`, `bg-muted`, `text-primary`, etc.
- **Fonts:** `font-sans` (DM Sans) for everything. Weights allowed: `font-medium`, `font-semibold`, `font-bold`.

**Banned after migration:**

- `style={{ color: ... }}` (inline color styles)
- `text-gray-*`, `text-slate-*`, `text-zinc-*`
- `bg-blue-600` and other raw palette colors for UI chrome
- `font-black`, `font-light`
- `tracking-wider` on body text (table headers only)

**Exception:** `ThemeContext` dynamic colors (`colors.primary`) may keep inline styles where already used. Do NOT refactor ThemeContext in this effort.

### 0.2 Inventory (deliverable: checklist, not code)

- List all 33 `h1` usages → classify each as PAGE_HEADER (migrate) vs DOCUMENT_CONTENT (skip).
- **Explicitly out of scope:**
  - DepEd form document renders: `SchoolForms.tsx` internal `h1`s, `FormViewer.tsx`, `SF5Form.tsx`, `ExcelRenderer`, print documents
  - Login pages (branded hero layouts): `LoginPage.tsx`, `AdminLoginPage.tsx`, `RegistrarLoginPage.tsx`

**Acceptance:** Banned-token list added to AGENTS.md; page inventory checklist complete.

---

## Phase 1 — Typography & Token Foundation

### 1.1 Fix `src/index.css`

- `@theme inline`: keep `--font-sans: DM Sans...`. Make `--font-heading` intentional — pick ONE:
  - **Recommended:** single font family (`font-sans` everywhere); weights carry hierarchy. Less drift, cleaner.
- Remove dead `--heading: Poppins` var if unused.

### 1.2 Codify the type scale (every page obeys this)

| Role | Classes |
|---|---|
| Page title | `text-2xl font-bold tracking-tight text-foreground` |
| Page subtitle | `text-sm text-muted-foreground` |
| Card/section title | `text-base font-semibold text-foreground` |
| Card description | `text-sm text-muted-foreground` |
| Table header | `text-xs font-medium uppercase tracking-wide text-muted-foreground` |
| Table cell | `text-sm text-foreground` |
| Stat label | `text-xs font-medium text-muted-foreground` |
| Stat value | `text-2xl font-bold text-foreground` |

### 1.3 De-hardcode `ui/` primitives

- `table.tsx` `TableHead`: `text-zinc-500` → `text-muted-foreground`
- `pagination.tsx`: `bg-blue-600` → `bg-primary hover:bg-primary/90`; `text-gray-600`/`text-gray-400` → tokens
- `card.tsx`: `text-zinc-900`/`text-zinc-400` → tokens

### 1.4 Standard page scaffold convention

- Page root: `<div className="space-y-6">` (migrate away from ad-hoc `space-y-8`)
- Table containers: `Card` with `p-0` + `overflow-x-auto` wrapper — one canonical class string reused everywhere

**Acceptance:** `npm run build` passes; grep confirms zero `zinc`/`blue-600` in `ui/`; type scale documented in AGENTS.md.

---

## Phase 2 — Shared Layout Components

### 2.1 Create `src/components/layout/PageHeader.tsx`

```ts
interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;   // buttons, rendered right-aligned
  badge?: ReactNode;     // optional status badge next to title
  className?: string;
}
```

- Renders: `h1` (page-title scale from 1.2) + description + responsive action row
- Layout: `flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4`
- No icons, no eyebrows, no gradients — plain and professional.

### 2.2 Create `src/components/layout/StatCard.tsx` (high ROI — repeated 5+ times across dashboards)

```ts
interface StatCardProps {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  iconClassName?: string;
}
```

### 2.3 Page layout audit pass

- Verify `AdminLayout` / `TeacherLayout` / `RegistrarLayout` provide page padding; inner pages must not re-add inconsistent margins.
- Document expected inner spacing in AGENTS.md.

**Acceptance:** Pilot page (see 4.1) uses `PageHeader` and looks correct in light + dark mode.

---

## Phase 3 — DataTable System (the core)

Create `src/components/data-table/` — composable, typed, **no new deps**:

```
src/components/data-table/
├── DataTable.tsx           # generic <T> table: columns + rows + state wiring
├── TableToolbar.tsx        # search + filter slots + actions
├── TablePagination.tsx     # footer: counts + rows-per-page + page buttons
├── TableStates.tsx         # EmptyState, LoadingSkeleton, ErrorState
├── usePagination.ts        # normalize 0/1-based pages everywhere
└── types.ts                # TableColumn<T>, TableFilters
```

### 3.1 `types.ts` — column contract

```ts
interface TableColumn<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;   // width/alignment per column
  align?: "left" | "center" | "right";
}
```

### 3.2 `usePagination.ts` — kill the 0-based/1-based split

```ts
const { page,          // ALWAYS 1-based externally
        totalPages,
        rowsPerPage,
        totalRows,
        setPage,
        setRowsPerPage,  // changing this resets page to 1
        slice           // (rows: T[]) => T[]  for client-side mode
      } = usePagination({ totalRows, initialRowsPerPage?: 10 });
```

- Rows-per-page allowed values: `[10, 25, 50, 100]`
- Default: **25** app-wide

### 3.3 `TableToolbar.tsx`

- **SearchInput pattern:** `Search` icon + `Input`, `placeholder="Search..."`, `className="pl-9 w-full sm:w-64"`, debounced 300ms (internal `useDebouncedValue`)
- **Filter slot:** array of `{ label, value, onChange, options }` rendered as `Select` — uniform `w-36` triggers
- Right side: `actions?: ReactNode`
- Any filter/search change → reset to page 1 (handled by `usePagination` wiring, not per-page)

### 3.4 `TableStates.tsx`

- **LoadingSkeleton:** N `TableRow`s × column count, `animate-pulse` muted rows. Requires adding `src/components/ui/skeleton.tsx` via shadcn CLI.
- **EmptyState:** centered icon + title + hint + optional action ("No users found" / "Try adjusting your search")
- **ErrorState:** destructive-tinted, retry action
- All render as full-width `TableRow`/`TableCell` (`colSpan` = column count) so they occupy real table geometry

### 3.5 `TablePagination.tsx` — one canonical footer

- Left: `Showing X to Y of Z` (`text-sm text-muted-foreground`)
- Center: rows-per-page `Select` (`Rows per page: 25`)
- Right: first / prev / numbered pages with ellipsis / next / last — reuse logic from existing dead `ui/pagination.tsx`, restyled to tokens; then **delete or re-export** `ui/pagination.tsx` so only one pagination exists
- Hidden entirely when `totalRows <= smallest rows-per-page option`

### 3.6 `DataTable.tsx` — thin generic assembler

```ts
interface DataTableProps<T> {
  columns: TableColumn<T>[];
  rows: T[];               // already filtered; slice handled via usePagination
  loading?: boolean;
  error?: string | null;
  emptyTitle?: string;
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  toolbar?: ReactNode;     // <TableToolbar .../>
  pagination: ReturnType<typeof usePagination>;
}
```

Composes `ui/table` primitives + states + footer.

**Important:** Pages with exotic layouts (`ClassRecordTable` ledger, SF form grids) **keep using raw primitives** — DataTable is for standard list views only.

**Acceptance:** Verified via pilot migration (Phase 4.1).

---

## Phase 4 — Migration Waves (page-by-page, one commit per page)

Order = highest drift + highest visibility first. Each migration: swap header → `PageHeader`, table block → `DataTable` family, banned tokens → semantic tokens, `space-y-6`.

**Rendering-only changes — no logic/data changes.**

| Wave | Pages |
|---|---|
| **4.1 Pilot** | `admin/UserManagement.tsx` + `registrar/StudentRecords.tsx` (worst offenders) — validate the system, adjust components here if needed |
| **4.2 Admin** | `ClassAssignments`, `AuditLogs`, `GradingConfig`, `SchoolYears`, `TransmutationTable`, `TemplateManager`, `SystemSettings`, `EditRequests`, `Dashboard` |
| **4.3 Registrar** | `RemedialTracker` (kills 1-based inline pagination), `TeachingLoad`, `AlumniStudents` (kills 0-based), `SectionRosterViewer`, `PrintCenter`, `EOSYFinalization` tabs, `Dashboard` |
| **4.4 Teacher** | `ClassRecordsList`, `MyAdvisory`, `Attendance`, `AttendanceReports`, `StudentGradeProfile`, `Schedule`, `Dashboard` |
| **4.5 Dashboards** (last, separately) | Dashboard stat rows → `StatCard`; dashboards have bespoke layouts — only align typography + tokens, don't force DataTable |

### Per-page checklist (same every time)

1. `PageHeader` replaces hand-rolled `h1` + `p`
2. Toolbar → `TableToolbar` (search + filters + actions)
3. Table + empty/loading/error → `DataTable`
4. Footer → `TablePagination`
5. Remove inline styles / gray-slate-zinc classes
6. `npm run lint && npm run build` green

### Out of scope (do not touch)

- Login/hero pages
- DepEd document renders (`SchoolForms` internals, `FormViewer`, `SF*Form`)
- `ClassRecordTable` ledger
- `ExcelRenderer`
- `ThemeContext`

---

## Phase 5 — Lock It In

### 5.1 Grep audit must return zero

```bash
rg "style=\{\{ ?color" src/pages
rg "text-(gray|slate|zinc)-" src/pages        # excluding document-render files
rg "font-black" src/
rg "from \"@/components/ui/pagination\"" src/pages
```

### 5.2 Full verification

- `npm run lint` — green
- `npm run build` — green (required by AGENTS.md)
- Spot-check light + dark mode on one page per portal

### 5.3 Update AGENTS.md with

- Type scale table
- "Banned patterns" list
- `PageHeader` / `DataTable` usage snippets
- Rows-per-page standard (25 default, `[10, 25, 50, 100]`)
- 1-based pagination rule

---

## Effort Estimate

| Phase | Nature | Risk |
|---|---|---|
| 0–3 | Foundation — the thinky part | Medium (get the API right) |
| 4 | Mechanical repetition, safe to parallelize per portal | Low |
| 5 | Gate | Low |
