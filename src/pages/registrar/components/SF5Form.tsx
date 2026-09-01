/**
 * SF5Form.tsx
 *
 * Full DepEd SF5 (Report on Promotion) layout with:
 * - Republic/DepEd header
 * - Gender-split sequential table (males first, then females)
 * - Summary tables (Promotion Status + Learning Progress)
 * - Signature lines
 * - Guidelines
 * - Print + Export support
 */

import { forwardRef } from "react";
import { Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SF5Data, SF5Student } from "@/lib/api";
import { SERVER_URL, getPortalToken } from "@/lib/api";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DESCRIPTOR_LABELS: Record<string, string> = {
  O: "Outstanding",
  VS: "Very Satisfactory",
  S: "Satisfactory",
  FS: "Fairly Satisfactory",
  DNME: "Did Not Meet Expectations",
};

function formatGA(grade: number | null, descriptor: string | null): string {
  if (grade === null) return "";
  const ga = grade >= 90 ? grade.toFixed(3) : grade.toFixed(2);
  return descriptor ? `${ga} (${descriptor})` : ga;
}

function formatActionTaken(status: SF5Student["promotionStatus"]): string {
  switch (status) {
    case "Promoted": return "PROMOTED";
    case "Conditional": return "*CONDITIONAL";
    case "Retained": return "RETAINED";
    case "No Grades": return "No Grades";
    default: return "";
  }
}

function formatIncompleteSubjects(subjects: string[]): string {
  return subjects.join(", ");
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Header({ data }: { data: SF5Data }) {
  const { section, schoolSettings } = data;
  return (
    <div className="mb-4">
      {/* SF5 Label */}
      <div className="mb-1">
        <span className="font-bold text-gray-900 text-xs">SF5</span>
      </div>

      {/* Republic / DepEd centered */}
      <div className="text-center mb-2">
        <p className="font-bold text-gray-900 text-sm">Republic of the Philippines</p>
        <p className="font-bold text-gray-900 text-sm">Department of Education</p>
        <p className="text-gray-900 text-xs">
          {schoolSettings.region && `Region ${schoolSettings.region}`}
          {schoolSettings.region && schoolSettings.division && " • "}
          {schoolSettings.division && `Division ${schoolSettings.division}`}
        </p>
      </div>

      {/* Form title */}
      <div className="text-center mb-3">
        <h1 className="text-sm font-bold text-gray-900">
          School Form 5 (SF 5)
        </h1>
        <p className="text-xs text-gray-900 font-semibold">
          Report on Promotion and Learning Progress &amp; Achievement
        </p>
        <p className="text-[10px] text-gray-700 italic">
          (Revised to conform with the instructions of DepEd Order 8, s. 2015)
        </p>
      </div>

      {/* School info fields */}
      <div className="border border-black p-2 text-xs space-y-1">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <span className="font-bold text-gray-900">School ID: </span>
            <span className="border-b border-gray-600 inline-block min-w-[80px] text-gray-900">
              {schoolSettings.schoolId || ""}
            </span>
          </div>
          <div>
            <span className="font-bold text-gray-900">School Year: </span>
            <span className="border-b border-gray-600 inline-block min-w-[120px] text-gray-900">
              {section.schoolYear}
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <span className="font-bold text-gray-900">District: </span>
            <span className="border-b border-gray-600 inline-block min-w-[120px] text-gray-900">
              {schoolSettings.district || ""}
            </span>
          </div>
          <div>
            <span className="font-bold text-gray-900">School Name: </span>
            <span className="border-b border-gray-600 inline-block min-w-[200px] text-gray-900">
              {schoolSettings.schoolName || ""}
            </span>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <span className="font-bold text-gray-900">Curriculum: </span>
            <span className="border-b border-gray-600 inline-block min-w-[80px] text-gray-900">
              K to 12 BEC
            </span>
          </div>
          <div>
            <span className="font-bold text-gray-900">Grade Level: </span>
            <span className="border-b border-gray-600 inline-block min-w-[40px] text-gray-900">
              {section.gradeLevel.replace("_", " ")}
            </span>
          </div>
          <div>
            <span className="font-bold text-gray-900">Section: </span>
            <span className="border-b border-gray-600 inline-block min-w-[80px] text-gray-900">
              {section.name}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function StudentTableHeader() {
  return (
    <thead>
      <tr className="border border-black bg-gray-200">
        <th className="border-r border-black p-1 text-center text-gray-900" style={{ width: "14%" }}>LRN</th>
        <th className="border-r border-black p-1 text-left text-gray-900" style={{ width: "24%" }}>LEARNER&apos;S NAME<br/>(Last Name, First Name, Middle Name)</th>
        <th className="border-r border-black p-1 text-center text-gray-900" style={{ width: "14%" }}>GENERAL AVERAGE</th>
        <th className="border-r border-black p-1 text-center text-gray-900" style={{ width: "16%" }}>ACTION TAKEN<br/>(Promoted, Conditional, or Retained)</th>
        <th className="border-r border-black p-1 text-center text-gray-900" style={{ width: "16%" }}>INCOMPLETE SUBJECT/S<br/><span className="text-[9px] font-normal">(From previous SY completed as of end of current SY)</span></th>
        <th className="border-black p-1 text-center text-gray-900" style={{ width: "16%" }}>INCOMPLETE SUBJECT/S<br/><span className="text-[9px] font-normal">(As of end of current SY)</span></th>
      </tr>
    </thead>
  );
}

function StudentRow({ student }: { student: SF5Student }) {
  return (
    <tr className="border border-black">
      <td className="border-r border-black p-1 text-center text-gray-900 text-[10px]">
        {student.lrn || ""}
      </td>
      <td className="border-r border-black p-1 text-gray-900 text-[10px]">
        {student.name}
      </td>
      <td className="border-r border-black p-1 text-center text-gray-900 text-[10px] font-bold">
        {formatGA(student.generalAverage, student.descriptor)}
      </td>
      <td className="border-r border-black p-1 text-center text-gray-900 text-[10px]">
        {formatActionTaken(student.promotionStatus)}
      </td>
      <td className="border-r border-black p-1 text-center text-gray-900 text-[10px]">
        {formatIncompleteSubjects(student.incompleteSubjects.prevSY)}
      </td>
      <td className="border-black p-1 text-center text-gray-900 text-[10px]">
        {formatIncompleteSubjects(student.incompleteSubjects.currentSY)}
      </td>
    </tr>
  );
}

function SubTotalRow({ label, count }: { label: string; count: number }) {
  return (
    <tr className="border border-black bg-gray-100">
      <td colSpan={5} className="border-r border-black p-1 text-right font-bold text-gray-900 text-xs">
        SUB TOTAL — {label}:
      </td>
      <td className="border-black p-1 text-center font-bold text-gray-900 text-xs">
        {count}
      </td>
    </tr>
  );
}

function TotalRow({ count }: { count: number }) {
  return (
    <tr className="border border-black bg-gray-200">
      <td colSpan={5} className="border-r border-black p-1 text-right font-bold text-gray-900 text-xs">
        TOTAL:
      </td>
      <td className="border-black p-1 text-center font-bold text-gray-900 text-xs">
        {count}
      </td>
    </tr>
  );
}

function SummaryTables({ data }: { data: SF5Data }) {
  const { summary } = data;

  return (
    <div className="mt-4 space-y-4">
      {/* Summary Table 1: Promotion Status */}
      <div className="border border-black p-2">
        <p className="font-bold text-gray-900 text-xs mb-2">SUMMARY TABLE</p>
        <table className="w-full text-[10px] border-collapse">
          <thead>
            <tr className="border border-black bg-gray-200">
              <th className="border-r border-black p-1 text-left text-gray-900" style={{ width: "40%" }}>STATUS</th>
              <th className="border-r border-black p-1 text-center text-gray-900" style={{ width: "20%" }}>MALE</th>
              <th className="border-r border-black p-1 text-center text-gray-900" style={{ width: "20%" }}>FEMALE</th>
              <th className="border-black p-1 text-center text-gray-900" style={{ width: "20%" }}>TOTAL</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border border-black">
              <td className="border-r border-black p-1 text-gray-900">PROMOTED</td>
              <td className="border-r border-black p-1 text-center text-gray-900">{summary.male.promoted}</td>
              <td className="border-r border-black p-1 text-center text-gray-900">{summary.female.promoted}</td>
              <td className="border-black p-1 text-center text-gray-900">{summary.promoted}</td>
            </tr>
            <tr className="border border-black">
              <td className="border-r border-black p-1 text-gray-900">*CONDITIONAL</td>
              <td className="border-r border-black p-1 text-center text-gray-900">{summary.male.conditional}</td>
              <td className="border-r border-black p-1 text-center text-gray-900">{summary.female.conditional}</td>
              <td className="border-black p-1 text-center text-gray-900">{summary.conditional}</td>
            </tr>
            <tr className="border border-black">
              <td className="border-r border-black p-1 text-gray-900">RETAINED</td>
              <td className="border-r border-black p-1 text-center text-gray-900">{summary.male.retained}</td>
              <td className="border-r border-black p-1 text-center text-gray-900">{summary.female.retained}</td>
              <td className="border-black p-1 text-center text-gray-900">{summary.retained}</td>
            </tr>
            <tr className="border border-black bg-gray-100">
              <td className="border-r border-black p-1 font-bold text-gray-900">TOTAL</td>
              <td className="border-r border-black p-1 text-center font-bold text-gray-900">
                {summary.male.promoted + summary.male.conditional + summary.male.retained + summary.male.noGrades}
              </td>
              <td className="border-r border-black p-1 text-center font-bold text-gray-900">
                {summary.female.promoted + summary.female.conditional + summary.female.retained + summary.female.noGrades}
              </td>
              <td className="border-black p-1 text-center font-bold text-gray-900">{summary.totalStudents}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Summary Table 2: Learning Progress & Achievement */}
      <div className="border border-black p-2">
        <p className="font-bold text-gray-900 text-xs mb-1">LEARNING PROGRESS AND ACHIEVEMENT</p>
        <p className="text-[9px] text-gray-700 mb-2">(Based on Learners&apos; General Average)</p>
        <table className="w-full text-[10px] border-collapse">
          <thead>
            <tr className="border border-black bg-gray-200">
              <th className="border-r border-black p-1 text-left text-gray-900" style={{ width: "40%" }}>DESCRIPTORS &amp; GRADING SCALE</th>
              <th className="border-r border-black p-1 text-center text-gray-900" style={{ width: "20%" }}>MALE</th>
              <th className="border-r border-black p-1 text-center text-gray-900" style={{ width: "20%" }}>FEMALE</th>
              <th className="border-black p-1 text-center text-gray-900" style={{ width: "20%" }}>TOTAL</th>
            </tr>
          </thead>
          <tbody>
            {(["DNME", "FS", "S", "VS", "O"] as const).map((key) => (
              <tr key={key} className="border border-black">
                <td className="border-r border-black p-1 text-gray-900">
                  {DESCRIPTOR_LABELS[key]} ({key === "DNME" ? "74 and below" : key === "FS" ? "75-79" : key === "S" ? "80-84" : key === "VS" ? "85-89" : "90-100"})
                </td>
                <td className="border-r border-black p-1 text-center text-gray-900">{summary.descriptors[key].male}</td>
                <td className="border-r border-black p-1 text-center text-gray-900">{summary.descriptors[key].female}</td>
                <td className="border-black p-1 text-center text-gray-900">{summary.descriptors[key].total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SignatureBlock({ data }: { data: SF5Data }) {
  return (
    <div className="mt-4 border border-black p-3">
      <div className="grid grid-cols-2 gap-8">
        {/* Prepared By */}
        <div className="text-center">
          <p className="font-bold text-gray-900 text-xs mb-1">PREPARED BY:</p>
          <div className="border-b border-gray-600 mt-8 mx-4"></div>
          <p className="mt-1 text-[10px] text-gray-900">{data.section.adviser || ""}</p>
          <p className="text-[9px] text-gray-700 italic">Class Adviser</p>
          <p className="text-[9px] text-gray-700 italic">(Name and Signature)</p>
        </div>

        {/* Certified Correct & Submitted */}
        <div className="text-center">
          <p className="font-bold text-gray-900 text-xs mb-1">CERTIFIED CORRECT &amp; SUBMITTED:</p>
          <div className="border-b border-gray-600 mt-8 mx-4"></div>
          <p className="mt-1 text-[10px] text-gray-900">{data.schoolSettings.schoolName}</p>
          <p className="text-[9px] text-gray-700 italic">School Head</p>
          <p className="text-[9px] text-gray-700 italic">(Name and Signature)</p>
        </div>
      </div>

      {/* Reviewed By */}
      <div className="mt-6 text-center max-w-[200px] mx-auto">
        <p className="font-bold text-gray-900 text-xs mb-1">REVIEWED BY:</p>
        <div className="border-b border-gray-600 mt-8 mx-4"></div>
        <p className="text-[9px] text-gray-700 italic">Division Representative</p>
        <p className="text-[9px] text-gray-700 italic">(Name and Signature)</p>
      </div>
    </div>
  );
}

function Guidelines() {
  return (
    <div className="mt-4 border border-black p-3 text-[9px] text-gray-900 leading-relaxed">
      <p className="font-bold mb-1">GUIDELINES:</p>
      <ol className="list-decimal list-inside space-y-0.5">
        <li>Do not include Dropouts and Transferred Out (D.O. 4, s. 2014)</li>
        <li>To be prepared by the Adviser. The Adviser should indicate the General Average based on the learner&apos;s Form 138.</li>
        <li>On the summary table, reflect the total number of learners PROMOTED (Final Grade of at least 75 in ALL learning areas), RETAINED (Did Not Meet Expectations in three (3) or more learning areas) and *CONDITIONAL (*Did Not Meet Expectations in not more than two (2) learning areas) and the Learning Progress and Achievement according to the individual General Average. All provisions on classroom assessment and the grading system in the said Order shall be in effect for all grade levels - DepEd Order 29, s. 2015.</li>
        <li>Did Not Meet Expectations of the Learning Areas. This refers to learning area/s that the learner had failed as of end of current SY. The learner may be for remediation or retention.</li>
        <li>Protocols of validation &amp; submission is under the discretion of the Schools Division Superintendent.</li>
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

interface SF5FormProps {
  data: SF5Data;
  onPrint?: () => void;
  onExport?: () => void;
  isExporting?: boolean;
}

const SF5Form = forwardRef<HTMLDivElement, SF5FormProps>(
  ({ data, onPrint, onExport, isExporting }, ref) => {
    // Split students by gender
    const maleStudents = data.students.filter(
      (s) => s.gender?.toUpperCase() === "MALE" || s.gender?.toUpperCase() === "M"
    );
    const femaleStudents = data.students.filter(
      (s) => s.gender?.toUpperCase() === "FEMALE" || s.gender?.toUpperCase() === "F"
    );

    return (
      <div className="space-y-4 animate-fade-in">
        {/* Action buttons — hidden when printing */}
        <div className="flex items-center justify-between print-hide">
          <div></div>
          <div className="flex gap-2">
            {onExport && (
              <Button
                onClick={onExport}
                variant="outline"
                className="rounded-xl"
                disabled={isExporting}
              >
                <Download className="w-4 h-4 mr-2" />
                {isExporting ? "Exporting..." : "Export Excel"}
              </Button>
            )}
            {onPrint && (
              <Button onClick={onPrint} className="rounded-xl bg-indigo-600 text-white hover:bg-indigo-700">
                <Printer className="w-4 h-4 mr-2" />
                Print Form
              </Button>
            )}
          </div>
        </div>

        {/* SF5 Form — print target */}
        <div
          ref={ref}
          className="bg-white border-2 border-gray-400 shadow-xl print-form p-6 mb-8 text-[11px] leading-tight"
        >
          <Header data={data} />

          {/* Main table — sequential: males then females */}
          <div className="border border-black">
            <table className="w-full text-[10px] border-collapse">
              <StudentTableHeader />
              <tbody>
                {/* Male students */}
                {maleStudents.map((student, idx) => (
                  <StudentRow key={`m-${idx}`} student={student} />
                ))}
                {maleStudents.length > 0 && (
                  <SubTotalRow label="MALE" count={maleStudents.length} />
                )}

                {/* Female students */}
                {femaleStudents.map((student, idx) => (
                  <StudentRow key={`f-${idx}`} student={student} />
                ))}
                {femaleStudents.length > 0 && (
                  <SubTotalRow label="FEMALE" count={femaleStudents.length} />
                )}

                {/* Grand total */}
                <TotalRow count={data.students.length} />
              </tbody>
            </table>
          </div>

          <SummaryTables data={data} />
          <SignatureBlock data={data} />
          <Guidelines />

          {/* Page footer */}
          <div className="mt-4 text-center text-[9px] text-gray-700">
            School Form 5: Page 1 of 1
          </div>
        </div>
      </div>
    );
  }
);

SF5Form.displayName = "SF5Form";

export default SF5Form;
