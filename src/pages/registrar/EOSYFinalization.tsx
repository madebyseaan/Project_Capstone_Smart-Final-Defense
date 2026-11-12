import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, AlertTriangle, RefreshCw, Download, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { registrarApi } from "@/lib/api";
import type { TermFinalizeStatusSubject } from "@/lib/termFinalizationTypes";
import type {
  EosyFinalizationOverview,
  EosyFinalizationSectionStatus,
} from "@/lib/eosyTypes";
import { toast } from "@/lib/toast";

import { PageHeader } from "@/components/layout/PageHeader";

import EOSYOverviewTab from "./components/EOSYOverviewTab";
import EOSYLearnerRecordsTab from "./components/EOSYLearnerRecordsTab";
import EOSYConfirmDialog from "./components/EOSYConfirmDialog";
import EOSYFinalizationStatusPanel from "./components/EOSYFinalizationStatusPanel";
import EnrollProAlert from "./components/EnrollProAlert";
import EOSYSectionDrawer from "./components/EOSYSectionDrawer";

// NOTE: This page is intentionally read-only for EnrollPro data.
// EOSY finalization (POST /eosy/sections/:id/finalize) writes to EnrollPro and is STRICTLY FORBIDDEN
// in SMART. All EnrollPro finalization must be performed directly in EnrollPro.
// SMART's own action here is EOSY promotion finalization. Term grade
// finalization is performed on /registrar/term-finalization.

function formatStaleNotice(ageMs: number) {
  const mins = Math.max(1, Math.round(ageMs / 60000));
  return `Cached data — about ${mins} min old (EnrollPro unreachable).`;
}

function normalizeSectionName(value: string | null | undefined) {
  return (value ?? "").trim().toUpperCase();
}

export default function EOSYFinalization() {

  // ── Filters ──
  const [schoolYearsLoading, setSchoolYearsLoading] = useState(true);
  const [schoolYears, setSchoolYears] = useState<any[]>([]);
  const [selectedSchoolYearId, setSelectedSchoolYearId] = useState<string>("");
  const [, setSectionsLoading] = useState(false);
  const [sectionsError, setSectionsError] = useState<string | null>(null);
  const [sections, setSections] = useState<any[]>([]);
  const [selectedSectionId, setSelectedSectionId] = useState<string>("");
  const [localSections, setLocalSections] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState("overview");
  const [cacheNotice, setCacheNotice] = useState<string | null>(null);
  const [sectionsSource, setSectionsSource] = useState<"enrollpro" | "db" | null>(null);

  // ── Year-level finalization status (SMART DB, independent of EnrollPro) ──
  const [finalizationOverview, setFinalizationOverview] =
    useState<EosyFinalizationOverview | null>(null);
  const [finalizationLoading, setFinalizationLoading] = useState(false);
  const [finalizationError, setFinalizationError] = useState<string | null>(null);
  const finalizationRequestId = useRef(0);

  // ── Data ──
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordsError, setRecordsError] = useState<string | null>(null);
  const [records, setRecords] = useState<any[]>([]);
  const [, setSectionMeta] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState("");

  // ── Term finalization readiness (read-only here; actions live on Term Finalization) ──
  const [allTermStatus, setAllTermStatus] = useState<TermFinalizeStatusSubject[]>([]);

  // ── SMART Promotion ──
  const [smartPromotion, setSmartPromotion] = useState<any>(null);
  const [smartLoading, setSmartLoading] = useState(false);
  const [eosyFinalizing, setEosyFinalizing] = useState(false);
  const [eosyUnfinalizing, setEosyUnfinalizing] = useState(false);
  const [eosyUnfinalizingAll, setEosyUnfinalizingAll] = useState(false);
  const [, setEosyMessage] = useState<string | null>(null);
  const navigate = useNavigate();

  // ── Student Grades (inline expand) ──
  const [expandedStudentLrn, setExpandedStudentLrn] = useState<string | null>(null);
  const [expandedGrades, setExpandedGrades] = useState<Record<string, { subjects: any[]; average: number | null; totalSubjects: number; gradedSubjects: number }>>({});
  const [expandedGradesLoading, setExpandedGradesLoading] = useState<Record<string, boolean>>({});

  // ── Confirm Dialogs ──
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    description: string;
    confirmLabel: string;
    variant: "danger" | "warning" | "info";
    onConfirm: () => void;
  }>({
    open: false,
    title: "",
    description: "",
    confirmLabel: "Confirm",
    variant: "warning",
    onConfirm: () => {},
  });

  // ─── Data Loading ────────────────────────────────────────────────────────────

  const loadSchoolYears = async () => {
    setSchoolYearsLoading(true);
    try {
      const res = await registrarApi.getEosySchoolYears();
      const payload = res.data as any;
      const years: any[] = Array.isArray(payload) ? payload : (payload?.schoolYears ?? []);
      setSchoolYears(years);
      if (payload?.warming) {
        // DB mirror served instantly; EnrollPro refresh is running in the background.
        setCacheNotice(null);
      } else if (payload?.source === "db") {
        setCacheNotice("EnrollPro is unreachable — showing last known school years from the SMART database.");
      } else if (payload?.stale) {
        setCacheNotice(formatStaleNotice(payload.ageMs ?? 0));
      } else {
        setCacheNotice(null);
      }
      setSelectedSchoolYearId((current) => {
        if (current && years.some((year) => String(year.id) === current)) {
          return current;
        }
        const active = years.find((year) => year.status === "ACTIVE");
        if (active) return String(active.id);
        return years.length > 0 ? String(years[0].id) : "";
      });
    } catch (err: any) {
      console.error("Failed to load school years", err);
      setCacheNotice("EnrollPro is unreachable and no cached school years are available.");
    } finally {
      setSchoolYearsLoading(false);
    }
  };

  const loadSections = async (syId?: string, force = false) => {
    const targetSyId = syId || selectedSchoolYearId;
    if (!targetSyId) return;
    setSectionsLoading(true);
    setSectionsError(null);
    setSelectedSectionId("");
    setRecords([]);
    try {
      const res = await registrarApi.getEosySections(parseInt(targetSyId, 10), force);
      const payload = res.data as any;
      setSections(payload.sections ?? payload.data ?? payload ?? []);
      setSectionsSource(payload?.source === "db" ? "db" : "enrollpro");
      if (payload?.source === "db") {
        setCacheNotice("EnrollPro is unreachable — showing last known sections from the SMART database. Live EOSY records are unavailable.");
      } else if (payload?.stale) {
        setCacheNotice(formatStaleNotice(payload.ageMs ?? 0));
      } else {
        setCacheNotice(null);
      }
    } catch (err: any) {
      setSectionsSource(null);
      setSectionsError(err?.response?.data?.message ?? "Failed to load EOSY sections from EnrollPro.");
    } finally {
      setSectionsLoading(false);
    }
  };

  const loadRecords = async (sectionId: string, force = false) => {
    if (!/^\d+$/.test(sectionId)) {
      setRecords([]);
      setRecordsError("EnrollPro is unreachable — live EOSY records are unavailable right now.");
      return;
    }
    setRecordsLoading(true);
    setRecordsError(null);
    setRecords([]);
    setSectionMeta(null);
    try {
      const res = await registrarApi.getEosySectionRecords(parseInt(sectionId, 10), force);
      const payload = res.data as any;
      if (payload?.stale) setCacheNotice(formatStaleNotice(payload.ageMs ?? 0));
      else setCacheNotice(null);
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

  const loadAllTermStatus = async (sectionId: string, schoolYear: string) => {
    if (!schoolYear) {
      setAllTermStatus([]);
      return;
    }
    try {
      const res = await registrarApi.getFinalizeStatusAll(sectionId, schoolYear);
      setAllTermStatus(res.data.subjects ?? []);
    } catch (err) {
      console.error("Failed to load all-term finalize status", err);
    }
  };

  const loadFinalizationStatus = useCallback(async (schoolYear: string) => {
    if (!schoolYear) {
      setFinalizationOverview(null);
      setFinalizationError(null);
      return;
    }
    const requestId = ++finalizationRequestId.current;
    setFinalizationLoading(true);
    setFinalizationError(null);
    try {
      const res = await registrarApi.getEosyFinalizationStatus(schoolYear);
      if (requestId !== finalizationRequestId.current) return;
      setFinalizationOverview(res.data);
    } catch (err: any) {
      if (requestId !== finalizationRequestId.current) return;
      setFinalizationOverview(null);
      setFinalizationError(
        err?.response?.data?.message ?? "Failed to load EOSY finalization status.",
      );
    } finally {
      if (requestId === finalizationRequestId.current) {
        setFinalizationLoading(false);
      }
    }
  }, []);

  const loadLocalSections = async (schoolYearLabel?: string) => {
    try {
      let targetSchoolYear = schoolYearLabel;
      if (!targetSchoolYear) {
        const settingsRes = await fetch("/api/admin/settings/public");
        const settingsData = await settingsRes.json();
        targetSchoolYear = settingsData?.settings?.currentSchoolYear;
      }
      if (!targetSchoolYear) {
        setLocalSections([]);
        return;
      }
      const res = await registrarApi.getSections({ schoolYear: targetSchoolYear });
      const data = res.data as any;
      setLocalSections(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to load local sections", err);
    }
  };

  // ─── Effects ─────────────────────────────────────────────────────────────────

  const selectedSyLabel =
    schoolYears.find((y: any) => String(y.id) === selectedSchoolYearId)?.yearLabel ?? "";

  const unfinalizableSectionCount =
    finalizationOverview?.sections.filter((section) => section.withStoredStatus > 0).length ?? 0;

  useEffect(() => { void loadSchoolYears(); }, []);
  useEffect(() => {
    if (!selectedSyLabel) return;
    void loadLocalSections(selectedSyLabel);
  }, [selectedSyLabel]);
  useEffect(() => { if (selectedSchoolYearId) void loadSections(selectedSchoolYearId); }, [selectedSchoolYearId]);
  useEffect(() => {
    if (!selectedSyLabel) {
      finalizationRequestId.current += 1;
      setFinalizationOverview(null);
      setFinalizationError(null);
      setFinalizationLoading(false);
      return;
    }
    setFinalizationOverview(null);
    setFinalizationError(null);
    void loadFinalizationStatus(selectedSyLabel);
  }, [selectedSyLabel, loadFinalizationStatus]);

  // Resolve local section for the selected EP section
  const epSection = sections.find((s) => String(s.id) === selectedSectionId);
  const localSection = localSections.find(
    (ls) =>
      (epSection?.id != null &&
        ls.enrollProId != null &&
        String(ls.enrollProId) === String(epSection.id)) ||
      normalizeSectionName(ls.name) ===
        normalizeSectionName(epSection?.name ?? epSection?.sectionName),
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
      if (localSection && selectedSyLabel) {
        void loadAllTermStatus(localSection.id, selectedSyLabel);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSectionId, localSections, sections, selectedSyLabel]);

  // ─── Handlers ────────────────────────────────────────────────────────────────

  const handleRefreshAll = () => {
    void loadSchoolYears();
    if (selectedSchoolYearId) void loadSections(selectedSchoolYearId, true);
    if (selectedSyLabel) {
      void loadFinalizationStatus(selectedSyLabel);
      void loadLocalSections(selectedSyLabel);
    }
  };

  const findEnrollProSectionForStatus = (status: EosyFinalizationSectionStatus) => {
    const local = localSections.find((section) => section.id === status.sectionId);
    if (local?.enrollProId != null) {
      const byEnrollProId = sections.find(
        (section) => Number(section.id) === Number(local.enrollProId),
      );
      if (byEnrollProId) return byEnrollProId;
    }
    return (
      sections.find(
        (section) =>
          normalizeSectionName(section.name ?? section.sectionName) ===
          normalizeSectionName(status.sectionName),
      ) ?? null
    );
  };

  const canOpenStatusSection = (status: EosyFinalizationSectionStatus) =>
    !!findEnrollProSectionForStatus(status);

  const handleOpenStatusSection = (status: EosyFinalizationSectionStatus) => {
    const target = findEnrollProSectionForStatus(status);
    if (!target) {
      toast.error("This section is not available in EnrollPro.");
      return;
    }
    setSelectedSectionId(String(target.id));
    setActiveTab("overview");
  };

  const handleCloseSection = () => {
    setSelectedSectionId("");
  };

  const handleEosyFinalize = async () => {
    if (!localSection || !selectedSyLabel || eosyFinalizing) return;
    setConfirmDialog({
      open: true,
      title: "Finalize EOSY?",
      description: `This will snapshot all finalized grades and persist promotion status for ${epSection?.name} (${selectedSyLabel}). This action is safe to re-run.`,
      confirmLabel: "Finalize EOSY",
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

  const handleUnfinalizeEosy = async () => {
    if (!localSection || !selectedSyLabel || eosyUnfinalizing) return;
    setConfirmDialog({
      open: true,
      title: "Unfinalize EOSY?",
      description: `This deletes EOSY promotion snapshots and clears promotion status for ${epSection?.name} (${selectedSyLabel}). Grade rows and term finalization are not changed. This is blocked if any remedial record is completed.`,
      confirmLabel: "Unfinalize EOSY",
      variant: "danger",
      onConfirm: async () => {
        setConfirmDialog((prev) => ({ ...prev, open: false }));
        setEosyUnfinalizing(true);
        setEosyMessage(null);
        try {
          const res = await registrarApi.unfinalizeEosySection(localSection.id, selectedSyLabel);
          setEosyMessage(res.data?.message ?? "EOSY unfinalized");
          void loadSmartPromotion(localSection.id, selectedSyLabel);
          void loadAllTermStatus(localSection.id, selectedSyLabel);
        } catch (err: any) {
          setEosyMessage(err?.response?.data?.message ?? "Failed to unfinalize EOSY");
        } finally {
          setEosyUnfinalizing(false);
          setTimeout(() => setEosyMessage(null), 8000);
        }
      },
    });
  };

  const handleUnfinalizeAllEosy = () => {
    if (!selectedSyLabel || eosyUnfinalizingAll || unfinalizableSectionCount === 0) return;
    setConfirmDialog({
      open: true,
      title: "Unfinalize all EOSY sections?",
      description: `This deletes EOSY promotion snapshots and clears promotion status for ${unfinalizableSectionCount} section(s) in ${selectedSyLabel}. Grade rows and term finalization are not changed. Sections with completed remedial records will be skipped.`,
      confirmLabel: "Unfinalize all",
      variant: "danger",
      onConfirm: async () => {
        setConfirmDialog((prev) => ({ ...prev, open: false }));
        setEosyUnfinalizingAll(true);
        try {
          const res = await registrarApi.unfinalizeAllEosySections(selectedSyLabel);
          const blocked = res.data?.blocked ?? [];
          if (blocked.length > 0) {
            toast.warning(
              `${res.data.message}. Skipped: ${blocked
                .map((section) => section.sectionName)
                .join(", ")}.`,
            );
          } else {
            toast.success(res.data.message);
          }
          await loadFinalizationStatus(selectedSyLabel);
          void loadLocalSections(selectedSyLabel);
          if (localSection) {
            void loadSmartPromotion(localSection.id, selectedSyLabel);
            void loadAllTermStatus(localSection.id, selectedSyLabel);
          }
        } catch (err: any) {
          toast.error(
            err?.response?.data?.message ?? "Failed to unfinalize all EOSY sections",
          );
        } finally {
          setEosyUnfinalizingAll(false);
        }
      },
    });
  };

  const handleOpenTermFinalization = () => {
    const params = new URLSearchParams();
    if (selectedSyLabel) params.set("schoolYear", selectedSyLabel);
    if (localSection) params.set("sectionId", localSection.id);
    const query = params.toString();
    navigate(`/registrar/term-finalization${query ? `?${query}` : ""}`);
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

  // When EnrollPro is unreachable, build lightweight learner rows from the
  // SMART promotion data so the Overview can still render useful counts.
  const smartFallbackRecords = (smartPromotion?.enrollments ?? []).map((enrollment: any) => {
    const [lastName = "", firstName = ""] = String(enrollment.studentName ?? "")
      .split(",")
      .map((part: string) => part.trim());
    const status = enrollment.decision?.promotionStatus ?? enrollment.stored?.promotionStatus ?? "";
    return {
      enrollmentRecordId: enrollment.enrollmentId,
      learnerId: enrollment.studentId,
      lrn: enrollment.lrn ?? "",
      firstName,
      lastName,
      middleName: "",
      sex: "",
      finalAverage: enrollment.decision?.generalAverage ?? null,
      isCurrentYear: true,
      promoted: status === "PROMOTED" || status === "JHS_COMPLETER",
      finalStatus: status,
      promotedToGradeLevel: enrollment.decision?.promotedToGradeLevel ?? "",
      smart: enrollment,
    };
  });

  const displayRecords = mergedRecords.length > 0 ? mergedRecords : smartFallbackRecords;

  const hasSectionSelected = !!selectedSectionId;

  const enrollProAlertMessage =
    sectionsError ??
    (sectionsSource === "db"
      ? "EnrollPro is unreachable. Showing last known sections from the SMART database. Live EOSY records are unavailable."
      : cacheNotice);

  // Term finalization is now owned by /registrar/term-finalization. EOSY only
  // reads that state to decide whether promotion can be finalized.
  const eosyFinalized =
    !!smartPromotion?.enrollments?.length &&
    smartPromotion.enrollments.every((e: any) => e.stored?.promotionStatus != null) &&
    (smartPromotion.draftBlockers?.length ?? 0) === 0;

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div
      className="space-y-6 animate-fade-in w-full"
      data-testid="eosy-finalization-page"
    >
      <EOSYFinalizationStatusPanel
        header={
          <div className="space-y-3">
            <PageHeader
              title="EOSY Finalization"
              description="Year-end promotion finalization. Term grade finalization now lives on the Term Finalization page."
              variant="plain"
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    onClick={handleRefreshAll}
                    variant="outline"
                    size="sm"
                    className="border-border/70 bg-background hover:bg-muted/70 text-foreground font-medium text-xs"
                  >
                    <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh
                  </Button>
                  {selectedSyLabel && (
                    <Button
                      variant="default"
                      size="sm"
                      className="font-semibold text-xs shadow-sm shadow-primary/20"
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
                        } catch { /* intentionally empty */ }
                      }}
                    >
                      <Download className="w-4 h-4 mr-1.5" /> Backup
                    </Button>
                  )}
                  {selectedSyLabel && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleUnfinalizeAllEosy}
                      disabled={
                        finalizationLoading || eosyUnfinalizingAll || unfinalizableSectionCount === 0
                      }
                      className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive font-medium text-xs"
                      data-testid="eosy-unfinalize-all"
                    >
                      {eosyUnfinalizingAll ? (
                        <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                      ) : (
                        <Undo2 className="w-3.5 h-3.5 mr-1.5" />
                      )}
                      Unfinalize all
                    </Button>
                  )}
                </div>
              }
            />
            {enrollProAlertMessage && <EnrollProAlert message={enrollProAlertMessage} />}
          </div>
        }
        overview={finalizationOverview}
        loading={finalizationLoading || schoolYearsLoading}
        error={finalizationError}
        yearLabel={selectedSyLabel}
        schoolYears={schoolYears}
        selectedSchoolYearId={selectedSchoolYearId}
        onSchoolYearChange={setSelectedSchoolYearId}
        schoolYearsLoading={schoolYearsLoading}
        onRefresh={handleRefreshAll}
        onOpenSection={handleOpenStatusSection}
        canOpenSection={canOpenStatusSection}
        isSectionSelected={(section) => {
          const target = findEnrollProSectionForStatus(section);
          return !!target && String(target.id) === selectedSectionId;
        }}
      />

      <EOSYSectionDrawer
        open={hasSectionSelected}
        title={epSection?.name ?? epSection?.sectionName ?? "Section Detail"}
        subtitle={[
          selectedSyLabel,
          localSection?.adviser
            ? `Adviser: ${localSection.adviser}`
            : "No adviser assigned",
        ]
          .filter(Boolean)
          .join(" · ")}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onClose={handleCloseSection}
      >
        {activeTab === "overview" ? (
          <>
            {recordsError && (
              <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <p className="text-xs font-medium">
                  {recordsError} Showing SMART promotion and finalization data instead.
                </p>
              </div>
            )}
            {recordsLoading ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground/40 mb-3" />
                <p className="text-muted-foreground font-medium text-sm">Loading section data...</p>
              </div>
            ) : (
              <EOSYOverviewTab
                smartPromotion={smartPromotion}
                smartLoading={smartLoading}
                eosyFinalizing={eosyFinalizing}
                eosyUnfinalizing={eosyUnfinalizing}
                records={displayRecords}
                allTermStatus={allTermStatus}
                epSectionName={epSection?.name ?? null}
                adviserName={localSection?.adviser ?? null}
                eosyFinalized={eosyFinalized}
                onEosyFinalize={handleEosyFinalize}
                onUnfinalizeEosy={handleUnfinalizeEosy}
                onOpenTermFinalization={handleOpenTermFinalization}
              />
            )}
          </>
        ) : recordsLoading ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground/40 mb-3" />
            <p className="text-muted-foreground font-medium text-sm">Loading section data...</p>
          </div>
        ) : recordsError ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mb-4">
              <AlertTriangle className="w-8 h-8 text-destructive" />
            </div>
            <h2 className="text-xl font-semibold text-foreground mb-2">Unable to Load Records</h2>
            <p className="text-muted-foreground mb-4 max-w-sm">{recordsError}</p>
            <Button onClick={() => void loadRecords(selectedSectionId)} variant="outline">
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
      </EOSYSectionDrawer>

      {/* ── Confirm Dialog ── */}
      <EOSYConfirmDialog
        open={confirmDialog.open}
        onOpenChange={(open) => setConfirmDialog((prev) => ({ ...prev, open }))}
        title={confirmDialog.title}
        description={confirmDialog.description}
        variant={confirmDialog.variant}
        confirmLabel={confirmDialog.confirmLabel}
        loading={eosyFinalizing || eosyUnfinalizing || eosyUnfinalizingAll}
        onConfirm={confirmDialog.onConfirm}
      />
    </div>
  );
}
