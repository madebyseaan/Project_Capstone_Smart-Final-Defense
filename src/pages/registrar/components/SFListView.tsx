import type { ElementType } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Eye,
  FileText,
  FolderOpen,
  GraduationCap,
  Info,
  Layers,
  Printer,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TabsContent } from "@/components/ui/tabs";
import { PageHeader } from "@/components/layout/PageHeader";
import { FilterTabs } from "@/components/layout/FilterTabs";
import type { FilterTabItem } from "@/components/layout/FilterTabs";
import type { Section } from "@/lib/api";
import { cn } from "@/lib/utils";
import { StudentSelectionTable } from "./StudentSelectionTable";
import { formatGradeLevel } from "./formUtils";

interface FormStudent {
  id: string;
  lrn: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  suffix?: string;
  gender?: string;
}

type ClassFormId = "sf1" | "sf2" | "sf5" | "sf6";
export type Sf9Term = "T1" | "T2" | "T3";
type StudentFormId = "sf9" | "sf10";
export type { ClassFormId, StudentFormId };

interface ClassForm {
  id: ClassFormId;
  code: string;
  name: string;
  description: string;
  icon: ElementType;
  schoolWide?: boolean;
  actionLabel: string;
}

const CLASS_FORMS: ClassForm[] = [
  {
    id: "sf1",
    code: "SF1",
    name: "School Register",
    description: "Master list of enrolled learners.",
    icon: Users,
    actionLabel: "Print",
  },
  {
    id: "sf2",
    code: "SF2",
    name: "Daily Attendance",
    description: "Daily attendance report for a section and month.",
    icon: Clock,
    actionLabel: "Print",
  },
  {
    id: "sf5",
    code: "SF5",
    name: "Promotion Report",
    description: "Final academic performance and promotion status.",
    icon: CheckCircle2,
    actionLabel: "Print",
  },
  {
    id: "sf6",
    code: "SF6",
    name: "Summary Promotion",
    description: "School-wide promotion statistics across all sections.",
    icon: FileText,
    schoolWide: true,
    actionLabel: "Open report",
  },
];

const FORMS_TAB_ITEMS: FilterTabItem[] = [
  { value: "class", label: "Class Forms", icon: Layers },
  { value: "student", label: "Student Forms", icon: GraduationCap },
];

const STUDENT_FORM_TAB_ITEMS: FilterTabItem[] = [
  { value: "sf9", label: "SF9 Report Card", icon: FileText },
  { value: "sf10", label: "SF10 Permanent Record", icon: FolderOpen },
];

interface SFListViewProps {
  error: string | null;
  activeTab: "class" | "student";
  onTabChange: (value: "class" | "student") => void;
  activeClassForm: ClassFormId;
  onActiveClassFormChange: (value: ClassFormId) => void;
  studentForm: StudentFormId;
  onStudentFormChange: (value: StudentFormId) => void;
  sf9Term: Sf9Term;
  onSf9TermChange: (value: Sf9Term) => void;
  schoolYear: string;
  schoolYears: string[];
  onSchoolYearChange: (value: string) => void;
  selectedGrade: string;
  onGradeChange: (value: string) => void;
  uniqueGradeLevels: string[];
  selectedSection: string;
  onSectionChange: (value: string) => void;
  sections: Section[];
  filteredSectionsForDropdown: Section[];
  students: FormStudent[];
  studentsLoading: boolean;
  filteredStudents: FormStudent[];
  selectedStudentIds: string[];
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onToggleAll: () => void;
  onToggleStudent: (id: string) => void;
  onClearSelection: () => void;
  onViewSF1: () => void;
  onViewSF2: () => void;
  onViewSF5: () => void;
  onViewSF6: () => void;
  onPrintSF1: () => void;
  onPrintSF2: () => void;
  onPrintSF5: () => void;
  onViewSF9: (id?: string, term?: Sf9Term) => void;
  onViewSF10: (id?: string) => void;
  onBulkPrint: (formType: "sf9" | "sf10") => void;
  onBulkPrintAll: (formType: "sf9" | "sf10") => void;
}

export default function SFListView({
  error,
  activeTab,
  onTabChange,
  activeClassForm,
  onActiveClassFormChange,
  studentForm,
  onStudentFormChange,
  sf9Term,
  onSf9TermChange,
  schoolYear,
  schoolYears,
  onSchoolYearChange,
  selectedGrade,
  onGradeChange,
  uniqueGradeLevels,
  selectedSection,
  onSectionChange,
  sections,
  filteredSectionsForDropdown,
  students,
  studentsLoading,
  filteredStudents,
  selectedStudentIds,
  searchQuery,
  onSearchChange,
  onToggleAll,
  onToggleStudent,
  onClearSelection,
  onViewSF1,
  onViewSF2,
  onViewSF5,
  onViewSF6,
  onPrintSF1,
  onPrintSF2,
  onPrintSF5,
  onViewSF9,
  onViewSF10,
  onBulkPrint,
  onBulkPrintAll,
}: SFListViewProps) {
  const isClassTab = activeTab === "class";
  const isSchoolWideClassForm = isClassTab && activeClassForm === "sf6";
  const isCumulativeStudentForm = !isClassTab && studentForm === "sf10";

  const disableSchoolYear = isCumulativeStudentForm;
  const disableGradeSection = isSchoolWideClassForm;

  const selectedSectionName = sections.find((s) => s.id === selectedSection)?.name;

  let filterHint: string | null = null;
  if (isSchoolWideClassForm) {
    filterHint = "SF6 is a school-wide report — grade and section filters don't apply.";
  } else if (isCumulativeStudentForm) {
    filterHint = "SF10 covers all school years — the school year filter doesn't apply.";
  }

  const openClassForm = (form: ClassFormId) => {
    if (form === "sf1") onViewSF1();
    else if (form === "sf2") onViewSF2();
    else if (form === "sf5") onViewSF5();
    else onViewSF6();
  };

  const printClassForm = (form: ClassFormId) => {
    if (form === "sf1") onPrintSF1();
    else if (form === "sf2") onPrintSF2();
    else if (form === "sf5") onPrintSF5();
    else onViewSF6();
  };

  const previewStudent = (studentId: string) => {
    if (studentForm === "sf9") onViewSF9(studentId, sf9Term);
    else onViewSF10(studentId);
  };

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-6 animate-fade-in">
      <PageHeader
        title="DepEd School Forms"
        description="Generate, preview, and print official school forms"
      />

      {error && (
        <Card className="border-destructive/30 bg-destructive/5 p-0">
          <CardContent className="flex items-center gap-3 p-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-destructive/10">
              <AlertCircle className="h-4 w-4 text-destructive" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Error loading data</p>
              <p className="text-xs text-muted-foreground">{error}</p>
            </div>
          </CardContent>
        </Card>
      )}

      <FilterTabs
        value={activeTab}
        onValueChange={(value) => onTabChange(value as "class" | "student")}
        items={FORMS_TAB_ITEMS}
        className="space-y-4"
      >
        <div className="rounded-xl border border-border bg-card px-3 py-2.5">
          <div
            className={cn(
              "grid grid-cols-1 gap-3",
              isClassTab ? "sm:grid-cols-3" : "sm:grid-cols-2 lg:grid-cols-4"
            )}
          >
            <div className="min-w-0">
              <label
                htmlFor="forms-school-year"
                className="mb-1 block text-[11px] font-medium text-muted-foreground"
              >
                School Year
              </label>
              <Select
                value={schoolYear}
                onValueChange={(v: string | null) => v && onSchoolYearChange(v)}
                disabled={disableSchoolYear}
              >
                <SelectTrigger
                  id="forms-school-year"
                  aria-describedby={filterHint ? "forms-filter-hint" : undefined}
                  className="h-9 rounded-lg text-xs font-medium"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {schoolYears.map((sy) => (
                    <SelectItem key={sy} value={sy}>
                      {sy}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="min-w-0">
              <label
                htmlFor="forms-grade"
                className="mb-1 block text-[11px] font-medium text-muted-foreground"
              >
                Grade
              </label>
              <Select
                value={selectedGrade}
                onValueChange={(v: string | null) => v && onGradeChange(v)}
                disabled={disableGradeSection}
              >
                <SelectTrigger
                  id="forms-grade"
                  aria-describedby={filterHint ? "forms-filter-hint" : undefined}
                  className="h-9 rounded-lg text-xs font-medium"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Grades</SelectItem>
                  {uniqueGradeLevels.map((gl) => (
                    <SelectItem key={gl} value={gl}>
                      Grade {formatGradeLevel(gl)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="min-w-0">
              <label
                htmlFor="forms-section"
                className="mb-1 block text-[11px] font-medium text-muted-foreground"
              >
                Section
              </label>
              <Select
                value={selectedSection}
                onValueChange={(v: string | null) => v && onSectionChange(v)}
                disabled={disableGradeSection}
              >
                <SelectTrigger
                  id="forms-section"
                  aria-describedby={filterHint ? "forms-filter-hint" : undefined}
                  className="h-9 rounded-lg text-xs font-medium"
                >
                  <SelectValue placeholder="Select section">
                    {selectedSectionName
                      ? selectedGrade === "ALL"
                        ? `Grade ${formatGradeLevel(
                            sections.find((s) => s.id === selectedSection)?.gradeLevel ?? ""
                          )} - ${selectedSectionName}`
                        : selectedSectionName
                      : "Select section"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {filteredSectionsForDropdown.map((section) => (
                    <SelectItem key={section.id} value={section.id}>
                      {selectedGrade === "ALL"
                        ? `Grade ${formatGradeLevel(section.gradeLevel)} - ${section.name}`
                        : section.name}
                      {section.program && section.program !== "REGULAR"
                        ? ` (${section.program})`
                        : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {!isClassTab && (
              <div className="min-w-0">
                <label
                  htmlFor="sf9-term"
                  className="mb-1 block text-[11px] font-medium text-muted-foreground"
                >
                  Term
                </label>
                <Select
                  value={sf9Term}
                  onValueChange={(v: string | null) => v && onSf9TermChange(v as Sf9Term)}
                  disabled={studentForm !== "sf9"}
                >
                  <SelectTrigger
                    id="sf9-term"
                    title={studentForm !== "sf9" ? "Term filter applies to SF9 only" : undefined}
                    className="h-9 rounded-lg text-xs font-medium normal-case"
                  >
                    <SelectValue>{`Term ${sf9Term.replace("T", "")}`}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="T1">Term 1</SelectItem>
                    <SelectItem value="T2">Term 2</SelectItem>
                    <SelectItem value="T3">Term 3</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {filterHint && (
            <p
              id="forms-filter-hint"
              className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground"
            >
              <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
              <span>{filterHint}</span>
            </p>
          )}
        </div>

        <TabsContent value="class" className="space-y-3">
          <Card className="border-border p-0">
            <div className="divide-y divide-border">
              {CLASS_FORMS.map((form) => {
                const Icon = form.icon;
                const ActionIcon = form.id === "sf6" ? FileText : Printer;
                const needsSection = !form.schoolWide;
                const actionsDisabled = needsSection && !selectedSection;

                return (
                  <div
                    key={form.id}
                    onClick={() => onActiveClassFormChange(form.id)}
                    className="flex cursor-pointer flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-3"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                        <Icon className="h-4 w-4" aria-hidden="true" />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge
                            variant="outline"
                            className="h-5 px-1.5 font-mono text-[10px]"
                          >
                            {form.code}
                          </Badge>
                          <span className="text-sm font-semibold text-foreground">
                            {form.name}
                          </span>
                          {form.schoolWide && (
                            <Badge
                              variant="secondary"
                              className="h-5 text-[10px] font-medium"
                            >
                              School-wide
                            </Badge>
                          )}
                        </div>
                        <p className="truncate text-[13px] leading-5 text-foreground/70">
                          {form.description}
                        </p>
                      </div>
                    </div>

                    <div
                      className="flex shrink-0 items-center justify-end gap-2 self-end sm:self-auto"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 w-[112px] justify-center text-xs"
                        onClick={() => openClassForm(form.id)}
                        disabled={actionsDisabled}
                        title={actionsDisabled ? "Select a section first" : undefined}
                      >
                        <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                        Preview
                      </Button>
                      <Button
                        size="sm"
                        className="h-8 w-[112px] justify-center text-xs"
                        onClick={() => printClassForm(form.id)}
                        disabled={actionsDisabled}
                        title={actionsDisabled ? "Select a section first" : undefined}
                      >
                        <ActionIcon className="h-3.5 w-3.5" aria-hidden="true" />
                        {form.actionLabel}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {!selectedSection && (
            <p className="text-xs text-muted-foreground">
              Select a section to enable SF1, SF2, and SF5. SF6 is always available.
            </p>
          )}
        </TabsContent>

        <TabsContent
          value="student"
          className={cn("space-y-3", selectedStudentIds.length > 0 && "pb-20")}
        >
          <FilterTabs
            value={studentForm}
            onValueChange={(value) => onStudentFormChange(value as StudentFormId)}
            items={STUDENT_FORM_TAB_ITEMS}
            className="w-full"
          />

          {!selectedSection ? (
            <Card className="border-dashed p-0">
              <CardContent className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                  <Users className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                </div>
                <p className="text-sm font-semibold text-foreground">
                  Select a grade and section to load students.
                </p>
                <p className="text-xs text-muted-foreground">
                  Use the filters above to choose a class.
                </p>
              </CardContent>
            </Card>
          ) : (
            <StudentSelectionTable
              filteredStudents={filteredStudents}
              selectedStudentIds={selectedStudentIds}
              searchQuery={searchQuery}
              onSearchChange={onSearchChange}
              onToggleAll={onToggleAll}
              onToggleStudent={onToggleStudent}
              onClearSelection={onClearSelection}
              studentForm={studentForm}
              sf9Term={sf9Term}
              onPreview={previewStudent}
              onBulkPrint={onBulkPrint}
              onBulkPrintAll={onBulkPrintAll}
              totalStudents={students.length}
              isLoading={studentsLoading}
            />
          )}
        </TabsContent>
      </FilterTabs>
    </div>
  );
}
