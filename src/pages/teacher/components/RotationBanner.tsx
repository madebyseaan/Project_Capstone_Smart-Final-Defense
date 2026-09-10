import { Link } from "react-router-dom";
import type { RotationSibling } from "../../lib/api";

interface RotationBannerProps {
  subjectName: string;
  rotationTermRank: number;
  termLabel: string;
  currentTermLabel: string;
  siblings: RotationSibling[] | null;
}

export default function RotationBanner({
  subjectName,
  rotationTermRank,
  termLabel,
  currentTermLabel,
  siblings,
}: RotationBannerProps) {
  const currentTermKey = `T${rotationTermRank}` as "T1" | "T2" | "T3";
  const isCurrentTerm = currentTermLabel === termLabel;

  const termKeys = ["T1", "T2", "T3"] as const;
  const termLabels: Record<string, string> = { T1: "Term 1", T2: "Term 2", T3: "Term 3" };

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5 space-y-3">
      <p className="text-sm font-bold text-amber-800">
        {subjectName} — rotating subject
      </p>
      <p className="text-sm text-amber-700">
        This subject is taught in <strong>{termLabel}</strong> only. In other terms, this section studies:
      </p>

      <div className="flex gap-3">
        {termKeys.map((tk) => {
          const sibling = siblings?.find((s) => s.term === tk);
          const isOwn = tk === currentTermKey;

          return (
            <div
              key={tk}
              className={`flex-1 rounded-xl border px-3 py-2.5 text-center ${
                isOwn
                  ? "border-amber-300 bg-amber-100 text-amber-900"
                  : "border-slate-200 bg-white text-foreground"
              }`}
            >
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">
                {termLabels[tk] ?? tk}
              </p>
              {isOwn ? (
                <>
                  <p className="text-sm font-bold leading-tight">{subjectName}</p>
                  <span className="inline-block mt-1 text-[9px] font-bold uppercase tracking-widest text-amber-600 bg-amber-200/60 rounded-full px-2 py-0.5">
                    current class
                  </span>
                </>
              ) : sibling ? (
                <>
                  {sibling.isMine ? (
                    <Link
                      to={`/teacher/records/${sibling.classAssignmentId}`}
                      className="text-sm font-bold leading-tight text-indigo-700 hover:text-indigo-900 hover:underline transition-colors"
                    >
                      {sibling.subjectName}
                    </Link>
                  ) : (
                    <p className="text-sm font-bold leading-tight">{sibling.subjectName}</p>
                  )}
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {sibling.isMine ? "your class" : `taught by ${sibling.teacherName}`}
                  </p>
                </>
              ) : (
                <p className="text-sm font-medium text-muted-foreground italic">—</p>
              )}
            </div>
          );
        })}
      </div>

      {!isCurrentTerm && (
        <p className="text-xs text-amber-700">
          School is currently in <strong>{currentTermLabel}</strong> — grading for this class happens in {termLabel}.
        </p>
      )}
    </div>
  );
}
