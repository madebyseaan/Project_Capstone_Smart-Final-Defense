export interface MasteryDistribution {
  outstanding: number;
  verySatisfactory: number;
  satisfactory: number;
  fairlySatisfactory: number;
  didNotMeet: number;
}

export const MASTERY_SEGMENTS = [
  { key: "outstanding", label: "Advancing", color: "bg-emerald-500", stroke: "stroke-emerald-500" },
  { key: "verySatisfactory", label: "Benchmarking", color: "bg-blue-500", stroke: "stroke-blue-500" },
  { key: "satisfactory", label: "Connecting", color: "bg-amber-500", stroke: "stroke-amber-500" },
  { key: "fairlySatisfactory", label: "Developing", color: "bg-orange-500", stroke: "stroke-orange-500" },
  { key: "didNotMeet", label: "Emerging", color: "bg-rose-500", stroke: "stroke-rose-500" },
] as const;

export const SURFACE =
  "rounded-[1.4rem] border border-border/70 bg-card shadow-[0_10px_30px_-24px_rgba(15,23,42,0.28)]";

export const MEDAL_TONES = [
  "bg-amber-500/15 text-amber-600 ring-amber-500/20",
  "bg-slate-400/15 text-slate-500 ring-slate-400/20",
  "bg-orange-500/15 text-orange-600 ring-orange-500/20",
] as const;

export function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}
