import { useState, useMemo, useCallback } from "react";

const ROWS_PER_PAGE_OPTIONS = [10, 25, 50, 100] as const;
const DEFAULT_ROWS_PER_PAGE = 25;

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
