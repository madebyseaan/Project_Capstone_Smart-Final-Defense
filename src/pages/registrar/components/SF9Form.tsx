import React from "react";
import type { SF9Data } from "@/lib/api";
import { formatGradeLevel } from "./formUtils";

interface SF9FormProps {
  data: SF9Data;
  fullLogoUrl: string | null;
  highlightSubject?: string | null;
}

export default function SF9Form({ data, fullLogoUrl, highlightSubject }: SF9FormProps) {
  return (
    <div className="bg-white border-2 border-gray-400 shadow-xl print-form print-form-sf9 p-8 mb-8">
      {/* Header with DepEd Logo */}
      <div className="flex items-start justify-between mb-6 pb-4 border-b-2 border-gray-400">
        <div className="w-20">
          <img src="/DepEd.png" alt="DepEd Logo" className="w-16 h-16 object-contain" />
        </div>
        <div className="flex-1 text-center">
          <p className="text-xs text-gray-700 mb-1">SF 9 - JHS</p>
          <h2 className="font-bold text-base text-gray-900">Republic of the Philippines</h2>
          <h3 className="font-bold text-sm text-gray-900">Department of Education</h3>
          <p className="text-sm text-gray-800 mt-1">{data.schoolSettings?.region || "Region _____________"}</p>
          <p className="text-sm text-gray-800">{data.schoolSettings?.division ? `Division of ${data.schoolSettings.division}` : "Division of _____________"}</p>
          <p className="text-sm text-gray-800 mt-1">District: _____________</p>
          <p className="text-sm text-gray-800">{data.schoolSettings?.schoolName ? `School: ${data.schoolSettings.schoolName}` : "School: _____________"}</p>
        </div>
        <div className="w-20 flex items-center justify-center">
          {fullLogoUrl ? (
            <img src={fullLogoUrl} alt="School Logo" className="w-16 h-16 object-contain" />
          ) : (
            <img src="/DepEd.png" alt="DepEd Seal" className="w-16 h-16 object-contain" />
          )}
        </div>
      </div>

      {/* Title */}
      <div className="text-center mb-6">
        <h1 className="text-xl font-bold text-gray-900 uppercase">Learner's Progress Report Card</h1>
      </div>

      {/* Student Information */}
      <div className="grid grid-cols-2 gap-x-8 gap-y-3 mb-6 text-sm">
        <div>
          <span className="font-bold text-gray-900">Name: </span>
          <span className="border-b border-gray-400 text-gray-900 inline-block min-w-[200px]">{data.student.name}</span>
        </div>
        <div>
          <span className="font-bold text-gray-900">LRN: </span>
          <span className="border-b border-gray-400 text-gray-900 font-mono inline-block min-w-[150px]">{data.student.lrn}</span>
        </div>
        <div>
          <span className="font-bold text-gray-900">Age: </span>
          <span className="border-b border-gray-400 text-gray-900 inline-block min-w-[80px]">{data.student.age || "____"}</span>
        </div>
        <div>
          <span className="font-bold text-gray-900">Sex: </span>
          <span className="border-b border-gray-400 text-gray-900 inline-block min-w-[80px]">{data.student.gender || "____"}</span>
        </div>
        <div>
          <span className="font-bold text-gray-900">Grade: </span>
          <span className="border-b border-gray-400 text-gray-900 inline-block min-w-[80px]">{formatGradeLevel(data.student.gradeLevel)}</span>
        </div>
        <div>
          <span className="font-bold text-gray-900">Section: </span>
          <span className="border-b border-gray-400 text-gray-900 inline-block min-w-[120px]">{data.student.section}</span>
        </div>
        <div className="col-span-2">
          <span className="font-bold text-gray-900">School Year: </span>
          <span className="border-b border-gray-400 text-gray-900 inline-block min-w-[120px]">{data.student.schoolYear}</span>
        </div>
      </div>

      {/* Dear Parent Message */}
      <div className="bg-gray-100 p-4 rounded mb-6 text-sm border border-gray-400">
        <p className="font-bold text-gray-900 mb-2">Dear Parent,</p>
        <p className="text-gray-800 text-justify leading-relaxed">
          This report card shows the ability and progress your child has made in different learning areas as well as his/her core values. 
          The school welcomes you should you desire to know more about your child's progress.
        </p>
      </div>

      {/* Report on Learning Progress and Achievement */}
      <div className="mb-6">
        <h3 className="font-bold text-sm mb-2 bg-gray-200 p-2 text-gray-900 border border-gray-400">REPORT ON LEARNING PROGRESS AND ACHIEVEMENT</h3>
        <table className="w-full border-2 border-gray-600 text-sm">
          <thead>
            <tr className="border-b-2 border-gray-600 bg-gray-100">
              <th rowSpan={2} className="border-r border-gray-600 p-2 text-left text-gray-900 w-44">Learning Areas</th>
              <th colSpan={3} className="border-r border-gray-600 p-2 text-gray-900">Term</th>
              <th rowSpan={2} className="border-r border-gray-600 p-2 text-gray-900 w-16">Final<br/>Rating</th>
              <th rowSpan={2} className="p-2 text-gray-900 w-20">Remarks</th>
            </tr>
            <tr className="border-b-2 border-gray-600 bg-gray-100">
              <th className="border-r border-gray-600 p-2 w-12 text-gray-900">1</th>
              <th className="border-r border-gray-600 p-2 w-12 text-gray-900">2</th>
              <th className="border-r border-gray-600 p-2 w-12 text-gray-900">3</th>
            </tr>
          </thead>
          <tbody>
            {data.subjectGrades.map((sg: any, index: number) => {
              const highlighted = !!highlightSubject && sg.subjectName === highlightSubject;
              return (
              <tr key={index} className={`border-b border-gray-600 ${highlighted ? "bg-primary/10 ring-2 ring-inset ring-primary print:ring-0 print:bg-transparent" : ""}`}>
                <td className="border-r border-gray-600 p-2 font-medium text-gray-900">{sg.subjectName}</td>
                <td className={`border-r border-gray-600 p-2 text-center font-semibold ${(sg.T1 ?? 0) < 75 && sg.T1 ? 'text-red-600' : 'text-gray-900'}`}>
                  {sg.T1 ?? ''}
                </td>
                <td className={`border-r border-gray-600 p-2 text-center font-semibold ${(sg.T2 ?? 0) < 75 && sg.T2 ? 'text-red-600' : 'text-gray-900'}`}>
                  {sg.T2 ?? ''}
                </td>
                <td className={`border-r border-gray-600 p-2 text-center font-semibold ${(sg.T3 ?? 0) < 75 && sg.T3 ? 'text-red-600' : 'text-gray-900'}`}>
                  {sg.T3 ?? ''}
                </td>
                <td className={`border-r border-gray-600 p-2 text-center font-bold ${(sg.final ?? 0) < 75 && sg.final ? 'text-red-600' : 'text-gray-900'}`}>
                  {sg.final ?? ''}
                </td>
                <td className="p-2 text-center text-sm text-gray-900">
                  {sg.remarks || ''}
                </td>
              </tr>
              );
            })}
            <tr className="bg-gray-200 font-bold border-t-2 border-gray-600">
              <td colSpan={4} className="border-r border-gray-600 p-2 text-right text-gray-900">General Average</td>
              <td className="border-r border-gray-600 p-2 text-center text-lg text-gray-900">
                {data.generalAverage?.toFixed(2) ?? ''}
              </td>
              <td className="p-2 text-center">
                {data.promotionStatus && (
                  <span className="block text-xs font-bold text-gray-900">{data.promotionStatus}</span>
                )}
                {data.honors && <span className="block text-foreground text-[11px]">{data.honors}</span>}
              </td>
            </tr>
          </tbody>
        </table>

        {/* Grading Scale */}
        <div className="mt-4 text-xs">
          <table className="border border-gray-600">
            <thead>
              <tr className="bg-gray-200">
                <th className="border border-gray-600 p-1.5 text-gray-900">Descriptors</th>
                <th className="border border-gray-600 p-1.5 text-gray-900">Grading Scale</th>
                <th className="border border-gray-600 p-1.5 text-gray-900">Remarks</th>
              </tr>
            </thead>
            <tbody>
              <tr><td className="border border-gray-600 p-1.5 text-gray-900">Advancing</td><td className="border border-gray-600 p-1.5 text-center text-gray-900">90-100</td><td className="border border-gray-600 p-1.5 text-gray-900">Passed</td></tr>
              <tr><td className="border border-gray-600 p-1.5 text-gray-900">Benchmarking</td><td className="border border-gray-600 p-1.5 text-center text-gray-900">85-89</td><td className="border border-gray-600 p-1.5 text-gray-900">Passed</td></tr>
              <tr><td className="border border-gray-600 p-1.5 text-gray-900">Connecting</td><td className="border border-gray-600 p-1.5 text-center text-gray-900">80-84</td><td className="border border-gray-600 p-1.5 text-gray-900">Passed</td></tr>
              <tr><td className="border border-gray-600 p-1.5 text-gray-900">Developing</td><td className="border border-gray-600 p-1.5 text-center text-gray-900">75-79</td><td className="border border-gray-600 p-1.5 text-gray-900">Passed</td></tr>
              <tr><td className="border border-gray-600 p-1.5 text-gray-900">Emerging</td><td className="border border-gray-600 p-1.5 text-center text-gray-900">60-74</td><td className="border border-gray-600 p-1.5 text-gray-900">Failed</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Page break: Core Values goes on back side (page 2) */}
      <div className="mb-6 sf9-page-break">
        <h3 className="font-bold text-sm mb-2 bg-gray-200 p-2 text-gray-900 border border-gray-400">REPORT ON LEARNER'S OBSERVED VALUES</h3>
        <table className="w-full border-2 border-gray-600 text-xs">
          <thead>
            <tr className="border-b-2 border-gray-600 bg-gray-100">
              <th className="border-r border-gray-600 p-2 text-gray-900 w-24">Core Values</th>
              <th className="border-r border-gray-600 p-2 text-gray-900">Behavior Statements</th>
              <th className="border-r border-gray-600 p-1.5 w-8 text-gray-900">1</th>
              <th className="border-r border-gray-600 p-1.5 w-8 text-gray-900">2</th>
              <th className="border-r border-gray-600 p-1.5 w-8 text-gray-900">3</th>
              <th className="p-1.5 w-8 text-gray-900">4</th>
            </tr>
          </thead>
          <tbody>
            {[
              { value: '1. Maka-Diyos', behaviors: ["Expresses one's spiritual beliefs while respecting others.", "Shows adherence to ethical principles by upholding truth."] },
              { value: '2. Makatao', behaviors: ["Is sensitive to individual, social, and cultural differences.", "Demonstrates contributions towards solidarity."] },
              { value: '3. Maka-Kalikasan', behaviors: ["Cares for environment and utilizes resources wisely."] },
              { value: '4. Maka-Bansa', behaviors: ["Demonstrates pride in being a Filipino.", "Demonstrates appropriate behavior in school and community."] }
            ].map((cv, i) => (
              <React.Fragment key={i}>
                {cv.behaviors.map((b, j) => (
                  <tr key={`${i}-${j}`} className="border-b border-gray-600">
                    {j === 0 && <td rowSpan={cv.behaviors.length} className="border-r border-gray-600 p-2 font-bold text-gray-900 align-top">{cv.value}</td>}
                    <td className="border-r border-gray-600 p-2 text-gray-800">{b}</td>
                    <td className="border-r border-gray-600 p-2"></td>
                    <td className="border-r border-gray-600 p-2"></td>
                    <td className="border-r border-gray-600 p-2"></td>
                    <td className="p-2"></td>
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
        <div className="mt-2 text-xs text-gray-800">
          <strong>Marking:</strong> AO - Always Observed | SO - Sometimes Observed | RO - Rarely Observed | NO - Not Observed
        </div>
      </div>

      {/* Attendance Record */}
      <div className="mb-6">
        <h3 className="font-bold text-sm mb-2 bg-gray-200 p-2 text-gray-900 border border-gray-400">ATTENDANCE RECORD</h3>
        <table className="w-full border-2 border-gray-600 text-xs">
          <thead>
            <tr className="border-b border-gray-600 bg-gray-100">
              <th className="border-r border-gray-600 p-1.5 text-gray-900"></th>
              {['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'Total'].map(m => (
                <th key={m} className="border-r border-gray-600 p-1 text-gray-900 text-center">{m}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              { label: "No. of School Days", pick: (m: any) => m.schoolDays, total: data.attendance?.total?.schoolDays },
              { label: "No. of Days Present", pick: (m: any) => m.present, total: data.attendance?.total?.present },
              { label: "No. of Days Absent", pick: (m: any) => m.absent, total: data.attendance?.total?.absent },
            ].map((row) => (
              <tr key={row.label} className="border-b border-gray-600">
                <td className="border-r border-gray-600 p-1.5 font-medium text-gray-900">{row.label}</td>
                {(data.attendance?.months ?? []).map((m) => (
                  <td key={m.key} className="border-r border-gray-600 p-1.5 text-center text-gray-900">
                    {row.pick(m) || ""}
                  </td>
                ))}
                <td className="border-r border-gray-600 p-1.5 text-center font-bold text-gray-900">
                  {row.total ?? ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Parent/Guardian Signature */}
      <div className="mb-6 border-2 border-gray-600 p-4">
        <h3 className="font-bold text-sm mb-3 text-gray-900">PARENT / GUARDIAN'S SIGNATURE</h3>
        <div className="grid grid-cols-4 gap-4 text-xs">
          {['Term 1', 'Term 2', 'Term 3'].map(q => (
            <div key={q}>
              <p className="text-gray-900 mb-6">{q}</p>
              <div className="border-b border-gray-600"></div>
            </div>
          ))}
        </div>
      </div>

      {/* Footer Signatures */}
      <div className="grid grid-cols-2 gap-8 mt-8 pt-4 border-t-2 border-gray-400">
        <div className="text-center">
          <div className="border-b border-gray-600 mx-8 mb-1 min-h-[2rem] flex items-end justify-center font-bold text-gray-900">
            {data.student.adviser || ""}
          </div>
          <p className="text-sm text-gray-900 font-medium">Class Adviser</p>
        </div>
        <div className="text-center">
          <div className="border-b border-gray-600 mx-8 mb-1 h-8"></div>
          <p className="text-sm text-gray-900 font-medium">School Principal</p>
        </div>
      </div>
    </div>
  );
}