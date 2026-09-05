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

  return (
    <Skeleton className={classes[hint ?? "name"]} style={{ opacity: 0.6 }} />
  );
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
          <p className="text-sm font-semibold text-foreground">
            {displayTitle}
          </p>
          {displayHint && (
            <p className="text-sm text-muted-foreground max-w-xs">
              {displayHint}
            </p>
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
