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
