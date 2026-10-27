import type { TermCardPayload } from "@/lib/api";
import { formatGradeLevel } from "@/lib/utils";

interface TermCardFormProps {
  data: TermCardPayload;
  fullLogoUrl: string | null;
}

export default function TermCardForm({ data, fullLogoUrl }: TermCardFormProps) {
  const { student, meta } = data;
  const termLabel = meta.termLabel ?? `Term ${meta.term.slice(1)}`;
  const isDraft = meta.termStatus === "DRAFT";

  return (
    <div
      data-testid="term-card-form"
      data-term-status={meta.termStatus}
      className="relative overflow-hidden bg-white border-2 border-gray-400 shadow-xl print-form print-form-term-card p-8 mb-8"
    >
      <div
        data-testid="term-card-watermark"
        aria-hidden="true"
        className="term-card-watermark-layer pointer-events-none absolute inset-0 z-20 flex select-none items-center justify-center"
      >
        <span className="term-card-watermark rotate-[-28deg] text-center font-bold uppercase tracking-[0.16em] text-black opacity-[0.08]">
          Temporary — {termLabel} only
        </span>
      </div>

      <div className="relative z-10">
        <div className="mb-4 flex items-start justify-between border-b-2 border-gray-400 pb-3">
          <div className="w-20">
            <img src="/DepEd.png" alt="DepEd Logo" className="h-14 w-14 object-contain" />
          </div>
          <div className="flex-1 text-center">
            <p className="mb-1 text-xs text-gray-700">SF 9 — TEMPORARY TERM CARD</p>
            <h2 className="text-base font-bold text-gray-900">Republic of the Philippines</h2>
            <h3 className="text-sm font-bold text-gray-900">Department of Education</h3>
            <p className="mt-1 text-sm text-gray-800">{data.schoolSettings?.region || "Region _____________"}</p>
            <p className="text-sm text-gray-800">
              {data.schoolSettings?.division ? `Division of ${data.schoolSettings.division}` : "Division of _____________"}
            </p>
            <p className="text-sm text-gray-800">
              {data.schoolSettings?.schoolName ? `School: ${data.schoolSettings.schoolName}` : "School: _____________"}
            </p>
          </div>
          <div className="flex w-20 items-center justify-center">
            {fullLogoUrl ? (
              <img src={fullLogoUrl} alt="School Logo" className="h-14 w-14 object-contain" />
            ) : (
              <img src="/DepEd.png" alt="DepEd Seal" className="h-14 w-14 object-contain" />
            )}
          </div>
        </div>

        <div className="mb-4 text-center">
          <h1 className="text-lg font-bold uppercase text-gray-900">Temporary Learner&apos;s Progress Report</h1>
          <p className="mt-1 text-sm font-semibold uppercase tracking-wide text-gray-700">{termLabel} only</p>
        </div>

        {isDraft && (
          <div className="mb-4 rounded border-2 border-gray-500 bg-gray-100 px-3 py-2 text-center">
            <p className="text-xs font-bold uppercase tracking-wide text-gray-900">
              Draft — grades are not final
            </p>
          </div>
        )}

        <div className="mb-4 grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
          <div>
            <span className="font-bold text-gray-900">Name: </span>
            <span className="inline-block min-w-[200px] border-b border-gray-400 text-gray-900">{student.name}</span>
          </div>
          <div>
            <span className="font-bold text-gray-900">LRN: </span>
            <span className="inline-block min-w-[150px] border-b border-gray-400 font-mono text-gray-900">{student.lrn}</span>
          </div>
          <div>
            <span className="font-bold text-gray-900">Grade: </span>
            <span className="inline-block min-w-[80px] border-b border-gray-400 text-gray-900">{formatGradeLevel(student.gradeLevel)}</span>
          </div>
          <div>
            <span className="font-bold text-gray-900">Section: </span>
            <span className="inline-block min-w-[120px] border-b border-gray-400 text-gray-900">{student.section}</span>
          </div>
          <div>
            <span className="font-bold text-gray-900">School Year: </span>
            <span className="inline-block min-w-[100px] border-b border-gray-400 text-gray-900">{student.schoolYear}</span>
          </div>
          <div>
            <span className="font-bold text-gray-900">Term: </span>
            <span className="inline-block min-w-[100px] border-b border-gray-400 text-gray-900">{termLabel}</span>
          </div>
          <div className="col-span-2">
            <span className="font-bold text-gray-900">Adviser: </span>
            <span className="inline-block min-w-[200px] border-b border-gray-400 text-gray-900">{student.adviser || "________________"}</span>
          </div>
        </div>

        <div className="mb-4">
          <h3 className="mb-2 border border-gray-400 bg-gray-200 p-2 text-sm font-bold text-gray-900">
            REPORT ON LEARNING PROGRESS AND ACHIEVEMENT — {termLabel.toUpperCase()}
          </h3>
          <table className="w-full border-2 border-gray-600 text-sm">
            <thead>
              <tr className="border-b-2 border-gray-600 bg-gray-100">
                <th className="w-1/2 border-r border-gray-600 p-2 text-left text-gray-900">Learning Areas</th>
                <th className="w-24 border-r border-gray-600 p-2 text-center text-gray-900">Term Grade</th>
                <th className="w-32 p-2 text-center text-gray-900">Remarks</th>
              </tr>
            </thead>
            <tbody>
              {data.termSubjects.map((subject) => (
                <tr key={`${subject.subjectCode}-${subject.subjectName}`} className="border-b border-gray-600">
                  <td className="border-r border-gray-600 p-2 font-medium text-gray-900">{subject.subjectName}</td>
                  <td className={`border-r border-gray-600 p-2 text-center font-semibold ${(subject.grade ?? 0) < 75 && subject.grade !== null ? "text-red-600" : "text-gray-900"}`}>
                    {subject.grade ?? ""}
                  </td>
                  <td className="p-2 text-center text-sm text-gray-900">{subject.remarks ?? ""}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-gray-600 bg-gray-200 font-bold">
                <td className="border-r border-gray-600 p-2 text-right text-gray-900">Term Average</td>
                <td className="border-r border-gray-600 p-2 text-center text-lg text-gray-900">
                  {data.termAverage !== null ? data.termAverage.toFixed(2) : ""}
                </td>
                <td className="p-2 text-center text-xs text-gray-900">
                  {data.termAverage === null ? "No grades yet" : ""}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mb-4">
          <h3 className="mb-2 border border-gray-400 bg-gray-200 p-2 text-sm font-bold text-gray-900">
            ATTENDANCE RECORD — {termLabel.toUpperCase()}
          </h3>
          {data.termAttendance ? (
            <table className="w-full border-2 border-gray-600 text-sm">
              <thead>
                <tr className="border-b-2 border-gray-600 bg-gray-100">
                  <th className="border-r border-gray-600 p-2 text-gray-900">No. of School Days</th>
                  <th className="border-r border-gray-600 p-2 text-gray-900">No. of Days Present</th>
                  <th className="p-2 text-gray-900">No. of Days Absent</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border-r border-gray-600 p-2 text-center text-gray-900">{data.termAttendance.schoolDays}</td>
                  <td className="border-r border-gray-600 p-2 text-center text-gray-900">{data.termAttendance.present}</td>
                  <td className="p-2 text-center text-gray-900">{data.termAttendance.absent}</td>
                </tr>
              </tbody>
            </table>
          ) : (
            <p className="rounded border border-gray-400 bg-gray-50 p-3 text-xs text-gray-700">
              Attendance for this term is not available because the term dates are not configured.
            </p>
          )}
        </div>

        <div className="mb-4 rounded border border-gray-400 bg-gray-50 p-3 text-xs leading-relaxed text-gray-800">
          This card covers {termLabel} only. It is a temporary report and is not valid for transfer or official school records.
          The official Learner&apos;s Progress Report Card (SF9) is issued separately.
        </div>

        <div className="mt-6 grid grid-cols-2 gap-8 border-t-2 border-gray-400 pt-4">
          <div className="text-center">
            <div className="mx-8 mb-1 flex min-h-[2rem] items-end justify-center border-b border-gray-600 font-bold text-gray-900">
              {student.adviser || ""}
            </div>
            <p className="text-sm font-medium text-gray-900">Class Adviser</p>
          </div>
          <div className="text-center">
            <div className="mx-8 mb-1 flex min-h-[2rem] items-end justify-center border-b border-gray-600 font-bold text-gray-900">
              {data.schoolSettings?.schoolHeadName || ""}
            </div>
            <p className="text-sm font-medium text-gray-900">School Principal</p>
          </div>
        </div>

        <p className="mt-4 text-center text-[10px] text-gray-600">
          Generated by SMART on {new Date(meta.generatedAt).toLocaleString("en-PH")}
        </p>
      </div>
    </div>
  );
}
