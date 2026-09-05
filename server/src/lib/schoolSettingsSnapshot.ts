/**
 * schoolSettingsSnapshot.ts
 *
 * Shared helpers for the school-settings-per-year snapshot feature.
 * Captures school identity at year creation; keeps the active year's snapshot
 * in sync with live SystemSettings; freezes the snapshot when a year is archived.
 *
 * Write-rule invariants (W1-W6) documented in docs/PLAN-school-settings-snapshot.md.
 */

import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { logger } from "./logger";
import { invalidateSchoolYearCache } from "./schoolYearResolver";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const SchoolSettingsSnapshotSchema = z.object({
  schoolName: z.string().default(""),
  schoolId: z.string().default(""),
  division: z.string().default(""),
  region: z.string().default(""),
  schoolHeadName: z.string().default(""),
  address: z.string().default(""),
});

export type SchoolSettingsSnapshot = z.infer<typeof SchoolSettingsSnapshotSchema>;

/** Response shape consumed by SF forms (district is NOT in SystemSettings). */
export interface SchoolIdentity extends SchoolSettingsSnapshot {
  district: string;
}

// Select clause for live fallback queries
const LIVE_SELECT = {
  schoolName: true,
  schoolId: true,
  division: true,
  region: true,
  schoolHeadName: true,
  address: true,
} as const;

// ---------------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------------

/**
 * Pure mapper: SystemSettings row (or partial EP payload) → snapshot.
 * Handles nulls by defaulting to "".
 */
export function captureSchoolSettingsSnapshot(
  settings: Record<string, unknown> | null | undefined
): SchoolSettingsSnapshot {
  const s = (settings ?? {}) as Record<string, unknown>;
  return {
    schoolName: typeof s.schoolName === "string" ? s.schoolName : "",
    schoolId: typeof s.schoolId === "string" ? s.schoolId : "",
    division: typeof s.division === "string" ? s.division : "",
    region: typeof s.region === "string" ? s.region : "",
    schoolHeadName: typeof s.schoolHeadName === "string" ? s.schoolHeadName : "",
    address: typeof s.address === "string" ? s.address : "",
  };
}

/** Check if a snapshot is all-empty strings. */
function isAllEmpty(snapshot: SchoolSettingsSnapshot): boolean {
  return (
    snapshot.schoolName === "" &&
    snapshot.schoolId === "" &&
    snapshot.division === "" &&
    snapshot.region === "" &&
    snapshot.schoolHeadName === "" &&
    snapshot.address === ""
  );
}

/**
 * Synchronously parse a raw JSON value into SchoolSettingsSnapshot.
 * Returns null on invalid shape (W6).
 */
function parseSnapshot(raw: unknown): SchoolSettingsSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const result = SchoolSettingsSnapshotSchema.safeParse(raw);
  return result.success ? result.data : null;
}

/**
 * Read live SystemSettings and return as a snapshot.
 * Returns all-"" if row is missing.
 */
export async function readLiveSnapshot(): Promise<SchoolSettingsSnapshot> {
  const settings = await prisma.systemSettings.findUnique({
    where: { id: "main" },
    select: LIVE_SELECT,
  });
  return captureSchoolSettingsSnapshot(settings);
}

// ---------------------------------------------------------------------------
// Write-path helpers
// ---------------------------------------------------------------------------

/**
 * Sync the active year's snapshot with current live SystemSettings.
 *
 * Invariants enforced:
 * - W2: Only the active year's snapshot may be updated.
 * - W3: Never overwrite an ARCHIVED year's snapshot.
 * - W4: Never replace a non-null snapshot with an all-empty one.
 * - W5: Idempotent — re-running is safe.
 */
export async function syncActiveYearSnapshot(): Promise<void> {
  try {
    const settings = await prisma.systemSettings.findUnique({
      where: { id: "main" },
      select: { schoolYearId: true },
    });

    if (!settings?.schoolYearId) return;

    const year = await prisma.schoolYear.findUnique({
      where: { id: settings.schoolYearId },
      select: { id: true, status: true, schoolSettingsSnapshot: true },
    });

    if (!year) return;
    if (year.status === "ARCHIVED") return; // W3

    const newSnapshot = await readLiveSnapshot();

    // W4: skip if every field is "" and existing snapshot is non-null
    if (isAllEmpty(newSnapshot) && year.schoolSettingsSnapshot !== null) return;

    await prisma.schoolYear.update({
      where: { id: year.id },
      data: { schoolSettingsSnapshot: newSnapshot as Prisma.InputJsonValue },
    });
  } catch (err: any) {
    logger.warn(`[SchoolSettingsSnapshot] syncActiveYearSnapshot failed (non-fatal): ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Read-path helpers
// ---------------------------------------------------------------------------

/**
 * Get school identity for a specific year by label.
 * Falls back to live SystemSettings if snapshot is null/invalid (W6).
 */
export async function getSchoolIdentityForYear(
  label: string
): Promise<SchoolIdentity> {
  const year = await prisma.schoolYear.findUnique({
    where: { label },
    select: { schoolSettingsSnapshot: true },
  });

  if (year?.schoolSettingsSnapshot) {
    const parsed = parseSnapshot(year.schoolSettingsSnapshot);
    if (parsed) return { ...parsed, district: "" };
  }

  // Fallback to live settings
  const live = await readLiveSnapshot();
  return { ...live, district: "" };
}

/**
 * Batch version: get school identity for multiple year labels (no N+1).
 * Missing labels or labels with null/invalid snapshots fall back to live.
 */
export async function getSchoolIdentityByYears(
  labels: string[]
): Promise<Map<string, SchoolIdentity>> {
  const uniqueLabels = [...new Set(labels)];
  const result = new Map<string, SchoolIdentity>();

  if (uniqueLabels.length === 0) return result;

  const years = await prisma.schoolYear.findMany({
    where: { label: { in: uniqueLabels } },
    select: { label: true, schoolSettingsSnapshot: true },
  });

  const yearMap = new Map(years.map((y) => [y.label, y]));
  const liveFallback = await readLiveSnapshot();

  for (const label of uniqueLabels) {
    const year = yearMap.get(label);
    if (year?.schoolSettingsSnapshot) {
      const parsed = parseSnapshot(year.schoolSettingsSnapshot);
      if (parsed) {
        result.set(label, { ...parsed, district: "" });
        continue;
      }
    }
    result.set(label, { ...liveFallback, district: "" });
  }

  return result;
}
