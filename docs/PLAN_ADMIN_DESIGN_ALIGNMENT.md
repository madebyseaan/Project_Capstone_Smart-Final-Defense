# PLAN — Admin Portal Design Alignment

## Goal
Fully refactor the **admin portal UI** to match the **registrar portal design language**.
Content, features, data and routes are preserved — this is a presentation-layer refactor.

## Decisions (locked)
1. **Modal system** — generalize `registrar-modal` into role-agnostic `src/components/app-modal/`.
   `registrar-modal/index.tsx` becomes a thin re-export so **no registrar file changes**.
2. **Tables/pagination** — adopt the `DataTable` system internals (`DataTable`, `TablePagination`,
   `usePagination`, `TableStates`), **restyled** to registrar's list-card language. No hand-rolled copies.
3. **Registrar scope** — admin only. Registrar pages stay byte-identical.
4. **Layout shell** — pages only. `AdminLayout`/`RegistrarLayout` already match; no shell refactor.

## Non-negotiables (AGENTS.md)
- No `text-gray-*` / `bg-gray-*` / `border-gray-*` / `text-slate-*` for chrome.
- No raw palette (`bg-emerald-600`, `bg-blue-100`, …) for UI chrome. Status **badges** keep tinted status colors.
- No `style={{ color / backgroundColor }}` except dynamic `useTheme().colors` and `app-modal` internals.
- No `font-black` / `font-light`. Page root `space-y-6` (never `space-y-8`).
- No `alert()` / `window.confirm()`.
- 1000-line hard limit per file.
- `npm run build` before finishing.

---

## Design Contract (canonical registrar patterns)

| Element | Pattern |
|---|---|
| Page root | `space-y-6 animate-fade-in max-w-[1400px] mx-auto w-full` |
| Header | `PageHeader` at **page root** (never inside `CardHeader`) |
| Primary action | `variant="default" size="sm" className="font-semibold text-xs shadow-sm shadow-primary/20"` |
| Secondary action | `variant="outline" size="sm" className="border-border/70 bg-background hover:bg-muted/70 text-foreground font-medium text-xs"` |
| Row action | `variant="ghost" size="sm" className="h-8 px-3 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground whitespace-nowrap -ml-2.5"` |
| Stat row | `grid grid-cols-2 lg:grid-cols-4 gap-4` + `StatCard` |
| List card | `Card className="border border-border shadow-sm bg-card overflow-hidden rounded-xl p-0"` |
| List card header | `px-6 py-4 border-b border-border flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4` |
| Section title / count | `text-base font-semibold text-foreground` / `text-sm text-muted-foreground` |
| Table wrapper | `<div className="overflow-x-auto"><Table>` |
| Table head cell | `text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3.5 px-4` |
| Table header row | `hover:bg-muted/50 border-b border-border bg-muted/50` |
| Table cell | `py-3.5 px-4 text-sm text-foreground align-middle whitespace-nowrap` |
| Missing value | `<Dash />` from `@/components/data-table` |
| Search | relative wrapper + `<Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />` + `<Input className="pl-8 h-9 w-56 rounded-lg text-xs" />` |
| Filter select | `<SelectTrigger className="w-32 h-9 rounded-lg text-xs font-medium">` |
| States | `LoadingSkeleton` / `EmptyState` / `ErrorState` from `@/components/data-table` |
| Page error | `h-64` centered `bg-destructive/10` circle + `AlertTriangle` + title + message + `Try Again` outline button |
| Tabs | shadcn `Tabs variant="line"` (not hand-rolled pills) |
| Theme tint | `style={{ backgroundColor: colors.primary }}` (`useTheme()` — sanctioned) |
| Feedback | shared `ConfirmDialog` (app-modal) + `toast` from `@/lib/toast` |

---

## P0 — Shared infrastructure

### 1. Generalize modal system
- Create `src/components/app-modal/index.tsx` — move the full implementation from `registrar-modal`.
- Rewrite `src/components/registrar-modal/index.tsx` as `export * from "@/components/app-modal";`
  (preserves every registrar import path; zero registrar page edits).
- Admin dialogs import from `@/components/app-modal`.

### 2. Restyle + extend `DataTable`
- `src/components/data-table/DataTable.tsx`:
  - Card → registrar list card (`border border-border shadow-sm bg-card overflow-hidden rounded-xl p-0`).
  - Add optional `title` / `description` props rendered in the registrar card header, with `toolbar` on the right.
  - Table header row → `bg-muted/50 border-b border-border`; standardized `TableHead` class.
- Verify `TablePagination` styling already matches registrar footer; keep generic "results" wording.
- Registrar does not import `DataTable`, so this restyle cannot affect it.

### 3. New small shared helpers (admin-facing)
- `src/components/common/ConfirmDialog.tsx` — built on `app-modal` (`destructive` + `loading`), replaces `alert`/`confirm`.
- `src/components/layout/PageError.tsx` — the repeated `h-64` error block (used by admin pages).
- Optional `src/components/layout/SearchInput.tsx` — search box wrapper.

---

## P1 — Simple pages

### `Dashboard.tsx` (364)
- Root → add `animate-fade-in max-w-[1400px] mx-auto w-full`.
- Stat/KPI blocks → `StatCard` grid (preserve all metrics; keep sparkline section styled to registrar Dashboard glass-card language if content requires).
- Fix dynamic Tailwind interpolation (`:326,328` — `bg-${color}-100` never compiles).
- Purge `shadow-gray-200/50`, `bg-white`, `border-gray-100`, raw badge palette.
- Loading → `bg-muted/30 animate-pulse`; error → destructive tile + `RefreshCw` Retry (registrar Dashboard pattern).

### `SchoolYears.tsx` (212)
- Table → `DataTable` + pagination; add search.
- `STATUS_COLORS` (`:44-49`) → consistent tinted status badge recipe.
- Raw alert banner (`:114`) → semantic banner.
- `confirm()` (`:101`) → `ConfirmDialog`.
- Raw dismiss `<button>` (`:117`) → `Button`.

### `ClassAssignments.tsx` (412)
- Both tables (`:302`, `:398`) → `DataTable` + pagination/search.
- Inline create form card (`:212-276`) → canonical card + shadcn form controls.
- Raw info/alert banners (`:185-207`) + status badges (`:334-349`) → semantic.
- `confirm()` (`:110`) → `ConfirmDialog`.
- Remove `any` types (`:28,40`).

### `EditRequests.tsx` (317)
- Move `PageHeader` from `CardHeader` (`:98-104`) to page root.
- Hand-rolled filter pills (`:107-120`) → shadcn `Tabs variant="line"` (or segmented control, no inline theme on raw buttons).
- `divide-y divide-gray-100` list (`:134,138`) → `DataTable` or canonical table.
- Purge `bg-blue-50`/`text-blue-600` (`:143`), `bg-slate-700` ticket (`:240`), raw `StatusBadge` palette (`:40-46`).
- Modals → `app-modal` (also see P4 `EditRequestModals.tsx`).

### `AuditLogs.tsx` (478)
- Custom stat cards (`:285-364`) → `StatCard`.
- Raw `Table` (`:417`) → `DataTable` + pagination + search.
- Header filters (`:377-412`) → DataTable toolbar.
- Purge `bg-gray-50/80` (`:419`), `border-gray-100` (`:368`), `hover:bg-gray-50/50` (`:441`).
- Inline spinner color (`:233`) → `text-primary`.
- `alert()` (`:223`) → `toast`.

---

## P2 — Medium pages

### `UserManagement.tsx` (737)
- Finish `DataTable` adoption: replace raw `Table` (`:319`) + manual `EmptyState` (`:332`) with `<DataTable>`; add pagination.
- `roleOpacity` hex concat (`:63-67,365,674`) → semantic opacity classes.
- `alert()` (`:168,193,208`) → `toast` / `ConfirmDialog`.
- Dialogs (`:410,534,652,717`) → `app-modal` (extract per-dialog components if >1000 lines).
- Keep `StatCard` + `TableToolbar`.

### `SystemHealth.tsx` (295)
- Drop double `p-6` (`:128`); root `space-y-6`.
- Wrap each panel in `Card`; raw `<table>` (`:275`) → `Table`; raw `<button>` (`:134-149`) → `Button`.
- Purge `border-slate-200 bg-white`, raw palette (`bg-emerald-600`, status colors) → semantic tokens.

### `TransmutationTable.tsx` (514)
- Raw `Table` (`:384`) → canonical `Table` (matrix layout stays custom).
- Replace hardcoded hex (`#dc2626`, `#fef2f2`, `#fecaca` at `:289-300,527`) → `Badge variant="destructive"` / destructive tokens.
- Inputs `border-gray-200` (`:330,418,429,443`) → `border-border`.
- Inline theme badges (`:448-456`), `bg-amber-100` (`:458`) → semantic status.

### `GradingConfig.tsx` (810)
- Fix bare `text-foreground` prop bug (`:418,425,429,445,523,672,707`) — must be in `className`.
- Raw `<table>` (`:739`) → `Table`; `tracking-wider` only on headers.
- Native `<select>` (`:712`) → `Select`; raw toggle (`:815`) → `Switch`/`Button`.
- Fallback hex `#8b5cf6`/`#f59e0b` (`:639,643,652,656`) → theme tokens.
- Reduce inline theme styling where not dynamic; purge raw palette badges/actions.
- `alert/confirm` (`:133,168,179,186,199,281,309,332`) → `toast`/`ConfirmDialog`.

---

## P3 — Large files (>1000 lines — must split)

### `SystemSettings.tsx` (1059)
- Split each quick-nav section into `src/pages/admin/components/` (e.g. `SchoolYearSection`, `SyncSection`, `GradeLockSection`, …); each ≤ 400 lines.
- Quick-nav `<a>` DOM-mutation hover (`:402-419`) → semantic hover classes.
- Purge `border-gray-*` / `bg-gray-50` throughout; raw palette banners.
- Native checkbox + inline `accentColor` (`:763-770`) → `Checkbox`.
- Fix mojibake `:540`.
- `alert()` (`:323`) → `toast`.

### `TemplateManager.tsx` (1073)
- Extract filter toolbar + templates table + preview into `src/pages/admin/components/` (≤ 400 each).
- Drop double `p-6` (`:485`); root `space-y-6 animate-fade-in max-w-[1400px] mx-auto w-full`.
- Move action toolbar (`:524-592`) into `PageHeader actions`.
- Native `<select>`/`<textarea>` → `Select`/`Textarea`; raw preview `<table>` (`:1110`) → styled table.
- Replace direct `axios` + local `SERVER_URL` (`:2,15,137,…`) → `adminApi` / `SERVER_URL` from `@/lib/api`.
- Custom stats (`:508-521`) → `StatCard`.
- `alert/confirm` (`:179,263,268,280,305,324,333,352,378`) → `toast`/`ConfirmDialog`.

---

## P4 — Admin child components (`src/pages/admin/components/`)

- `GradeLocksPanel.tsx` — wrap in `Card`; purge `text-gray-*`; raw `Table` → `Table`; `text-red-600` → destructive; root `mb-8` → parent `space-y-6`.
- `RolloverStatusCard.tsx` — wrap in `Card`; purge grays; raw chips/banners → semantic; `window.confirm` (`:40`) → `ConfirmDialog`.
- `DeveloperToolsCard.tsx` — root `mb-8` → parent spacing; raw colors in `<pre>` → semantic; `window.confirm` (`:15`) → `ConfirmDialog`.
- `EditRequestModals.tsx` — native inputs/textarea → shadcn; raw duration chips → semantic; info boxes → `InfoCard`/`AlertBanner`; `alert()` (`:51,148,217`) → `toast`.

---

## Phase order
1. **P0** — app-modal, DataTable restyle/extension, helpers. Run build.
2. **P1** — Dashboard, SchoolYears, ClassAssignments, EditRequests, AuditLogs.
3. **P2** — UserManagement, SystemHealth, TransmutationTable, GradingConfig.
4. **P3** — SystemSettings split, TemplateManager split.
5. **P4** — child components.
6. **P5** — verify + manual mobile pass.

Run `npm run build` after each page/component; `npm run lint` at phase boundaries.

## Per-page checklist
1. Root → `space-y-6 animate-fade-in max-w-[1400px] mx-auto w-full` (drop stray `p-6`).
2. `PageHeader` at root with standardized action buttons.
3. Stats → `StatCard` grid.
4. List card → registrar card + header; tables → `DataTable` (or canonical `Table` for matrices).
5. Add search/filter/pagination where a list lacks them.
6. Purge non-semantic grays + raw chrome palette (keep status badge tints).
7. Replace `alert`/`confirm` with `ConfirmDialog`/`toast`.
8. Fix bugs: bare `text-foreground` prop, dynamic Tailwind, hardcoded hex, axios bypass, `any` types.
9. Split any file > 1000 lines.
10. `npm run build`.

## Verification
```
npm run build
npm run lint
```
Manual: mobile ~375px — no horizontal scrollbar; cards/tables stack; footer buttons full width.

## File-size budgets
| File | Current | Target |
|---|---|---|
| `SystemSettings.tsx` | 1059 | ≤ 700 (+ section components ≤ 400 each) |
| `TemplateManager.tsx` | 1073 | ≤ 700 (+ section components ≤ 400 each) |
| `GradingConfig.tsx` | 810 | ≤ 700 |
| `UserManagement.tsx` | 737 | ≤ 700 |
| All other admin pages | < 600 | ≤ 600 |
| `app-modal/index.tsx` | 274 | ≤ 400 |

## Risks / guards
- The `registrar-modal` re-export must keep the public API and import path identical — **no registrar page edits**.
- `DataTable` restyle is safe (registrar does not import it); verify no admin page depends on old `border-0` style.
- Presentation-only: do not change data shapes, API calls, routes, or permissions.
- Split large files incrementally and build after each extraction to catch regressions.

## Out of scope
- Registrar pages, Teacher portal, layouts, backend, DB.
