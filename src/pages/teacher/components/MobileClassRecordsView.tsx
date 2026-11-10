import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Archive,
  BookOpen,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Search,
  Trash2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { SURFACE } from "./MobileDashboardTokens";
import type { ClassAssignment } from "@/lib/api";

interface MobileClassRecordsViewProps {
  activeClasses: ClassAssignment[];
  archivedClasses: ClassAssignment[];
  searchTerm: string;
  onSearchChange: (value: string) => void;
  termFilter: "current" | "full";
  onTermFilterChange: (value: "current" | "full") => void;
  onRequestDelete: (id: string, name: string) => void;
}

const gradeLevelLabels: Record<string, string> = {
  GRADE_7: "Grade 7",
  GRADE_8: "Grade 8",
  GRADE_9: "Grade 9",
  GRADE_10: "Grade 10",
};

function getGradeTone(gradeLevel: string) {
  switch (gradeLevel) {
    case "GRADE_7":
      return {
        card: "bg-emerald-50/40 border-emerald-200/70 dark:bg-emerald-500/10 dark:border-emerald-500/20",
        accent: "border-l-emerald-400 dark:border-l-emerald-500",
        tile: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
        badge:
          "bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/20",
      };
    case "GRADE_8":
      return {
        card: "bg-amber-50/40 border-amber-200/70 dark:bg-amber-500/10 dark:border-amber-500/20",
        accent: "border-l-amber-400 dark:border-l-amber-500",
        tile: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
        badge:
          "bg-amber-50 text-amber-700 border-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/20",
      };
    case "GRADE_9":
      return {
        card: "bg-rose-50/40 border-rose-200/70 dark:bg-rose-500/10 dark:border-rose-500/20",
        accent: "border-l-rose-400 dark:border-l-rose-500",
        tile: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
        badge:
          "bg-rose-50 text-rose-700 border-rose-100 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/20",
      };
    case "GRADE_10":
      return {
        card: "bg-blue-50/40 border-blue-200/70 dark:bg-blue-500/10 dark:border-blue-500/20",
        accent: "border-l-blue-400 dark:border-l-blue-500",
        tile: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
        badge:
          "bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/20",
      };
    default:
      return {
        card: "bg-indigo-50/40 border-indigo-200/70 dark:bg-indigo-500/10 dark:border-indigo-500/20",
        accent: "border-l-indigo-400 dark:border-l-indigo-500",
        tile: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300",
        badge:
          "bg-indigo-50 text-indigo-700 border-indigo-100 dark:bg-indigo-500/10 dark:text-indigo-300 dark:border-indigo-500/20",
      };
  }
}

function ActiveClassCard({ assignment }: { assignment: ClassAssignment }) {
  const tone = getGradeTone(assignment.section.gradeLevel);
  const learnerCount = assignment.section.enrollments?.length ?? 0;

  return (
    <Link
      to={`/teacher/records/${assignment.id}`}
      className={cn(
        "flex items-center gap-3 rounded-2xl border border-l-4 p-4 shadow-[0_10px_30px_-24px_rgba(15,23,42,0.28)] transition-transform active:scale-[0.99]",
        tone.card,
        tone.accent,
      )}
    >
      <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", tone.tile)}>
        <BookOpen className="h-5 w-5" aria-hidden="true" />
      </div>

      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-[0.95rem] font-semibold leading-snug text-foreground">
          {assignment.subject.name}
        </p>
        <p className="mt-0.5 truncate text-[0.8rem] font-medium text-muted-foreground">
          Section {assignment.section.name}
        </p>
        <span
          className={cn(
            "mt-1.5 inline-flex rounded-full border px-2 py-0.5 text-[0.8rem] font-semibold",
            tone.badge,
          )}
        >
          {gradeLevelLabels[assignment.section.gradeLevel] ?? assignment.section.gradeLevel}
        </span>
      </div>

      <div className="shrink-0 text-right">
        <p className="text-[1.3rem] font-semibold leading-none tabular-nums text-foreground">
          {learnerCount}
        </p>
        <p className="mt-1 text-[0.8rem] font-medium text-muted-foreground">
          {learnerCount === 1 ? "learner" : "learners"}
        </p>
      </div>

      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden="true" />
    </Link>
  );
}

function ArchivedClassRow({
  assignment,
  onRequestDelete,
}: {
  assignment: ClassAssignment;
  onRequestDelete: (id: string, name: string) => void;
}) {
  const transferred = assignment.archivedReason === "ATLAS_REASSIGNED";
  const learnerCount = assignment.section.enrollments?.length ?? 0;

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-2xl border p-3",
        transferred
          ? "border-amber-200/70 bg-amber-50/40 dark:border-amber-500/20 dark:bg-amber-500/10"
          : "border-rose-200/70 bg-rose-50/40 dark:border-rose-500/20 dark:bg-rose-500/10",
      )}
    >
      <Link
        to={`/teacher/records/${assignment.id}`}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
            transferred
              ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
              : "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
          )}
        >
          <BookOpen className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.875rem] font-semibold text-foreground">
            {assignment.subject.name}
          </p>
          <p className="mt-0.5 truncate text-[0.8rem] font-medium text-muted-foreground">
            Section {assignment.section.name} · {learnerCount}{" "}
            {learnerCount === 1 ? "learner" : "learners"}
          </p>
          <span
            className={cn(
              "mt-1 inline-flex rounded-full border px-2 py-0.5 text-[0.8rem] font-semibold",
              transferred
                ? "border-amber-200 bg-amber-50 text-amber-700"
                : "border-rose-200 bg-rose-50 text-rose-700",
            )}
          >
            {transferred ? "Transferred" : "Archived"}
          </span>
        </div>
      </Link>

      {!transferred && (
        <button
          type="button"
          onClick={() => onRequestDelete(assignment.id, assignment.subject.name)}
          aria-label={`Delete ${assignment.subject.name}`}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-rose-600 transition-colors active:bg-rose-100"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export default function MobileClassRecordsView({
  activeClasses,
  archivedClasses,
  searchTerm,
  onSearchChange,
  termFilter,
  onTermFilterChange,
  onRequestDelete,
}: MobileClassRecordsViewProps) {
  const [archivedOpen, setArchivedOpen] = useState(false);
  const count = activeClasses.length;
  const archivedCount = archivedClasses.length;

  return (
    <div className="space-y-5 lg:hidden">
      <div className={cn("flex items-center gap-3 p-4", SURFACE)}>
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-[0_12px_24px_-14px_rgba(0,0,0,0.55)]">
          <BookOpen className="h-6 w-6" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-[1.5rem] font-semibold leading-tight tracking-tight text-foreground">
            My classes
          </h1>
          <p className="mt-1 text-[0.8rem] font-medium text-muted-foreground">
            {count} {count === 1 ? "class" : "classes"}{" "}
            {termFilter === "current" ? "this term" : "this year"}
          </p>
        </div>
      </div>

      <div className={cn("space-y-2 p-3", SURFACE)}>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            inputMode="search"
            placeholder="Search classes"
            aria-label="Search class records"
            value={searchTerm}
            onChange={(event) => onSearchChange(event.target.value)}
            className="h-12 rounded-xl border-border bg-background pl-10 text-base font-medium"
          />
        </div>

        <div className="flex gap-1 rounded-xl bg-muted p-1">
          {(["current", "full"] as const).map((value) => {
            const active = termFilter === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => onTermFilterChange(value)}
                aria-pressed={active}
                className={cn(
                  "min-h-12 flex-1 rounded-lg text-[0.8rem] font-semibold transition-colors",
                  active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
                )}
              >
                {value === "current" ? "This term" : "Full year"}
              </button>
            );
          })}
        </div>
      </div>

      {count > 0 ? (
        <div className="space-y-2.5">
          {activeClasses.map((assignment) => (
            <ActiveClassCard key={assignment.id} assignment={assignment} />
          ))}
        </div>
      ) : (
        <div className={cn("px-4 py-10 text-center", SURFACE)}>
          <BookOpen className="mx-auto h-7 w-7 text-muted-foreground/60" aria-hidden="true" />
          <p className="mt-3 text-[0.9rem] font-semibold text-foreground">
            {searchTerm ? "No classes match your search" : "No classes this term"}
          </p>
          <p className="mt-1 text-[0.8rem] font-medium text-muted-foreground">
            {searchTerm
              ? "Try a different subject, section, or grade."
              : "Switch to Full year or check back after the next sync."}
          </p>
        </div>
      )}

      {archivedCount > 0 && (
        <section className="space-y-2">
          <button
            type="button"
            onClick={() => setArchivedOpen((open) => !open)}
            aria-expanded={archivedOpen}
            className={cn("flex w-full items-center gap-3 p-4 text-left", SURFACE)}
          >
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
              <Archive className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[0.9rem] font-semibold text-foreground">Archived</p>
              <p className="mt-0.5 text-[0.8rem] font-medium text-muted-foreground">
                {archivedCount} {archivedCount === 1 ? "record" : "records"}
              </p>
            </div>
            {archivedOpen ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground/60" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground/60" aria-hidden="true" />
            )}
          </button>

          {archivedOpen && (
            <div className="space-y-2">
              {archivedClasses.map((assignment) => (
                <ArchivedClassRow
                  key={assignment.id}
                  assignment={assignment}
                  onRequestDelete={onRequestDelete}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
