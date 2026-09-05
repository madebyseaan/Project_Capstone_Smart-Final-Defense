# Registrar UI Polish — Implementation Plan (Handoff)

> **Goal:** Make the Registrar portal the visual reference standard for the entire SMART UI.
> **Mode:** Presentation-layer only. No data-layer changes. No new architecture.
> **Result:** After completion + user approval, the patterns built here get codified (Section 6) and Admin/Teacher portals must follow them exactly.

---

## 0. Context (why this exists)

- The shared DataTable system (`src/components/data-table/`) has **zero consumers** — every page hand-rolls its own tables, loading, empty, and placeholder patterns.
- `TableStates.tsx` renders nested `<Table>` elements inside the parent `<TableBody>` (invalid HTML — browsers hoist the nested table and break layout).
- Registrar pages currently use 4 competing missing-value conventions (`"—"`, `"-"`, `"--"`, `"N/A"`), multiple spinner patterns, and one hand-rolled pulse skeleton.
- The app has `tw-animate-css` installed and imported in `index.css` but almost never used. Custom keyframes (`shimmer`, `fadeIn`, `slideUp`) exist in `index.css` already.
- There is **no toast system** anywhere — saves/syncs/errors happen silently.

**Definition of "modern professional" for this system:** consistent states, subtle motion, responsive feedback, semantic tokens. NOT: more libraries, illustrations, or redesigns.

---

## 1. Guardrails (NON-NEGOTIABLE — read before writing any code)

1. **No data-layer changes.** Pages use local `useState` + `useEffect` + direct `registrarApi` calls. Keep that. React Query migration is a separate future task — do NOT start it.
2. **No API/route/schema changes.** Zero backend edits.
3. **Maximum ONE new dependency: `sonner`.** Nothing else. No framer-motion, no vaul, no illustration packs, no second component library.
4. **AGENTS.md banned patterns are enforced** — this includes fixing existing violations, not copying them:
   - `bg-slate-900/95` (Registrar Dashboard tooltip, line ~61) → semantic tokens
   - `text-gray-*`, `text-slate-*` in UI chrome → `text-foreground` / `text-muted-foreground`
   - Chart data-series hex colors (recharts `fill`) are **allowed** — data-viz, not UI chrome. Centralize them as a constant, don't scatter.
5. **Do not touch:** mobile card views (StudentRecords, SectionRosterViewer), SF form grids, print styles in `index.css` (SF forms must still print), FormViewer/PrintCenter visuals, the exotic layouts (ClassRecordTable ledger, AttendanceReports SF2 grid, Schedule timetable).
6. **File size:** 1000 lines max. SchoolForms.tsx is already 2142 — you may EXTRACT the student-selection table section into a component, do not grow the file.
7. **Every page batch ends with:** `npm run lint` + `npm run build` (root). Fix all errors before moving on.
8. **No functional changes.** Every button, filter, sync, and flow must behave identically before and after. This is a reskin of states, not a refactor of behavior.

---

## 2. Allowed additions

| Addition | Purpose |
|---|---|
| `sonner` (npm) | Toast notifications — shadcn's official toast |
| `src/lib/toast.ts` | Thin wrapper: `toast.success/error/promise` so call sites never import sonner directly |
| `useCountUp` hook (`src/hooks/useCountUp.ts`, ~30 lines, custom) | Animated number count-up for StatCard values |
| `Dash` component (`src/components/data-table/Dash.tsx`) | Single missing-value placeholder convention |
| Motion via existing `tw-animate-css` classes + existing `index.css` keyframes | Entrance/hover polish |

---

## 3. Phase 0 — Shared Foundation (build first, registrar pages consume it)

### 3.1 Fix TableStates HTML bug
`src/components/data-table/TableStates.tsx` — `LoadingSkeleton`, `EmptyState`, `ErrorState` each render a full nested `<Table>`. They must render only `<TableRow><TableCell colSpan={n}>` fragments (no `<Table>`, no `<TableHeader>/<TableBody>` wrappers) so they compose legally inside a parent `<TableBody>`.

### 3.2 Skeleton v2 (LoadingSkeleton)
- Keep real column headers visible during load (they're static config — skeleton-ing them is noise and causes layout jump).
- Row count: `clamp(rowsPerPage, 6, 10)`.
- Add `TableColumn.skeleton?: "name" | "pill" | "badge" | "number" | "date" | "avatar"` to `types.ts`. Each hint maps to varied width/shape (e.g. name = `h-4 w-28`, pill = `h-6 w-16 rounded-full`, badge = `h-5 w-14 rounded-md`, number = `h-4 w-10`, date = `h-4 w-20`, avatar = `h-8 w-8 rounded-full`). Default = `h-4 w-full` at ~80% width.
- Use the existing `shimmer` keyframe from `index.css` (add a `.skeleton-shimmer` utility if needed) — no flat gray bars.
- No two adjacent cells in a row should have identical widths — vary per column.

### 3.3 EmptyState v2
- Height: `py-14` (taller than current `h-32`).
- Icon in a `h-12 w-12 rounded-full bg-muted flex items-center justify-center` circle.
- Title (existing type scale) + hint + `action?: ReactNode` slot.
- Support search-echo: optional `searchTerm` prop → renders "No results for 'foo'" when a filter was active vs. a plain "nothing yet" message when the dataset is empty. Differentiate these two cases.

### 3.4 ErrorState v2
- Same layout language as EmptyState v2, destructive-tinted icon circle.
- Accept `onRetry` and always render the Retry button when provided (React Query `refetch` or the page's existing reload fn).

### 3.5 Dash component
```tsx
// src/components/data-table/Dash.tsx
<span className="text-muted-foreground/40 select-none">&mdash;</span>
```
Export from the barrel. This replaces ALL of `"—"`, `"-"`, `"--"`, `"N/A"` for missing values in migrated tables.

### 3.6 Sonner
- `npm install sonner`
- Mount `<Toaster richColors position="top-right" />` at app root (wherever providers live in `main.tsx`/`App.tsx`).
- `src/lib/toast.ts` wrapper. Call sites use the wrapper only.

### 3.7 useCountUp
`src/hooks/useCountUp.ts` — animates 0 → target over ~800ms with easeOut, `requestAnimationFrame` based, respects `prefers-reduced-motion` (jump straight to value). Wire into `StatCard` value display.

### 3.8 Motion rules (apply everywhere, this is the anti-drift core)
- **Entrance:** `animate-in fade-in slide-in-from-bottom-1 duration-300` (4px rise, 300ms). Stagger cards/stat rows by 50ms (`style={{ animationDelay }}`). Fire **once** on mount — never on every refetch.
- **Hover:** interactive elements only (rows with `onRowClick`, buttons, cards that navigate). 150ms transitions. Tables: the existing `hover:bg-muted/50` is correct — don't add transforms to table rows.
- **Loading:** shimmer skeletons + spinner buttons (button label swaps to `Loader2 animate-spin` while its action runs). This is the ONLY place anything loops.
- **Nothing** slides across the screen, bounces, or animates infinitely.
- **Respect `prefers-reduced-motion`** in the count-up hook; CSS animations degrade automatically.

---

## 4. Phase 1 — Registrar Pages (strict order)

### 4.1 `pages/registrar/Dashboard.tsx` (612 lines)
- Replace full-page `Loader2` block (~L97+ render) with dashboard-shaped shimmer: grid of stat-card skeletons + chart-area skeletons (`h-64 rounded-xl` shimmer blocks).
- `StatCard` values → `useCountUp`.
- Staggered entrance on stat cards and quick actions (Section 3.8).
- **Fix banned patterns:** `GlowTooltip` container `bg-slate-900/95 ... border-white/10` (~L61) → `bg-popover text-popover-foreground border-border` with `shadow-lg`. Keep the `GRADE_COLORS` hex array (~L49) but move to a named constant with a comment-free `// data-viz palette` note OR into `lib/constants.ts` — do not inline-scatter.
- Sync button → `toast.promise` wrapping the existing sync call.
- Charts: no changes beyond the tooltip fix (recharts already looks right).

### 4.2 `pages/registrar/StudentRecords.tsx`
- Desktop table only (mobile card view untouched).
- Replace full-page spinner (~L303–309) with in-table `LoadingSkeleton` (keep toolbar + headers visible).
- Delete the dead/unreachable inner `loading` branch (~L427–430).
- Empty states (desktop ~L518–525) → shared `EmptyState` with real `emptyTitle`/`emptyHint` + search-echo when filters are active.
- Placeholders: replace `"-"` (sectionName, gender, SF9 grades, promotionStatus) and `"N/A"` with `<Dash />`. Prose fallbacks ("Not Set", "No address on record") may stay where they read better.
- Replace hand-rolled pagination footer with `TablePagination` (keep the exact same page-size behavior).
- Wire `onRetry` on error state to the existing reload fn.

### 4.3 `pages/registrar/AlumniStudents.tsx`
- Same treatment as 4.2. In-tbody spinner row (~L353–358) → `LoadingSkeleton`; empty row (~L359–365) → shared `EmptyState`; `gender || "-"` (~L371) → `<Dash />`; custom pagination → `TablePagination`. colSpan=9 — pass `columnCount={9}`.
- Card container gets the standard Card treatment if it differs from DataTable's (`border-0 shadow-lg shadow-muted/50 rounded-xl`).

### 4.4 `pages/registrar/RemedialTracker.tsx`
- Card-level spinner (~L397–400) → in-table skeleton; keep the separate error card pattern but restyle ErrorState layout to match v2.
- Empty row (~L425–432) → shared `EmptyState`.
- `"--"` placeholders (LRN ~L454, RFG ~L591, outcome ~L617) → `<Dash />`.
- The expanded-row plain `<table>` sub-rows (~L545–645) → shadcn `Table` components (visual consistency; keep structure identical).

### 4.5 `pages/registrar/SectionRosterViewer.tsx`
- Replace the hand-rolled `animate-pulse` rows (~L238–251) with shared `LoadingSkeleton`.
- Empty state (~L263–268) → shared `EmptyState`.
- Adviser `|| "--"` (~L308) → `<Dash />`.
- Mobile card view untouched.

### 4.6 `pages/registrar/TeachingLoad.tsx` (card list — no table)
- Full-page spinner (~L64–70) → card-shaped skeletons matching the layout (grouped by faculty).
- Empty banner (~L163–175) → `EmptyState` layout language (icon circle + title + hint), keep the rollover explanation text.
- `"—"` coverage (~L156) → `<Dash />`.
- Staggered entrance on faculty groups.

### 4.7 Toast wiring (all registrar pages)
- Every sync button, export action, and destructive confirm (EOSY especially) gets `toast.promise` or `toast.success/error`.
- EOSY flows: confirm dialogs stay, but their success/failure outcomes toast. Never auto-dismiss destructive failures.

### 4.8 `pages/registrar/SchoolForms.tsx` (2142 lines — minimal scope)
- Student-selection table (~L1463–1532) currently has NO loading and NO empty state — blank tbody on empty filter. Add shared skeleton + `EmptyState` with search-echo.
- Extract ONLY that table section into `pages/registrar/components/StudentSelectionTable.tsx` to respect the 1000-line rule. Mechanical move, no behavior change.
- No other visual changes to this page.

---

## 5. Verification protocol (after every numbered page)

```
npm run lint        # zero errors
npm run build       # zero type errors
```

Manual check (dev server, registrar portal):
- [ ] Loading state shows skeleton (no full-page spinner), headers visible
- [ ] Empty state differentiates "no data" vs "no filter results"
- [ ] Missing values render Dash consistently
- [ ] Pagination still works, same page sizes
- [ ] All buttons/filters/syncs behave as before
- [ ] Dark mode: no hardcoded grays anywhere on the page
- [ ] SF forms still print correctly (if page has print flows)

---

## 6. Completion — Extract the Reference Standard

Once the user approves the registrar portal:

1. Create `plans/ui-reference-standard.md` documenting the final patterns:
   - Screenshot-anchored descriptions of each state (skeleton / empty / error / dash / toast)
   - The motion rules from 3.8 verbatim
   - StatCard count-up, stagger, tooltip token recipe
   - The canonical DataTable page scaffold (toolbar → table → pagination composition)
2. Update `AGENTS.md` DataTable section: add `skeleton` column prop, `Dash` convention, toast wrapper, "loading = in-table skeleton rows, never full-page spinner", motion rules summary.
3. Admin and Teacher batches then migrate AGAINST that doc — any pattern not in it requires asking the user first.

**Drift tripwires (for the workhorse):**
- You're about to install a second package → STOP, ask.
- You're about to edit a `.api` call, hook logic, or backend file → STOP, ask.
- You're about to add a new color/animation not in Section 3.8 → STOP, ask.
- You're about to restyle a mobile card view, SF grid, or print style → STOP, ask.
