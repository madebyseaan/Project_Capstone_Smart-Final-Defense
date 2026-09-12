import { Link } from "react-router-dom";
import { Repeat } from "lucide-react";
import type { RotationSibling } from "../../lib/api";

interface RotationBannerProps {
  subjectName: string;
  rotationTermRank: number;
  termLabel: string;
  currentTermLabel: string;
  siblings: RotationSibling[] | null;
}

/**
 * Compact rotating-subject strip. Rendered inside the ClassRecordHero so it
 * reads as part of the header instead of a standalone panel.
 */
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
  const termTitles: Record<string, string> = { T1: "Term 1", T2: "Term 2", T3: "Term 3" };

  return (
    <div className="border-t border-amber-200/70 bg-amber-50/50 px-6 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-700 whitespace-nowrap">
          <Repeat className="w-3.5 h-3.5" />
          Rotating subject · {termLabel} only
        </span>

        <div className="flex flex-wrap items-center gap-1.5">
          {termKeys.map((tk) => {
            const sibling = siblings?.find((s) => s.term === tk);
            const isOwn = tk === currentTermKey;

            if (isOwn) {
              return (
                <span
                  key={tk}
                  className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-100 px-2.5 py-1 text-[11px] text-amber-900"
                  title={`${termTitles[tk]} — current class`}
                >
                  <span className="font-bold uppercase tracking-wide text-[9px] text-amber-700">{termTitles[tk]}</span>
                  <span className="font-semibold">{subjectName}</span>
                  <span className="rounded-full bg-amber-200/70 px-1.5 text-[9px] font-bold uppercase tracking-wide text-amber-700">
                    this class
                  </span>
                </span>
              );
            }

            if (!sibling) {
              return (
                <span
                  key={tk}
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-muted-foreground"
                >
                  <span className="font-bold uppercase tracking-wide text-[9px]">{termTitles[tk]}</span>
                  <span className="italic">—</span>
                </span>
              );
            }

            return (
              <span
                key={tk}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px]"
                title={sibling.isMine ? "Your class" : `Taught by ${sibling.teacherName}`}
              >
                <span className="font-bold uppercase tracking-wide text-[9px] text-muted-foreground">{termTitles[tk]}</span>
                {sibling.isMine ? (
                  <Link
                    to={`/teacher/records/${sibling.classAssignmentId}`}
                    className="font-semibold text-indigo-700 hover:text-indigo-900 hover:underline"
                  >
                    {sibling.subjectName}
                  </Link>
                ) : (
                  <span className="font-semibold text-foreground">{sibling.subjectName}</span>
                )}
                {sibling.isMine && (
                  <span className="text-[9px] font-bold uppercase tracking-wide text-indigo-500">your class</span>
                )}
              </span>
            );
          })}
        </div>

        {!isCurrentTerm && (
          <span className="ml-auto text-[11px] font-medium text-amber-700 whitespace-nowrap">
            School is in <strong>{currentTermLabel}</strong> — grading happens in {termLabel}
          </span>
        )}
      </div>
    </div>
  );
}
