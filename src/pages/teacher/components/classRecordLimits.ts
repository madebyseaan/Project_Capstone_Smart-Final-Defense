export const MAX_WW_TASKS = 5;
export const MAX_PT_TASKS = 3;

export function taskLimitFor(category: "WW" | "PT"): number {
  return category === "WW" ? MAX_WW_TASKS : MAX_PT_TASKS;
}
