import { useState, useEffect } from "react";
import { GraduationCap, Loader2, AlertTriangle, RefreshCw, Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { registrarApi } from "@/lib/api";

import { useTheme } from "@/contexts/ThemeContext";

import EOSYOverviewTab from "./components/EOSYOverviewTab";
import EOSYGradeLockingTab from "./components/EOSYGradeLockingTab";
import EOSYLearnerRecordsTab from "./components/EOSYLearnerRecordsTab";
import EOSYConfirmDialog from "./components/EOSYConfirmDialog";

// NOTE: This page is intentionally read-only for EnrollPro data.
// EOSY finalization (POST /eosy/sections/:id/finalize) writes to EnrollPro and is STRICTLY FORBIDDEN
// in SMART. All EnrollPro finalization must be performed directly in EnrollPro.
// SMART's own finalize actions (grade locking, promotion snapshots) are performed here.

export default function EOSYFinalization() {
  const { colors } = useTheme();

  // ── Filters ──
  const [schoolYearsLoading, setSchoolYearsLoading] = useState(true);
  const [schoolYears, setSchoolYears] = useState<any[]>([]);
  const [selectedSchoolYearId, setSelectedSchoolYearId] = useState<string>("");
  const [sectionsLoading, setSectionsLoading] = useState(false);
  const [sectionsError, setSectionsError] = useState<string | null>(null);
  const [sections, setSections] = useState<any[]>([]);
  const [selectedSectionId, setSelectedSectionId] = useState<string>("");
  const [localSections, setLocalSections] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState("overview");

  // ── Data ──
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordsError, setRecordsError] = useState<string | null>(null);
  const [records, setRecords] = useState<any[]>([]);
  const [sectionMeta, setSectionMeta] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState("");

  // ── Grade Finalization ──
  const [finalizeStatus, setFinalizeStatus] = useState<any[]>([]);
  const [allTermStatus, setAllTermStatus] = useState<any[]>([]);
  const [finalizeLoading, setFinalizeLoading] = useState(false);
  const [finalizingSubject, setFinalizingSubject] = useState<string | null>(null);
  const [finalizeMessage, setFinalizeMessage] = useState<string | null>(null);
  const [currentTerm, setCurrentTerm] = useState<string>("T3");

  // ── SMART Promotion ──
  const [smartPromotion, setSmartPromotion] = useState<any>(null);
  const [smartLoading, setSmartLoading] = useState(false);
  const [eosyFinalizing, setEosyFinalizing] = useState(false);
  const [eosyMessage, setEosyMessage] = useState<string | null>(null);

  // ── Student Grades (inline expand) ──
  const [expandedStudentLrn, setExpandedStudentLrn] = useState<string | null>(null);
  const [expandedGrades, setExpandedGrades] = useState<Record<string, { subjects: any[]; average: number | null; totalSubjects: number; gradedSubjects: number }>>({});
  const [expandedGradesLoading, setExpandedGradesLoading] = useState<Record<string, boolean>>({});

  // ── Confirm Dialogs ──
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    description: string;
    variant: "danger" | "warning" | "info";
    onConfirm: () => void;
  }>({ open: false, title: "", description: "", variant: "warning", onConfirm: () => {} });

  // ─── Data Loading ────────────────────────────────────────────────────────────

  const loadSchoolYears = async () => {
    setSchoolYearsLoading(true);
    try {
      const res = await registrarApi.getEosySchoolYears();
      const years = (res.data as any) || [];
      setSchoolYears(years);
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
      const normalized = rawRecords.map((rec: any) => {
        const l = rec.enrollmentApplication?.learner ?? rec.learner ?? rec;
        const rawSex = (l.sex ?? rec.sex ?? "").toString().trim().toUpperCase();
        const sex = rawSex === "MALE" || rawSex === "M" ? "Male" : rawSex === "FEMALE" || rawSex === "F" ? "Female" : "";
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

  const loadSmartPromotion = async (sectionId: string, syLabel: string) => {
    if (!sectionId || !syLabel) { setSmartPromotion(null); return; }
    setSmartLoading(true);
    try {
      const res = await registrarApi.getEosyPromotionStatus(sectionId, syLabel);
      setSmartPromotion(res.data ?? null);
    } catch {
      setSmartPromotion(null);
    } finally {
      setSmartLoading(false);
    }
  };

  const loadFinalizeStatus = async (sectionId: string) => {
    setFinalizeLoading(true);
    try {
      const token = localStorage.getItem("token_registrar") || sessionStorage.getItem("token_registrar") || "";
      const csrfCookie = document.cookie.split("; ").find(row => row.startsWith("x-csrf-token="))?.split("=")[1] || "";
      const res = await fetch(`/api/registrar/finalize-status/${sectionId}/${currentTerm}`, {
        headers: { Authorization: `Bearer ${token}`, "x-csrf-token": csrfCookie },
      });
      const data = await res.json();
      setFinalizeStatus(data.subjects || []);
    } catch (err) {
      console.error("Failed to load finalize status", err);
    } finally {
      setFinalizeLoading(false);
    }
  };

  const loadAllTermStatus = async (sectionId: string) => {
    try {
      const token = localStorage.getItem("token_registrar") || sessionStorage.getItem("token_registrar") || "";
      const csrfCookie = document.cookie.split("; ").find(row => row.startsWith("x-csrf-token="))?.split("=")[1] || "";
      const res = await fetch(`/api/registrar/finalize-status-all/${sectionId}`, {
        headers: { Authorization: `Bearer ${token}`, "x-csrf-token": csrfCookie },
      });
      const data = await res.json();
      setAllTermStatus(data.subjects || []);
    } catch (err) {
      console.error("Failed to load all-term finalize status", err);
    }
  };

  const loadLocalSections = async () => {
    try {
      const token = sessionStorage.getItem("token_registrar") || "";
      const settingsRes = await fetch("/api/admin/settings", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const settingsData = await settingsRes.json();
      const currentSY = settingsData?.settings?.currentSchoolYear;
      if (!currentSY) {
        setLocalSections([]);
        return;
      }
      const res = await registrarApi.getSections({ schoolYear: currentSY });
      const data = res.data as any;
      setLocalSections(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to load local sections", err);
    }
  };

  const fetchCurrentTerm = async () => {
    try {
      const token = sessionStorage.getItem("token_registrar") || "";
      const res = await fetch("/api/admin/settings", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setCurrentTerm(data.settings?.currentTerm ?? "T3");
    } catch (err) {
      console.error("Failed to fetch current term", err);
    }
  };

  // ─── Effects ─────────────────────────────────────────────────────────────────

  useEffect(() => { void loadSchoolYears(); }, []);
  useEffect(() => { void loadLocalSections(); }, []);
  useEffect(() => { void fetchCurrentTerm(); }, []);
  useEffect(() => { if (selectedSchoolYearId) void loadSections(selectedSchoolYearId); }, [selectedSchoolYearId]);

  const selectedSyLabel = schoolYears.find((y: any) => String(y.id) === selectedSchoolYearId)?.yearLabel ?? "";

  // Resolve local section for the selected EP section
  const epSection = sections.find((s) => String(s.id) === selectedSectionId);
  const localSection = localSections.find(
    (ls) => ls.name?.toUpperCase() === epSection?.name?.toUpperCase()
  );

  useEffect(() => {
    if (!selectedSectionId) { setSmartPromotion(null); return; }
    if (localSection && selectedSyLabel) {
      void loadSmartPromotion(localSection.id, selectedSyLabel);
    } else {
      setSmartPromotion(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSectionId, selectedSchoolYearId, localSections, sections]);

  useEffect(() => {
    if (selectedSectionId) {
      void loadRecords(selectedSectionId);
      if (localSection) {
        void loadFinalizeStatus(localSection.id);
        void loadAllTermStatus(localSection.id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSectionId, localSections, sections]);

  // ─── Handlers ────────────────────────────────────────────────────────────────

  const handleEosyFinalize = async () => {
    if (!localSection || !selectedSyLabel || eosyFinalizing) return;
    setConfirmDialog({
      open: true,
      title: "Finalize EOSY?",
      description: `This will snapshot all finalized grades and persist promotion status for ${epSection?.name} (${selectedSyLabel}). This action is safe to re-run.`,
      variant: "warning",
      onConfirm: async () => {
        setConfirmDialog((prev) => ({ ...prev, open: false }));
        setEosyFinalizing(true);
        setEosyMessage(null);
        try {
          const res = await registrarApi.finalizeEosySection(localSection.id, selectedSyLabel);
          setEosyMessage(res.data?.message ?? "EOSY finalize complete");
          void loadSmartPromotion(localSection.id, selectedSyLabel);
        } catch (err: any) {
          const blockers: any[] = err?.response?.data?.blockers ?? [];
          setEosyMessage(
            blockers.length > 0
              ? `${err?.response?.data?.message ?? "Cannot finalize"} — e.g. ${blockers[0].studentName} (${blockers[0].subjectName}, ${blockers[0].term})`
              : err?.response?.data?.message ?? "Failed to finalize EOSY"
          );
        } finally {
          setEosyFinalizing(false);
          setTimeout(() => setEosyMessage(null), 8000);
        }
      },
    });
  };

  const handleFinalizeAll = async () => {
    if (finalizingSubject) return;
    if (!selectedSectionId || !localSection) {
      setFinalizeMessage("Section not found in SMART database");
      setTimeout(() => setFinalizeMessage(null), 6000);
      return;
    }
    const draftCount = allTermStatus.filter((s) => s.totalDraft > 0).length;
    if (draftCount === 0) {
      setFinalizeMessage("All grades are already finalized");
      setTimeout(() => setFinalizeMessage(null), 4000);
      return;
    }
    setConfirmDialog({
      open: true,
      title: "Finalize all draft grades?",
      description: `This will lock ${draftCount} subject(s) across all terms (T1, T2, T3) for ${epSection?.name}. Teachers will no longer be able to edit these grades.`,
      variant: "danger",
      onConfirm: async () => {
        setConfirmDialog((prev) => ({ ...prev, open: false }));
        setFinalizingSubject("all");
        setFinalizeMessage(null);
        try {
          const draftSubjects = allTermStatus.filter((s) => s.totalDraft > 0);
          let totalFinalized = 0;
          let failed = 0;
          const terms = ["T1", "T2", "T3"] as const;
          for (const subject of draftSubjects) {
            const subjectIds = (subject.subjectId ?? "").split(",").filter(Boolean);
            for (const term of terms) {
              if (subject.terms[term]?.draft > 0) {
                for (const subjectId of subjectIds) {
                  try {
                    const res = await registrarApi.finalizeGrades(localSection.id, term, subjectId);
                    totalFinalized += res.data?.finalizedCount || 0;
                  } catch {
                    failed++;
                  }
                  await new Promise((r) => setTimeout(r, 100));
                }
              }
            }
          }
          setFinalizeMessage(
            failed > 0
              ? `Finalized ${totalFinalized} grades, ${failed} request(s) failed — try again for remaining`
              : `Finalized ${totalFinalized} grades across ${draftSubjects.length} subjects (all terms)`,
          );
          void loadFinalizeStatus(localSection.id);
          void loadAllTermStatus(localSection.id);
          setTimeout(() => setFinalizeMessage(null), 6000);
        } catch {
          setFinalizeMessage("Failed to finalize grades");
          setTimeout(() => setFinalizeMessage(null), 6000);
        } finally {
          setFinalizingSubject(null);
        }
      },
    });
  };

  const handleUnfinalizeAll = async () => {
    if (finalizingSubject) return;
    if (!selectedSectionId || !localSection) {
      setFinalizeMessage("Section not found in SMART database");
      setTimeout(() => setFinalizeMessage(null), 6000);
      return;
    }
    const finalizedSubjects = allTermStatus.filter((s) => s.totalFinalized > 0);
    if (finalizedSubjects.length === 0) {
      setFinalizeMessage("No grades to unfinalize");
      setTimeout(() => setFinalizeMessage(null), 4000);
      return;
    }
    setConfirmDialog({
      open: true,
      title: "Unfinalize all grades?",
      description: `This will unlock ${finalizedSubjects.length} subject(s) across all terms (T1, T2, T3) for ${epSection?.name}. Teachers will be able to edit grades again.`,
      variant: "warning",
      onConfirm: async () => {
        setConfirmDialog((prev) => ({ ...prev, open: false }));
        setFinalizingSubject("all");
        setFinalizeMessage(null);
        try {
          let totalUnfinalized = 0;
          let failed = 0;
          const terms = ["T1", "T2", "T3"] as const;
          for (const subject of finalizedSubjects) {
            const subjectIds = (subject.subjectId ?? "").split(",").filter(Boolean);
            for (const term of terms) {
              if (subject.terms[term]?.finalized > 0) {
                for (const subjectId of subjectIds) {
                  try {
                    const res = await registrarApi.unfinalizeGrades(localSection.id, term, subjectId);
                    totalUnfinalized += res.data?.unfinalizedCount || 0;
                  } catch {
                    failed++;
                  }
                  await new Promise((r) => setTimeout(r, 100));
                }
              }
            }
          }
          setFinalizeMessage(
            failed > 0
              ? `Unfinalized ${totalUnfinalized} grades, ${failed} request(s) failed — try again for remaining`
              : `Unfinalized ${totalUnfinalized} grades across ${finalizedSubjects.length} subjects (all terms)`,
          );
          void loadFinalizeStatus(localSection.id);
          void loadAllTermStatus(localSection.id);
          setTimeout(() => setFinalizeMessage(null), 6000);
        } catch {
          setFinalizeMessage("Failed to unfinalize grades");
          setTimeout(() => setFinalizeMessage(null), 6000);
        } finally {
          setFinalizingSubject(null);
        }
      },
    });
  };

  const handleToggleStudentGrades = async (student: any) => {
    const lrn = student.lrn;
    if (!lrn || !localSection) return;

    // Toggle: if already expanded, collapse
    if (expandedStudentLrn === lrn) {
      setExpandedStudentLrn(null);
      return;
    }

    setExpandedStudentLrn(lrn);

    // Already cached? Skip fetch
    if (expandedGrades[lrn]) return;

    setExpandedGradesLoading((prev) => ({ ...prev, [lrn]: true }));
    try {
      const token = sessionStorage.getItem("token_registrar") || "";
      const csrfCookie = document.cookie.split("; ").find(row => row.startsWith("x-csrf-token="))?.split("=")[1] || "";
      const headers = { Authorization: `Bearer ${token}`, "x-csrf-token": csrfCookie };

      // Fetch all 3 terms in parallel
      const [t1Res, t2Res, t3Res] = await Promise.all([
        fetch(`/api/registrar/student-grades/${localSection.id}/T1`, { headers }),
        fetch(`/api/registrar/student-grades/${localSection.id}/T2`, { headers }),
        fetch(`/api/registrar/student-grades/${localSection.id}/T3`, { headers }),
      ]);

      const [t1Data, t2Data, t3Data] = await Promise.all([t1Res.json(), t2Res.json(), t3Res.json()]);

      // Extract this student's data from each term
      const findStudent = (data: any) => data.students?.find((s: any) => s.lrn === lrn);
      const t1 = findStudent(t1Data);
      const t2 = findStudent(t2Data);
      const t3 = findStudent(t3Data);

      // Merge by subject name
      const subjectMap = new Map<string, { subjectName: string; T1: number | null; T2: number | null; T3: number | null }>();
      for (const termData of [t1, t2, t3]) {
        if (!termData?.subjects) continue;
        for (const sub of termData.subjects) {
          const key = sub.subjectName;
          if (!subjectMap.has(key)) {
            subjectMap.set(key, { subjectName: key, T1: null, T2: null, T3: null });
          }
          const entry = subjectMap.get(key)!;
          const termKey = termData === t1 ? "T1" : termData === t2 ? "T2" : "T3";
          entry[termKey] = sub.quarterlyGrade;
        }
      }

      const mergedSubjects = Array.from(subjectMap.values()).sort((a, b) => a.subjectName.localeCompare(b.subjectName));

      // Compute final average from all available term grades
      const allGrades = mergedSubjects.flatMap((s) => [s.T1, s.T2, s.T3]).filter((g): g is number => g !== null);
      const finalAverage = allGrades.length > 0 ? Math.round(allGrades.reduce((sum, g) => sum + g, 0) / allGrades.length) : null;

      setExpandedGrades((prev) => ({
        ...prev,
        [lrn]: {
          subjects: mergedSubjects,
          average: finalAverage,
          totalSubjects: mergedSubjects.length,
          gradedSubjects: mergedSubjects.filter((s) => s.T1 !== null || s.T2 !== null || s.T3 !== null).length,
        },
      }));
    } catch {
      // Set empty data on error
      setExpandedGrades((prev) => ({
        ...prev,
        [lrn]: { subjects: [], average: null, totalSubjects: 0, gradedSubjects: 0 },
      }));
    } finally {
      setExpandedGradesLoading((prev) => ({ ...prev, [lrn]: false }));
    }
  };

  // ─── Derived ─────────────────────────────────────────────────────────────────

  const mergedRecords = records.map((rec) => {
    const epName = `${rec.lastName ?? ""}, ${rec.firstName ?? ""}`.trim().toUpperCase();
    const smartMatch = smartPromotion?.enrollments?.find((e: any) => {
      const smartName = (e.studentName ?? "").trim().toUpperCase();
      return smartName === epName || smartName.includes(epName) || epName.includes(smartName);
    });
    return { ...rec, smart: smartMatch ?? null };
  });

  const hasSectionSelected = !!selectedSectionId;

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 animate-fade-in">
      <Card className="border-slate-200 shadow-sm overflow-hidden bg-white">
        <CardHeader className="border-b border-slate-100 bg-white pb-6">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
            <div className="flex flex-col gap-2">
              <CardTitle className="text-2xl font-bold text-gray-900 flex items-center gap-3">
                <div className="p-2 rounded-xl text-white shadow-lg" style={{ backgroundColor: colors.primary }}>
                  <GraduationCap className="w-5 h-5" />
                </div>
                EOSY Finalization
              </CardTitle>
              <CardDescription className="font-medium text-slate-500">
                End-of-School-Year monitoring, grade locking, and promotion finalization
              </CardDescription>
            </div>

            <div className="flex items-center gap-2">
              <Button onClick={() => void loadSections()} variant="outline" className="rounded-xl shadow-sm">
                <RefreshCw className="w-4 h-4 mr-2" /> Refresh
              </Button>
              {selectedSyLabel && (
                <Button
                  variant="outline"
                  className="rounded-xl shadow-sm"
                  onClick={async () => {
                    try {
                      const res = await registrarApi.exportYearBackup(selectedSyLabel);
                      const blob = new Blob([res.data as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `YearBackup_${selectedSyLabel}.xlsx`;
                      a.click();
                      URL.revokeObjectURL(url);
                    } catch {}
                  }}
                >
                  <Download className="w-4 h-4 mr-2" /> Backup
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {/* ── Filter Bar ── */}
          <div className="p-6 border-b border-slate-100 bg-slate-50/30">
            {sectionsLoading || schoolYearsLoading ? (
              <div className="flex items-center gap-3 text-gray-500 py-2">
                <Loader2 className="w-5 h-5 animate-spin" style={{ color: colors.primary }} />
                <span className="text-sm">Loading EOSY data...</span>
              </div>
            ) : sectionsError ? (
              <div className="flex items-center gap-3 text-red-500 py-2">
                <AlertTriangle className="w-5 h-5" />
                <span className="text-sm">{sectionsError}</span>
                <Button onClick={() => void loadSections()} variant="outline" size="sm" className="rounded-xl ml-2">
                  Retry
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-4">
                <Select value={selectedSchoolYearId} onValueChange={setSelectedSchoolYearId}>
                  <SelectTrigger className="w-[150px]">
                    <SelectValue placeholder="Select SY">
                      {(() => {
                        const sy = schoolYears.find((y) => String(y.id) === selectedSchoolYearId);
                        return sy ? `${sy.yearLabel}${sy.status === "ACTIVE" ? " (Active)" : ""}` : "Select SY";
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

                <Select value={selectedSectionId} onValueChange={setSelectedSectionId}>
                  <SelectTrigger className="w-[280px]">
                    <SelectValue placeholder="Select a section">
                      {(() => {
                        const s = sections.find((sec) => String(sec.id) === selectedSectionId);
                        return s
                          ? `${s.name ?? s.sectionName}${s.gradeLevel?.name ? ` (${s.gradeLevel.name})` : ""}`
                          : "Select a section";
                      })()}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {sections.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.name ?? s.sectionName}
                        {s.gradeLevel?.name ? ` (${s.gradeLevel.name})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <span className="text-sm text-slate-500">
                  {sections.length} section(s) available
                </span>
              </div>
            )}
          </div>

          {/* ── Tabs ── */}
          {hasSectionSelected ? (
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <div className="px-6 pt-4 border-b border-slate-100">
                <TabsList variant="line" className="w-full justify-start">
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="grade-locking">Grade Locking</TabsTrigger>
                  <TabsTrigger value="learner-records">Learner Records</TabsTrigger>
                </TabsList>
              </div>

              <div className="p-6">
                <TabsContent value="overview">
                  {recordsLoading ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                      <Loader2 className="w-8 h-8 animate-spin text-slate-300 mb-3" />
                      <p className="text-slate-500 font-medium text-sm">Loading section data...</p>
                    </div>
                  ) : recordsError ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center px-4">
                      <AlertTriangle className="w-10 h-10 text-amber-400 mb-3" />
                      <p className="text-gray-700 font-semibold">Unable to load records</p>
                      <p className="text-gray-500 text-sm mt-1 max-w-sm">{recordsError}</p>
                      <Button onClick={() => void loadRecords(selectedSectionId)} variant="outline" className="mt-4 rounded-xl">
                        Try Again
                      </Button>
                    </div>
                  ) : (
                    <EOSYOverviewTab
                      smartPromotion={smartPromotion}
                      smartLoading={smartLoading}
                      eosyFinalizing={eosyFinalizing}
                      records={mergedRecords}
                      allTermStatus={allTermStatus}
                      epSectionName={epSection?.name ?? null}
                      adviserName={localSection?.adviser ?? null}
                      onEosyFinalize={handleEosyFinalize}
                    />
                  )}
                </TabsContent>

                <TabsContent value="grade-locking">
                  {finalizeLoading && allTermStatus.length === 0 ? (
                    <div className="flex items-center gap-2 text-gray-500 py-8 justify-center">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="text-sm">Loading finalization status...</span>
                    </div>
                  ) : (
                    <EOSYGradeLockingTab
                      allTermStatus={allTermStatus}
                      finalizeLoading={finalizeLoading}
                      finalizingSubject={finalizingSubject}
                      finalizeMessage={finalizeMessage}
                      epSectionName={epSection?.name ?? null}
                      onFinalizeAll={handleFinalizeAll}
                      onUnfinalizeAll={handleUnfinalizeAll}
                    />
                  )}
                </TabsContent>

                <TabsContent value="learner-records">
                  {recordsLoading ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                      <Loader2 className="w-8 h-8 animate-spin text-slate-300 mb-3" />
                      <p className="text-slate-500 font-medium text-sm">Fetching learner records...</p>
                    </div>
                  ) : recordsError ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center px-4">
                      <AlertTriangle className="w-10 h-10 text-amber-400 mb-3" />
                      <p className="text-gray-700 font-semibold">Unable to load records</p>
                      <p className="text-gray-500 text-sm mt-1 max-w-sm">{recordsError}</p>
                      <Button onClick={() => void loadRecords(selectedSectionId)} variant="outline" className="mt-4 rounded-xl">
                        Try Again
                      </Button>
                    </div>
                  ) : (
                    <EOSYLearnerRecordsTab
                      records={mergedRecords}
                      searchTerm={searchTerm}
                      onSearchChange={setSearchTerm}
                      expandedStudentLrn={expandedStudentLrn}
                      expandedGrades={expandedGrades}
                      expandedGradesLoading={expandedGradesLoading}
                      onToggleStudentGrades={handleToggleStudentGrades}
                    />
                  )}
                </TabsContent>
              </div>
            </Tabs>
          ) : (
            /* ── Empty State ── */
            <div className="flex flex-col items-center justify-center py-40 text-center px-4">
              <GraduationCap className="w-16 h-16 text-slate-200 mb-6" />
              <p className="text-slate-500 font-semibold text-xl">No Section Selected</p>
              <p className="text-slate-400 text-sm mt-2 max-w-sm">
                Select a school year and section from the filters above to view End of School Year records.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Confirm Dialog ── */}
      <EOSYConfirmDialog
        open={confirmDialog.open}
        onOpenChange={(open) => setConfirmDialog((prev) => ({ ...prev, open }))}
        title={confirmDialog.title}
        description={confirmDialog.description}
        variant={confirmDialog.variant}
        confirmLabel={confirmDialog.variant === "danger" ? "Yes, Finalize" : "Confirm"}
        onConfirm={confirmDialog.onConfirm}
      />
    </div>
  );
}
