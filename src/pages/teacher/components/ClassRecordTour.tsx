import React, { useEffect, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
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
      "Welcome! This banner displays your current subject, grade level, and assigned section. SMART automatically determines the active DepEd weighted scoring (e.g., 20% Written Work, 50% Performance Tasks, 30% Term Assessment).",
    devTip:
      "Click the back arrow on the left anytime to return to your Class Records list and select other subjects.",
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
      "Keep an eye on 'Needs Support' (learners below 75.0) to schedule timely remedial sessions before term finalization.",
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
      "Setting dates and descriptions is optional, but it enriches your grade records with complete lesson documentation.",
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
      notes: "Saved titles appear automatically on your grade records!",
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
    targetId: "tutorial-cell-example",
    title: "How Grading Works",
    category: "Grading Example",
    icon: HelpCircle,
    badgeColor: "bg-emerald-50 text-emerald-700 border-emerald-200",
    content:
      "Just type a student's raw score into any cell. SMART auto-calculates the Percentage Score and Weighted Score instantly.",
    exampleBox: {
      title: "What to Type in a Cell",
      items: [
        { label: "Score", value: "e.g. 18, 20, 15", color: "text-slate-900" },
        { label: "Excused", value: "Type 'E'", color: "text-blue-600" },
        { label: "Absent", value: "Type 'A' (counts as 0)", color: "text-rose-600" },
      ],
    },
    devTip:
      "Press Enter to commit and jump to the next student. Scores save automatically!",
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

  // Reset to step 1 when tour closes & manage scroll lock
  useEffect(() => {
    if (!isOpen) {
      setCurrentStepIndex(0);
    }
    // Lock/unlock scroll during tour
    if (isOpen) {
      document.body.style.overflow = "hidden";
      document.documentElement.style.overflow = "hidden";
    } else {
      document.body.style.removeProperty("overflow");
      document.documentElement.style.removeProperty("overflow");
    }
    return () => {
      document.body.style.removeProperty("overflow");
      document.documentElement.style.removeProperty("overflow");
    };
  }, [isOpen]);

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
        // Step 1: custom scroll to show banner with header space above
        if (step.id === "hero-info") {
          const elTop = el.getBoundingClientRect().top + window.pageYOffset;
          window.scrollTo({ top: Math.max(0, elTop - 80), behavior: "smooth" });
        } else if (step.id === "assessment-panel") {
          // Step 6: scroll up extra to make room for card above
          const elTop = el.getBoundingClientRect().top + window.pageYOffset;
          window.scrollTo({ top: Math.max(0, elTop - 500), behavior: "smooth" });
        } else if (step.id === "column-quick-meta") {
          // Step 7: scroll down to show card below the quick meta editor
          const elTop = el.getBoundingClientRect().top + window.pageYOffset;
          window.scrollTo({ top: Math.max(0, elTop - 120), behavior: "smooth" });
        } else {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }

        // Set bounding rect after scroll settles
        const updateRect = () => {
          const freshEl = document.getElementById(step.targetId);
          if (freshEl) {
            setTargetRect(freshEl.getBoundingClientRect());
          }
        };

        updateRect();
        setTimeout(updateRect, 300);
        setTimeout(updateRect, 600);
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
        // Recalculate on resize for responsive updates
        updatePosition();
      };
      window.addEventListener("resize", handleResize);
      return () => {
        window.removeEventListener("resize", handleResize);
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
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  // Responsive card dimensions
  const getCardDimensions = () => {
    const vw = window.innerWidth;
    if (isMobile) {
      // Mobile: smaller cards, full width minus padding
      const mobileWidth = Math.min(vw - 32, 400);
      return {
        standardWidth: mobileWidth,
        standardHeight: 320,
        compactWidth: mobileWidth,
        compactHeight: step.id === "assessment-panel" ? 360 : 280,
      };
    }
    if (vw < 1024) {
      // Tablet
      const tabletWidth = Math.min(vw - 48, 520);
      return {
        standardWidth: tabletWidth,
        standardHeight: 380,
        compactWidth: Math.min(vw - 48, 680),
        compactHeight: step.id === "assessment-panel" ? 380 : 300,
      };
    }
    // Desktop: original sizes
    return {
      standardWidth: 448,
      standardHeight: 420,
      compactWidth: step.id === "task-controls" ? 640 : step.id === "assessment-panel" ? 780 : 680,
      compactHeight: step.id === "hps-row" ? 320 : step.id === "task-controls" ? 320 : step.id === "assessment-panel" ? 400 : 280,
    };
  };

  const dimensions = getCardDimensions();

  // Compact wide layout for steps that overlap their highlight target
  const isCompactStep = step.id === "assessment-panel" || step.id === "hps-row" || step.id === "task-controls";
  const isCompactAbove = step.id === "hps-row" || step.id === "task-controls" || step.id === "assessment-panel";
  const compactHeight = dimensions.compactHeight;
  const compactWidth = dimensions.compactWidth;
  const cardMaxHeight = isCompactStep ? compactHeight : undefined;

  if (targetRect) {
    const cardEstimatedHeight = isCompactStep ? compactHeight : dimensions.standardHeight;
    const cardWidth = isCompactStep ? compactWidth : dimensions.standardWidth;
    const vh = window.innerHeight;
    const vw = window.innerWidth;

    if (isMobile) {
      // Mobile: always centered horizontally, above or below target
      modalLeft = "50%";
      modalRight = undefined;
      transform = "translateX(-50%)";

      const spaceBelow = vh - targetRect.bottom - 20;
      const spaceAbove = targetRect.top - 60; // Account for header

      if (isCompactAbove && spaceAbove >= cardEstimatedHeight + 24) {
        modalTop = Math.max(16, targetRect.top - cardEstimatedHeight - 24);
        modalBottom = undefined;
      } else if (spaceBelow >= cardEstimatedHeight + 24) {
        modalTop = targetRect.bottom + 24;
        modalBottom = undefined;
      } else if (spaceAbove >= cardEstimatedHeight + 24) {
        modalTop = Math.max(16, targetRect.top - cardEstimatedHeight - 24);
        modalBottom = undefined;
      } else {
        // Fallback: center on screen
        modalTop = Math.max(16, (vh - cardEstimatedHeight) / 2);
        modalBottom = undefined;
      }
    } else if (isCompactStep) {
      // Compact steps: centered horizontally, placed above or below target
      modalLeft = "50%";
      modalRight = undefined;
      transform = "translateX(-50%)";

      if (isCompactAbove) {
        const topOffset = step.id === "hps-row" ? 24 : 16;
        modalTop = Math.max(16, targetRect.top - cardEstimatedHeight - topOffset);
        modalBottom = undefined;
      } else {
        const spaceBelow = vh - targetRect.bottom - 20;
        if (spaceBelow >= cardEstimatedHeight + 16) {
          modalTop = targetRect.bottom + 16;
          modalBottom = undefined;
        } else {
          modalTop = Math.max(16, (vh - cardEstimatedHeight) / 2);
          modalBottom = undefined;
        }
      }
    } else if ((step.placement === "right" || step.id === "column-quick-meta" || step.id === "cell-example" || step.id === "gender-toggle") && isDesktop) {
      // Place floating on the right side, relative to the target element
      const cardGap = 16;
      const cardLeft = targetRect.right + cardGap;
      const rightPlacementClear = cardLeft > 16 && vw - cardLeft > cardWidth + 16;

      if (rightPlacementClear) {
        modalLeft = `${cardLeft}px`;
        modalRight = undefined;
        transform = "none";

        const targetMiddle = targetRect.top + targetRect.height / 2;
        let candidateTop = targetMiddle - cardEstimatedHeight / 2;
        candidateTop = Math.max(16, candidateTop);
        candidateTop = Math.min(vh - cardEstimatedHeight - 16, candidateTop);

        modalTop = candidateTop;
        modalBottom = undefined;

        if (modalTop + cardEstimatedHeight > vh - 16) {
          modalTop = undefined;
          modalBottom = 16;
        }
      } else {
        // Fallback to centered below/above
        modalLeft = "50%";
        modalRight = undefined;
        transform = "translateX(-50%)";

        const spaceBelow = vh - targetRect.bottom - 20;
        const spaceAbove = targetRect.top - 20;

        if (spaceBelow >= cardEstimatedHeight) {
          modalTop = targetRect.bottom + 16;
          modalBottom = undefined;
        } else if (spaceAbove >= cardEstimatedHeight) {
          modalTop = Math.max(16, targetRect.top - cardEstimatedHeight - 16);
          modalBottom = undefined;
        } else {
          modalTop = undefined;
          modalBottom = 16;
        }
      }
    } else if (step.id === "optional-details-btn" && isDesktop) {
      // Step 5: place card to the LEFT of target, vertically centered with it
      const cardGap = 20;
      const cardLeft = targetRect.left - cardWidth - cardGap;

      if (cardLeft >= 16) {
        modalLeft = `${cardLeft}px`;
        modalRight = undefined;
        transform = "none";

        const targetMiddle = targetRect.top + targetRect.height / 2;
        let candidateTop = targetMiddle - cardEstimatedHeight / 2;
        candidateTop = Math.max(16, candidateTop);
        candidateTop = Math.min(vh - cardEstimatedHeight - 16, candidateTop);
        modalTop = candidateTop;
        modalBottom = undefined;
      } else {
        modalLeft = "50%";
        modalRight = undefined;
        transform = "translateX(-50%)";
        modalTop = Math.max(16, targetRect.top - cardEstimatedHeight - 24);
        modalBottom = undefined;
      }
    } else {
      // Default: place below or above the target, centered horizontally
      modalLeft = "50%";
      modalRight = undefined;
      transform = "translateX(-50%)";

      const spaceBelow = vh - targetRect.bottom - 20;
      const spaceAbove = targetRect.top - 20;

      if (spaceBelow >= cardEstimatedHeight) {
        modalTop = targetRect.bottom + 16;
        modalBottom = undefined;
      } else if (spaceAbove >= cardEstimatedHeight) {
        modalTop = Math.max(16, targetRect.top - cardEstimatedHeight - 16);
        modalBottom = undefined;
      } else {
        modalTop = undefined;
        modalBottom = 16;
      }
    }

    // Viewport bottom safety clamp
    if (modalTop !== undefined && modalTop + cardEstimatedHeight > vh - 16) {
      modalTop = undefined;
      modalBottom = 16;
    }

    // Viewport top safety clamp
    if (modalTop !== undefined && modalTop < 16) {
      modalTop = 16;
    }
  } else {
    modalTop = 120;
  }

  return createPortal(
    <div 
      className="fixed inset-0 overflow-hidden pointer-events-auto" 
      style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999 }}
    >
      {/* Invisible backdrop for outside clicks */}
      <div 
        className="fixed inset-0" 
        onClick={onClose} 
        style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 9998 }} 
      />

      {/* Target element spotlight cutout - the box-shadow creates the dark overlay covering everything */}
      {targetRect ? (
        <div
          className="fixed pointer-events-none transition-all duration-300 ease-out rounded-2xl ring-4 ring-amber-400 ring-offset-2 ring-offset-amber-400/20"
          style={{
            top: `${Math.max(4, targetRect.top - 6)}px`,
            left: `${Math.max(4, targetRect.left - 6)}px`,
            width: `${targetRect.width + 12}px`,
            height: `${targetRect.height + 12}px`,
            boxShadow: "0 0 0 9999px rgba(15, 23, 42, 0.78), 0 0 35px rgba(251, 191, 36, 0.45)",
            zIndex: 9999,
          }}
        />
      ) : (
        <div 
          className="fixed inset-0 bg-slate-950/75 pointer-events-none" 
          style={{ zIndex: 9997 }} 
        />
      )}

      {/* Floating Tutorial Dialog Card */}
      <div
        ref={cardRef}
        className="fixed transition-all duration-300 ease-out"
        style={{
          zIndex: 10000,
          top: modalTop !== undefined ? `${modalTop}px` : undefined,
          bottom: modalBottom !== undefined ? `${modalBottom}px` : undefined,
          left: modalLeft,
          right: modalRight,
          transform: transform,
          width: isCompactStep ? `min(92vw, ${compactWidth}px)` : `min(92vw, ${dimensions.standardWidth}px)`,
          maxHeight: "calc(100vh - 32px)",
        }}
      >
        <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden ring-1 ring-slate-900/10 flex flex-col" style={{ maxHeight: cardMaxHeight ? `min(${cardMaxHeight}px, calc(100vh - 32px))` : "min(82vh, calc(100vh - 32px))" }}>
          {/* Header Bar */}
          <div className="bg-slate-900 px-5 py-3 text-white flex items-center justify-between shrink-0">
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
          <div className={cn("overflow-y-auto", isCompactStep ? "px-5 py-3 space-y-2" : "p-4 sm:p-5 space-y-3")}>
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
    </div>,
    document.body
  );
}
