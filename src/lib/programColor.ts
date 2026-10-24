export const REGULAR_PROGRAM = "REGULAR";

const PROGRAM_ALIASES: Array<[RegExp, string]> = [
  [/^REG(ULAR)?$/, "REGULAR"],
  [/ARTS/, "SPA"],
  [/SPORT/, "SPS"],
  [/SCIENCE|ENGINEERING|ESEP|^STE$/, "STE"],
  [/SPECIAL ED|SPED|SNED/, "SPED"],
  [/FOREIGN LANGUAGE|SPFL/, "SPFL"],
  [/JOURNALISM|SPJ/, "SPJ"],
  [/OPEN HIGH SCHOOL|OHSP/, "OHSP"],
  [/TECHNICAL|VOCATIONAL|SPTVE/, "SPTVE"],
];

export function normalizeProgram(program?: string | null): string {
  const raw = String(program ?? "").trim().toUpperCase();
  if (!raw) return REGULAR_PROGRAM;
  for (const [pattern, code] of PROGRAM_ALIASES) {
    if (pattern.test(raw)) return code;
  }
  return raw;
}

const PROGRAM_BADGE_CLASSES: Record<string, string> = {
  STE: "border-[var(--program-1)]/30 bg-[var(--program-1-bg)] text-[var(--program-1)]",
  SPA: "border-[var(--program-2)]/30 bg-[var(--program-2-bg)] text-[var(--program-2)]",
  SPS: "border-[var(--program-3)]/30 bg-[var(--program-3-bg)] text-[var(--program-3)]",
  SPED: "border-[var(--program-4)]/30 bg-[var(--program-4-bg)] text-[var(--program-4)]",
  SPJ: "border-[var(--program-5)]/30 bg-[var(--program-5-bg)] text-[var(--program-5)]",
  SPFL: "border-[var(--program-6)]/30 bg-[var(--program-6-bg)] text-[var(--program-6)]",
  SPTVE: "border-[var(--program-7)]/30 bg-[var(--program-7-bg)] text-[var(--program-7)]",
  OHSP: "border-[var(--program-9)]/30 bg-[var(--program-9-bg)] text-[var(--program-9)]",
};

const FALLBACK_BADGE_CLASSES = [
  "border-[var(--program-1)]/30 bg-[var(--program-1-bg)] text-[var(--program-1)]",
  "border-[var(--program-2)]/30 bg-[var(--program-2-bg)] text-[var(--program-2)]",
  "border-[var(--program-3)]/30 bg-[var(--program-3-bg)] text-[var(--program-3)]",
  "border-[var(--program-4)]/30 bg-[var(--program-4-bg)] text-[var(--program-4)]",
  "border-[var(--program-5)]/30 bg-[var(--program-5-bg)] text-[var(--program-5)]",
  "border-[var(--program-6)]/30 bg-[var(--program-6-bg)] text-[var(--program-6)]",
  "border-[var(--program-7)]/30 bg-[var(--program-7-bg)] text-[var(--program-7)]",
  "border-[var(--program-8)]/30 bg-[var(--program-8-bg)] text-[var(--program-8)]",
  "border-[var(--program-9)]/30 bg-[var(--program-9-bg)] text-[var(--program-9)]",
  "border-[var(--program-10)]/30 bg-[var(--program-10-bg)] text-[var(--program-10)]",
];

function hashProgram(code: string): number {
  let hash = 0;
  for (let i = 0; i < code.length; i++) {
    hash = (hash * 31 + code.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % FALLBACK_BADGE_CLASSES.length;
}

export function getProgramBadgeClass(program?: string | null): string {
  const code = normalizeProgram(program);
  if (code === REGULAR_PROGRAM) {
    return "border-[var(--program-reg)]/30 bg-[var(--program-reg-bg)] text-[var(--program-reg)]";
  }
  return PROGRAM_BADGE_CLASSES[code] ?? FALLBACK_BADGE_CLASSES[hashProgram(code)];
}
