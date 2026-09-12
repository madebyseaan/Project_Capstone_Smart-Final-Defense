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
              {title && (
                <h2 className="text-base font-semibold text-foreground">{title}</h2>
              )}
              {description && (
                <p className="text-sm text-muted-foreground">{description}</p>
              )}
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
                <ErrorState
                  message={error}
                  columnCount={columns.length}
                  onRetry={onRetry}
                />
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
