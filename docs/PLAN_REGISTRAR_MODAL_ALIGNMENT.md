# PLAN — Registrar Modal Design Alignment

## Goal
Migrate ALL registrar-portal modals to the unified "Registrar Modal" design system extracted from `CompleteRemedialDialog` (StudentRecords-inspired: `border-2` tinted cards, `rounded-xl sm:rounded-2xl`, generous responsive padding, theme-color tints, zero horizontal scroll).

## The Design System (DONE — do not recreate)

**File:** `src/components/registrar-modal/index.tsx`

Exports (all pull `colors` from `useTheme()` internally — NO color props needed):

| Export | Purpose | Key props |
|---|---|---|
| `RegistrarModal` | Full modal shell: header (icon tile + title + description), children, footer (Cancel/Confirm w/ loading spinner) | `open, onOpenChange, icon, title, description?, size, confirmLabel?, onConfirm?, confirmDisabled?, destructive?, loading?, hideFooter?` |
| `InfoCard` | Tinted border-2 info card (identity grids) | `tone ("primary"\|"secondary"\|"accent"), label, children` |
| `StatTile` | Compact stat tile | `tone, icon, label, value, hint?` |
| `AlertBanner` | Callout banner | `variant ("danger"\|"warning"\|"info"), title?, children` |
| `StepCards` | Numbered action-step cards | `steps: {title, hint?}[], tones?` |
| `ModalSection` | Bordered content block wrapper (tables/lists) | `title?, badge?, children` |

**Shell sizes:** `sm` (confirm dialogs) / `md` (default) / `lg` (tables) / `xl` (rosters).
**Shell base:** `max-h-[90vh] overflow-y-auto overflow-x-hidden p-4 sm:p-6 md:p-8 border-0 shadow-2xl bg-card rounded-xl sm:rounded-2xl gap-0`.
**Footer:** `flex flex-col-reverse sm:flex-row sm:justify-end` — Cancel outline + Confirm (primary or destructive red), spinner when `loading`.

## Reference Implementation (DONE — copy this pattern)
`src/pages/registrar/components/CompleteRemedialDialog.tsx` — shows: identity grid of `InfoCard`s → `StatTile` row → `AlertBanner` validation → `ModalSection` table (fluid `w-full`, NO `min-w`/`overflow-x-auto`) → `StepCards` → danger `AlertBanner` → footer.

## Migration Inventory (3 remaining modals)

### 1. `src/pages/registrar/components/EOSYConfirmDialog.tsx` (easy — start here)
Currently: plain `sm:max-w-md` dialog with its own variant system.
- Replace shell with `RegistrarModal size="sm"` — its `variant: "danger" | "warning" | "info"` maps to `destructive` prop (danger) or default.
- Body: wrap description in `AlertBanner` with matching variant.
- Delete its local `variantConfig` + footer — shell handles both.
- Props stay the same (`open, onOpenChange, title, description, confirmLabel, variant, loading, onConfirm`) so `EOSYFinalization.tsx` needs no changes.

### 2. `src/pages/registrar/StudentRecords.tsx` — Student Detail Dialog (medium)
Currently: `w-[95vw] sm:!max-w-3xl ... xl:!max-w-6xl`, raw `Dialog/DialogContent`.
- Replace shell with `RegistrarModal size="xl" hideFooter icon={<Users className="w-6 h-6" />} title="Student Record"` (view-only).
- Keep ALL body sections (info grid, SF readiness grid, SF9/SF10 tables) — they already follow the tinted-card language; just swap raw `DialogTitle` header and keep `space-y-6 sm:space-y-8` body.
- `FormStatusCard` stays as-is (already on design).

### 3. `src/pages/registrar/SectionRosterViewer.tsx` — Roster Dialog (medium)
Currently: `w-[95vw] sm:!max-w-4xl ... max-h-[85vh] flex flex-col p-0` with sticky header + toolbar + scrollable table.
- This one has an internal scroll layout (`flex flex-col`, table scrolls, header fixed). Use `RegistrarModal` with `size="xl"` BUT keep its `flex flex-col` structure:
  - Option A (preferred): keep raw `Dialog` here — this is a full-viewport app-style dialog, not a confirm dialog. Only align the chrome: `rounded-xl`, `shadow-2xl`, `border-0`, header icon tile pattern.
  - Use `ModalSection` for the roster table block if it fits.

## Rules
- NO `w-[95vw]` (shell's `max-w-[calc(100%-2rem)]` handles mobile).
- NO `min-w-[...]` + `overflow-x-auto` tables inside modals — use fluid `w-full` tables with `whitespace-nowrap` numeric cells; text wraps.
- Tints always from theme: `${color}08` bg + `${color}30` border via `InfoCard`/`StatTile` — never hardcode.
- `memo` all extracted modal components; `useCallback` handlers passed in.
- If `if (!data) return null` guards exist, keep them (don't render empty shells).

## File-Size Budget (1000-line hard limit)

**Every modal is its own component file.** Never inline a `RegistrarModal` tree into a page — extract to `src/pages/registrar/components/<Name>Dialog.tsx`, keep the page as state + data + `<NameDialog ... />`.

| File | Current | Budget after migration |
|---|---|---|
| `registrar-modal/index.tsx` | 260 | ≤ 400 (only grows if adding new primitives) |
| `StudentRecords.tsx` | 786 | ≤ 600 — extract dialog → `StudentDetailDialog.tsx` (≈220 lines move out) |
| `RemedialTracker.tsx` | 657 | ≤ 750 |
| `SectionRosterViewer.tsx` | 643 | ≤ 750 |
| `EOSYConfirmDialog.tsx` | 82 | ≤ 120 |
| New dialog files | — | ≤ 400 each |

**If a file exceeds its budget mid-migration, split at these points:**
- `StudentRecords.tsx` → dialog → `components/StudentDetailDialog.tsx`; mobile card list → `components/StudentCardList.tsx`
- `RemedialTracker.tsx` → toolbar + conducted-dates row → `components/RemedialToolbar.tsx`
- `SectionRosterViewer.tsx` → roster table body → `components/RosterTableBody.tsx`

## Verification (after each modal)
```
npm run build
npx eslint src/pages/registrar src/components/registrar-modal
```
Then manual check: mobile width (~375px) — no horizontal scrollbar, footer buttons stack full-width.

## Out of scope
- Teacher/admin portals, non-modal UI, backend.
