/**
 * attendanceAggregate.test.ts — DepEd SF2/SF9 attendance math (pure, no DB).
 */
import { describe, it, expect } from "vitest";
import {
  dateKey,
  listSchoolDays,
  buildSf2Grid,
  buildSf9Attendance,
  schoolYearMonths,
  type AttendanceRecordLike,
  type Sf2StudentLike,
} from "../lib/attendanceAggregate";

const student = (id: string, lastName: string, gender: string): Sf2StudentLike => ({
  id,
  lrn: `LRN-${id}`,
  firstName: "Juan",
  middleName: "D",
  lastName,
  gender,
});

const rec = (studentId: string, date: string, status: string, remarks?: string): AttendanceRecordLike => ({
  studentId,
  date: new Date(`${date}T00:00:00Z`),
  status,
  remarks,
});

describe("dateKey", () => {
  it("formats a UTC date as YYYY-MM-DD", () => {
    expect(dateKey(new Date("2026-06-01T00:00:00Z"))).toBe("2026-06-01");
  });
});

describe("listSchoolDays", () => {
  it("returns distinct in-month dates with records, ascending", () => {
    const records = [
      rec("a", "2026-06-03", "PRESENT"),
      rec("a", "2026-06-01", "PRESENT"),
      rec("b", "2026-06-01", "ABSENT"),
      rec("a", "2026-05-30", "PRESENT"),
      rec("a", "2026-07-01", "PRESENT"),
    ];
    const days = listSchoolDays(records, 2026, 6);
    expect(days.map((d) => d.date)).toEqual(["2026-06-01", "2026-06-03"]);
    expect(days[0].dayNum).toBe(1);
  });
});

describe("buildSf2Grid", () => {
  const students = [student("m1", "Alpha", "MALE"), student("f1", "Beta", "FEMALE")];
  const records = [
    rec("m1", "2026-06-01", "PRESENT"),
    rec("f1", "2026-06-01", "ABSENT"),
    rec("m1", "2026-06-02", "LATE"),
    rec("f1", "2026-06-02", "EXCUSED"),
    rec("m1", "2026-06-03", "PRESENT"),
    rec("f1", "2026-06-03", "PRESENT"),
  ];

  it("marks days and counts absent/tardy (excused counts as present)", () => {
    const grid = buildSf2Grid(students, records, 2026, 6);
    expect(grid.schoolDays.map((d) => d.date)).toEqual([
      "2026-06-01",
      "2026-06-02",
      "2026-06-03",
    ]);

    const male = grid.groups.find((g) => g.key === "MALE")!.students[0];
    expect(male.marks).toEqual({ "2026-06-01": "", "2026-06-02": "/", "2026-06-03": "" });
    expect(male.absent).toBe(0);
    expect(male.tardy).toBe(1);
    expect(male.present).toBe(3);

    const female = grid.groups.find((g) => g.key === "FEMALE")!.students[0];
    expect(female.marks).toEqual({ "2026-06-01": "x", "2026-06-02": "E", "2026-06-03": "" });
    expect(female.absent).toBe(1);
    expect(female.tardy).toBe(0);
    expect(female.present).toBe(2);

    expect(grid.dailyPresent).toEqual({
      "2026-06-01": 1,
      "2026-06-02": 2,
      "2026-06-03": 2,
    });
  });

  it("computes summary and groups by sex", () => {
    const grid = buildSf2Grid(students, records, 2026, 6);
    expect(grid.summary.noOfDaysOfClasses).toBe(3);
    expect(grid.summary.enrolmentMale).toBe(1);
    expect(grid.summary.enrolmentFemale).toBe(1);
    expect(grid.summary.enrolmentTotal).toBe(2);
    expect(grid.summary.averageDailyAttendance).toBe(1.67);
    expect(grid.summary.percentageAttendance).toBe(83.33);
    expect(grid.groups.map((g) => g.key)).toEqual(["MALE", "FEMALE"]);
  });

  it("treats a missing record on a school day as present (blank)", () => {
    const withGhost = [...students, student("x1", "Gamma", "MALE")];
    const grid = buildSf2Grid(withGhost, records, 2026, 6);
    const ghost = grid.groups.flatMap((g) => g.students).find((s) => s.studentId === "x1")!;
    expect(ghost.absent).toBe(0);
    expect(ghost.present).toBe(3);
    expect(ghost.marks["2026-06-01"]).toBe("");
  });

  it("collects distinct non-empty daily remarks for the month", () => {
    const one = [student("r1", "Epsilon", "MALE")];
    const records = [
      rec("r1", "2026-06-01", "ABSENT", "Sick"),
      rec("r1", "2026-06-02", "PRESENT", ""),
      rec("r1", "2026-06-03", "LATE", "Sick"),
      rec("r1", "2026-06-04", "ABSENT", "Field trip"),
    ];
    const grid = buildSf2Grid(one, records, 2026, 6);
    expect(grid.groups[0].students[0].remarks).toBe("Sick; Field trip");
  });

  it("flags a learner with 5 consecutive absences", () => {
    const one = [student("a1", "Delta", "MALE")];
    const days = ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05"];
    const absent = days.map((d) => rec("a1", d, "ABSENT"));
    const grid = buildSf2Grid(one, absent, 2026, 6);
    const row = grid.groups[0].students[0];
    expect(row.maxConsecutiveAbsent).toBe(5);
    expect(grid.summary.studentsAbsent5Consecutive).toBe(1);
  });
});

describe("schoolYearMonths", () => {
  it("maps a YYYY-YYYY label to Jun..Apr across the year boundary", () => {
    const months = schoolYearMonths("2026-2027");
    expect(months.map((m) => m.key)).toEqual([
      "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr",
    ]);
    expect(months[0]).toEqual({ key: "Jun", year: 2026, month: 6 });
    expect(months[6]).toEqual({ key: "Dec", year: 2026, month: 12 });
    expect(months[7]).toEqual({ key: "Jan", year: 2027, month: 1 });
    expect(months[10]).toEqual({ key: "Apr", year: 2027, month: 4 });
  });
});

describe("buildSf9Attendance", () => {
  it("aggregates school days/present/absent per month and totals", () => {
    const records = [
      rec("s1", "2026-06-01", "PRESENT"),
      rec("s1", "2026-06-02", "LATE"),
      rec("s1", "2027-01-15", "ABSENT"),
    ];
    const result = buildSf9Attendance(records, "2026-2027");
    expect(result.months).toHaveLength(11);

    const june = result.months.find((m) => m.key === "Jun")!;
    expect(june).toMatchObject({ schoolDays: 2, present: 2, absent: 0 });

    const jan = result.months.find((m) => m.key === "Jan")!;
    expect(jan).toMatchObject({ schoolDays: 1, present: 0, absent: 1 });

    expect(result.total).toEqual({ schoolDays: 3, present: 2, absent: 1 });
  });
});
