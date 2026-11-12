/**
 * teacherYearArchiveExcel.ts
 *
 * Human-readable Excel rendering of a stored teacher-year archive.
 * Generated on download; never stored.
 */

import ExcelJS from "exceljs";

type JsonRecord = Record<string, unknown>;

interface SectionRow {
  id: string;
  name: string;
  gradeLevel: string;
  program: string;
  status: string;
  role: string;
}

interface StudentRow {
  id: string;
  lrn: string;
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  suffix?: string | null;
  sectionId: string;
  enrollment?: {
    status?: string;
    promotionStatus?: string | null;
    promotedToGradeLevel?: string | null;
  };
}

interface AssignmentRow {
  id: string;
  subject: { id?: string; code: string; name: string; displayName?: string | null };
  sectionId: string;
  teachingMinutes?: number | null;
  isActive: boolean;
  archivedReason?: string | null;
  source: string;
}

interface GradeRow {
  studentId: string;
  classAssignmentId: string;
  term: string;
  writtenWorkPS?: number | null;
  perfTaskPS?: number | null;
  quarterlyAssessPS?: number | null;
  initialGrade?: number | null;
  quarterlyGrade?: number | null;
  remarks?: string | null;
  status: string;
}

interface AttendanceRow {
  studentId: string;
  sectionId: string;
  date: string;
  status: string;
  remarks?: string | null;
}

interface ScheduleRow {
  day: string;
  startTime: string;
  endTime: string;
  subjectId?: string | null;
  sectionId: string;
  termIndex?: number | null;
}

interface WorkloadRow {
  type: string;
  minutes: number;
  sectionId?: string | null;
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" ? (value as JsonRecord) : {};
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function text(value: unknown): string {
  return value == null ? "" : String(value);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function studentLabel(student: StudentRow | undefined): string {
  if (!student) return "";
  return [student.lastName, student.firstName, student.middleName]
    .filter(Boolean)
    .join(", ");
}

function prettifyGradeLevel(value: string): string {
  return value.replace(/^GRADE_/, "Grade ").replace(/_/g, "-");
}

function addDataSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  headers: string[],
  rows: Array<Array<string | number | null>>,
  widths: number[],
): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet(name);
  sheet.addRow(headers);
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  header.alignment = { vertical: "middle", horizontal: "center" };
  header.height = 22;

  for (const row of rows) sheet.addRow(row);

  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, sheet.rowCount), column: headers.length },
  };
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) row.alignment = { vertical: "top", wrapText: false };
  });

  if (rows.length === 0) {
    const row = sheet.addRow(["No records in this category."]);
    row.font = { italic: true, color: { argb: "FF777777" } };
  }

  return sheet;
}

export function buildTeacherYearArchiveWorkbook(payload: Record<string, unknown>): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "SMART";
  workbook.created = new Date();

  const schoolYear = asRecord(payload.schoolYear);
  const teacher = asRecord(payload.teacher);
  const summary = asRecord(payload.summary);
  const dataQuality = asRecord(payload.dataQuality);
  const sections = asArray<SectionRow>(payload.sections);
  const students = asArray<StudentRow>(payload.students);
  const assignments = asArray<AssignmentRow>(payload.classAssignments);
  const grades = asArray<GradeRow>(payload.grades);
  const attendance = asArray<AttendanceRow>(payload.attendance);
  const schedules = asArray<ScheduleRow>(payload.schedules);
  const workload = asArray<WorkloadRow>(payload.workload);

  const sectionsById = new Map(sections.map((row) => [row.id, row]));
  const studentsById = new Map(students.map((row) => [row.id, row]));
  const assignmentsById = new Map(assignments.map((row) => [row.id, row]));
  const subjectsById = new Map<string, AssignmentRow["subject"]>();
  for (const assignment of assignments) {
    if (assignment.subject?.id) subjectsById.set(assignment.subject.id, assignment.subject);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const summarySheet = workbook.addWorksheet("Summary");
  summarySheet.columns = [
    { key: "label", width: 30 },
    { key: "value", width: 60 },
  ];
  const summaryRows: Array<[string, string | number]> = [
    ["Teacher", text(teacher.name)],
    ["Employee ID", text(teacher.employeeId)],
    ["School Year", text(schoolYear.label)],
    ["Grading Mode", text(schoolYear.gradingMode)],
    ["Generated At", text(payload.generatedAt)],
    ["Schema Version", text(payload.schemaVersion)],
    ["Archive Source", text(payload.source)],
    ["", ""],
    ["Sections", numberOrNull(summary.sections) ?? 0],
    ["Subjects", numberOrNull(summary.subjects) ?? 0],
    ["Students", numberOrNull(summary.students) ?? 0],
    ["Class Assignments", numberOrNull(summary.assignments) ?? 0],
    ["Grades", numberOrNull(summary.grades) ?? 0],
    ["Attendance Rows", numberOrNull(summary.attendanceRows) ?? 0],
    ["Schedules", numberOrNull(summary.schedules) ?? 0],
    ["Workload Entries", numberOrNull(summary.workloadEntries) ?? 0],
    ["EOSY Snapshots", numberOrNull(summary.eosySnapshots) ?? 0],
  ];
  for (const [label, value] of summaryRows) summarySheet.addRow({ label, value });
  summarySheet.getColumn(1).font = { bold: true };
  summarySheet.getRow(1).font = { bold: true };

  const warnings = Array.isArray(dataQuality.warnings)
    ? (dataQuality.warnings as unknown[]).map(text)
    : [];
  if (warnings.length > 0) {
    summarySheet.addRow({});
    summarySheet.addRow({ label: "Data Quality Warnings", value: warnings.join(", ") });
    summarySheet.getRow(summarySheet.rowCount).font = {
      color: { argb: "FFB45309" },
      bold: true,
    };
  }

  // ── Grades ────────────────────────────────────────────────────────────────
  const gradeRows = [...grades].sort((a, b) => {
    const sa = studentLabel(studentsById.get(a.studentId));
    const sb = studentLabel(studentsById.get(b.studentId));
    if (sa !== sb) return sa.localeCompare(sb);
    const aa = assignmentsById.get(a.classAssignmentId);
    const ab = assignmentsById.get(b.classAssignmentId);
    const subjectCompare = text(aa?.subject?.name).localeCompare(text(ab?.subject?.name));
    if (subjectCompare !== 0) return subjectCompare;
    return a.term.localeCompare(b.term);
  });

  addDataSheet(
    workbook,
    "Grades",
    [
      "Term",
      "LRN",
      "Student",
      "Section",
      "Subject",
      "WW %",
      "PT %",
      "QA %",
      "Initial Grade",
      "Quarterly Grade",
      "Remarks",
      "Status",
    ],
    gradeRows.map((grade) => {
      const student = studentsById.get(grade.studentId);
      const assignment = assignmentsById.get(grade.classAssignmentId);
      const section = assignment ? sectionsById.get(assignment.sectionId) : undefined;
      return [
        grade.term,
        text(student?.lrn),
        studentLabel(student),
        text(section?.name),
        text(assignment?.subject?.displayName || assignment?.subject?.name),
        numberOrNull(grade.writtenWorkPS),
        numberOrNull(grade.perfTaskPS),
        numberOrNull(grade.quarterlyAssessPS),
        numberOrNull(grade.initialGrade),
        numberOrNull(grade.quarterlyGrade),
        text(grade.remarks),
        text(grade.status),
      ];
    }),
    [8, 16, 28, 18, 24, 10, 10, 10, 12, 14, 18, 12],
  );

  // ── Attendance ────────────────────────────────────────────────────────────
  const attendanceRows = [...attendance].sort((a, b) => {
    const dateCompare = text(a.date).localeCompare(text(b.date));
    if (dateCompare !== 0) return dateCompare;
    return studentLabel(studentsById.get(a.studentId)).localeCompare(
      studentLabel(studentsById.get(b.studentId)),
    );
  });

  addDataSheet(
    workbook,
    "Attendance",
    ["Date", "LRN", "Student", "Section", "Status", "Remarks"],
    attendanceRows.map((row) => {
      const student = studentsById.get(row.studentId);
      return [
        text(row.date),
        text(student?.lrn),
        studentLabel(student),
        text(sectionsById.get(row.sectionId)?.name),
        text(row.status),
        text(row.remarks),
      ];
    }),
    [12, 16, 28, 18, 12, 30],
  );

  // ── Students ──────────────────────────────────────────────────────────────
  const studentRows = [...students]
    .sort((a, b) => studentLabel(a).localeCompare(studentLabel(b)))
    .map((student) => [
      text(student.lrn),
      studentLabel(student),
      text(sectionsById.get(student.sectionId)?.name),
      text(student.enrollment?.status),
      text(student.enrollment?.promotionStatus),
      text(student.enrollment?.promotedToGradeLevel),
    ]);

  addDataSheet(
    workbook,
    "Students",
    ["LRN", "Student", "Section", "Enrollment Status", "Promotion Status", "Promoted To"],
    studentRows,
    [16, 28, 18, 16, 20, 14],
  );

  // ── Classes ───────────────────────────────────────────────────────────────
  addDataSheet(
    workbook,
    "Classes",
    ["Subject", "Section", "Teaching Minutes", "Active", "Source", "Archived Reason"],
    assignments.map((assignment) => [
      text(assignment.subject?.displayName || assignment.subject?.name),
      text(sectionsById.get(assignment.sectionId)?.name),
      numberOrNull(assignment.teachingMinutes),
      assignment.isActive ? "Yes" : "No",
      text(assignment.source),
      text(assignment.archivedReason),
    ]),
    [28, 18, 16, 10, 12, 30],
  );

  // ── Schedule ──────────────────────────────────────────────────────────────
  addDataSheet(
    workbook,
    "Schedule",
    ["Day", "Start", "End", "Subject", "Section", "Term"],
    schedules.map((row) => [
      text(row.day),
      text(row.startTime),
      text(row.endTime),
      text(subjectsById.get(text(row.subjectId))?.displayName || subjectsById.get(text(row.subjectId))?.name),
      text(sectionsById.get(row.sectionId)?.name),
      numberOrNull(row.termIndex),
    ]),
    [14, 10, 10, 28, 18, 8],
  );

  // ── Workload ──────────────────────────────────────────────────────────────
  addDataSheet(
    workbook,
    "Workload",
    ["Type", "Minutes", "Section"],
    workload.map((row) => [
      text(row.type),
      numberOrNull(row.minutes) ?? 0,
      text(sectionsById.get(text(row.sectionId))?.name),
    ]),
    [20, 12, 18],
  );

  return workbook;
}
