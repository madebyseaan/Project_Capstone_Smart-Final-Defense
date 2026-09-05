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
import type { TableColumn } from "./types";
import { LoadingSkeleton, EmptyState, ErrorState } from "./TableStates";
import { TablePagination } from "./TablePagination";
import type { usePagination } from "./usePagination";

interface DataTableProps<T> {
  columns: TableColumn<T>[];
  rows: T[];
  loading?: boolean;
  error?: string | null;
  emptyTitle?: string;
  emptyHint?: string;
  emptySearchTerm?: string;
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  toolbar?: ReactNode;
  pagination: ReturnType<typeof usePagination>;
  onRetry?: () => void;
}

export function DataTable<T>({
  columns,
  rows,
  loading,
  error,
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

  return (
    <Card className="border-0 shadow-lg shadow-muted/50 rounded-xl bg-card p-0">
      {toolbar && (
        <div className="px-6 py-4 border-b border-border">{toolbar}</div>
      )}
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {columns.map((col) => (
                  <TableHead key={col.key} className={col.className}>
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
                    className={onRowClick ? "cursor-pointer" : undefined}
                  >
                    {columns.map((col) => (
                      <TableCell
                        key={col.key}
                        className={col.className}
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
