import { describe, expect, it } from "vitest";
import { buildTermAttendance, type AttendanceRecordLike } from "../lib/attendanceAggregate";

const records: AttendanceRecordLike[] = [
  { studentId: "s1", date: new Date("2026-06-07T00:00:00Z"), status: "PRESENT" },
  { studentId: "s1", date: new Date("2026-06-08T00:00:00Z"), status: "PRESENT" },
  { studentId: "s1", date: new Date("2026-06-08T00:00:00Z"), status: "ABSENT" },
  { studentId: "s1", date: new Date("2026-06-09T00:00:00Z"), status: "LATE" },
  { studentId: "s1", date: new Date("2026-06-10T00:00:00Z"), status: "ABSENT" },
  { studentId: "s1", date: new Date("2026-06-11T00:00:00Z"), status: "EXCUSED" },
  { studentId: "s1", date: new Date("2026-06-12T00:00:00Z"), status: "PRESENT" },
];

describe("buildTermAttendance", () => {
  it("returns null when a term boundary is missing", () => {
    expect(buildTermAttendance(records, null, new Date("2026-06-30T00:00:00Z"))).toBeNull();
    expect(buildTermAttendance(records, new Date("2026-06-01T00:00:00Z"), null)).toBeNull();
  });

  it("counts only records inside the inclusive term range", () => {
    const result = buildTermAttendance(
      records,
      new Date("2026-06-08T00:00:00Z"),
      new Date("2026-06-11T00:00:00Z"),
    );

    expect(result).toEqual({
      startDate: "2026-06-08",
      endDate: "2026-06-11",
      schoolDays: 4,
      present: 3,
      absent: 2,
    });
  });

  it("treats LATE and EXCUSED as present and only ABSENT as absent", () => {
    const result = buildTermAttendance(
      records,
      "2026-06-09",
      "2026-06-11",
    );

    expect(result).toEqual({
      startDate: "2026-06-09",
      endDate: "2026-06-11",
      schoolDays: 3,
      present: 2,
      absent: 1,
    });
  });

  it("returns zero counts for an empty range", () => {
    const result = buildTermAttendance(records, "2026-07-01", "2026-07-31");
    expect(result).toEqual({
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      schoolDays: 0,
      present: 0,
      absent: 0,
    });
  });
});
