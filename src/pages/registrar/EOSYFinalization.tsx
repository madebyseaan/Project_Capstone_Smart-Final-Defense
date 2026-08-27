import { useState, useEffect } from "react";
import { GraduationCap, Loader2, AlertTriangle, RefreshCw, CheckCircle, XCircle, Search, FileCheck, FileEdit, Eye } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { registrarApi } from "@/lib/api";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { useTheme } from "@/contexts/ThemeContext";

// NOTE: This page is intentionally read-only.
// EOSY finalization (POST /eosy/sections/:id/finalize) writes to EnrollPro and is STRICTLY FORBIDDEN
// in SMART. All finalization actions must be performed directly in EnrollPro.

export default function EOSYFinalization() {
  const { colors } = useTheme();
  
  const [schoolYearsLoading, setSchoolYearsLoading] = useState(true);
  const [schoolYears, setSchoolYears] = useState<any[]>([]);
  const [selectedSchoolYearId, setSelectedSchoolYearId] = useState<string>("");

  const [sectionsLoading, setSectionsLoading] = useState(false);
  const [sectionsError, setSectionsError] = useState<string | null>(null);
  const [sections, setSections] = useState<any[]>([]);

  const [selectedSectionId, setSelectedSectionId] = useState<string>("");
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordsError, setRecordsError] = useState<string | null>(null);
  const [records, setRecords] = useState<any[]>([]);
  const [sectionMeta, setSectionMeta] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState("");

  // Grade finalization state
  const [finalizeStatus, setFinalizeStatus] = useState<any[]>([]);
  const [finalizeLoading, setFinalizeLoading] = useState(false);
  const [finalizingSubject, setFinalizingSubject] = useState<string | null>(null);
  const [finalizeMessage, setFinalizeMessage] = useState<string | null>(null);
  const [currentTerm, setCurrentTerm] = useState<string>("T3");
  
  // Local sections for matching EnrollPro to SMART
  const [localSections, setLocalSections] = useState<any[]>([]);

  // Student grades modal state
  const [gradesModalOpen, setGradesModalOpen] = useState(false);
  const [gradesModalStudent, setGradesModalStudent] = useState<any>(null);
  const [gradesModalData, setGradesModalData] = useState<any>(null);
  const [gradesModalLoading, setGradesModalLoading] = useState(false);
  const [gradesModalError, setGradesModalError] = useState<string | null>(null);

  const loadSchoolYears = async () => {
    setSchoolYearsLoading(true);
    try {
      const res = await registrarApi.getEosySchoolYears();
      const years = (res.data as any) || [];
      setSchoolYears(years);
      
      // Select the active one by default if available
      const active = years.find((y: any) => y.status === "ACTIVE");
      if (active) {
        setSelectedSchoolYearId(String(active.id));
      } else if (years.length > 0) {
        setSelectedSchoolYearId(String(years[0].id));
      }
    } catch (err: any) {
      console.error("Failed to load school years", err);
    } finally {
      setSchoolYearsLoading(false);
    }
  };

  const loadSections = async (syId?: string) => {
    const targetSyId = syId || selectedSchoolYearId;
    if (!targetSyId) return;

    setSectionsLoading(true);
    setSectionsError(null);
    setSelectedSectionId("");
    setRecords([]);
    try {
      const res = await registrarApi.getEosySections(parseInt(targetSyId, 10));
      const payload = res.data as any;
      setSections(payload.sections ?? payload.data ?? payload ?? []);
    } catch (err: any) {
      setSectionsError(err?.response?.data?.message ?? "Failed to load EOSY sections from EnrollPro.");
    } finally {
      setSectionsLoading(false);
    }
  };

  const loadRecords = async (sectionId: string) => {
    setRecordsLoading(true);
    setRecordsError(null);
    setRecords([]);
    setSectionMeta(null);
    try {
      const res = await registrarApi.getEosySectionRecords(parseInt(sectionId, 10));
      const payload = res.data as any;
      const rawRecords: any[] = payload.records ?? payload.learners ?? payload.data ?? [];

      // Normalize: EnrollPro EOSY records nest learner under rec.enrollmentApplication.learner
      const normalized = rawRecords.map((rec: any) => {
        const l = rec.enrollmentApplication?.learner ?? rec.learner ?? rec;
        const rawSex = (l.sex ?? rec.sex ?? "").toString().trim().toUpperCase();
        const sex = rawSex === "MALE" || rawSex === "M" ? "Male" : rawSex === "FEMALE" || rawSex === "F" ? "Female" : "";
        
        // Determine the source of the grade
        const isCurrentYear = rec.finalAverage != null || rec.finalGrade != null || l.finalAverage != null;
        const finalAverage = rec.finalAverage ?? rec.finalGrade ?? l.finalAverage ?? l.previousGenAve ?? null;

        return {
          enrollmentRecordId: rec.id ?? rec.enrollmentRecordId,
          learnerId: l.id ?? rec.learnerId,
          lrn: l.lrn ?? rec.lrn ?? "",
          firstName: l.firstName ?? rec.firstName ?? "",
          lastName: l.lastName ?? rec.lastName ?? "",
          middleName: l.middleName ?? rec.middleName ?? "",
          sex,
          finalAverage,
          isCurrentYear,
          // Promotion status
          promoted: rec.eosyStatus === "PROMOTED" || l.promotionStatus === "PROMOTED" || rec.promoted || rec.isPromoted,
          finalStatus: rec.eosyStatus ?? l.promotionStatus ?? rec.finalStatus ?? "",
          promotedToGradeLevel: rec.promotedToGradeLevel ?? rec.nextGradeLevel ?? "",
        };
      });

      setRecords(normalized);
      setSectionMeta(payload.section ?? payload.meta ?? null);
    } catch (err: any) {
      setRecordsError(err?.response?.data?.message ?? "Failed to load EOSY records from EnrollPro.");
    } finally {
      setRecordsLoading(false);
    }
  };

  useEffect(() => { void loadSchoolYears(); }, []);
  
  useEffect(() => {
    if (selectedSchoolYearId) void loadSections(selectedSchoolYearId);
  }, [selectedSchoolYearId]);

  useEffect(() => {
    if (selectedSectionId) {
      void loadRecords(selectedSectionId);
      // Also load finalization status using the matched local section
      const localSection = localSections.find(
        (ls) => ls.name?.toUpperCase() === sections.find((s) => String(s.id) === selectedSectionId)?.name?.toUpperCase()
      );
      if (localSection) {
        void loadFinalizeStatus(localSection.id);
      }
    }
  }, [selectedSectionId, localSections, sections]);

  const loadFinalizeStatus = async (sectionId: string) => {
    setFinalizeLoading(true);
    try {
      const token = localStorage.getItem("token_registrar") || sessionStorage.getItem("token_registrar") || "";
      const csrfCookie = document.cookie.split("; ").find(row => row.startsWith("x-csrf-token="))?.split("=")[1] || "";
      const res = await fetch(`/api/registrar/finalize-status/${sectionId}/${currentTerm}`, {
        headers: { 
          Authorization: `Bearer ${token}`,
          "x-csrf-token": csrfCookie,
        },
      });
      const data = await res.json();
      setFinalizeStatus(data.subjects || []);
    } catch (err) {
      console.error("Failed to load finalize status", err);
    } finally {
      setFinalizeLoading(false);
    }
  };

  const loadLocalSections = async () => {
    try {
      // Fetch current school year from settings
      const token = sessionStorage.getItem("token_registrar") || "";
      const settingsRes = await fetch("/api/admin/settings", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const settingsData = await settingsRes.json();
      const currentSY = settingsData?.settings?.currentSchoolYear || "2026-2027";
      
      const res = await registrarApi.getSections({ schoolYear: currentSY });
      const data = res.data as any;
      setLocalSections(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to load local sections", err);
    }
  };

  useEffect(() => { void loadLocalSections(); }, []);

  const loadStudentGrades = async (student: any) => {
    if (!selectedSectionId) return;
    const epSection = sections.find((s) => String(s.id) === selectedSectionId);
    const localSection = localSections.find(
      (ls) => ls.name?.toUpperCase() === epSection?.name?.toUpperCase()
    );
    if (!localSection) {
      setGradesModalError("Section not found in SMART database");
      return;
    }

    setGradesModalLoading(true);
    setGradesModalError(null);
    setGradesModalData(null);
    setGradesModalStudent(student);
    setGradesModalOpen(true);

    try {
      const token = sessionStorage.getItem("token_registrar") || "";
      const csrfCookie = document.cookie.split("; ").find(row => row.startsWith("x-csrf-token="))?.split("=")[1] || "";
      const res = await fetch(`/api/registrar/student-grades/${localSection.id}/${currentTerm}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "x-csrf-token": csrfCookie,
        },
      });
      if (!res.ok) {
        throw new Error("Failed to load student grades");
      }
      const data = await res.json();
      // Find the specific student by LRN (EnrollPro learnerId may differ from SMART studentId)
      const studentData = data.students?.find((s: any) => s.lrn === student.lrn);
      setGradesModalData(studentData || null);
    } catch (err: any) {
      setGradesModalError(err?.message || "Failed to load student grades");
    } finally {
      setGradesModalLoading(false);
    }
  };

  // Fetch current term from settings
  useEffect(() => {
    const fetchCurrentTerm = async () => {
      try {
        const token = sessionStorage.getItem("token_registrar") || "";
        const res = await fetch("/api/admin/settings", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        // EOSY is always Term 3 - that's the final term for the school year
        setCurrentTerm("T3");
      } catch (err) {
        console.error("Failed to fetch current term", err);
      }
    };
    void fetchCurrentTerm();
  }, []);

  const handleFinalizeAll = async () => {
    if (!selectedSectionId) return;
    const epSection = sections.find((s) => String(s.id) === selectedSectionId);
    const localSection = localSections.find(
      (ls) => ls.name?.toUpperCase() === epSection?.name?.toUpperCase()
    );
    if (!localSection) {
      setFinalizeMessage("Section not found in SMART database");
      setTimeout(() => setFinalizeMessage(null), 4000);
      return;
    }

    const draftCount = finalizeStatus.filter(s => s.draft > 0).length;
    if (draftCount === 0) {
      setFinalizeMessage("All grades are already finalized");
      setTimeout(() => setFinalizeMessage(null), 4000);
      return;
    }

    if (!window.confirm(`Finalize ALL ${draftCount} subjects for ${epSection?.name}? This will lock all Term 3 grades for EnrollPro sync.`)) return;

    setFinalizingSubject("all");
    setFinalizeMessage(null);
    try {
      const token = sessionStorage.getItem("token_registrar") || "";
      const csrfCookie = document.cookie.split("; ").find(row => row.startsWith("x-csrf-token="))?.split("=")[1] || "";

      // Finalize all draft subjects
      const draftSubjects = finalizeStatus.filter(s => s.draft > 0);
      let totalFinalized = 0;

      for (const subject of draftSubjects) {
        const res = await fetch("/api/registrar/finalize-grades", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "x-csrf-token": csrfCookie,
          },
          body: JSON.stringify({
            sectionId: localSection.id,
            term: currentTerm,
            subjectId: subject.subjectId,
          }),
        });
        const data = await res.json();
        if (res.ok) {
          totalFinalized += data.finalizedCount || 0;
        }
      }

      setFinalizeMessage(`Finalized ${totalFinalized} grades across ${draftSubjects.length} subjects`);
      void loadFinalizeStatus(localSection.id);
      setTimeout(() => setFinalizeMessage(null), 4000);
    } catch (err) {
      setFinalizeMessage("Failed to finalize grades");
    } finally {
      setFinalizingSubject(null);
    }
  };

  const handleUnfinalizeAll = async () => {
    if (!selectedSectionId) return;
    const epSection = sections.find((s) => String(s.id) === selectedSectionId);
    const localSection = localSections.find(
      (ls) => ls.name?.toUpperCase() === epSection?.name?.toUpperCase()
    );
    if (!localSection) {
      setFinalizeMessage("Section not found in SMART database");
      setTimeout(() => setFinalizeMessage(null), 4000);
      return;
    }

    const finalizedCount = finalizeStatus.filter(s => s.finalized > 0).length;
    if (finalizedCount === 0) {
      setFinalizeMessage("No grades to unfinalize");
      setTimeout(() => setFinalizeMessage(null), 4000);
      return;
    }

    if (!window.confirm(`Unfinalize ALL ${finalizedCount} subjects for ${epSection?.name}? Teachers will be able to edit grades again.`)) return;

    setFinalizingSubject("all");
    setFinalizeMessage(null);
    try {
      const token = sessionStorage.getItem("token_registrar") || "";
      const csrfCookie = document.cookie.split("; ").find(row => row.startsWith("x-csrf-token="))?.split("=")[1] || "";

      // Unfinalize all finalized subjects
      const finalizedSubjects = finalizeStatus.filter(s => s.finalized > 0);
      let totalUnfinalized = 0;

      for (const subject of finalizedSubjects) {
        const res = await fetch("/api/registrar/unfinalize-grades", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "x-csrf-token": csrfCookie,
          },
          body: JSON.stringify({
            sectionId: localSection.id,
            term: currentTerm,
            subjectId: subject.subjectId,
          }),
        });
        const data = await res.json();
        if (res.ok) {
          totalUnfinalized += data.unfinalizedCount || 0;
        }
      }

      setFinalizeMessage(`Unfinalized ${totalUnfinalized} grades across ${finalizedSubjects.length} subjects`);
      void loadFinalizeStatus(localSection.id);
      setTimeout(() => setFinalizeMessage(null), 4000);
    } catch (err) {
      setFinalizeMessage("Failed to unfinalize grades");
    } finally {
      setFinalizingSubject(null);
    }
  };

  const filteredRecords = records.filter(r => 
    `${r.firstName} ${r.lastName} ${r.lrn}`.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const promotedCount = records.filter((r) => r.promoted || r.finalStatus === "PROMOTED").length;
  const heldCount = records.filter((r) => !r.promoted && r.finalStatus !== "PROMOTED" && r.finalStatus).length;

  return (
    <div className="space-y-6 animate-fade-in">
      <Breadcrumb items={[{ label: "Dashboard", href: "/registrar" }, { label: "EOSY Finalization" }]} />

      <Card className="border-slate-200 shadow-sm overflow-hidden bg-white">
        <CardHeader className="border-b border-slate-100 bg-white pb-6">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
            <div className="flex flex-col gap-3">
              <div>
                <CardTitle className="text-2xl font-bold text-gray-900 flex items-center gap-3">
                  <div className="p-2 rounded-lg text-white" style={{ backgroundColor: colors.primary }}>
                    <GraduationCap className="w-5 h-5" />
                  </div>
                  EOSY Section List
                </CardTitle>
                <CardDescription className="mt-2 font-medium text-slate-500">
                  Hinigaran National High School — End of School Year Monitoring
                </CardDescription>
              </div>
              
              {/* Read-only notice */}
              <div className="bg-amber-50/80 border border-amber-100 rounded-lg px-4 py-2 inline-flex items-center gap-3 mt-1 w-fit">
                <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                <p className="text-amber-800 text-xs">
                  <strong>Read-Only:</strong> SMART displays EOSY data from EnrollPro for reference. Grade finalization is managed here by the registrar.
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <Button onClick={() => void loadSections()} variant="outline" className="rounded-xl shadow-sm">
                <RefreshCw className="w-4 h-4 mr-2" /> Refresh
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {/* Controls Area */}
          <div className="p-6 border-b border-slate-100 bg-slate-50/30">
            <div className="flex flex-col gap-4">
              {sectionsLoading || schoolYearsLoading ? (
                <div className="flex items-center gap-3 text-gray-500 py-2">
                  <Loader2 className="w-5 h-5 animate-spin" style={{ color: colors.primary }} />
                  <span className="text-sm">Loading EOSY data…</span>
                </div>
              ) : sectionsError ? (
                <div className="flex items-center gap-3 text-red-500 py-2">
                  <AlertTriangle className="w-5 h-5" />
                  <span className="text-sm">{sectionsError}</span>
                  <Button onClick={() => void loadSections()} variant="outline" size="sm" className="rounded-xl ml-2">Retry</Button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex flex-wrap items-center gap-4">
                    {/* Section Dropdown */}
                    <Select value={selectedSectionId} onValueChange={setSelectedSectionId}>
                      <SelectTrigger className="w-[280px]">
                        <SelectValue placeholder="— Select a section —">
                          {(() => {
                            const s = sections.find((sec) => String(sec.id) === selectedSectionId);
                            return s ? `${s.name ?? s.sectionName}${s.gradeLevel?.name ? ` (${s.gradeLevel.name})` : ""}${s.finalized ? " ✓ Finalized" : ""}` : "— Select a section —";
                          })()}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {sections.map((s) => (
                          <SelectItem key={s.id} value={String(s.id)}>
                            {s.name ?? s.sectionName}{s.gradeLevel?.name ? ` (${s.gradeLevel.name})` : ""}
                            {s.finalized ? " ✓ Finalized" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {/* School Year Dropdown */}
                    {schoolYears.length > 0 && (
                      <Select value={selectedSchoolYearId} onValueChange={setSelectedSchoolYearId}>
                        <SelectTrigger className="w-[140px]">
                          <SelectValue placeholder="Select SY">
                            {(() => {
                              const sy = schoolYears.find((y) => String(y.id) === selectedSchoolYearId);
                              return sy ? `${sy.yearLabel} ${sy.status === "ACTIVE" ? "(Active)" : ""}` : "Select SY";
                            })()}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {schoolYears.map((sy) => (
                            <SelectItem key={sy.id} value={String(sy.id)}>
                              {sy.yearLabel} {sy.status === "ACTIVE" ? "(Active)" : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}

                    {/* Status Text */}
                    <span className="text-sm font-medium text-slate-500">
                      {sections.length} section(s) available
                    </span>
                  </div>

                  {/* Search Bar */}
                  <div className="relative w-full md:w-64">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <Input 
                      placeholder="Search learners..." 
                      className="pl-9 rounded-xl border-slate-200 bg-white shadow-sm focus:ring-primary/20"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Grade Finalization Section */}
          <div className="p-6 border-b border-slate-100 bg-gradient-to-r from-blue-50/50 to-indigo-50/30">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <FileCheck className="w-5 h-5 text-blue-600" />
                <h3 className="font-semibold text-gray-900">Grade Finalization (Term 3 - EOSY)</h3>
              </div>
              {finalizeMessage && (
                <span className={`text-sm font-medium px-3 py-1 rounded-full ${finalizeMessage.includes("Failed") ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>
                  {finalizeMessage}
                </span>
              )}
            </div>

            {/* Adviser Display */}
            {selectedSectionId && (() => {
              const epSection = sections.find((s) => String(s.id) === selectedSectionId);
              const localSection = localSections.find(
                (ls) => ls.name?.toUpperCase() === epSection?.name?.toUpperCase()
              );
              const adviserName = localSection?.adviser || null;
              return adviserName ? (
                <div className="flex items-center gap-2 mb-3 text-sm">
                  <span className="text-gray-500">Adviser:</span>
                  <span className="font-semibold text-gray-900">{adviserName}</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 mb-3 text-sm">
                  <span className="text-gray-500">Adviser:</span>
                  <span className="text-amber-600 italic">Not assigned</span>
                </div>
              );
            })()}
            <p className="text-sm text-gray-500 mb-4">
              Finalize grades to lock them from teacher edits and make them visible to EnrollPro sync.
            </p>
            
            {/* Finalize Status - Shows when section is selected */}
            {selectedSectionId && (
              <>
                {currentTerm !== "T3" ? (
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                    <p className="text-amber-800 text-sm">
                      <strong>Note:</strong> Grade finalization is only available during Term 3 (EOSY). 
                      Current term is {currentTerm}. Finalization will be available when Term 3 begins.
                    </p>
                  </div>
                ) : finalizeLoading ? (
                <div className="flex items-center gap-2 text-gray-500">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">Loading finalization status...</span>
                </div>
              ) : finalizeStatus.length === 0 ? (
                <p className="text-sm text-gray-400">No subjects found for this section.</p>
              ) : (
                <div className="space-y-4">
                  {/* Overall Status */}
                  <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-6">
                      <div>
                        <p className="text-sm font-medium text-gray-700">Total Subjects</p>
                        <p className="text-2xl font-bold text-gray-900">{finalizeStatus.length}</p>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-700">Draft</p>
                        <p className="text-2xl font-bold text-amber-600">{finalizeStatus.filter(s => s.draft > 0).length}</p>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-700">Finalized</p>
                        <p className="text-2xl font-bold text-green-600">{finalizeStatus.filter(s => s.finalized > 0 && s.draft === 0).length}</p>
                      </div>
                    </div>
                    
                    {/* Single Action Button */}
                    <div className="flex items-center gap-3">
                      {finalizeMessage && (
                        <span className={`text-sm font-medium px-3 py-1 rounded-full ${finalizeMessage.includes("Failed") ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>
                          {finalizeMessage}
                        </span>
                      )}
                      {finalizeStatus.filter(s => s.draft > 0).length > 0 ? (
                        <Button
                          onClick={handleFinalizeAll}
                          disabled={finalizingSubject === "all"}
                          style={{ backgroundColor: colors.primary }}
                        >
                          {finalizingSubject === "all" ? (
                            <Loader2 className="w-4 h-4 animate-spin mr-2" />
                          ) : (
                            <FileCheck className="w-4 h-4 mr-2" />
                          )}
                          Finalize All ({finalizeStatus.filter(s => s.draft > 0).length} subjects)
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          onClick={handleUnfinalizeAll}
                          disabled={finalizingSubject === "all"}
                          className="text-orange-600 border-orange-200 hover:bg-orange-50"
                        >
                          {finalizingSubject === "all" ? (
                            <Loader2 className="w-4 h-4 animate-spin mr-2" />
                          ) : (
                            <FileEdit className="w-4 h-4 mr-2" />
                          )}
                          Unfinalize All
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Subject List (read-only display) */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {finalizeStatus.map((subject: any) => {
                      const isFinalized = subject.finalized > 0 && subject.draft === 0;
                      return (
                        <div
                          key={subject.subjectId}
                          className={`flex items-center justify-between p-3 rounded-lg border ${
                            isFinalized 
                              ? "bg-green-50 border-green-200" 
                              : "bg-white border-gray-200"
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-gray-900 text-sm truncate">{subject.subjectName}</p>
                            <p className="text-xs text-gray-500 mt-0.5">
                              <span className={subject.draft > 0 ? "text-amber-600 font-medium" : ""}>{subject.draft} draft</span>
                              {" · "}
                              <span className={subject.finalized > 0 ? "text-green-600 font-medium" : ""}>{subject.finalized} finalized</span>
                            </p>
                          </div>
                          <div className="ml-2 flex-shrink-0">
                            {isFinalized ? (
                              <Badge className="bg-green-100 text-green-700 border-green-200">
                                <CheckCircle className="w-3 h-3 mr-1" /> Finalized
                              </Badge>
                            ) : (
                              <Badge className="bg-amber-100 text-amber-700 border-amber-200">
                                Draft
                              </Badge>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              </>
            )}
          </div>

          {/* Table Area */}
          {selectedSectionId ? (
            <div className="bg-white">
              {recordsLoading ? (
                <div className="flex flex-col items-center justify-center py-32 text-center">
                  <Loader2 className="w-10 h-10 animate-spin text-slate-300 mb-4" />
                  <p className="text-slate-500 font-medium">Fetching learner records...</p>
                </div>
              ) : recordsError ? (
                <div className="flex flex-col items-center justify-center py-24 text-center px-4">
                  <AlertTriangle className="w-12 h-12 text-amber-500 mb-4" />
                  <p className="text-gray-700 font-semibold text-lg">Unable to load records</p>
                  <p className="text-gray-500 text-sm mt-1 max-w-sm">{recordsError}</p>
                  <Button onClick={() => void loadRecords(selectedSectionId)} variant="outline" className="mt-6 rounded-xl">Try Again</Button>
                </div>
              ) : (
                <>
                  {/* Table Header/Metadata */}
                  <div className="px-6 py-4 bg-white border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="text-sm">
                      <span className="text-slate-500">Learner records for </span>
                      <span className="font-bold text-slate-900">
                        {sectionMeta?.name ?? sections.find((s) => String(s.id) === selectedSectionId)?.name ?? "Section"}
                      </span>
                      {searchTerm && (
                        <span className="ml-2 text-slate-400">
                          (Found {filteredRecords.length} of {records.length})
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-xs font-medium">
                      <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-50 text-emerald-700">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                        <span>{promotedCount} Promoted</span>
                      </div>
                      {heldCount > 0 && (
                        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-red-50 text-red-700">
                          <div className="w-1.5 h-1.5 rounded-full bg-red-500"></div>
                          <span>{heldCount} Held</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-gray-50/50 hover:bg-gray-50/50">
                          <TableHead className="font-bold text-gray-700 w-12 pl-6">#</TableHead>
                          <TableHead className="font-bold text-gray-700">LRN</TableHead>
                          <TableHead className="font-bold text-gray-700">Learner Name</TableHead>
                          <TableHead className="font-bold text-gray-700">Sex</TableHead>
                          <TableHead className="font-bold text-gray-700">Final Average</TableHead>
                          <TableHead className="font-bold text-gray-700">Status</TableHead>
                          <TableHead className="font-bold text-gray-700">Promoted To</TableHead>
                          <TableHead className="font-bold text-gray-700 pr-6 text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredRecords.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={8} className="text-center py-20 text-gray-500">
                              {searchTerm ? "No learners match your search" : "No EOSY records for this section"}
                            </TableCell>
                          </TableRow>
                        ) : (
                          filteredRecords.map((rec: any, i: number) => {
                            const isPromoted = rec.promoted || rec.finalStatus === "PROMOTED";
                            return (
                              <TableRow key={rec.enrollmentRecordId ?? rec.learnerId ?? i} className="hover:bg-slate-50/50 transition-colors">
                                <TableCell className="text-gray-400 text-sm pl-6">{i + 1}</TableCell>
                                <TableCell className="font-mono text-sm text-gray-600">{rec.lrn ?? "—"}</TableCell>
                                <TableCell className="font-medium text-gray-900">
                                  {rec.lastName}, {rec.firstName} {rec.middleName ?? ""}
                                </TableCell>
                                <TableCell>
                                  <Badge className={rec.sex === "Male" ? "bg-blue-50 text-blue-700 border-blue-100" : "bg-pink-50 text-pink-700 border-pink-100"} variant="outline">
                                    {rec.sex ?? "—"}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  <div className="flex flex-col gap-1">
                                    <span className="font-semibold text-gray-900">
                                      {rec.finalAverage != null ? rec.finalAverage.toFixed(2) : "—"}
                                    </span>
                                    {rec.finalAverage != null && (
                                      rec.isCurrentYear ? (
                                        <Badge variant="outline" className="w-fit text-[10px] py-0 px-1.5 bg-blue-50 text-blue-600 border-blue-200">
                                          Current SY
                                        </Badge>
                                      ) : (
                                        <Badge variant="outline" className="w-fit text-[10px] py-0 px-1.5 bg-amber-50 text-amber-600 border-amber-200">
                                          Historical
                                        </Badge>
                                      )
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  {isPromoted ? (
                                    <Badge className="bg-emerald-100 text-emerald-700 gap-1 border-emerald-200">
                                      <CheckCircle className="w-3 h-3" /> PROMOTED
                                    </Badge>
                                  ) : rec.finalStatus ? (
                                    <Badge className="bg-red-100 text-red-700 gap-1 border-red-200">
                                      <XCircle className="w-3 h-3" /> {rec.finalStatus}
                                    </Badge>
                                  ) : (
                                    <Badge className="bg-gray-100 text-gray-500 border-gray-200" variant="outline">—</Badge>
                                  )}
                                </TableCell>
                                <TableCell className="text-sm text-gray-600 pr-6">
                                  {rec.promotedToGradeLevel?.name ?? rec.nextGradeLevel?.name ?? "—"}
                                </TableCell>
                                <TableCell className="text-right pr-6">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="rounded-lg h-8 text-xs"
                                    onClick={() => void loadStudentGrades(rec)}
                                  >
                                    <Eye className="w-3.5 h-3.5 mr-1" />
                                    View Grades
                                  </Button>
                                </TableCell>
                              </TableRow>
                            );
                          })
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-40 text-center px-4 bg-slate-50/10 border-t border-slate-100">
               <GraduationCap className="w-16 h-16 text-slate-200 mb-6" />
               <p className="text-slate-500 font-semibold text-xl">No Section Selected</p>
               <p className="text-slate-400 text-sm mt-2 max-w-sm">
                 Please select a section and academic year from the filters above to view the End of School Year records.
               </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Student Grades Modal */}
      <Dialog open={gradesModalOpen} onOpenChange={setGradesModalOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GraduationCap className="w-5 h-5" />
              Student Grades — {gradesModalStudent?.firstName} {gradesModalStudent?.lastName}
            </DialogTitle>
            <DialogDescription>
              LRN: {gradesModalStudent?.lrn ?? "—"} | Term: {currentTerm}
            </DialogDescription>
          </DialogHeader>

          {gradesModalLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
              <span className="ml-2 text-sm text-slate-500">Loading grades...</span>
            </div>
          ) : gradesModalError ? (
            <div className="flex items-center justify-center py-12 text-center">
              <AlertTriangle className="w-6 h-6 text-amber-500 mr-2" />
              <span className="text-sm text-red-600">{gradesModalError}</span>
            </div>
          ) : gradesModalData ? (
            <div className="space-y-4">
              {/* Summary */}
              <div className="flex items-center gap-6 p-4 bg-slate-50 rounded-lg">
                <div>
                  <p className="text-xs font-medium text-slate-500">Average</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {gradesModalData.average != null ? gradesModalData.average.toFixed(1) : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-500">Subjects Graded</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {gradesModalData.gradedSubjects}/{gradesModalData.totalSubjects}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-500">Remarks</p>
                  <Badge className={gradesModalData.average != null && gradesModalData.average >= 75 ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}>
                    {gradesModalData.average != null
                      ? gradesModalData.average >= 75 ? "PASSED" : "FAILED"
                      : "No Grade"}
                  </Badge>
                </div>
              </div>

              {/* Subject Grades Table */}
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b">
                      <th className="text-left font-semibold text-gray-700 px-4 py-2">Subject</th>
                      <th className="text-center font-semibold text-gray-700 px-4 py-2">Quarterly Grade</th>
                      <th className="text-center font-semibold text-gray-700 px-4 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gradesModalData.subjects?.map((subject: any) => (
                      <tr key={subject.subjectId} className="border-b last:border-b-0 hover:bg-slate-50/50">
                        <td className="px-4 py-2 font-medium text-gray-900">{subject.subjectName}</td>
                        <td className="px-4 py-2 text-center">
                          {subject.quarterlyGrade != null ? (
                            <span className="font-semibold">{subject.quarterlyGrade}</span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-center">
                          {subject.status === "FINALIZED" ? (
                            <Badge className="bg-green-100 text-green-700 border-green-200">
                              <CheckCircle className="w-3 h-3 mr-1" /> Finalized
                            </Badge>
                          ) : subject.status === "DRAFT" ? (
                            <Badge className="bg-amber-100 text-amber-700 border-amber-200">
                              Draft
                            </Badge>
                          ) : (
                            <Badge className="bg-gray-100 text-gray-500 border-gray-200" variant="outline">
                              No Grade
                            </Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="text-xs text-slate-400 text-center">
                Grades are read-only. Contact the subject teacher to make changes.
              </p>
            </div>
          ) : (
            <div className="flex items-center justify-center py-12 text-slate-400">
              No grade data available
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
