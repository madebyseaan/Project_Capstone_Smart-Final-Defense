# AI Handoff — SMART Data Table Design for MRF

**How to use this document:** paste it into the MRF-side AI coding agent as the task brief. It is fully self-contained: the agent does not need access to the SMART repository. MRF supplies its own columns, rows, data source, and labels; the visual design (structure, typography, spacing, states, interactions) must match this spec exactly.

Companion docs:
- `AI_HANDOFF_SIDEBAR_TOPBAR.md` — app shell
- `AI_HANDOFF_MODALS_DRAWERS.md` — dialogs and slide-over drawers

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
