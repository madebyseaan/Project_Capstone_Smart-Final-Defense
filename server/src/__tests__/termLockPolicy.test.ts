/**
 * termLockPolicy.test.ts — RL-3a pure tests for the auto-lock policy.
 */
import { describe, it, expect } from "vitest";
import { shouldLockTerm, shouldBeUnlockedTerm, shouldLockYear } from "../lib/termLockPolicy";

const NOW = new Date("2031-03-01T00:00:00Z");
const PAST = new Date("2030-01-01T00:00:00Z");
const FUTURE = new Date("2032-01-01T00:00:00Z");

describe("RL-3a — shouldLockTerm", () => {
  it("locks terms strictly before the active term when their end date passed", () => {
    expect(shouldLockTerm("T1", PAST, NOW, "T2")).toBe(true);
    expect(shouldLockTerm("T2", PAST, NOW, "T3")).toBe(true);
  });

  it("never locks the active term", () => {
    expect(shouldLockTerm("T1", PAST, NOW, "T1")).toBe(false);
    expect(shouldLockTerm("T3", PAST, NOW, "T3")).toBe(false);
  });

  it("never locks a future term, even with stale (past) dates — rollover case", () => {
    expect(shouldLockTerm("T2", PAST, NOW, "T1")).toBe(false);
    expect(shouldLockTerm("T3", PAST, NOW, "T1")).toBe(false);
    expect(shouldLockTerm("T3", PAST, NOW, "T2")).toBe(false);
  });

  it("falls back to date-based locking when EnrollPro's term is unknown", () => {
    expect(shouldLockTerm("T2", PAST, NOW, null)).toBe(true);
    expect(shouldLockTerm("T2", FUTURE, NOW, null)).toBe(false);
  });

  it("does not lock when the end date has not passed", () => {
    expect(shouldLockTerm("T1", FUTURE, NOW, "T3")).toBe(false);
    expect(shouldLockTerm("T1", null, NOW, "T3")).toBe(false);
  });
});

describe("RL-3a — shouldBeUnlockedTerm", () => {
  it("requires unlock for the active and future terms", () => {
    expect(shouldBeUnlockedTerm("T2", "T2")).toBe(true);
    expect(shouldBeUnlockedTerm("T3", "T2")).toBe(true);
    expect(shouldBeUnlockedTerm("T1", "T2")).toBe(false);
  });

  it("does nothing when the active term is unknown", () => {
    expect(shouldBeUnlockedTerm("T1", null)).toBe(false);
  });
});

describe("RL-3a — shouldLockYear", () => {
  it("locks the year only when T3 is over and EnrollPro reports T3", () => {
    expect(shouldLockYear(PAST, NOW, "T3")).toBe(true);
  });

  it("does not lock the year while EnrollPro is in T1/T2 (rollover case)", () => {
    expect(shouldLockYear(PAST, NOW, "T1")).toBe(false);
    expect(shouldLockYear(PAST, NOW, "T2")).toBe(false);
  });

  it("falls back to date-based locking when EnrollPro is unknown", () => {
    expect(shouldLockYear(PAST, NOW, null)).toBe(true);
  });

  it("does not lock when the T3 end date has not passed", () => {
    expect(shouldLockYear(FUTURE, NOW, "T3")).toBe(false);
    expect(shouldLockYear(null, NOW, "T3")).toBe(false);
  });
});
