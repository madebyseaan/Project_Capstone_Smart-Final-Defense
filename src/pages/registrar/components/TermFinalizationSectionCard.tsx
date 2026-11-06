import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Eye,
  FileCheck2,
  FileEdit,
  Loader2,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { shortSubjectName } from "@/lib/subjectLabels";
import type {
  TermFinalizationSection,
  TermFinalizationSubject,
} from "@/lib/termFinalizationTypes";

interface TermFinalizationSectionCardProps {
  section: TermFinalizationSection;
  expanded: boolean;
  yearArchived: boolean;
  busyKey: string | null;
  onToggle: () => void;
  onViewGrades: () => void;
  onFinalizeSection: () => void;
  onUnfinalizeSection: () => void;
  onFinalizeSubject: (subject: TermFinalizationSubject) => void;
  onUnfinalizeSubject: (subject: TermFinalizationSubject) => void;
}

function gradeLevelLabel(value: string): string {
  return value.replace(/^GRADE_/, "Grade ");
}

function sectionStatus(section: TermFinalizationSection, archived: boolean) {
  if (archived || section.sectionStatus === "ARCHIVED" || section.sectionStatus === "COMPLETED") {
    return { label: "Archived", className: "bg-muted text-muted-foreground border-border" };
  }
  if (section.isFinalized) {
    return {
      label: "Finalized",
      className: "bg-emerald-50 text-emerald-700 border-emerald-200",
    };
  }
  if (section.draftCount > 0) {
    return { label: "Draft", className: "bg-amber-50 text-amber-700 border-amber-200" };
  }
  return { label: "No grades", className: "bg-muted text-muted-foreground border-border" };
}

function subjectStatus(subject: TermFinalizationSubject) {
  if (!subject.hasGrades) {
    return { label: "No grades", className: "bg-muted text-muted-foreground border-border" };
  }
  if (subject.draft > 0) {
    return { label: "Draft", className: "bg-amber-50 text-amber-700 border-amber-200" };
  }
  return { label: "Finalized", className: "bg-emerald-50 text-emerald-700 border-emerald-200" };
}

export default function TermFinalizationSectionCard({
  section,
  expanded,
  yearArchived,
  busyKey,
  onToggle,
  onViewGrades,
  onFinalizeSection,
  onUnfinalizeSection,
  onFinalizeSubject,
  onUnfinalizeSubject,
}: TermFinalizationSectionCardProps) {
  const archived =
    yearArchived ||
    section.sectionStatus === "ARCHIVED" ||
    section.sectionStatus === "COMPLETED";
  const status = sectionStatus(section, yearArchived);
  const progress =
    section.totalSubjects > 0
      ? Math.round((section.finalizedSubjects / section.totalSubjects) * 100)
      : 0;
  const sectionBusy = busyKey === `${section.sectionId}:section`;
  const actionsDisabled = archived || !section.canFinalize || !!busyKey;

  const renderSubjectAction = (subject: TermFinalizationSubject, testIdSuffix = "") => {
    const subjectKey = `${section.sectionId}:subject:${subject.subjectIds.join(",")}`;
    const subjectBusy = busyKey === subjectKey;

    if (subject.draft > 0) {
      return (
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          disabled={actionsDisabled || !!busyKey || section.eosyFinalized}
          title={
            section.eosyFinalized
              ? "Unfinalize EOSY before changing term grades"
              : undefined
          }
          onClick={() => onFinalizeSubject(subject)}
          data-testid={`term-finalization-finalize-subject${testIdSuffix}`}
        >
          {subjectBusy ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          ) : (
            <CheckCircle2 className="mr-1 h-3 w-3" />
          )}
          Finalize
        </Button>
      );
    }

    if (subject.finalized > 0) {
      return (
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs text-amber-700 border-amber-200 hover:bg-amber-50"
          disabled={actionsDisabled || !!busyKey || section.eosyFinalized}
          title={
            section.eosyFinalized
              ? "Unfinalize EOSY before unfinalizing term grades"
              : undefined
          }
          onClick={() => onUnfinalizeSubject(subject)}
          data-testid={`term-finalization-unfinalize-subject${testIdSuffix}`}
        >
          {subjectBusy ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          ) : (
            <FileEdit className="mr-1 h-3 w-3" />
          )}
          Unfinalize
        </Button>
      );
    }

    return <span className="text-xs text-muted-foreground">—</span>;
  };

  return (
    <Card
      className="border border-border bg-card shadow-sm rounded-xl p-0 overflow-hidden"
      data-testid="term-finalization-section"
      data-section-id={section.sectionId}
    >
      <CardContent className="p-0">
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            data-testid="term-finalization-section-toggle"
            className="flex min-w-0 flex-1 items-start gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <span className="mt-0.5 text-muted-foreground">
              {expanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-foreground">{section.sectionName}</span>
                <Badge variant="outline" className="text-[10px] font-medium">
                  {gradeLevelLabel(section.gradeLevel)}
                </Badge>
                {section.program !== "REGULAR" && (
                  <Badge variant="outline" className="text-[10px] font-medium">
                    {section.program}
                  </Badge>
                )}
                {section.eosyFinalized ? (
                  <Badge className="bg-primary/10 text-primary border-primary/30 text-[10px] font-medium">
                    EOSY finalized
                  </Badge>
                ) : section.eosyStarted ? (
                  <Badge className="bg-amber-50 text-amber-700 border-amber-200 text-[10px] font-medium">
                    EOSY partial
                  </Badge>
                ) : null}
                <Badge className={cn("text-[10px] font-medium", status.className)}>
                  {status.label}
                </Badge>
              </span>
              <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Users className="h-3.5 w-3.5" />
                  {section.adviserName ?? "No adviser"}
                </span>
                <span className="inline-flex items-center gap-1">
                  <BookOpen className="h-3.5 w-3.5" />
                  {section.finalizedSubjects}/{section.totalSubjects} subjects finalized
                </span>
                {section.draftCount > 0 && (
                  <span className="inline-flex items-center gap-1 text-amber-700">
                    <FileEdit className="h-3.5 w-3.5" />
                    {section.draftCount} draft grade{section.draftCount === 1 ? "" : "s"}
                  </span>
                )}
                {section.noGradeSubjects > 0 && (
                  <span className="inline-flex items-center gap-1 text-amber-700">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {section.noGradeSubjects} subject{section.noGradeSubjects === 1 ? "" : "s"} without grades
                  </span>
                )}
              </span>
              <span className="mt-2 flex items-center gap-2">
                <span className="h-1.5 w-full max-w-[320px] overflow-hidden rounded-full bg-muted">
                  <span
                    className={cn(
                      "block h-full rounded-full transition-all duration-300",
                      section.isFinalized ? "bg-emerald-500" : "bg-primary",
                    )}
                    style={{ width: `${progress}%` }}
                  />
                </span>
                <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
                  {progress}%
                </span>
              </span>
            </span>
          </button>

          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              disabled={section.subjects.length === 0}
              onClick={onViewGrades}
              data-testid="term-finalization-view-grades"
            >
              <Eye className="mr-1.5 h-3.5 w-3.5" />
              View grades
            </Button>
            {section.draftCount > 0 ? (
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                disabled={actionsDisabled || sectionBusy || section.eosyFinalized}
                title={
                  section.eosyFinalized
                    ? "Unfinalize EOSY before changing term grades"
                    : undefined
                }
                onClick={onFinalizeSection}
                data-testid="term-finalization-finalize-section"
              >
                {sectionBusy ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FileCheck2 className="mr-1.5 h-3.5 w-3.5" />
                )}
                Finalize section
              </Button>
            ) : section.finalizedCount > 0 ? (
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs text-amber-700 border-amber-200 hover:bg-amber-50"
                disabled={actionsDisabled || sectionBusy || section.eosyFinalized}
                title={
                  section.eosyFinalized
                    ? "Unfinalize EOSY before unfinalizing term grades"
                    : undefined
                }
                onClick={onUnfinalizeSection}
                data-testid="term-finalization-unfinalize-section"
              >
                {sectionBusy ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FileEdit className="mr-1.5 h-3.5 w-3.5" />
                )}
                Unfinalize
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground">No grades to finalize</span>
            )}
          </div>
        </div>

        {expanded && (
          <div className="border-t border-border">
            {section.subjects.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">
                No class assignments were found for this section in this term.
              </p>
            ) : (
              <>
              <div className="hidden overflow-x-auto lg:block">
                <Table className="min-w-[680px]">
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Subject
                      </TableHead>
                      <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Teacher
                      </TableHead>
                      <TableHead className="w-[90px] text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Draft
                      </TableHead>
                      <TableHead className="w-[100px] text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Finalized
                      </TableHead>
                      <TableHead className="w-[120px] text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Status
                      </TableHead>
                      <TableHead className="w-[140px] text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Action
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {section.subjects.map((subject) => {
                      const subjectState = subjectStatus(subject);
                      return (
                        <TableRow
                          key={`${section.sectionId}-${subject.subjectName}`}
                          className="border-border/60"
                          data-testid="term-finalization-subject"
                        >
                          <TableCell>
                            <p className="text-sm font-medium text-foreground">
                              {shortSubjectName(subject.subjectName)}
                            </p>
                            <p
                              className="text-[11px] text-muted-foreground"
                              title={subject.subjectName}
                            >
                              {subject.subjectName}
                              {subject.subjectCodes.length > 0
                                ? ` · ${subject.subjectCodes.join(", ")}`
                                : ""}
                            </p>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {subject.teacherNames.length > 0
                              ? subject.teacherNames.join(", ")
                              : "—"}
                          </TableCell>
                          <TableCell className="text-center text-sm tabular-nums">
                            {subject.draft > 0 ? (
                              <span className="font-medium text-amber-700">{subject.draft}</span>
                            ) : (
                              <span className="text-muted-foreground">0</span>
                            )}
                          </TableCell>
                          <TableCell className="text-center text-sm tabular-nums text-foreground">
                            {subject.finalized}
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge className={cn("text-[10px] font-medium", subjectState.className)}>
                              {subjectState.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            {renderSubjectAction(subject)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              <div className="divide-y divide-border lg:hidden">
                {section.subjects.map((subject) => {
                  const subjectState = subjectStatus(subject);
                  return (
                    <div
                      key={`${section.sectionId}-${subject.subjectName}-mobile`}
                      className="space-y-2 px-4 py-3"
                      data-testid="term-finalization-subject-mobile"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground">
                            {shortSubjectName(subject.subjectName)}
                          </p>
                          <p
                            className="truncate text-[11px] text-muted-foreground"
                            title={subject.subjectName}
                          >
                            {subject.subjectName}
                          </p>
                          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                            {subject.teacherNames.length > 0
                              ? subject.teacherNames.join(", ")
                              : "No teacher"}
                            {subject.subjectCodes.length > 0
                              ? ` · ${subject.subjectCodes.join(", ")}`
                              : ""}
                          </p>
                        </div>
                        <Badge
                          className={cn("shrink-0 text-[10px] font-medium", subjectState.className)}
                        >
                          {subjectState.label}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs text-muted-foreground">
                          <span className="font-medium text-amber-700">{subject.draft} draft</span>
                          {" · "}
                          {subject.finalized} finalized
                        </p>
                        {renderSubjectAction(subject, "-mobile")}
                      </div>
                    </div>
                  );
                })}
              </div>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
