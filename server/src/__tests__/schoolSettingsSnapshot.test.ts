/**
 * schoolSettingsSnapshot.test.ts
 *
 * Unit tests for the school-settings-per-year snapshot feature.
 * Tests W2 (active sync), W3 (archived freeze), W4 (empty-guard), W6 (malformed fallback).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import {
  captureSchoolSettingsSnapshot,
  syncActiveYearSnapshot,
  getSchoolIdentityForYear,
  getSchoolIdentityByYears,
} from "../lib/schoolSettingsSnapshot";

const YEAR_SNAP = "2098-2099";
const YEAR_ARCHIVE = "2099-2100";
const YEAR_NULL = "2100-2101";
const YEAR_BATCH_A = "2101-2102";
const YEAR_BATCH_B = "2102-2103";

const SNAPSHOT_FIXTURE = {
  schoolName: "Test School Snap",
  schoolId: "999999",
  division: "Test Division",
  region: "Test Region",
  schoolHeadName: "Test Head",
  address: "123 Test St",
};

const mainSettingsId = "main";
let previousSettings: any = null;

beforeAll(async () => {
  // Save current settings for restoration
  previousSettings = await prisma.systemSettings.findUnique({ where: { id: mainSettingsId } });

  // Set up known live settings for tests
  await prisma.systemSettings.upsert({
    where: { id: mainSettingsId },
    update: {
      schoolName: "Live School",
      schoolId: "111111",
      division: "Live Division",
      region: "Live Region",
      schoolHeadName: "Live Head",
      address: "Live Address",
    },
    create: {
      id: mainSettingsId,
      schoolName: "Live School",
      schoolId: "111111",
      division: "Live Division",
      region: "Live Region",
      schoolHeadName: "Live Head",
      address: "Live Address",
    },
  });

  // Create test school years
  await prisma.schoolYear.create({
    data: { label: YEAR_SNAP, status: "ACTIVE", externalId: 980101, schoolSettingsSnapshot: SNAPSHOT_FIXTURE as any },
  });
  await prisma.schoolYear.create({
    data: { label: YEAR_ARCHIVE, status: "ARCHIVED", externalId: 980102, schoolSettingsSnapshot: SNAPSHOT_FIXTURE as any },
  });
  await prisma.schoolYear.create({
    data: { label: YEAR_NULL, status: "ACTIVE", externalId: 980103 },
  });
  await prisma.schoolYear.create({
    data: { label: YEAR_BATCH_A, status: "ACTIVE", externalId: 980104, schoolSettingsSnapshot: SNAPSHOT_FIXTURE as any },
  });
  await prisma.schoolYear.create({
    data: { label: YEAR_BATCH_B, status: "ACTIVE", externalId: 980105 },
  });
});

afterAll(async () => {
  await prisma.schoolYear.deleteMany({ where: { label: { in: [YEAR_SNAP, YEAR_ARCHIVE, YEAR_NULL, YEAR_BATCH_A, YEAR_BATCH_B] } } });
  // Restore previous settings
  if (previousSettings) {
    await prisma.systemSettings.update({ where: { id: mainSettingsId }, data: previousSettings });
  } else {
    await prisma.systemSettings.delete({ where: { id: mainSettingsId } }).catch(() => {});
  }
});

describe("captureSchoolSettingsSnapshot", () => {
  it("maps settings to snapshot, nulls become empty strings", () => {
    const result = captureSchoolSettingsSnapshot({ schoolName: "X", schoolId: null, division: undefined });
    expect(result.schoolName).toBe("X");
    expect(result.schoolId).toBe("");
    expect(result.division).toBe("");
  });

  it("handles null/undefined input", () => {
    const result = captureSchoolSettingsSnapshot(null);
    expect(result.schoolName).toBe("");
    expect(result.schoolHeadName).toBe("");
  });
});

describe("getSchoolIdentityForYear", () => {
  it("returns snapshot values when snapshot exists", async () => {
    const identity = await getSchoolIdentityForYear(YEAR_SNAP);
    expect(identity.schoolName).toBe("Test School Snap");
    expect(identity.schoolId).toBe("999999");
    expect(identity.division).toBe("Test Division");
    expect(identity.region).toBe("Test Region");
    expect(identity.schoolHeadName).toBe("Test Head");
    expect(identity.district).toBe("");
  });

  it("falls back to live settings when snapshot is null (W6)", async () => {
    const identity = await getSchoolIdentityForYear(YEAR_NULL);
    expect(identity.schoolName).toBe("Live School");
    expect(identity.schoolId).toBe("111111");
    expect(identity.division).toBe("Live Division");
  });

  it("falls back to live settings when snapshot is malformed JSON (W6)", async () => {
    // Insert a year with malformed snapshot
    const label = "2103-2104";
    await prisma.schoolYear.create({
      data: { label, status: "ACTIVE", externalId: 980106, schoolSettingsSnapshot: { schoolName: 123 } as any },
    });

    const identity = await getSchoolIdentityForYear(label);
    // Should fall back to live
    expect(identity.schoolName).toBe("Live School");
    expect(identity.schoolId).toBe("111111");

    await prisma.schoolYear.delete({ where: { label } });
  });
});

describe("syncActiveYearSnapshot", () => {
  it("updates active year's snapshot to match live settings (W2)", async () => {
    // Point SystemSettings to YEAR_NULL year (which has no snapshot)
    const year = await prisma.schoolYear.findUnique({ where: { label: YEAR_NULL } });
    await prisma.systemSettings.update({ where: { id: mainSettingsId }, data: { schoolYearId: year!.id } });

    await syncActiveYearSnapshot();

    const updated = await prisma.schoolYear.findUnique({ where: { label: YEAR_NULL } });
    expect(updated?.schoolSettingsSnapshot).not.toBeNull();
    const snap = updated?.schoolSettingsSnapshot as any;
    expect(snap.schoolName).toBe("Live School");
    expect(snap.schoolId).toBe("111111");
  });

  it("never updates ARCHIVED year's snapshot (W3)", async () => {
    // Point SystemSettings to ARCHIVED year
    const archivedYear = await prisma.schoolYear.findUnique({ where: { label: YEAR_ARCHIVE } });
    await prisma.systemSettings.update({ where: { id: mainSettingsId }, data: { schoolYearId: archivedYear!.id } });

    const before = (archivedYear?.schoolSettingsSnapshot as any).schoolName;
    await syncActiveYearSnapshot();

    const after = await prisma.schoolYear.findUnique({ where: { id: archivedYear!.id } });
    expect((after?.schoolSettingsSnapshot as any).schoolName).toBe(before);
  });

  it("skips all-empty new snapshot vs non-null existing (W4)", async () => {
    // Set live settings to all empty
    await prisma.systemSettings.update({
      where: { id: mainSettingsId },
      data: { schoolName: "", schoolId: "", division: "", region: "", schoolHeadName: "", address: "" },
    });

    // Point to YEAR_SNAP which has a non-null snapshot
    const yearWithSnap = await prisma.schoolYear.findUnique({ where: { label: YEAR_SNAP } });
    await prisma.systemSettings.update({ where: { id: mainSettingsId }, data: { schoolYearId: yearWithSnap!.id } });

    await syncActiveYearSnapshot();

    const after = await prisma.schoolYear.findUnique({ where: { id: yearWithSnap!.id } });
    // Should NOT have been overwritten — still has original snapshot
    expect((after?.schoolSettingsSnapshot as any).schoolName).toBe("Test School Snap");

    // Restore live settings
    await prisma.systemSettings.update({
      where: { id: mainSettingsId },
      data: { schoolName: "Live School", schoolId: "111111", division: "Live Division", region: "Live Region", schoolHeadName: "Live Head", address: "Live Address" },
    });
  });
});

describe("getSchoolIdentityByYears", () => {
  it("returns correct per-label results for mix of snapshotted / null / nonexistent", async () => {
    const result = await getSchoolIdentityByYears([YEAR_SNAP, YEAR_NULL, "nonexistent-label", YEAR_BATCH_A]);

    // Snapshotted year
    const snapResult = result.get(YEAR_SNAP);
    expect(snapResult?.schoolName).toBe("Test School Snap");

    // Null-snapshot year → fallback
    const nullResult = result.get(YEAR_NULL);
    expect(nullResult?.schoolName).toBe("Live School");

    // Nonexistent → fallback
    const missingResult = result.get("nonexistent-label");
    expect(missingResult?.schoolName).toBe("Live School");

    // Another snapshotted year
    const batchResult = result.get(YEAR_BATCH_A);
    expect(batchResult?.schoolName).toBe("Test School Snap");
  });
});
