/**
 * DEMO-only term management switch.
 *
 * When `DEMO_TERM_MODE=true`, SMART stops asking EnrollPro for the active term
 * and term dates, and lets an admin manage the term schedule locally. This is
 * intended for demos / development where EnrollPro's term configuration does
 * not cover the current calendar date.
 *
 * Default is OFF. When off, every code path behaves exactly as before
 * (EnrollPro remains the single source of truth).
 */
export function isDemoTermMode(): boolean {
  return process.env.DEMO_TERM_MODE === "true";
}
