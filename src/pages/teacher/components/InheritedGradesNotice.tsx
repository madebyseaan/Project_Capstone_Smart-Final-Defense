import type { ClassRecord } from "@/lib/api";

interface InheritedGradesNoticeProps {
  inheritedFromTeachers: Array<{ name: string; termsCovered: string[] }>;
  inheritedGrades: Array<{ studentId: string; term: string; quarterlyGrade: number | null; inheritedFrom?: string | null }>;
  mergedRecords: ClassRecord[];
  selectedTerm: string;
}

export function InheritedGradesNotice({
  inheritedFromTeachers,
  inheritedGrades,
  mergedRecords,
  selectedTerm,
}: InheritedGradesNoticeProps) {
  return (
    <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-4 flex items-start gap-3">
      <div className="p-2 rounded-xl bg-blue-100 text-blue-600 shrink-0 mt-0.5">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
      </div>
      <div>
        <p className="text-sm font-semibold text-blue-900">
          Grade history inherited from {inheritedFromTeachers.map(t => `${t.name} (${t.termsCovered.join(', ')})`).join('; ')}
        </p>
        <p className="text-xs text-blue-700 mt-1">
          Scores from the previous teacher are shown below. Editing any cell copies the inherited history into your class record.
        </p>
        {/* Show inherited grades for the selected term */}
        {(() => {
          const termInherited = inheritedGrades.filter(g => g.term === selectedTerm);
          if (termInherited.length === 0) return null;
          return (
            <div className="mt-3 space-y-1">
              {termInherited.map((ig) => {
                const student = mergedRecords.find(r => r.student.id === ig.studentId);
                const studentName = student ? `${student.student.lastName}, ${student.student.firstName}` : ig.studentId;
                return (
                  <div key={ig.studentId} className="flex items-center justify-between text-xs bg-blue-100/50 rounded-lg px-3 py-1.5">
                    <span className="font-medium text-blue-800">{studentName}</span>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-blue-900">{ig.quarterlyGrade?.toFixed(1) ?? '—'}</span>
                      <span className="text-[10px] text-blue-600">from {ig.inheritedFrom}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>
    </div>
  );
}