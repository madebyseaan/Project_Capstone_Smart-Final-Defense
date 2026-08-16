import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  Sparkles,
  ChevronRight,
  ChevronLeft,
  X,
  Lightbulb,
  Check,
  BookOpen,
  FileSpreadsheet,
  BarChart3,
  Users,
  Calendar,
  Layers,
  Award,
  Zap,
  Keyboard,
  MousePointerClick,
  Edit3,
  HelpCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface TourStep {
  id: string;
  targetId: string;
  title: string;
  category: string;
  icon: any;
  content: string;
  exampleBox?: {
    title: string;
    items: { label: string; value: string; color?: string }[];
    notes?: string;
  };
  devTip: string;
  badgeColor: string;
  placement?: "center" | "right" | "auto";
  action?: (helpers: {
    setShowAssessmentDetails: (show: boolean) => void;
    setSelectedColumn: (col: { type: "WW" | "PT" | "QA"; number: number } | null) => void;
  }) => void;
}

const TOUR_STEPS: TourStep[] = [
  {
    id: "hero-info",
    targetId: "tutorial-hero-info",
    title: "Class Information & Grading Scheme",
    category: "Subject Setup",
    icon: BookOpen,
    badgeColor: "bg-indigo-50 text-indigo-700 border-indigo-200",
    content:
      "Welcome! This banner displays your current subject, grade level, and assigned section. SMART automatically determines whether standard DepEd weighted scoring (e.g., 20% Written Work, 50% Performance Tasks, 30% Quarterly Assessment) or Homeroom Guidance qualitative grading mode is active.",
    devTip:
      "Click the back arrow on the left anytime to return to your Class Records list and select other subjects.",
    action: ({ setShowAssessmentDetails, setSelectedColumn }) => {
      setShowAssessmentDetails(false);
      setSelectedColumn(null);
    },
  },
  {
    id: "ecr-actions",
    targetId: "tutorial-ecr-actions",
    title: "Official DepEd ECR Excel Export & Import",
    category: "Data Sync",
    icon: FileSpreadsheet,
    badgeColor: "bg-emerald-50 text-emerald-700 border-emerald-200",
    content:
      "Never re-type grades manually! Click 'Export ECR' to instantly generate and download the official DepEd Electronic Class Record (.xlsx) formatted to division standards. Already have scores in an Excel sheet? Click 'Import ECR' to batch-sync all student scores into SMART in seconds.",
    devTip:
      "The exported workbook uses official DepEd sheet formulas, making it 100% ready for quarterly submission to the registrar or school head.",
    action: ({ setShowAssessmentDetails, setSelectedColumn }) => {
      setShowAssessmentDetails(false);
      setSelectedColumn(null);
    },
  },
  {
    id: "stats-overview",
    targetId: "tutorial-stats-overview",
    title: "Real-Time Class Performance Analytics",
    category: "Insights",
    icon: BarChart3,
    badgeColor: "bg-blue-50 text-blue-700 border-blue-200",
    content:
      "These live metric cards recalculate your Class Average, Passing Rate, Highest Grade, and Students Needing Support in real time as you type scores — giving you instant visibility into student mastery without manual computation.",
    devTip:
      "Keep an eye on 'Needs Support' (learners below 75.0) to schedule timely remedial sessions before quarterly finalization.",
    action: ({ setShowAssessmentDetails, setSelectedColumn }) => {
      setShowAssessmentDetails(false);
      setSelectedColumn(null);
    },
  },
  {
    id: "gender-toggle",
    targetId: "tutorial-gender-toggle",
    title: "Alphabetical vs. DepEd Gendered Sections",
    category: "Roster View",
    icon: Users,
    badgeColor: "bg-purple-50 text-purple-700 border-purple-200",
    content:
      "DepEd school forms (SF1, SF2, SF5) require learners categorized into Male and Female groupings. Toggle between a single clean Alphabetical list or DepEd Gendered Section format with one click. Your grade entries are preserved across both views.",
    devTip:
      "When cross-referencing your grade sheet with School Form SF5 (Report on Promotion), switch to 'Gendered' view for identical ordering.",
    action: ({ setShowAssessmentDetails, setSelectedColumn }) => {
      setShowAssessmentDetails(false);
      setSelectedColumn(null);
    },
  },
  {
    id: "optional-details-btn",
    targetId: "tutorial-optional-details",
    title: "Optional Assessment Details Toggle",
    category: "Assessment Meta",
    icon: Calendar,
    badgeColor: "bg-amber-50 text-amber-700 border-amber-200",
    content:
      "Clicking this button expands the Assessment Details manager. This lets you assign descriptive titles (e.g. 'Quiz 1: Fractions') and submission dates to all Written Works, Performance Tasks, and Quarterly Exams.",
    devTip:
      "Setting dates and descriptions is optional, but it enriches your official DepEd ECR export with complete lesson documentation.",
    action: ({ setShowAssessmentDetails, setSelectedColumn }) => {
      setShowAssessmentDetails(true);
      setSelectedColumn(null);
    },
  },
  {
    id: "assessment-panel",
    targetId: "tutorial-assessment-details-panel",
    title: "Bulk Assessment Details Manager",
    category: "Assessment Meta",
    icon: Edit3,
    badgeColor: "bg-indigo-50 text-indigo-700 border-indigo-200",
    content:
      "Here is the opened Assessment Details panel! You can set the Date and meaningful Titles for all Written Works, Performance Tasks, and Term Assessments. Click 'Save All Details' to store them for the entire class.",
    exampleBox: {
      title: "Example Setup",
      items: [
        { label: "WW 1", value: "Quiz 1: Fractions (15/08/2026)", color: "text-indigo-600" },
        { label: "PT 1", value: "Math Model Portfolio", color: "text-purple-700" },
      ],
      notes: "Saved titles appear automatically on DepEd ECR export sheets!",
    },
    devTip:
      "You can collapse this panel anytime by clicking 'Optional Assessment Details' again.",
    action: ({ setShowAssessmentDetails, setSelectedColumn }) => {
      setShowAssessmentDetails(true);
      setSelectedColumn(null);
    },
  },
  {
    id: "column-quick-meta",
    targetId: "tutorial-column-meta-editor",
    title: "Single-Column Quick Meta Editor",
    category: "Pro Feature",
    icon: MousePointerClick,
    badgeColor: "bg-purple-50 text-purple-700 border-purple-200",
    content:
      "Did you know? You don't have to open the full panel every time! Simply click directly on any column header (1, 2, 3...) in the table below to open this quick single-activity editor bar.",
    devTip:
      "Type the title and date, then click 'Apply' to update just that specific quiz or activity in one second.",
    action: ({ setShowAssessmentDetails, setSelectedColumn }) => {
      setShowAssessmentDetails(false);
      setSelectedColumn({ type: "WW", number: 1 });
    },
  },
  {
    id: "period-controls",
    targetId: "tutorial-period-controls",
    title: "Quarterly Periods & Score Safety",
    category: "Term Control",
    icon: Layers,
    badgeColor: "bg-rose-50 text-rose-700 border-rose-200",
    content:
      "Switch between Term 1, Term 2, and Term 3 via the Period selector. SMART isolates and stores each quarter's records safely. If you ever need a clean slate for the active quarter, 'Clear Scores' provides a 2-step protected reset.",
    devTip:
      "Scores are saved permanently per quarter. Switching terms will never overwrite or erase scores from other quarters.",
    action: ({ setShowAssessmentDetails, setSelectedColumn }) => {
      setShowAssessmentDetails(false);
      setSelectedColumn(null);
    },
  },
  {
    id: "hps-row",
    targetId: "tutorial-hps-row",
    title: "Highest Possible Score (HPS / MAX Row)",
    category: "Crucial Step",
    icon: Award,
    badgeColor: "bg-indigo-900 text-indigo-200 border-indigo-700",
    content:
      "⚡ CRITICAL STEP: Always enter the Highest Possible Score in this dark navy row before recording student grades! SMART uses these benchmark values to calculate Percentage Scores (PS) and Weighted Scores (WS) for each student.",
    devTip:
      "If HPS is set to 0 or left blank, student percentage scores cannot be calculated and grades will display as 0.0.",
    action: ({ setShowAssessmentDetails, setSelectedColumn }) => {
      setShowAssessmentDetails(false);
      setSelectedColumn(null);
    },
  },
  {
    id: "task-controls",
    targetId: "tutorial-task-controls",
    title: "Dynamic Activities (+ / - Tasks)",
    category: "Custom Weights",
    icon: Zap,
    badgeColor: "bg-purple-50 text-purple-700 border-purple-200",
    content:
      "Have 5 quizzes or 4 performance tasks this quarter? Click the (+) button inside Written Work or Performance Tasks to dynamically add columns, or (-) to remove extra ones. The Total, PS, and Weighted Score automatically adjust.",
    devTip:
      "You can add up to 10 activities per category. Column removal warns you first if scores are currently recorded.",
    action: ({ setShowAssessmentDetails, setSelectedColumn }) => {
      setShowAssessmentDetails(false);
      setSelectedColumn(null);
    },
  },
  {
    id: "cell-example",
    targetId: "tutorial-task-controls",
    title: "Live Example: How to Grade a Single Cell",
    category: "Grading Example",
    icon: HelpCircle,
    badgeColor: "bg-emerald-50 text-emerald-700 border-emerald-200",
    content:
      "Here is a complete walkthrough for entering scores into the ledger grid:",
    exampleBox: {
      title: "Cell Grading Formula Example",
      items: [
        { label: "1. HPS Max Score", value: "20 pts (in MAX Row)", color: "text-indigo-700" },
        { label: "2. Student Raw Score", value: "Type '18' into cell", color: "text-slate-900" },
        { label: "3. Percentage Score (PS)", value: "90.0% ((18 ÷ 20) × 100)", color: "text-indigo-600" },
        { label: "4. Weighted Score (WS)", value: "18.00 (90% × 20% weight)", color: "text-purple-600" },
        { label: "5. Excused Absence", value: "Type 'E' (No grade penalty)", color: "text-blue-600" },
        { label: "6. Unexcused Absent", value: "Type 'A' (Counted as 0)", color: "text-rose-600" },
      ],
      notes: "Scores auto-save immediately to the server on Enter or when moving away!",
    },
    devTip:
      "Pressing Enter auto-commits the score and jumps straight down to the next student in the same column!",
    action: ({ setShowAssessmentDetails, setSelectedColumn }) => {
      setShowAssessmentDetails(false);
      setSelectedColumn(null);
    },
  },
  {
    id: "keyboard-shortcuts",
    targetId: "tutorial-ledger-scores",
    title: "Pro Shortcuts & DepEd Transmutation",
    category: "Developer Pro-Tips",
    icon: Keyboard,
    badgeColor: "bg-slate-900 text-amber-400 border-slate-700",
    placement: "right",
    content:
      "Speed through your grading workflow with developer keyboard shortcuts:\n• Press Enter to jump down to the next learner in the same column.\n• Press Tab or Right Arrow to move to the next task.\n• Initial grades are transmuted automatically according to the official DepEd 60–100 scale.",
    devTip:
      "You can re-open this interactive tutorial anytime by clicking the 'Tutorial' button in the top banner. Happy teaching!",
    action: ({ setShowAssessmentDetails, setSelectedColumn }) => {
      setShowAssessmentDetails(false);
      setSelectedColumn(null);
    },
  },
];

interface ClassRecordTourProps {
  isOpen: boolean;
  onClose: () => void;
  setShowAssessmentDetails: (show: boolean) => void;
  setSelectedColumn: (col: { type: "WW" | "PT" | "QA"; number: number } | null) => void;
}

export function ClassRecordTour({
  isOpen,
  onClose,
  setShowAssessmentDetails,
  setSelectedColumn,
}: ClassRecordTourProps) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const step = TOUR_STEPS[currentStepIndex];

  // Execute step-specific action (e.g. open panel or quick editor)
  useEffect(() => {
    if (isOpen && step?.action) {
      step.action({ setShowAssessmentDetails, setSelectedColumn });
    }
  }, [isOpen, currentStepIndex, step, setShowAssessmentDetails, setSelectedColumn]);

  // Update target rect & scroll into view smoothly
  const updatePosition = useCallback(() => {
    if (!isOpen || !step) return;

    // Small delay to allow any opened panels to mount in DOM
    const timer = setTimeout(() => {
      // Ensure horizontal scroll on table body is 0 so column 1 is visible
      const tableBody = document.getElementById("tutorial-ledger-scores");
      if (tableBody) {
        tableBody.scrollLeft = 0;
      }

      const el = document.getElementById(step.targetId);
      if (el) {
        if (step.id === "cell-example") {
          // Scroll so student 1 row is cleanly visible directly below the sticky HPS row
          const ledgerContainer = document.getElementById("tutorial-ledger-scores");
          const ledgerTop = ledgerContainer ? ledgerContainer.getBoundingClientRect().top + window.pageYOffset : 0;
          const targetScroll = Math.max(0, ledgerTop - 380);

          window.scrollTo({
            top: targetScroll,
            behavior: "smooth",
          });
        } else {
          const yOffset = -90;
          const elementPosition = el.getBoundingClientRect().top + window.pageYOffset;
          const offsetPosition = Math.max(0, elementPosition + yOffset);

          window.scrollTo({
            top: offsetPosition,
            behavior: "smooth",
          });
        }

        // Set bounding rect after scroll settles
        const updateRect = () => {
          const freshEl = document.getElementById(step.targetId);
          if (freshEl) {
            setTargetRect(freshEl.getBoundingClientRect());
          }
        };

        updateRect();
        setTimeout(updateRect, 200);
      } else {
        setTargetRect(null);
      }
    }, 120);

    return () => clearTimeout(timer);
  }, [isOpen, step]);

  useEffect(() => {
    if (isOpen) {
      updatePosition();
      const handleResize = () => {
        const el = document.getElementById(step?.targetId || "");
        if (el) setTargetRect(el.getBoundingClientRect());
      };
      window.addEventListener("resize", handleResize);
      window.addEventListener("scroll", handleResize, true);
      return () => {
        window.removeEventListener("resize", handleResize);
        window.removeEventListener("scroll", handleResize, true);
      };
    }
  }, [isOpen, currentStepIndex, updatePosition, step?.targetId]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowRight" || e.key === "Enter") {
        if (currentStepIndex < TOUR_STEPS.length - 1) {
          setCurrentStepIndex((prev) => prev + 1);
        } else {
          onClose();
        }
      } else if (e.key === "ArrowLeft") {
        if (currentStepIndex > 0) {
          setCurrentStepIndex((prev) => prev - 1);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, currentStepIndex, onClose]);

  if (!isOpen || !step) return null;

  const Icon = step.icon;
  const isFirst = currentStepIndex === 0;
  const isLast = currentStepIndex === TOUR_STEPS.length - 1;

  // Calculate smart tooltip modal position with zero overlap
  let modalTop: number | undefined = undefined;
  let modalBottom: number | undefined = undefined;
  let modalLeft: string | undefined = "50%";
  let modalRight: string | undefined = undefined;
  let transform: string = "translateX(-50%)";

  const isDesktop = typeof window !== "undefined" && window.innerWidth >= 1024;

  if (targetRect) {
    const cardEstimatedHeight = 420;
    const vh = window.innerHeight;

    if ((step.placement === "right" || step.id === "assessment-panel" || step.id === "column-quick-meta") && isDesktop) {
      // Place floating on the right side of the screen, perfectly alongside the target on the left
      modalLeft = undefined;
      modalRight = "28px";
      transform = "none";
      modalTop = Math.max(76, Math.min(vh - 440, 100));
      modalBottom = undefined;
    } else {
      const spaceBelow = vh - targetRect.bottom - 20;
      const spaceAbove = targetRect.top - 20;

      if (spaceBelow >= 300) {
        // Room below target: place with comfortable 16px clearance
        modalTop = targetRect.bottom + 16;
        modalBottom = undefined;
      } else if (spaceAbove >= 300) {
        // Room above target: place with comfortable 16px clearance
        modalTop = Math.max(16, targetRect.top - 340);
        modalBottom = undefined;
      } else {
        // Fallback: Dock safely to the bottom of viewport
        modalTop = undefined;
        modalBottom = 16;
      }
    }

    // Viewport bottom safety clamp
    if (modalTop !== undefined && modalTop + 320 > vh - 16) {
      modalTop = undefined;
      modalBottom = 16;
    }
  } else {
    modalTop = 120;
  }

  return (
    <div className="fixed inset-0 z-[100] overflow-hidden pointer-events-auto">
      {/* Invisible backdrop for outside clicks */}
      <div className="fixed inset-0 z-[99]" onClick={onClose} />

      {/* Target element spotlight cutout with crystal-clear interior and dark outer backdrop */}
      {targetRect ? (
        <div
          className="fixed pointer-events-none transition-all duration-300 ease-out rounded-2xl ring-4 ring-amber-400 ring-offset-2 ring-offset-amber-400/20"
          style={{
            top: `${Math.max(4, targetRect.top - 6)}px`,
            left: `${Math.max(4, targetRect.left - 6)}px`,
            width: `${targetRect.width + 12}px`,
            height: `${targetRect.height + 12}px`,
            boxShadow: "0 0 0 9999px rgba(15, 23, 42, 0.78), 0 0 35px rgba(251, 191, 36, 0.45)",
            zIndex: 100,
          }}
        />
      ) : (
        <div className="fixed inset-0 bg-slate-950/75 pointer-events-none z-[100]" />
      )}

      {/* Floating Tutorial Dialog Card */}
      <div
        ref={cardRef}
        className="fixed z-[102] w-[92vw] max-w-lg transition-all duration-300 ease-out"
        style={{
          top: modalTop !== undefined ? `${modalTop}px` : undefined,
          bottom: modalBottom !== undefined ? `${modalBottom}px` : undefined,
          left: modalLeft,
          right: modalRight,
          transform: transform,
        }}
      >
        <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden ring-1 ring-slate-900/10 max-h-[82vh] flex flex-col">
          {/* Header Bar */}
          <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 px-5 py-3 text-white flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-xl bg-amber-400/20 border border-amber-400/40 flex items-center justify-center text-amber-400">
                <Sparkles className="w-3.5 h-3.5" />
              </div>
              <div>
                <p className="text-xs font-black tracking-widest uppercase text-amber-400">
                  SMART Class Record Guide
                </p>
                <p className="text-[10px] font-bold text-slate-300">
                  Step {currentStepIndex + 1} of {TOUR_STEPS.length} • {step.category}
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-1 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
              title="Close Tutorial (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Progress Bar */}
          <div className="w-full bg-slate-100 h-1 shrink-0">
            <div
              className="bg-amber-400 h-1 transition-all duration-300"
              style={{
                width: `${((currentStepIndex + 1) / TOUR_STEPS.length) * 100}%`,
              }}
            />
          </div>

          {/* Body Content (Scrollable if needed on small viewports) */}
          <div className="p-4 sm:p-5 space-y-3 overflow-y-auto">
            {/* Step Title & Icon */}
            <div className="flex items-start gap-3">
              <div
                className={cn(
                  "p-2 rounded-xl border shrink-0 mt-0.5 shadow-sm",
                  step.badgeColor
                )}
              >
                <Icon className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-black text-slate-900 leading-snug">
                  {step.title}
                </h3>
                <p className="text-xs text-slate-600 font-medium mt-1 leading-relaxed whitespace-pre-line">
                  {step.content}
                </p>
              </div>
            </div>

            {/* Example Box (if step has one) */}
            {step.exampleBox && (
              <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-2.5 space-y-1.5">
                <p className="text-[10px] font-black text-slate-900 uppercase tracking-wide flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                  {step.exampleBox.title}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs">
                  {step.exampleBox.items.map((item, idx) => (
                    <div
                      key={idx}
                      className="bg-white border border-slate-100 rounded-lg px-2 py-1 flex items-center justify-between"
                    >
                      <span className="text-[9px] font-bold text-slate-400 uppercase">
                        {item.label}
                      </span>
                      <span className={cn("text-[10px] font-black font-mono", item.color)}>
                        {item.value}
                      </span>
                    </div>
                  ))}
                </div>
                {step.exampleBox.notes && (
                  <p className="text-[9px] font-semibold text-slate-500 italic">
                    💡 {step.exampleBox.notes}
                  </p>
                )}
              </div>
            )}

            {/* Developer Tip Callout */}
            <div className="bg-amber-50/80 border border-amber-200/70 rounded-2xl p-2.5 flex items-start gap-2.5">
              <Lightbulb className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-[10px] font-bold text-amber-900 leading-none mb-0.5">
                  Developer Pro-Tip
                </p>
                <p className="text-[10px] text-amber-800/90 font-medium leading-relaxed">
                  {step.devTip}
                </p>
              </div>
            </div>

            {/* Step Navigation Dots */}
            <div className="flex items-center justify-center gap-1 pt-0.5">
              {TOUR_STEPS.map((s, idx) => (
                <button
                  key={s.id}
                  onClick={() => setCurrentStepIndex(idx)}
                  className={cn(
                    "h-1.5 rounded-full transition-all duration-200",
                    idx === currentStepIndex
                      ? "w-5 bg-indigo-600"
                      : "w-1.5 bg-slate-200 hover:bg-slate-300"
                  )}
                  title={`Go to step ${idx + 1}: ${s.title}`}
                />
              ))}
            </div>
          </div>

          {/* Dedicated Pinned Footer (Guaranteed Visible Always) */}
          <div className="bg-slate-50/90 px-4 py-2.5 border-t border-slate-100 flex items-center justify-between shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 text-xs font-bold h-8 px-2"
            >
              Skip Tutorial
            </Button>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={isFirst}
                onClick={() => setCurrentStepIndex((prev) => prev - 1)}
                className="h-8 px-3 rounded-xl border-slate-200 text-slate-700 text-xs font-bold disabled:opacity-30"
              >
                <ChevronLeft className="w-3.5 h-3.5 mr-1" /> Back
              </Button>

              <Button
                size="sm"
                onClick={() => {
                  if (isLast) {
                    onClose();
                  } else {
                    setCurrentStepIndex((prev) => prev + 1);
                  }
                }}
                className="h-8 px-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-md shadow-indigo-200 gap-1.5"
              >
                {isLast ? (
                  <>
                    <Check className="w-3.5 h-3.5" /> Finish Guide
                  </>
                ) : (
                  <>
                    Next <ChevronRight className="w-3.5 h-3.5" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
