/**
 * termLockPolicy.ts — RL-3a lock rules for the hourly auto-term scheduler.
 *
 * The scheduler locks terms whose LOCAL end dates have passed. Local term dates
 * are a single global set on SystemSettings, so immediately after a school-year
 * rollover they still hold the OUTGOING year's dates. Without these rules the
 * scheduler locks T2/T3 (and the whole year) of the NEW year as soon as it runs.
 *
 * Rules:
 *  - A term may be locked only if its end date passed AND it comes strictly
 *    BEFORE EnrollPro's active term. The active term is never locked (existing
 *    behavior), and future terms cannot have ended.
 *  - When EnrollPro's active term is unknown (offline/demo), fall back to the
 *    legacy date-based locking.
 *  - The year may be locked only when T3 is genuinely over: T3 end date passed
 *    and EnrollPro reports T3 (or is unknown).
 */

const TERM_ORDER = ["T1", "T2", "T3"] as const;
export type TermName = (typeof TERM_ORDER)[number];

export function termIndex(term: string | null | undefined): number {
  if (!term) return -1;
  return TERM_ORDER.indexOf(term.toUpperCase() as TermName);
}

export function shouldLockTerm(
  term: string,
  endDate: Date | null | undefined,
  now: Date,
  enrollProActiveTerm: string | null,
): boolean {
  if (!endDate) return false;
  if (now <= endDate) return false;

  const activeIdx = termIndex(enrollProActiveTerm);
  if (activeIdx < 0) return true; // fallback: unknown active term → date-based

  return termIndex(term) < activeIdx;
}

/**
 * True when a term must NOT be locked because it is the active term or a
 * future term. Used to auto-unlock terms that a stale schedule locked.
 */
export function shouldBeUnlockedTerm(term: string, enrollProActiveTerm: string | null): boolean {
  const activeIdx = termIndex(enrollProActiveTerm);
  if (activeIdx < 0) return false;
  return termIndex(term) >= activeIdx;
}

export function shouldLockYear(
  t3EndDate: Date | null | undefined,
  now: Date,
  enrollProActiveTerm: string | null,
): boolean {
  if (!t3EndDate) return false;
  if (now <= t3EndDate) return false;

  const active = enrollProActiveTerm?.toUpperCase();
  if (!active || termIndex(active) < 0) return true; // fallback: date-based

  // The year is over only when EnrollPro also reports T3.
  return active === "T3";
}
