# Student Records Table Reference

> **Purpose:** Give the workhorse a precise, low-risk design brief for polishing `src/pages/registrar/StudentRecords.tsx`.
>
> **Important:** This is a planning document only. Do not implement from assumptions. The Student Records desktop table should become the visual reference for future standard tables only after it is reviewed and approved.

## 1. Objective

Improve the desktop Student Records table so it feels like a modern professional school-management system rather than a default static data grid.

The target direction is the table shown in the provided reference image:

- Quiet white surface with clear hierarchy
- Compact but comfortable row density
- Strong student-name identity through initials/avatar treatment
- Small semantic badges for gender, grade, and enrollment status
- Clear separation between metadata and the primary student name
- Filters grouped into one purposeful toolbar
- One obvious row action: `View`
- Subtle interaction feedback instead of excessive gradients, shadows, or animation

This is a **visual and presentation-state refactor**, not a data or routing refactor.

## 2. Current File Map

Only `src/pages/registrar/StudentRecords.tsx` is in scope for this investigation.

| Area | Current location | Direction |
|---|---:|---|
| Page shell and heading | 320–333 | Preserve behavior; keep the existing `PageHeader` |
| Summary cards | 335–347 | Preserve for this table pass; do not redesign the dashboard system here |
| Table card and filters | 349–420 | Polish the visual hierarchy and responsive wrapping |
| Mobile cards | 423–491 | **Do not change** in this pass |
| Desktop table | 493–584 | Main implementation target |
| Pagination | 587–661 | Preserve behavior; improve visual consistency only |
| Student detail dialog | 665 onward | **Do not change** in this pass |

Existing table state imports are at lines 52–53. The workhorse must verify the actual shared component API before changing its usage. Do not invent props that the shared component does not support.

## 3. Anti-Drift Contract

These rules are mandatory for the implementation.

1. Change only the Student Records page and, if necessary, a small reusable table presentation component extracted from it.
2. Do not change `registrarApi`, request parameters, response mapping, filter logic, pagination slicing, route paths, dialog behavior, or authentication.
3. Do not migrate this page to React Query as part of the UI work.
4. Do not redesign the mobile card view, student detail dialog, form-status cards, or print behavior.
5. Do not add a second component library.
6. Do not add an animation library. Use existing shadcn primitives, Tailwind tokens, and existing CSS animation utilities.
7. Do not replace the table with a card grid on desktop. This page is the canonical standard-table example.
8. Do not use gradients, glassmorphism, row transforms, excessive rounded containers, or decorative illustrations.
9. Do not introduce raw palette colors for UI chrome. Use semantic tokens such as `bg-card`, `bg-muted`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary`, and their opacity variants.
10. Dynamic school branding through `useTheme()` may remain where it is already used. Do not replace it with hardcoded colors.
11. Preserve the current page-size options and pagination behavior unless a separate product decision is made.
12. Keep `StudentRecords.tsx` below the repository's 1000-line limit. Extract the desktop table if needed; do not split unrelated dialog logic.

## 4. Recommended Safe Architecture

Do not refactor the entire codebase while polishing this page.

### First implementation

Extract only the desktop table presentation into a focused component if that keeps the page readable:

`src/pages/registrar/components/StudentRecordsTable.tsx`

The component may receive:

- The already-filtered/paginated students
- `loading` and the existing error state if needed
- The existing `handleViewStudent` callback
- The existing theme colors only where dynamic branding is required
- Search/filter context needed for the empty message

The component must not fetch data, alter filters, calculate statistics, or own pagination.

### Later generalization

After this page is approved, extract the visual rules into the shared DataTable system and apply them to other standard tables one page at a time. Do not generalize first and discover the visual direction later.

## 5. Target Table Composition

The desktop table should have this stable structure:

```text
PageHeader
Summary cards
Table card
  Table card header
    Title: All Students
    Result count / active-filter context
    Toolbar: school year, search, grade, section
  Table viewport
    Table header
    Table body
  Pagination footer
Student detail dialog
```

The table card should retain one outer surface. Avoid adding a separate card around every column or row.

### Outer card

- Use the existing shadcn `Card`.
- Keep one consistent radius and one restrained shadow.
- Use `overflow-hidden` on the card so the table and separators align with its edges.
- Keep the border subtle; do not use heavy double borders.
- The card header may use a very light `bg-muted/30` or remain the card surface. Choose one treatment and keep it consistent.

### Table viewport

- Keep horizontal scrolling for narrow desktop/tablet widths.
- Use a minimum table width only if needed to prevent compressed labels and badges.
- Do not hide important columns on desktop.
- Keep the header visible while scrolling the table if this can be done without changing the page scroll model or breaking the mobile layout.

## 6. Column Design Specification

Use explicit column intent. The visual design should not be left to browser auto-sizing.

| Column | Visual treatment | Alignment | Notes |
|---|---|---|---|
| LRN | Muted monospace/tabular number | Left | Narrow, readable, never visually dominant |
| Student Name | Initial avatar + bold primary name | Left | Widest column; preserve full name visibility as much as practical |
| Gender | Small semantic outline badge | Left or center | Must have a text fallback when missing |
| Grade Level | Branded or neutral outline badge | Left or center | Use the existing school-brand color only through the theme system |
| Section | Regular text, muted when secondary | Left | Missing value uses the canonical placeholder |
| Status | Semantic status badge | Left or center | `ENROLLED` should be positive; other known states must remain distinguishable |
| Actions | Ghost/outline `View` button with eye icon | Right | Keep one clear action; preserve the existing callback |

Suggested relative widths:

- LRN: 14–16%
- Student Name: 32–38%
- Gender: 10–12%
- Grade Level: 12–14%
- Section: 14–17%
- Status: 12–14%
- Actions: 9–11%

The exact percentages are less important than maintaining a visibly dominant Student Name column and a compact Actions column.

## 7. Row Design

### Normal row

- Comfortable height, approximately 64–72px including cell padding.
- Use a quiet bottom separator such as `border-border/70`.
- Avoid vertical borders between every cell.
- Use `hover:bg-muted/30` or an equivalent token-based hover state.
- Do not scale, translate, or lift rows on hover.
- Keep the student name at `font-semibold` or `font-bold` only if the surrounding type scale supports it. Avoid making every cell bold.
- Use `tabular-nums` for LRN and numeric values.

### Student identity cell

- Keep the initial avatar because it gives the table visual identity and helps scanning.
- Use a stable, accessible label. The avatar should not be the only way to identify the student.
- Keep the full name as visible text: `LAST NAME, FIRST NAME MIDDLE NAME SUFFIX`.
- If a secondary line is added, use only useful metadata such as LRN. Do not duplicate the entire name.
- Preserve dynamic theme branding through `colors.primary`; do not hardcode a new avatar palette.

### Action cell

- Keep the existing `handleViewStudent` behavior.
- Use a minimum 24px target; preferably a 32–36px button height.
- The icon must have a visible or accessible label. `View` text is preferred over an icon-only control in this table.
- Include a visible focus ring using the existing semantic `ring` token.

## 8. Placeholder and Missing-Data Standard

This is the most important part of the requested improvement.

### Canonical display

Use one shared visual placeholder for unavailable table values:

- Display: an em dash, `—`
- Color: `text-muted-foreground/50` or the approved equivalent
- Weight: regular, never bold
- Meaning: unavailable or not provided, not an error by itself
- Accessibility: provide an accessible label such as `Not available` when the visual dash would otherwise be ambiguous

Do not use these competing forms in the table:

- `-`
- `--`
- `N/A`
- Empty text
- An empty colored badge

### Per-column rules

- Missing LRN: muted dash, not a monospace blank.
- Missing student name: treat as a data-quality problem; show the dash and do not create an empty avatar label.
- Missing gender: show a muted dash. Do not render an empty pink/green badge.
- Missing grade: show a muted dash or a neutral outline placeholder, but choose one and document it.
- Missing section: show the canonical dash.
- Missing status: show the canonical dash or an explicitly neutral `Not set` badge. Never show a green/orange status badge with no meaningful value.

### Known value versus missing value

Keep semantic styling only for known values:

- `ENROLLED`: positive semantic badge
- `TRANSFERRED`: informational semantic badge
- Other known statuses: neutral/warning/destructive only when the status actually means that
- Unknown/missing status: neutral placeholder, never a guessed status

The placeholder must look intentionally quiet. It should not compete with names, badges, or actions.

## 9. Loading State Design

The current call passes `rowCount={limit}`. That is unsafe visually when `limit` is 250 or 500. The workhorse must cap the visible skeleton rows.

Recommended behavior:

- Keep the card header, filters, column headers, and table dimensions stable while loading.
- Render 6–10 skeleton rows, regardless of the selected maximum page size.
- Match skeleton shapes to columns:
  - LRN: short monospace-like bar
  - Student Name: avatar circle plus a wider text bar
  - Gender/Grade/Status: pill-shaped bars
  - Section: medium text bar
  - Actions: compact button bar
- Use varied widths. Do not render identical full-width bars in every cell.
- Use the existing shimmer animation if available. Do not add a new loading dependency.
- Keep motion subtle and respect reduced-motion preferences.

The loading state must not cause the table header or filter controls to jump vertically when the data arrives.

## 10. Empty and Error States

### No records

When the dataset itself is empty:

- Keep the table header and card structure.
- Render one valid table row with one cell spanning all columns.
- Use an icon inside a soft muted circular container.
- Title: `No students found` or another page-specific message.
- Hint: explain the next useful action, such as checking the selected school year or syncing enrollment data.

### Filters produce no matches

When students exist but the active search/grade/section filters produce no rows:

- Use a different message, such as `No matching students`.
- Include the active search term where useful.
- Hint: `Try adjusting your search or filters.`
- If a clear-filters action already exists or can be added without changing behavior, make it the empty-state action. Do not add a new filter architecture.

### Error

- Keep the page/table context where possible instead of replacing the entire page with a generic blank screen.
- Use the existing retry behavior or reload behavior. Do not change API handling.
- Use a clear error message and a visible `Try again` button.
- Do not style an error using color alone; retain text and icon meaning.

All state rows must be valid table markup: `TableBody` → `TableRow` → `TableCell`.

## 11. Toolbar Improvements

The current toolbar is at lines 351–420. Preserve all four controls and their values.

Recommended visual treatment:

- Make the title/result count and filters visually separate groups.
- Keep search as the widest control.
- Use one consistent control height and radius across Select triggers and Input.
- Keep the keyboard shortcut indicator, but ensure it does not obscure the input on smaller widths.
- Allow controls to wrap cleanly; do not force horizontal overflow.
- On smaller desktop widths, the search field may occupy a full row while selects wrap below it.
- Use visible labels or accessible names even when the select trigger only displays `All Grades` or `All Sections`.
- Do not add filter chips, command palettes, or new toolbar actions in this pass.

## 12. Pagination Improvements

The existing pagination calculations and page-size options must remain functionally identical.

Visual goals:

- Keep the range summary readable: `Showing X–Y of Z learners`.
- Use consistent button sizes and visible focus states.
- Disabled controls must look disabled and remain keyboard-safe.
- Make the current page clearly selected without relying on color alone.
- Keep the footer separated from the table by one border only.
- On narrow widths, stack the summary, page-size control, and page navigation without clipping.

Do not silently replace the current page-size options with a different list during this visual pass.

## 13. Accessibility Requirements

- Use the native table semantics already provided by shadcn components.
- Every table header must describe its column.
- Every icon-only control must have an accessible label. The current `View` text should remain visible.
- Do not use color as the only distinction between gender, grade, or status.
- Preserve visible keyboard focus for search, selects, pagination, and View buttons.
- Keep interactive targets at least 24px; 32–36px is preferable for the View control.
- Ensure placeholder values are understandable to screen-reader users.
- Verify the table at 200% zoom and on a narrow viewport.
- Respect `prefers-reduced-motion`.

## 14. Implementation Sequence

The workhorse should implement in this order:

1. Capture the current Student Records page in loading, normal, empty, filtered-empty, error, dark-mode, and narrow-width states.
2. Confirm the current shared `LoadingSkeleton`, `EmptyState`, and `Dash` APIs before editing their call sites.
3. Extract the desktop table presentation only if necessary to keep `StudentRecords.tsx` readable and under 1000 lines.
4. Stabilize the table shell, toolbar, column widths, row spacing, student identity cell, badges, and View action.
5. Apply the canonical placeholder rules to the desktop table only.
6. Apply the capped, column-aware loading skeleton.
7. Apply distinct empty and filtered-empty messages.
8. Polish pagination without changing calculations or options.
9. Run the verification checklist below.
10. Stop and request review. Do not migrate another page until this page is approved.

## 15. Verification Checklist

### Functional safety

- [ ] School year selection still reloads the same records.
- [ ] Search still matches student names and LRN exactly as before.
- [ ] Grade and section filters still reset or constrain each other as before.
- [ ] Pagination still slices the same records.
- [ ] Page-size options still work.
- [ ] View opens the same student detail dialog and loads the same data.
- [ ] Mobile cards are unchanged.
- [ ] No backend, API, route, or auth files changed.

### Visual quality

- [ ] Normal rows resemble the reference direction without copying hardcoded colors.
- [ ] Student Name is the visual anchor of each row.
- [ ] Badges are compact and semantic.
- [ ] Missing values use one quiet em-dash treatment.
- [ ] Loading rows are realistic and capped at 6–10.
- [ ] Empty and filtered-empty states are intentional, not blank table bodies.
- [ ] Hover and focus states are subtle and visible.
- [ ] Toolbar controls wrap without clipping.
- [ ] Pagination remains usable on narrow widths.
- [ ] Dark mode uses semantic tokens and has readable contrast.

### Required commands

```bash
npm run lint
npm run build
```

## 16. Approval Gate: Make This the UI Standard

Do not treat this table as the standard until the user reviews it visually.

After approval, document the final decisions in a separate reference standard:

- Card and toolbar composition
- Column width strategy
- Row height and separator treatment
- Avatar/name cell pattern
- Badge variants
- Canonical missing-value placeholder
- Loading skeleton shapes and row cap
- Empty/error state layout
- Pagination footer
- Motion and accessibility rules

Only then should the workhorse migrate `AlumniStudents`, `RemedialTracker`, `SectionRosterViewer`, and other standard tables. Each migration must preserve page behavior and use this Student Records page as the visual benchmark.

## 17. Stop Conditions

Stop and ask before proceeding if any of these become necessary:

- Changing an API response or backend route
- Changing filter or pagination semantics
- Replacing local state with a new state-management pattern
- Adding a dependency other than an already-approved project dependency
- Redesigning the mobile cards or detail dialog
- Changing print styles or school-form layouts
- Adding a new color palette, font, animation system, or component library
- Touching unrelated registrar pages before Student Records is approved
