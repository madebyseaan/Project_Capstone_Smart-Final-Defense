import type { ElementType } from "react";
import {
  FolderOpen,
  FileText,
  Users,
  Clock,
  CheckCircle2,
  Eye,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Section } from "@/lib/api";
import { HelpTooltip } from "@/components/ui/tooltip";
import { PageHeader } from "@/components/layout/PageHeader";
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

interface SchoolForm {
  id: string;
  name: string;
  fullName: string;
  description: string;
  icon: ElementType;
  color: string;
  status: "active" | "dev";
}

const schoolForms: SchoolForm[] = [
  {
    id: "SF1",
    name: "School Register",
    fullName: "School Form 1 - School Register",
    description: "Master list of enrolled students.",
    icon: Users,
    color: "gray",
    status: "active",
  },
  {
    id: "SF2",
    name: "Daily Attendance",
    fullName: "School Form 2 - Daily Attendance Report",
    description: "Daily attendance tracking.",
    icon: Clock,
    color: "gray",
    status: "active",
  },
  {
    id: "SF5",
    name: "Promotion Report",
    fullName: "School Form 5 - Report on Promotion",
    description: "Final academic performance.",
    icon: CheckCircle2,
    color: "gray",
    status: "active",
  },
  {
    id: "SF6",
    name: "Summary Promotion",
    fullName: "School Form 6 - Summary Promotion Report",
    description: "School-wide promotion statistics.",
    icon: FileText,
    color: "purple",
    status: "active",
  },
  {
    id: "SF9",
    name: "Report Card",
    fullName: "School Form 9 - Learner's Progress Report Card",
    description: "Term-based issued report card.",
    icon: FileText,
    color: "blue",
    status: "active",
  },
  {
    id: "SF10",
    name: "Permanent Record",
    fullName: "School Form 10 - Learner's Permanent Academic Record",
    description: "Official cumulative record.",
    icon: FolderOpen,
    color: "green",
    status: "active",
  },
];

interface SFListViewProps {
  error: string | null;
  schoolYear: string;
  schoolYears: string[];
  onSchoolYearChange: (value: string) => void;
  selectedGrade: string;
  onGradeChange: (value: string) => void;
  uniqueGradeLevels: string[];
  selectedSection: string;
  selectedStudent: string;
  onSectionChange: (value: string) => void;
  sections: Section[];
  filteredSectionsForDropdown: Section[];
  students: FormStudent[];
  filteredStudents: FormStudent[];
  selectedStudentIds: string[];
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onToggleAll: () => void;
  onToggleStudent: (id: string) => void;
  onViewSF1: () => void;
  onViewSF2: () => void;
  onViewSF5: () => void;
  onViewSF6: () => void;
  onViewSF9: (id?: string) => void;
  onViewSF10: (id?: string) => void;
  onBulkPrint: (formType: "sf9" | "sf10") => void;
  onBulkPrintAll: (formType: "sf9" | "sf10") => void;
  themeColors: { primary: string };
}

export default function SFListView({
  error,
  schoolYear,
  schoolYears,
  onSchoolYearChange,
  selectedGrade,
  onGradeChange,
  uniqueGradeLevels,
  selectedSection,
  selectedStudent,
  onSectionChange,
  sections,
  filteredSectionsForDropdown,
  students,
  filteredStudents,
  selectedStudentIds,
  searchQuery,
  onSearchChange,
  onToggleAll,
  onToggleStudent,
  onViewSF1,
  onViewSF2,
  onViewSF5,
  onViewSF6,
  onViewSF9,
  onViewSF10,
  onBulkPrint,
  onBulkPrintAll,
  themeColors,
}: SFListViewProps) {
  return (
      <div className="space-y-6 animate-fade-in max-w-[1400px] mx-auto w-full">
        <PageHeader
          title="DepEd School Forms"
          description="Generate and view official Department of Education forms"
        />

        {/* Error Display */}
        {error && (
          <Card className="border border-rose-200 bg-rose-50 rounded-xl p-0">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-rose-100 rounded-full flex items-center justify-center shrink-0">
                  <AlertCircle className="w-5 h-5 text-destructive" />
                </div>
                <div>
                  <p className="font-semibold text-foreground">Error Loading Data</p>
                  <p className="text-sm text-muted-foreground">{error}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Filters Card */}
        <Card className="border border-border shadow-sm bg-card overflow-hidden rounded-xl p-0">
          <div className="px-6 py-4 border-b border-border">
            <div>
              <h2 className="text-base font-semibold text-foreground">Filters</h2>
              <p className="text-sm text-muted-foreground">
                Narrow down by school year, grade, and section to load the right students
              </p>
            </div>
          </div>
          <CardContent className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <div className="flex items-center gap-1 mb-1.5">
                  <label className="block text-xs font-medium text-muted-foreground">School Year</label>
                  <HelpTooltip content="Select the school year for which to generate forms" />
                </div>
                <Select value={schoolYear} onValueChange={(v: string | null) => v && onSchoolYearChange(v)}>
                  <SelectTrigger className="h-9 rounded-lg text-xs font-medium">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {schoolYears.map((sy) => (
                      <SelectItem key={sy} value={sy}>{sy}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Grade Filter</label>
                <Select value={selectedGrade} onValueChange={(v: string | null) => v && onGradeChange(v)}>
                  <SelectTrigger className="h-9 rounded-lg text-xs font-medium">
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
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Section Filter</label>
                <Select value={selectedSection} onValueChange={(v: string | null) => v && onSectionChange(v)}>
                  <SelectTrigger className="h-9 rounded-lg text-xs font-medium">
                    <SelectValue placeholder="Select section">
                      {(() => {
                        const section = sections.find(s => s.id === selectedSection);
                        if (!section) return "Select section";
                        return selectedGrade === "ALL"
                          ? `Grade ${formatGradeLevel(section.gradeLevel)} - ${section.name}`
                          : section.name;
                      })()}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {filteredSectionsForDropdown.map((section) => (
                      <SelectItem key={section.id} value={section.id}>
                        {selectedGrade === "ALL" ? `Grade ${formatGradeLevel(section.gradeLevel)} - ${section.name}` : section.name}{section.program && section.program !== 'REGULAR' ? ` (${section.program})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Forms Grid */}
        <Card className="border border-border shadow-sm bg-card overflow-hidden rounded-xl p-0">
          <div className="px-6 py-4 border-b border-border">
            <h2 className="text-base font-semibold text-foreground">Available Forms</h2>
            <p className="text-sm text-muted-foreground">
              {schoolForms.length} DepEd school forms ready to generate
            </p>
          </div>
          <CardContent className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {schoolForms.map((form) => {
                const isDev = form.status === "dev";

                return (
                  <div
                    key={form.id}
                    className={`group border border-border bg-card overflow-hidden rounded-xl transition-all ${isDev ? 'opacity-75' : 'hover:shadow-md hover:-translate-y-0.5'}`}
                  >
                    <div className="px-5 py-4 border-b border-border flex items-center gap-3">
                      <div
                        className={`p-2.5 rounded-lg text-white shrink-0 ${!isDev ? 'group-hover:scale-105 transition-transform' : ''}`}
                        style={{ backgroundColor: isDev ? '#94a3b8' : themeColors.primary }}
                      >
                        <form.icon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge
                            className="text-[11px] font-semibold px-2 py-0.5 rounded-full border"
                            style={{
                              backgroundColor: isDev ? '#f1f5f9' : `${themeColors.primary}10`,
                              color: isDev ? '#64748b' : themeColors.primary,
                              borderColor: isDev ? '#e2e8f0' : `${themeColors.primary}25`,
                            }}
                          >
                            {form.id}
                          </Badge>
                          {isDev && (
                            <Badge variant="outline" className="text-[10px] bg-muted text-muted-foreground border-border uppercase tracking-wider px-1.5 h-4">
                              In Dev
                            </Badge>
                          )}
                        </div>
                        <p className={`text-sm font-semibold mt-1 truncate ${isDev ? 'text-muted-foreground' : 'text-foreground'}`}>
                          {form.name}
                        </p>
                      </div>
                    </div>
                    <div className="p-5 flex flex-col gap-4">
                      <p className={`text-xs flex-1 ${isDev ? 'text-muted-foreground' : 'text-muted-foreground'}`}>
                        {form.description}
                      </p>

                      <Button
                        onClick={() => {
                          if (form.id === "SF1") onViewSF1();
                          else if (form.id === "SF2") onViewSF2();
                          else if (form.id === "SF5") onViewSF5();
                          else if (form.id === "SF6") onViewSF6();
                          else if (form.id === "SF9") onViewSF9();
                          else if (form.id === "SF10") onViewSF10();
                        }}
                        disabled={
                          isDev ||
                          ((form.id === "SF1" || form.id === "SF2" || form.id === "SF5") && !selectedSection) ||
                          ((form.id === "SF9" || form.id === "SF10") && !selectedStudent)
                        }
                        className="rounded-lg w-full text-white"
                        style={{ backgroundColor: isDev ? '#94a3b8' : themeColors.primary }}
                      >
                        {isDev ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin-slow opacity-50" />
                            Under Development
                          </>
                        ) : (
                          <>
                            <Eye className="w-3.5 h-3.5 mr-1.5" />
                            View
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Student List for Quick Access */}
        {selectedSection && students.length > 0 && (
          <StudentSelectionTable
            filteredStudents={filteredStudents}
            selectedStudentIds={selectedStudentIds}
            searchQuery={searchQuery}
            onSearchChange={onSearchChange}
            onToggleAll={onToggleAll}
            onToggleStudent={onToggleStudent}
            onViewSF9={(id) => onViewSF9(id)}
            onViewSF10={(id) => onViewSF10(id)}
            onBulkPrint={(formType) => onBulkPrint(formType)}
            onBulkPrintAll={(formType) => onBulkPrintAll(formType)}
            themeColors={themeColors}
          />
        )}
      </div>
  );
}
