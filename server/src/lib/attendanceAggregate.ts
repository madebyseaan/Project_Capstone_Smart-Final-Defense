/**
 * attendanceAggregate.ts
 *
 * Pure aggregation helpers for DepEd attendance-based school forms.
 *
 * SF2 (Daily Attendance Report of Learners) and SF9 (Learner's Progress Report
 * Card — Attendance Record) both derive their numbers from the same daily
 * `Attendance` rows. Keeping the math here (no Prisma, no Express) lets the
 * routes stay thin and makes the rules unit-testable.
 *
 * Rules (confirmed with stakeholders):
 * - School day = a date in the reporting month where the section has at least
 *   one saved attendance record (a day the adviser actually took attendance).
 * - PRESENT  -> blank day mark  (counts as present)
 * - LATE     -> "/"   day mark  (counts as present AND tardy)
 * - EXCUSED  -> "E"   day mark  (counts as present; never absent/tardy)
 * - ABSENT   -> "x"   day mark  (counts as absent)
 * - A missing record on a school day is treated as present (deped default blank).
 */

const DAY_LETTERS = ["S", "M", "T", "W", "TH", "F", "S"];

const MONTH_LABELS = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];

/** Short month labels used by the SF9 attendance record (DepEd order). */
const SF9_MONTH_KEYS = ["Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr"];

export interface AttendanceRecordLike {
  studentId: string;
  date: Date;
  status: string;
  remarks?: string | null;
}

export interface Sf2StudentLike {
  id: string;
  lrn: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  gender: string | null;
}

export interface SchoolDay {
  date: string; // YYYY-MM-DD
  dayNum: number;
  dayLetter: string;
}

export interface Sf2StudentRow {
  studentId: string;
  lrn: string;
  lastName: string;
  firstName: string;
  middleName: string | null;
  gender: string | null;
  /** dateKey -> "" | "x" | "/" | "E" */
  marks: Record<string, string>;
  absent: number;
  tardy: number;
  present: number;
  /** Highest run of consecutive ABSENT school days in the month. */
  maxConsecutiveAbsent: number;
  /** Distinct non-empty daily remarks for the month, joined with "; ". */
  remarks: string;
}

export interface Sf2Group {
  key: "MALE" | "FEMALE" | "OTHER";
  label: string;
  students: Sf2StudentRow[];
}

export interface Sf2Summary {
  noOfDaysOfClasses: number;
  enrolmentMale: number;
  enrolmentFemale: number;
  enrolmentTotal: number;
  averageDailyAttendance: number;
  percentageAttendance: number;
  studentsAbsent5Consecutive: number;
}

export interface Sf2Grid {
  schoolDays: SchoolDay[];
  groups: Sf2Group[];
  /** dateKey -> number of learners present (not absent) that day. */
  dailyPresent: Record<string, number>;
  summary: Sf2Summary;
  monthLabel: string;
  year: number;
  month: number;
}

export interface Sf9MonthRow {
  key: string;
  label: string;
  schoolDays: number;
  present: number;
  absent: number;
}

export interface Sf9Attendance {
  months: Sf9MonthRow[];
  total: { schoolDays: number; present: number; absent: number };
}

// ---------------------------------------------------------------------------
// Date helpers — all derived from the UTC calendar date so results do not
// shift with the server timezone (Prisma returns @db.Date at UTC midnight).
// ---------------------------------------------------------------------------

export function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function keyYear(key: string): number {
  return Number(key.slice(0, 4));
}

function keyMonth(key: string): number {
  return Number(key.slice(5, 7));
}

function dowLetter(key: string): string {
  return DAY_LETTERS[new Date(`${key}T00:00:00Z`).getUTCDay()];
}

export function monthLabel(month: number): string {
  return MONTH_LABELS[month - 1] ?? "";
}

function isAbsent(status: string): boolean {
  return status === "ABSENT";
}

// ---------------------------------------------------------------------------
// SF2
// ---------------------------------------------------------------------------

/**
 * Distinct dates within `year`/`month` that carry at least one attendance
 * record, sorted ascending. These are the reporting month's school days.
 */
export function listSchoolDays(
  records: AttendanceRecordLike[],
  year: number,
  month: number,
): SchoolDay[] {
  const seen = new Set<string>();
  const days: SchoolDay[] = [];

  for (const record of records) {
    const key = dateKey(record.date);
    if (keyYear(key) !== year || keyMonth(key) !== month) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    days.push({ date: key, dayNum: Number(key.slice(8, 10)), dayLetter: dowLetter(key) });
  }

  return days.sort((a, b) => a.date.localeCompare(b.date));
}

function maxConsecutiveAbsences(records: AttendanceRecordLike[], schoolDays: SchoolDay[]): number {
  const byDate = new Map<string, string>();
  for (const record of records) byDate.set(dateKey(record.date), record.status);

  let max = 0;
  let run = 0;
  for (const day of schoolDays) {
    const status = byDate.get(day.date);
    if (status && isAbsent(status)) {
      run += 1;
      if (run > max) max = run;
    } else {
      run = 0;
    }
  }
  return max;
}

export function buildSf2Grid(
  students: Sf2StudentLike[],
  records: AttendanceRecordLike[],
  year: number,
  month: number,
): Sf2Grid {
  const schoolDays = listSchoolDays(records, year, month);

  const recordsByStudent = new Map<string, AttendanceRecordLike[]>();
  for (const record of records) {
    const list = recordsByStudent.get(record.studentId);
    if (list) list.push(record);
    else recordsByStudent.set(record.studentId, [record]);
  }

  const rows: Sf2StudentRow[] = students.map((student) => {
    const own = recordsByStudent.get(student.id) ?? [];
    const byDate = new Map<string, string>();
    const remarksSet = new Set<string>();
    for (const record of own) {
      const key = dateKey(record.date);
      if (keyYear(key) === year && keyMonth(key) === month) {
        byDate.set(key, record.status);
        const note = record.remarks?.trim();
        if (note) remarksSet.add(note);
      }
    }

    const marks: Record<string, string> = {};
    let absent = 0;
    let tardy = 0;

    for (const day of schoolDays) {
      const status = byDate.get(day.date);
      if (status && isAbsent(status)) {
        marks[day.date] = "x";
        absent += 1;
      } else if (status === "LATE") {
        marks[day.date] = "/";
        tardy += 1;
      } else if (status === "EXCUSED") {
        marks[day.date] = "E";
      } else {
        marks[day.date] = "";
      }
    }

    return {
      studentId: student.id,
      lrn: student.lrn,
      lastName: student.lastName,
      firstName: student.firstName,
      middleName: student.middleName,
      gender: student.gender,
      marks,
      absent,
      tardy,
      present: schoolDays.length - absent,
      maxConsecutiveAbsent: maxConsecutiveAbsences(own, schoolDays),
      remarks: Array.from(remarksSet).join("; "),
    };
  });

  const dailyPresent: Record<string, number> = {};
  for (const day of schoolDays) {
    dailyPresent[day.date] = rows.reduce(
      (count, row) => count + (row.marks[day.date] === "x" ? 0 : 1),
      0,
    );
  }

  const byName = (a: Sf2StudentRow, b: Sf2StudentRow) =>
    a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName);

  const male = rows.filter((r) => (r.gender || "").toUpperCase() === "MALE").sort(byName);
  const female = rows.filter((r) => (r.gender || "").toUpperCase() === "FEMALE").sort(byName);
  const other = rows
    .filter((r) => {
      const g = (r.gender || "").toUpperCase();
      return g !== "MALE" && g !== "FEMALE";
    })
    .sort(byName);

  const groups: Sf2Group[] = [];
  if (male.length) groups.push({ key: "MALE", label: "MALE", students: male });
  if (female.length) groups.push({ key: "FEMALE", label: "FEMALE", students: female });
  if (other.length) groups.push({ key: "OTHER", label: "UNCLASSIFIED", students: other });

  const totalDailyAttendance = Object.values(dailyPresent).reduce((a, b) => a + b, 0);
  const averageDailyAttendance = schoolDays.length
    ? totalDailyAttendance / schoolDays.length
    : 0;
  const percentageAttendance =
    schoolDays.length && students.length
      ? (totalDailyAttendance / (schoolDays.length * students.length)) * 100
      : 0;

  return {
    schoolDays,
    groups,
    dailyPresent,
    summary: {
      noOfDaysOfClasses: schoolDays.length,
      enrolmentMale: male.length,
      enrolmentFemale: female.length,
      enrolmentTotal: students.length,
      averageDailyAttendance: Number(averageDailyAttendance.toFixed(2)),
      percentageAttendance: Number(percentageAttendance.toFixed(2)),
      studentsAbsent5Consecutive: rows.filter((r) => r.maxConsecutiveAbsent >= 5).length,
    },
    monthLabel: monthLabel(month),
    year,
    month,
  };
}

// ---------------------------------------------------------------------------
// SF9
// ---------------------------------------------------------------------------

/**
 * The 11 monthly columns of the SF9 attendance record, mapped to concrete
 * calendar months for a "YYYY-YYYY" school-year label (Jun..Apr).
 */
export function schoolYearMonths(label: string): Array<{ key: string; year: number; month: number }> {
  const startYear = Number(label.split("-")[0]);
  const safeStart = Number.isFinite(startYear) ? startYear : new Date().getFullYear();
  return SF9_MONTH_KEYS.map((key, index) => {
    // index 0..6 = Jun..Dec of startYear, 7..10 = Jan..Apr of startYear+1
    const month = index + 6 <= 12 ? index + 6 : index - 6;
    const year = index + 6 <= 12 ? safeStart : safeStart + 1;
    return { key, year, month };
  });
}

export function buildSf9Attendance(
  records: AttendanceRecordLike[],
  schoolYearLabel: string,
): Sf9Attendance {
  const months = schoolYearMonths(schoolYearLabel);

  const rows: Sf9MonthRow[] = months.map(({ key, year, month }) => {
    const inMonth = records.filter((record) => {
      const dk = dateKey(record.date);
      return keyYear(dk) === year && keyMonth(dk) === month;
    });
    const schoolDays = new Set(inMonth.map((record) => dateKey(record.date))).size;
    const absent = inMonth.filter((record) => isAbsent(record.status)).length;
    const present = inMonth.length - absent;
    return { key, label: key, schoolDays, present, absent };
  });

  return {
    months: rows,
    total: {
      schoolDays: rows.reduce((a, r) => a + r.schoolDays, 0),
      present: rows.reduce((a, r) => a + r.present, 0),
      absent: rows.reduce((a, r) => a + r.absent, 0),
    },
  };
}
