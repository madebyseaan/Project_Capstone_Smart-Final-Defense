import { Fragment } from "react";
import type { SF2Data } from "@/lib/api";

interface SF2FormProps {
  data: SF2Data;
}

const LEGEND: Array<[string, string]> = [
  ["(blank)", "Present"],
  ["x", "Absent"],
  ["/", "Tardy"],
  ["E", "Excused"],
];

function markClass(mark: string): string {
  if (mark === "x") return "text-red-600 font-bold";
  if (mark === "/") return "text-amber-600 font-bold";
  if (mark === "E") return "text-indigo-600 font-bold";
  return "";
}

export default function SF2Form({ data }: SF2FormProps) {
  const { section, schoolSettings, schoolDays, groups, dailyPresent, summary } = data;
  const totalCols = 3 + schoolDays.length + 2; // No. + Name + days + Absent/Tardy
  const groupsWithIndex = groups.reduce<Array<(typeof groups)[number] & { startIndex: number }>>(
    (acc, group) => {
      const startIndex = acc.length
        ? acc[acc.length - 1].startIndex + acc[acc.length - 1].students.length
        : 0;
      acc.push({ ...group, startIndex });
      return acc;
    },
    [],
  );

  return (
    <div className="bg-white border-2 border-gray-400 shadow-xl print-form p-4 mb-8 text-[9px] leading-tight">
      {/* Header */}
        <div className="mb-1">
          <span className="font-bold text-gray-900 text-xs">SF2</span>
        </div>
        <div className="text-center mb-2">
          <p className="font-bold text-gray-900">Republic of the Philippines</p>
          <p className="font-bold text-gray-900">Department of Education</p>
          <p className="font-bold text-gray-900 mt-1">Daily Attendance Report of Learners</p>
        </div>

        {/* School info bar */}
        <div className="grid grid-cols-4 gap-x-4 gap-y-0.5 border border-black p-1.5 mb-2 text-[9px]">
          <div>School ID: <span className="font-bold">{schoolSettings?.schoolId}</span></div>
          <div>Region: <span className="font-bold">{schoolSettings?.region}</span></div>
          <div>Division: <span className="font-bold">{schoolSettings?.division}</span></div>
          <div>District: <span className="font-bold">{schoolSettings?.district || "—"}</span></div>
          <div className="col-span-2">School Name: <span className="font-bold">{schoolSettings?.schoolName}</span></div>
          <div>School Year: <span className="font-bold">{section.schoolYear}</span></div>
          <div>Grade Level: <span className="font-bold">{String(section.gradeLevel || "").replace("_", " ")}</span></div>
          <div>Section: <span className="font-bold">{section.name}</span></div>
          <div className="col-span-2">Adviser: <span className="font-bold">{section.adviserName || "—"}</span></div>
          <div className="col-span-2">
            Report for the Month of: <span className="font-bold">{data.monthLabel} {data.year}</span>
          </div>
        </div>

        {/* Ledger */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse border border-black text-[8px]">
            <thead>
              <tr className="bg-gray-200">
                <th rowSpan={2} className="border border-black p-0.5 w-6">No.</th>
                <th rowSpan={2} className="border border-black p-0.5 min-w-[150px] text-left">
                  LEARNER'S NAME (Last Name, First Name, Middle Name)
                </th>
                {schoolDays.map((d) => (
                  <th key={`num-${d.date}`} className="border border-black p-0 text-center w-7" title={d.date}>
                    {d.dayNum}
                  </th>
                ))}
                <th colSpan={2} className="border border-black p-0.5 text-center">Total for the Month</th>
                <th rowSpan={2} className="border border-black p-0.5 min-w-[90px] text-left">REMARKS</th>
              </tr>
              <tr className="bg-gray-200">
                {schoolDays.map((d) => (
                  <th key={`ltr-${d.date}`} className="border border-black p-0 text-center w-7">
                    {d.dayLetter}
                  </th>
                ))}
                <th className="border border-black p-0.5 text-center w-10">ABSENT</th>
                <th className="border border-black p-0.5 text-center w-10">TARDY</th>
              </tr>
            </thead>
            <tbody>
              {groupsWithIndex.map((group) => {
                return (
                  <Fragment key={`grp-${group.key}`}>
                    <tr className="bg-gray-100">
                      <td colSpan={totalCols} className="border border-black p-0.5 font-bold">
                        {group.label} ({group.students.length})
                      </td>
                    </tr>
                    {group.students.map((student, studentIndex) => {
                      return (
                        <tr key={student.studentId}>
                          <td className="border border-black p-0.5 text-center">{group.startIndex + studentIndex + 1}</td>
                          <td className="border border-black p-0.5">
                            {student.lastName}, {student.firstName} {student.middleName || ""}
                          </td>
                          {schoolDays.map((d) => (
                            <td key={`m-${student.studentId}-${d.date}`} className={`border border-black p-0 text-center ${markClass(student.marks[d.date] || "")}`}>
                              {student.marks[d.date] || ""}
                            </td>
                          ))}
                          <td className="border border-black p-0.5 text-center font-bold">{student.absent}</td>
                          <td className="border border-black p-0.5 text-center font-bold">{student.tardy}</td>
                          <td className="border border-black p-0.5 text-[7px]">{student.remarks}</td>
                        </tr>
                      );
                    })}
                    <tr key={`sub-${group.key}`} className="bg-gray-50">
                      <td className="border border-black p-0.5"></td>
                      <td className="border border-black p-0.5 font-bold text-right pr-1">TOTAL Per Day</td>
                      {schoolDays.map((d) => (
                        <td key={`sub-${group.key}-${d.date}`} className="border border-black p-0 text-center font-bold">
                          {group.students.reduce((n, s) => n + (s.marks[d.date] === "x" ? 0 : 1), 0)}
                        </td>
                      ))}
                      <td className="border border-black p-0.5"></td>
                      <td className="border border-black p-0.5"></td>
                      <td className="border border-black p-0.5"></td>
                    </tr>
                  </Fragment>
                );
              })}
              {/* Combined TOTAL PER DAY */}
              <tr className="bg-gray-200">
                <td className="border border-black p-0.5"></td>
                <td className="border border-black p-0.5 font-bold text-right pr-1">Combined TOTAL PER DAY</td>
                {schoolDays.map((d) => (
                  <td key={`comb-${d.date}`} className="border border-black p-0 text-center font-bold">
                    {dailyPresent[d.date] ?? 0}
                  </td>
                ))}
                <td className="border border-black p-0.5"></td>
                <td className="border border-black p-0.5"></td>
                <td className="border border-black p-0.5"></td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Legend */}
        <div className="mt-2 text-[8px] text-gray-800">
          <span className="font-bold">CODES FOR CHECKING ATTENDANCE: </span>
          {LEGEND.map(([code, label], i) => (
            <span key={code}>
              {i > 0 ? "  |  " : ""}
              <span className="font-bold">{code}</span> - {label}
            </span>
          ))}
        </div>

        {/* Summary + Signatures */}
        <div className="mt-3 grid grid-cols-2 gap-4 text-[9px]">
          <div>
            <p className="font-bold mb-1">GUIDELINES:</p>
            <ol className="list-decimal list-inside space-y-0.5 text-gray-800">
              <li>The attendance shall be accomplished daily.</li>
              <li>Dates shall be written in the columns after Learner's Name.</li>
              <li>
                Percentage of Attendance for the month = Average Daily Attendance ÷ Registered
                Learners as of end of the month × 100.
              </li>
              <li>Every end of the month, the adviser submits this form to the principal (SF4).</li>
            </ol>
          </div>
          <div>
            <table className="w-full text-[9px]">
              <tbody>
                <tr>
                  <td className="pr-2 font-bold">No. of Days of Classes:</td>
                  <td className="font-bold">{summary.noOfDaysOfClasses}</td>
                </tr>
                <tr><td colSpan={2} className="pt-1 font-bold">Enrolment as of {data.monthLabel}:</td></tr>
                <tr><td className="pl-3">Male:</td><td className="font-bold">{summary.enrolmentMale}</td></tr>
                <tr><td className="pl-3">Female:</td><td className="font-bold">{summary.enrolmentFemale}</td></tr>
                <tr><td className="pl-3 font-bold">Total:</td><td className="font-bold">{summary.enrolmentTotal}</td></tr>
                <tr><td className="pt-1">Average Daily Attendance:</td><td className="font-bold">{summary.averageDailyAttendance}</td></tr>
                <tr><td>Percentage of Attendance for the month:</td><td className="font-bold">{summary.percentageAttendance}%</td></tr>
                <tr><td>Number of students absent for 5 consecutive days:</td><td className="font-bold">{summary.studentsAbsent5Consecutive}</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-8 text-[9px]">
          <div className="text-center">
            <div className="border-b border-black mx-6 mb-1 h-8"></div>
            <p className="font-bold">Signature of Teacher over Printed Name</p>
            <p>{section.adviserName || ""}</p>
          </div>
          <div className="text-center">
            <div className="border-b border-black mx-6 mb-1 h-8"></div>
            <p className="font-bold">Signature of School Head over Printed Name</p>
            <p>{schoolSettings?.schoolHeadName || ""}</p>
          </div>
        </div>
      </div>
  );
}
