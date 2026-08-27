import { TransmutationEntry } from "@prisma/client";

export interface TransmutationInput {
  minGrade: number;
  maxGrade: number;
  transmutedGrade: number;
}

const EPSILON = 0.005; // tolerance for 2-decimal float comparisons
const MIN_BOUND = 0;
const MAX_BOUND = 100;
const STEP = 0.01;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Validates a full transmutation table (sorted by minGrade).
 *
 * Rules:
 * - Non-empty
 * - Each entry: numeric values, 0 <= minGrade <= maxGrade <= 100
 * - transmutedGrade is an integer within bounds
 * - First range starts at 0, last range ends at 100 (full coverage)
 * - Ranges are contiguous (next minGrade === current maxGrade + 0.01)
 * - Ranges do not overlap
 *
 * @returns null when valid, otherwise a human-readable error message.
 */
export function validateTransmutationEntries(entries: TransmutationInput[]): string | null {
  if (!Array.isArray(entries) || entries.length === 0) {
    return "entries array is required and must not be empty";
  }

  const rows = entries.map((e) => ({
    minGrade: round2(Number(e.minGrade)),
    maxGrade: round2(Number(e.maxGrade)),
    transmutedGrade: Number(e.transmutedGrade),
  }));

  for (const e of rows) {
    if (
      !Number.isFinite(e.minGrade) ||
      !Number.isFinite(e.maxGrade) ||
      !Number.isFinite(e.transmutedGrade)
    ) {
      return `Invalid numeric value in entry (min=${e.minGrade}, max=${e.maxGrade}, transmuted=${e.transmutedGrade})`;
    }
    if (e.minGrade < MIN_BOUND || e.maxGrade > MAX_BOUND || e.minGrade > e.maxGrade) {
      return `Entry ${e.minGrade.toFixed(2)} → ${e.maxGrade.toFixed(2)} is invalid: grades must satisfy ${MIN_BOUND} ≤ min ≤ max ≤ ${MAX_BOUND}`;
    }
    if (!Number.isInteger(e.transmutedGrade) || e.transmutedGrade < 0 || e.transmutedGrade > 100) {
      return `Entry ${e.minGrade.toFixed(2)} → ${e.maxGrade.toFixed(2)}: transmuted grade must be an integer between 0 and 100`;
    }
  }

  const sorted = [...rows].sort((a, b) => a.minGrade - b.minGrade);

  if (Math.abs(sorted[0].minGrade - MIN_BOUND) > EPSILON) {
    return `Table must start at ${MIN_BOUND.toFixed(2)} (first minGrade is ${sorted[0].minGrade.toFixed(2)})`;
  }
  const last = sorted[sorted.length - 1];
  if (Math.abs(last.maxGrade - MAX_BOUND) > EPSILON) {
    return `Table must end at ${MAX_BOUND.toFixed(2)} (last maxGrade is ${last.maxGrade.toFixed(2)})`;
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const curr = sorted[i];
    const next = sorted[i + 1];
    const expectedNextMin = round2(curr.maxGrade + STEP);
    if (next.minGrade < expectedNextMin - EPSILON) {
      return `Overlap detected: range ${next.minGrade.toFixed(2)} → ${next.maxGrade.toFixed(2)} overlaps previous range ending at ${curr.maxGrade.toFixed(2)}`;
    }
    if (next.minGrade > expectedNextMin + EPSILON) {
      return `Gap detected between ${curr.maxGrade.toFixed(2)} and ${next.minGrade.toFixed(2)} — grades in this gap would transmute to 60`;
    }
  }

  return null;
}

/**
 * Validates a table after adding/replacing/removing a single row.
 *
 * @param existing current rows in the DB
 * @param changed the row being added or updated, or null when deleting
 * @param changedId id of the row being updated/deleted (optional)
 */
export function validateTransmutationRowChange(
  existing: TransmutationEntry[],
  changed: TransmutationInput | null,
  changedId?: string
): string | null {
  const merged: TransmutationInput[] = existing
    .filter((e) => (changedId ? e.id !== changedId : true))
    .map((e) => ({
      minGrade: e.minGrade,
      maxGrade: e.maxGrade,
      transmutedGrade: e.transmutedGrade,
    }));
  if (changed) {
    merged.push(changed);
  }
  return validateTransmutationEntries(merged);
}
