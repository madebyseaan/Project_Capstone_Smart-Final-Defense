/**
 * StudentRecordsDrawer.tsx — registrar Records Vault slide-over.
 *
 * Opens instantly from the Former Students list and renders the learner's
 * documents in place (no redirect). Availability comes from the read-only
 * documents-index endpoint so we never fire a request that 404s.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  X,
  FileText,
  GraduationCap,
  History,
  ClipboardCheck,
  LayoutList,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { registrarApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import OverviewTab from "./records/OverviewTab";
import Sf10Tab from "./records/Sf10Tab";
import Sf9Tab from "./records/Sf9Tab";
import PriorRecordsTab from "./records/PriorRecordsTab";
import RemedialTab from "./records/RemedialTab";
import {
  EMPTY_INDEX_ENTRY,
  formatVaultGradeLevel,
  formatVaultName,
  isSyntheticStudentId,
  type VaultStudent,
  type VaultTab,
} from "./records/types";

interface StudentRecordsDrawerProps {
  student: VaultStudent | null;
  initialTab?: VaultTab;
  onClose: () => void;
  onRequestSync: () => void;
}

const TABS: { key: VaultTab; label: string; icon: LucideIcon }[] = [
  { key: "overview", label: "Overview", icon: LayoutList },
  { key: "sf10", label: "SF10", icon: FileText },
  { key: "sf9", label: "Report Cards", icon: GraduationCap },
  { key: "prior", label: "Prior School", icon: History },
  { key: "remedial", label: "Remedial", icon: ClipboardCheck },
];

export default function StudentRecordsDrawer({
  student,
  initialTab = "sf10",
  onClose,
  onRequestSync,
}: StudentRecordsDrawerProps) {
  const navigate = useNavigate();
  const studentKey = student?.id ?? "";

  // Reset the active tab when a different learner is opened — derived state,
  // no effect (avoids cascading renders).
  const [navState, setNavState] = useState<{ key: string; tab: VaultTab; sf9Year: string | null }>(() => ({
    key: studentKey,
    tab: initialTab,
    sf9Year: null,
  }));
  if (navState.key !== studentKey) {
    setNavState({ key: studentKey, tab: initialTab, sf9Year: null });
  }
  const tab = navState.tab;
  const setTab = (next: VaultTab) =>
    setNavState((prev) => ({ ...prev, key: studentKey, tab: next }));
  const openYear = (year: string) =>
    setNavState({ key: studentKey, tab: "sf9", sf9Year: year });

  const synthetic = student ? isSyntheticStudentId(student.id) : false;

  const indexQuery = useQuery({
    queryKey: ["registrar", "vault", "index", studentKey],
    queryFn: async () => {
      if (!student) return EMPTY_INDEX_ENTRY;
      const { data } = await registrarApi.getDocumentsIndex([student.id]);
      return data.index[student.id] ?? EMPTY_INDEX_ENTRY;
    },
    enabled: !!student && !synthetic,
    retry: 0,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!student) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [student, onClose]);

  if (!student) return null;

  const entry = synthetic ? EMPTY_INDEX_ENTRY : indexQuery.data ?? null;
  const loadingIndex = !synthetic && indexQuery.isLoading;

  const tabBadge = (key: VaultTab): string | null => {
    if (loadingIndex || !entry) return null;
    if (key === "sf9") return entry.reportCardYears.length ? String(entry.reportCardYears.length) : null;
    if (key === "prior") return entry.priorRecords ? String(entry.priorRecords) : null;
    return null;
  };

  // Portal to <body>: the layout's content wrapper creates a stacking context,
  // so an in-tree overlay can never paint above the fixed sidebar.
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex justify-end print-hide"
      role="dialog"
      aria-modal="true"
      aria-label={`Records for ${formatVaultName(student)}`}
    >
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />

      <div className="relative h-full w-full max-w-[1100px] bg-background shadow-2xl flex flex-col animate-in slide-in-from-right-2 duration-200">
        <header className="px-4 lg:px-6 pt-4 pb-0 border-b border-border">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-bold tracking-tight text-foreground truncate">
                Records — {formatVaultName(student)}
              </h2>
              <p className="text-xs text-muted-foreground truncate">
                LRN {student.lrn || "—"} · {formatVaultGradeLevel(student.lastGradeLevel) || "—"} ·{" "}
                {student.lastSection || "—"} · S.Y. {student.lastSchoolYear || "—"}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge variant="outline" className="text-[11px] font-medium">
                {student.enrollmentStatus}
              </Badge>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close records"
                className="p-2 rounded-lg text-muted-foreground hover:bg-muted transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <nav className="flex items-center gap-1 mt-3 -mb-px overflow-x-auto" aria-label="Document sections">
            {TABS.map(({ key, label, icon: Icon }) => {
              const isActive = tab === key;
              const badge = tabBadge(key);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 h-9 rounded-t-lg text-xs font-medium whitespace-nowrap border-b-2 transition-colors",
                    isActive
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                  {badge && (
                    <span className="px-1.5 py-0.5 text-[10px] rounded-full font-semibold bg-muted text-muted-foreground tabular-nums">
                      {badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </header>

        <div className="flex-1 overflow-y-auto p-4 lg:p-6">
          {loadingIndex ? (
            <div className="flex items-center justify-center gap-2 py-24 text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              Checking available documents…
            </div>
          ) : (
            <>
              {tab === "overview" && (
                <OverviewTab
                  student={student}
                  entry={entry}
                  loading={loadingIndex}
                  onSelectTab={setTab}
                  onOpenYear={openYear}
                />
              )}
              {tab === "sf10" && (
                <Sf10Tab student={student} available={!!entry?.sf10} onRequestSync={onRequestSync} />
              )}
              {tab === "sf9" && (
                <Sf9Tab student={student} years={entry?.reportCardYears ?? []} initialYear={navState.sf9Year} />
              )}
              {tab === "prior" && (
                <PriorRecordsTab
                  student={student}
                  count={entry?.priorRecords ?? 0}
                  onManage={() => navigate(`/registrar/transferees/${student.id}/sf10-records`)}
                />
              )}
              {tab === "remedial" && (
                <RemedialTab
                  student={student}
                  hasRemedial={!!entry?.remedial}
                  onOpenTracker={() => navigate("/registrar/remedial")}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
