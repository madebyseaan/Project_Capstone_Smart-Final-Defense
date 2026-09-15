/**
 * enrollpro-year-pick.test.ts — RL-10a.
 * When EnrollPro's active-year endpoint is unavailable and only the school-year
 * list is reachable, the ACTIVE year must win over a pinned/preferred label.
 */
import { describe, it, expect } from "vitest";
import { pickEnrollProSchoolYear } from "../lib/enrollproClient";

const YEARS = [
  { id: 5, yearLabel: "2026-2027", status: "ARCHIVED" },
  { id: 6, yearLabel: "2027-2028", status: "ARCHIVED" },
  { id: 9, yearLabel: "2030-2031", status: "ACTIVE" },
];

describe("RL-10a — pickEnrollProSchoolYear", () => {
  it("prefers the ACTIVE year over a pinned (stale) label", () => {
    expect(pickEnrollProSchoolYear(YEARS, "2026-2027")).toEqual(YEARS[2]);
  });

  it("still prefers ACTIVE over a label that matches no year", () => {
    expect(pickEnrollProSchoolYear(YEARS, "1999-2000")).toEqual(YEARS[2]);
  });

  it("falls back to the pinned label when no year is ACTIVE", () => {
    const noActive = YEARS.map((y) => ({ ...y, status: "ARCHIVED" }));
    expect(pickEnrollProSchoolYear(noActive, "2026-2027")).toEqual(noActive[0]);
  });

  it("falls back to the latest id when nothing matches", () => {
    const noActive = YEARS.map((y) => ({ ...y, status: "ARCHIVED" }));
    expect(pickEnrollProSchoolYear(noActive)).toEqual(noActive[2]);
  });

  it("returns undefined for an empty list", () => {
    expect(pickEnrollProSchoolYear([], "2026-2027")).toBeUndefined();
  });
});
