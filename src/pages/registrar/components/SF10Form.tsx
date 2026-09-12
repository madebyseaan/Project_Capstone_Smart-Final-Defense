import type { SF10Data } from "@/lib/api";
import { formatGradeLevel, formatISODate } from "./formUtils";
import { buildSF10Areas, getAreaDisplayValues } from "./sf10Utils";

function ChecklistMark({ checked }: { checked?: boolean | null }) {
  return (
    <span className="inline-flex items-center justify-center w-3.5 h-3.5 border border-black mr-1 align-[-2px] text-[9px] leading-none font-bold text-gray-900">
      {checked ? "X" : "\u00A0"}
    </span>
  );
}

interface SF10FormProps {
  data: SF10Data;
  schoolName?: string;
  highlightArea?: { recordIndex: number; name: string } | null;
}

export default function SF10Form({ data, schoolName, highlightArea }: SF10FormProps) {
  const studentFirstName = data.student.firstName || data.student.name.split(',')[1]?.trim().split(' ')[0] || '';
  const studentLastName = data.student.lastName || data.student.name.split(',')[0]?.trim() || '';
  const studentMiddleName = data.student.middleName || data.student.name.split(',')[1]?.trim().split(' ').slice(1).join(' ') || '';
  const studentNameExtension = data.student.nameExtension || '';

  return (
    <div className="bg-white border-2 border-gray-400 shadow-xl print-form p-6 mb-8 text-[11px] leading-tight">
      {/* SF10-JHS Label */}
      <div className="mb-1">
        <span className="font-bold text-gray-900 text-xs">SF10-JHS</span>
      </div>

      {/* Header â€” Republic / DepEd centered */}
      <div className="text-center mb-3">
        <p className="font-bold text-gray-900">Republic of the Philippines</p>
        <p className="font-bold text-gray-900">Department of Education</p>
      </div>

      {/* Title */}
      <div className="text-center mb-4">
        <h1 className="text-sm font-bold text-gray-900">Learner Permanent Academic Record for Junior High School (SF10-JHS)</h1>
        <p className="text-[10px] text-gray-700 mt-0.5">(Formerly Form 137)</p>
      </div>

      {/* LEARNER'S INFORMATION */}
      <div className="mb-3 border border-black">
        <div className="bg-gray-200 px-2 py-0.5 border-b border-black">
          <span className="font-bold text-[11px] text-gray-900">LEARNER&apos;S INFORMATION</span>
        </div>
        <div className="p-2">
          {/* Row 1: Last Name | First Name */}
          <div className="grid grid-cols-2 gap-4 mb-1">
            <div>
              <span className="font-bold text-gray-900">LAST NAME:</span>
              <span className="border-b border-gray-600 ml-1 text-gray-900 inline-block min-w-[150px]">{studentLastName}</span>
            </div>
            <div>
              <span className="font-bold text-gray-900">FIRST NAME:</span>
              <span className="border-b border-gray-600 ml-1 text-gray-900 inline-block min-w-[150px]">{studentFirstName}</span>
            </div>
          </div>
          {/* Row 2: Name Extension | Middle Name */}
          <div className="grid grid-cols-2 gap-4 mb-1">
            <div>
              <span className="font-bold text-gray-900">NAME EXTENSION (Jr, II):</span>
              <span className="border-b border-gray-600 ml-1 text-gray-900 inline-block min-w-[150px]">{studentNameExtension}</span>
            </div>
            <div>
              <span className="font-bold text-gray-900">MIDDLE NAME:</span>
              <span className="border-b border-gray-600 ml-1 text-gray-900 inline-block min-w-[150px]">{studentMiddleName}</span>
            </div>
          </div>
          {/* Row 3: LRN | Birthdate */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="font-bold text-gray-900">Learner Reference Number (LRN):</span>
              <span className="border-b border-gray-600 ml-1 font-mono text-gray-900 inline-block min-w-[150px]">{data.student.lrn}</span>
            </div>
            <div>
              <span className="font-bold text-gray-900">Birthdate (mm/dd/yyyy):</span>
              <span className="border-b border-gray-600 ml-1 text-gray-900 inline-block min-w-[150px]">{formatISODate(data.student.birthDate) ?? ""}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ELIGIBILITY FOR JHS ENROLMENT */}
      <div className="mb-3 border border-black">
        <div className="bg-gray-200 px-2 py-0.5 border-b border-black">
          <span className="font-bold text-[11px] text-gray-900">ELIGIBILITY FOR JHS ENROLMENT</span>
        </div>
        <div className="p-2">
          {/* Row 1: Elementary School Completer + General Average */}
          <div className="flex items-center gap-2 mb-1">
            <span className="text-gray-900 inline-flex items-center">
              <ChecklistMark checked={data.student.elementarySchoolCompleter} /> Elementary School Completer
            </span>
            <span className="ml-auto">
              <span className="font-bold text-gray-900">General Average:</span>
              <span className="border-b border-gray-600 ml-1 inline-block min-w-[60px] text-gray-900 text-center">{data.student.elementaryGeneralAverage ?? ""}</span>
            </span>
          </div>
          <div className="mb-1">
            <span className="font-bold text-gray-900 ml-4">Name of Elementary School:</span>
            <span className="border-b border-gray-600 ml-1 inline-block min-w-[300px] text-gray-900">{data.student.elementarySchoolName ?? ""}</span>
          </div>
          {/* Row 2: Other Credential */}
          <div className="mb-1">
            <span className="font-bold text-gray-900">Other Credential Presented</span>
          </div>
          <div className="flex items-center gap-2 mb-1 ml-4">
            <span className="text-gray-900 inline-flex items-center">
              <ChecklistMark checked={data.student.peptPasser} /> PEPT Passer
            </span>
            <span className="ml-4">
              <span className="font-bold text-gray-900">Rating:</span>
              <span className="border-b border-gray-600 ml-1 inline-block min-w-[60px] text-gray-900 text-center">{data.student.peptRating ?? ""}</span>
            </span>
          </div>
          <div className="mb-1 ml-4">
            <span className="font-bold text-gray-900">Date of Examination/Assessment (mm/dd/yyyy):</span>
            <span className="border-b border-gray-600 ml-1 inline-block min-w-[100px] text-gray-900">{formatISODate(data.student.peptExamDate ?? undefined) ?? ""}</span>
          </div>
          <div className="flex items-center gap-2 ml-4">
            <span className="text-gray-900 inline-flex items-center">
              <ChecklistMark checked={data.student.alsAePasser} /> ALS A &amp; E Passer
            </span>
          </div>
        </div>
      </div>

      {/* TRANSFEREE INFORMATION — shown only for transfer-in learners */}
      {data.student.isTransferee && (
        <div className="mb-3 border border-black">
          <div className="bg-gray-200 px-2 py-0.5 border-b border-black">
            <span className="font-bold text-[11px] text-gray-900">TRANSFEREE INFORMATION</span>
          </div>
          <div className="p-2">
            <div className="grid grid-cols-2 gap-4 mb-1">
              <div>
                <span className="font-bold text-gray-900">Transferred From (Previous School):</span>
                <span className="border-b border-gray-600 ml-1 inline-block min-w-[150px] text-gray-900">{data.student.previousSchool || ''}</span>
              </div>
              <div>
                <span className="font-bold text-gray-900">Last Grade Completed:</span>
                <span className="border-b border-gray-600 ml-1 inline-block min-w-[150px] text-gray-900">{data.student.lastGradeCompleted || ''}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="font-bold text-gray-900">Transfer Certificate No.:</span>
                <span className="border-b border-gray-600 ml-1 inline-block min-w-[150px] text-gray-900">{data.student.transferCertNo || ''}</span>
              </div>
              <div>
                <span className="font-bold text-gray-900">Date Transferred In:</span>
                <span className="border-b border-gray-600 ml-1 inline-block min-w-[150px] text-gray-900">{formatISODate(data.student.transferInDate) || ''}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SCHOLASTIC RECORD â€” one per grade level */}
      {data.schoolRecords.map((record: any, recordIndex: number) => (
        <div key={recordIndex} className="mb-3 border border-black page-break-inside-avoid">
          {/* School / Grade / Section / SY Header */}
          <div className="p-2 border-b border-black">
            <div className="grid grid-cols-2 gap-2 mb-0.5">
              <div>
                <span className="font-bold text-gray-900">School:</span>
                <span className="border-b border-gray-600 ml-1 text-gray-900 inline-block min-w-[200px]">{record.school || schoolName || ''}</span>
              </div>
              <div>
                <span className="font-bold text-gray-900">School ID:</span>
                <span className="border-b border-gray-600 ml-1 text-gray-900 inline-block min-w-[80px]">{record.schoolId || ''}</span>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <span className="font-bold text-gray-900">Classified as Grade:</span>
                <span className="border-b border-gray-600 ml-1 text-gray-900 inline-block min-w-[40px]">{formatGradeLevel(record.gradeLevel)}</span>
              </div>
              <div>
                <span className="font-bold text-gray-900">Section:</span>
                <span className="border-b border-gray-600 ml-1 text-gray-900 inline-block min-w-[80px]">{record.section}</span>
              </div>
              <div>
                <span className="font-bold text-gray-900">School Year:</span>
                <span className="border-b border-gray-600 ml-1 text-gray-900 inline-block min-w-[80px]">{record.schoolYear}</span>
              </div>
            </div>
            {record.external && (
              <div className="mt-1 flex items-center gap-2">
                <span className="inline-block border border-black px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-gray-900 bg-gray-200">
                  From previous school
                </span>
                {record.mergedFromPreviousSchool ? (
                  <span className="text-[9px] text-gray-700">Merged with {record.mergedFromPreviousSchool}</span>
                ) : null}
              </div>
            )}
            {record.transferInDate && (
              <div className="mt-1 text-[10px]">
                <span className="font-bold text-gray-900">Transferred In:</span>
                <span className="border-b border-gray-600 ml-1 inline-block min-w-[80px] text-gray-900">{formatISODate(record.transferInDate)}</span>
              </div>
            )}
          </div>

          {/* Scholastic Record Table */}
          <table className="w-full text-[10px] border-collapse">
            <thead>
              <tr className="border-b border-black">
                <th rowSpan={2} className="border-r border-black p-1 text-left text-gray-900 bg-gray-200" style={{ width: '30%' }}>
                  LEARNING AREAS
                </th>
                <th colSpan={3} className="border-r border-black p-1 text-center text-gray-900 bg-gray-200">
                  Term Rating
                </th>
                <th rowSpan={2} className="border-r border-black p-1 text-center text-gray-900 bg-gray-200" style={{ width: '10%' }}>
                  FINAL<br/>RATING
                </th>
                <th rowSpan={2} className="p-1 text-center text-gray-900 bg-gray-200" style={{ width: '12%' }}>
                  REMARKS
                </th>
              </tr>
              <tr className="border-b border-black">
                <th className="border-r border-black p-1 text-center text-gray-900 bg-gray-200" style={{ width: '8%' }}>1</th>
                <th className="border-r border-black p-1 text-center text-gray-900 bg-gray-200" style={{ width: '8%' }}>2</th>
                <th className="border-r border-black p-1 text-center text-gray-900 bg-gray-200" style={{ width: '8%' }}>3</th>
              </tr>
            </thead>
            <tbody>
              {buildSF10Areas(record.subjectGrades).map((area, idx) => {
                // Get display values (handles grouped subjects by averaging)
                const vals = getAreaDisplayValues(area, record.subjectGrades);

                const cellClass = (val: number | null) =>
                  `border-r border-black p-0.5 text-center ${(val ?? 0) < 75 && val != null ? 'text-red-600 font-bold' : 'text-gray-900'}`;

                // Backend quarterlyGrade values are already transmuted â€” display as-is
                const t1 = vals.t1;
                const t2 = vals.t2;
                const t3 = vals.t3;
                const finalGrade = vals.final;

                const highlighted =
                  !!highlightArea &&
                  highlightArea.recordIndex === recordIndex &&
                  highlightArea.name === area.name;

                return (
                  <tr key={idx} className={`border-b border-black ${highlighted ? "bg-primary/10 ring-2 ring-inset ring-primary print:ring-0 print:bg-transparent" : ""}`}>
                    <td className="border-r border-black p-0.5 text-gray-900 font-medium">
                      {area.name}
                    </td>
                    <td className={cellClass(t1)}>{t1 ?? ''}</td>
                    <td className={cellClass(t2)}>{t2 ?? ''}</td>
                    <td className={`${cellClass(t3)} border-r border-black`}>{t3 ?? ''}</td>
                    <td className={`border-r border-black p-0.5 text-center font-bold ${(finalGrade ?? 0) < 75 && finalGrade != null ? 'text-red-600' : 'text-gray-900'}`}>
                      {finalGrade ?? ''}
                    </td>
                    <td className="p-0.5 text-center text-gray-900">
                      {finalGrade != null ? (finalGrade >= 75 ? 'Passed' : 'Failed') : ''}
                    </td>
                  </tr>
                );
              })}

              {/* General Average Row */}
              <tr className="border-t-2 border-black bg-gray-100">
                <td colSpan={4} className="border-r border-black p-1 text-right font-bold text-gray-900">General Average:</td>
                <td className="border-r border-black p-1 text-center font-bold text-sm text-gray-900">
                  {record.generalAverage ?? ''}
                </td>
                <td className="p-1 text-center text-gray-900">
                  {record.generalAverage != null ? (record.generalAverage >= 75 ? 'Passed' : 'Failed') : ''}
                </td>
              </tr>
            </tbody>
          </table>

          {/* Remedial Classes Section */}
          <div className="border-t border-black p-2">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-bold text-gray-900">Remedial Classes</span>
              <span className="text-gray-900 ml-4">
                Conducted from (mm/dd/yyyy)
                {(() => {
                  const conductedFrom = formatISODate(record.remedialClasses?.[0]?.conductedFrom);
                  return conductedFrom ? (
                    <span className="border-b border-gray-600 mx-1 inline-block min-w-[80px]">
                      {conductedFrom}
                    </span>
                  ) : (
                    <span className="border-b border-gray-600 mx-1 inline-block min-w-[80px]">&nbsp;</span>
                  );
                })()}
                to
                {(() => {
                  const conductedTo = formatISODate(record.remedialClasses?.[0]?.conductedTo);
                  return conductedTo ? (
                    <span className="border-b border-gray-600 mx-1 inline-block min-w-[80px]">
                      {conductedTo}
                    </span>
                  ) : (
                    <span className="border-b border-gray-600 mx-1 inline-block min-w-[80px]">&nbsp;</span>
                  );
                })()}
              </span>
            </div>
            <table className="w-full text-[10px] border-collapse mt-1">
              <thead>
                <tr className="border-b border-black">
                  <th className="border-r border-black p-0.5 text-left text-gray-900 bg-gray-100" style={{ width: '40%' }}>Learning Areas</th>
                  <th className="border-r border-black p-0.5 text-center text-gray-900 bg-gray-100" style={{ width: '15%' }}>Final Rating</th>
                  <th className="p-0.5 text-center text-gray-900 bg-gray-100" style={{ width: '25%' }}>Remedial Class Mark</th>
                </tr>
              </thead>
              <tbody>
                {(record.remedialClasses?.length > 0
                  ? record.remedialClasses
                  : [{ learningAreas: "", finalRating: "", remedialClassMark: "" },
                     { learningAreas: "", finalRating: "", remedialClassMark: "" },
                     { learningAreas: "", finalRating: "", remedialClassMark: "" }]
                ).map((rc: any, i: number) => (
                  <tr key={i} className="border-b border-black">
                    <td className="border-r border-black p-0.5 h-4 text-gray-900">{rc.learningAreas || ""}</td>
                    <td className="border-r border-black p-0.5 text-center text-gray-900">{rc.finalRating || ""}</td>
                    <td className="p-0.5 text-center text-gray-900">{rc.remedialClassMark || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Adviser / Principal Signatures */}
          <div className="grid grid-cols-2 gap-4 p-2 border-t border-black text-[10px]">
            <div className="text-center">
              <div className="border-b border-gray-600 mt-6 mx-4"></div>
              <p className="mt-0.5 text-gray-900">{record.adviserName || ""}</p>
              <p className="text-gray-900">Signature of Adviser</p>
              <p className="text-gray-700 italic">(over Printed Name)</p>
            </div>
            <div className="text-center">
              <div className="border-b border-gray-600 mt-6 mx-4"></div>
              <p className="mt-0.5 text-gray-900">{data.schoolSettings?.schoolHeadName || ""}</p>
              <p className="text-gray-900">Signature of Principal/School Head</p>
              <p className="text-gray-700 italic">(over Printed Name)</p>
            </div>
          </div>
        </div>
      ))}

      {/* CERTIFICATION */}
      <div className="mt-3 border border-black p-3">
        <p className="font-bold text-gray-900 text-center mb-2">CERTIFICATION</p>
        <p className="text-gray-900 text-center leading-relaxed mb-3">
          I CERTIFY that this is a true record of {studentFirstName} {studentLastName}
          {' '}with LRN {data.student.lrn} and that he/she is eligible for admission to Grade ______.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <span className="font-bold text-gray-900">Name of School:</span>
            <span className="border-b border-gray-600 ml-1 inline-block min-w-[180px] text-gray-900">{data.schoolSettings?.schoolName || schoolName || ''}</span>
          </div>
          <div>
            <span className="font-bold text-gray-900">School ID:</span>
            <span className="border-b border-gray-600 ml-1 inline-block min-w-[80px] text-gray-900">{data.schoolSettings?.schoolId || ''}</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-8 mt-6">
          <div className="text-center">
            <div className="border-b border-gray-600 mt-6 mx-8"></div>
            <p className="mt-0.5 text-[10px] text-gray-900">Date</p>
          </div>
          <div className="text-center">
            <div className="border-b border-gray-600 mt-6 mx-8"></div>
            <p className="mt-0.5 text-[10px] text-gray-900">{data.schoolSettings?.schoolHeadName || ""}</p>
            <p className="text-[10px] text-gray-900">Signature of Principal/School Head over Printed Name</p>
          </div>
        </div>
      </div>
    </div>
  );
}