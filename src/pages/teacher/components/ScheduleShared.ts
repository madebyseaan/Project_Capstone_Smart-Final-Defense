import type { ScheduleEntryDto, ScheduleSpecialEvent } from "@/lib/api";

export type ScheduleEntry = ScheduleEntryDto;

export interface ClassSlot {
  type: "class";
  start: string;
  end: string;
  entries: Record<string, ScheduleEntry>;
  event?: ScheduleSpecialEvent | undefined;
}

export interface BreakSlot {
  type: "break";
  start: string;
  end: string;
  eventName: string;
  breakType: "recess" | "lunch" | "other";
  durationMin: number;
  days: string[];
}

export type TimeSlot = ClassSlot | BreakSlot;

export const DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"] as const;

export const DAY_LABELS: Record<string, string> = {
  MONDAY: "Monday",
  TUESDAY: "Tuesday",
  WEDNESDAY: "Wednesday",
  THURSDAY: "Thursday",
  FRIDAY: "Friday",
};

export const DAY_SHORT: Record<string, string> = {
  MONDAY: "Mon",
  TUESDAY: "Tue",
  WEDNESDAY: "Wed",
  THURSDAY: "Thu",
  FRIDAY: "Fri",
};

export const gradeLevelLabels: Record<string, string> = {
  GRADE_7: "Grade 7",
  GRADE_8: "Grade 8",
  GRADE_9: "Grade 9",
  GRADE_10: "Grade 10",
};

export function getGradeColors(gradeLevel: string) {
  switch (gradeLevel) {
    case "GRADE_7":
      return {
        badge:
          "bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/20",
        cell:
          "bg-emerald-50/40 border-emerald-200 hover:bg-emerald-50 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:hover:bg-emerald-500/15",
        dot: "bg-emerald-400", accent: "border-l-emerald-400 dark:border-l-emerald-500",
        text: "text-emerald-800 dark:text-emerald-200",
      };
    case "GRADE_8":
      return {
        badge:
          "bg-amber-50 text-amber-700 border-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/20",
        cell:
          "bg-amber-50/40 border-amber-200 hover:bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/20 dark:hover:bg-amber-500/15",
        dot: "bg-amber-400", accent: "border-l-amber-400 dark:border-l-amber-500",
        text: "text-amber-800 dark:text-amber-200",
      };
    case "GRADE_9":
      return {
        badge:
          "bg-rose-50 text-rose-700 border-rose-100 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/20",
        cell:
          "bg-rose-50/40 border-rose-200 hover:bg-rose-50 dark:bg-rose-500/10 dark:border-rose-500/20 dark:hover:bg-rose-500/15",
        dot: "bg-rose-400", accent: "border-l-rose-400 dark:border-l-rose-500",
        text: "text-rose-800 dark:text-rose-200",
      };
    case "GRADE_10":
      return {
        badge:
          "bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/20",
        cell:
          "bg-blue-50/40 border-blue-200 hover:bg-blue-50 dark:bg-blue-500/10 dark:border-blue-500/20 dark:hover:bg-blue-500/15",
        dot: "bg-blue-400", accent: "border-l-blue-400 dark:border-l-blue-500",
        text: "text-blue-800 dark:text-blue-200",
      };
    default:
      return {
        badge:
          "bg-indigo-50 text-indigo-700 border-indigo-100 dark:bg-indigo-500/10 dark:text-indigo-300 dark:border-indigo-500/20",
        cell:
          "bg-indigo-50/40 border-indigo-200 hover:bg-indigo-50 dark:bg-indigo-500/10 dark:border-indigo-500/20 dark:hover:bg-indigo-500/15",
        dot: "bg-indigo-400", accent: "border-l-indigo-400 dark:border-l-indigo-500",
        text: "text-indigo-800 dark:text-indigo-200",
      };
  }
}

export function formatGradeShort(gradeLevel: string): string {
  const map: Record<string, string> = {
    GRADE_7: "G7",
    GRADE_8: "G8",
    GRADE_9: "G9",
    GRADE_10: "G10",
  };
  return map[gradeLevel] ?? gradeLevel;
}

export function formatSectionLabel(gradeLevel: string, sectionName: string): string {
  return `${gradeLevelLabels[gradeLevel] ?? gradeLevel} - ${sectionName}`;
}

const ABBREVIATIONS: Record<string, string> = {
  "Environmental Science": "Env. Science",
  "Applied Chemistry": "App. Chemistry",
  "Physical Science": "Phys. Science",
  "General Science": "Gen. Science",
  "Earth Science": "Earth Sci.",
  "Life Science": "Life Sci.",
  "Social Studies": "Social Std.",
  Filipino: "Filipino",
  "Araling Panlipunan": "Aral. Pan.",
  "Edukasyon sa Pagpapakatao": "ESP",
  "Technology and Livelihood Education": "TLE",
  "Understanding Culture Society and Politics": "UCSP",
  "Komunikasyon at Pananaliksik": "Kom. Pan.",
  "Reading and Writing Skills": "Read & Write",
  "Contemporary Arts": "Contemp. Arts",
  "Media and Information Literacy": "MIL",
  "Physical Education": "P.E.",
  Mathematics: "Math",
  English: "English",
  Science: "Science",
};

export function stripGradeSuffix(name: string): string {
  return name.replace(/\s*\d+$/, "").trim();
}

export function shortenSubject(name: string): string {
  if (name.length <= 15) return name;
  for (const [full, short] of Object.entries(ABBREVIATIONS)) {
    if (name.startsWith(full)) {
      return name.replace(full, short);
    }
  }
  return name;
}

export function getDayKey(): string {
  const day = new Date().getDay();
  const map = ["", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "", ""];
  return map[day] ?? "";
}

export function formatTime12h(time24: string): string {
  const [h, m] = time24.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

export function formatTimeRange(start: string, end: string): string {
  const startLabel = formatTime12h(start);
  const endLabel = formatTime12h(end);
  const startPeriod = startLabel.slice(-2);
  const endPeriod = endLabel.slice(-2);
  if (startPeriod === endPeriod) {
    return `${startLabel.slice(0, -3)}–${endLabel}`;
  }
  return `${startLabel} – ${endLabel}`;
}

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

const BREAK_THRESHOLD_MIN = 15;

export function classifyBreak(eventName: string): BreakSlot["breakType"] {
  const n = eventName.toLowerCase();
  if (n.includes("lunch")) return "lunch";
  if (n.includes("health") || n.includes("recess")) return "recess";
  return "other";
}

export function getTimeSlots(
  entries: ScheduleEntry[],
  specialEvents: ScheduleSpecialEvent[],
  contractSlots: { startTime: string; endTime: string }[],
): TimeSlot[] {
  const slotMap = new Map<string, ClassSlot>();
  for (const entry of entries) {
    const key = `${entry.startTime}-${entry.endTime}`;
    if (!slotMap.has(key)) {
      slotMap.set(key, { type: "class", start: entry.startTime, end: entry.endTime, entries: {} });
    }
    slotMap.get(key)!.entries[entry.day.toUpperCase()] = entry;
  }

  const result: TimeSlot[] = [];

  if (specialEvents.length > 0) {
    const breakRows = new Map<string, BreakSlot>();
    for (const evt of specialEvents) {
      const key = `${evt.startTime}-${evt.endTime}`;
      const existing = breakRows.get(key);
      if (existing) {
        existing.days = [...new Set([...existing.days, ...evt.days])];
        continue;
      }
      breakRows.set(key, {
        type: "break",
        start: evt.startTime,
        end: evt.endTime,
        eventName: evt.eventName,
        breakType: classifyBreak(evt.eventName),
        durationMin: timeToMinutes(evt.endTime) - timeToMinutes(evt.startTime),
        days: [...evt.days],
      });
    }

    const windowKeys = new Set<string>([
      ...slotMap.keys(),
      ...breakRows.keys(),
      ...contractSlots.map((s) => `${s.startTime}-${s.endTime}`),
    ]);
    for (const key of windowKeys) {
      const classSlot = slotMap.get(key);
      const breakSlot = breakRows.get(key);
      if (classSlot) {
        if (breakSlot) {
          classSlot.event = specialEvents.find(
            (e) => e.startTime === breakSlot.start && e.endTime === breakSlot.end,
          );
        }
        result.push(classSlot);
      } else if (breakSlot) {
        result.push(breakSlot);
      }
    }
    return result.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  }

  const classSlots = Array.from(slotMap.values()).sort((a, b) => a.start.localeCompare(b.start));
  if (classSlots.length === 0) return [];

  result.push(classSlots[0]);
  for (let i = 1; i < classSlots.length; i++) {
    const prevEnd = timeToMinutes(classSlots[i - 1].end);
    const nextStart = timeToMinutes(classSlots[i].start);
    const gap = nextStart - prevEnd;

    if (gap >= BREAK_THRESHOLD_MIN) {
      const breakType = gap >= 45 ? "lunch" : "recess";
      result.push({
        type: "break",
        start: classSlots[i - 1].end,
        end: classSlots[i].start,
        eventName: breakType === "lunch" ? "Lunch Break" : "Recess",
        breakType,
        durationMin: gap,
        days: [...DAYS],
      });
    }
    result.push(classSlots[i]);
  }

  return result;
}

export function roomDisplay(entry: ScheduleEntry): { text: string; title: string } | null {
  if (entry.roomLabel) {
    return {
      text: entry.roomLabel,
      title: entry.roomBuilding ? `${entry.roomLabel} — ${entry.roomBuilding}` : entry.roomLabel,
    };
  }
  if (entry.roomId != null) {
    return { text: "Room", title: `ATLAS room id ${entry.roomId} — name not mapped yet` };
  }
  return null;
}

