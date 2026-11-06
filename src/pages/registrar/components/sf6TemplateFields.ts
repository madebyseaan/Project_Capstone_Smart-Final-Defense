import type { Sf6Data, Sf6Descriptors, Sf6StatusCounts } from "@/lib/api";

type TemplateValue = string | number;

type GradeCounts = {
  promoted: number;
  conditional: number;
  retained: number;
  noGrades: number;
  male: Sf6StatusCounts;
  female: Sf6StatusCounts;
  descriptors: Sf6Descriptors;
};

const GRADE_TOKENS = [
  { gradeLevel: "GRADE_7", token: "G7" },
  { gradeLevel: "GRADE_8", token: "G8" },
  { gradeLevel: "GRADE_9", token: "G9" },
  { gradeLevel: "GRADE_10", token: "G10" },
] as const;

const STATUS_ROWS = ["PROMOTED", "CONDITIONAL", "RETAINED"] as const;
const DESCRIPTOR_ROWS = ["DNME", "FS", "S", "VS", "O"] as const;

function statusValue(counts: Sf6StatusCounts | undefined, token: (typeof STATUS_ROWS)[number]): number {
  if (!counts) return 0;
  if (token === "PROMOTED") return counts.promoted;
  if (token === "CONDITIONAL") return counts.conditional;
  return counts.retained;
}

function writeGradeTokens(
  fields: Record<string, TemplateValue>,
  prefix: string,
  grade: GradeCounts | undefined
): void {
  for (const status of STATUS_ROWS) {
    fields[`${prefix}_${status}_M`] = statusValue(grade?.male, status);
    fields[`${prefix}_${status}_F`] = statusValue(grade?.female, status);
    fields[`${prefix}_${status}_T`] =
      statusValue(grade, status);
  }

  for (const descriptor of DESCRIPTOR_ROWS) {
    const counts = grade?.descriptors?.[descriptor];
    fields[`${prefix}_${descriptor}_M`] = counts?.male ?? 0;
    fields[`${prefix}_${descriptor}_F`] = counts?.female ?? 0;
    fields[`${prefix}_${descriptor}_T`] = counts?.total ?? 0;
  }

  fields[`${prefix}_TOTAL_M`] =
    statusValue(grade?.male, "PROMOTED") +
    statusValue(grade?.male, "CONDITIONAL") +
    statusValue(grade?.male, "RETAINED");
  fields[`${prefix}_TOTAL_F`] =
    statusValue(grade?.female, "PROMOTED") +
    statusValue(grade?.female, "CONDITIONAL") +
    statusValue(grade?.female, "RETAINED");
  fields[`${prefix}_TOTAL_T`] =
    statusValue(grade, "PROMOTED") +
    statusValue(grade, "CONDITIONAL") +
    statusValue(grade, "RETAINED");
}

export function buildSf6TemplateFields(data: Sf6Data): Record<string, TemplateValue> {
  const fields: Record<string, TemplateValue> = {
    SCHOOL_ID: data.schoolSettings?.schoolId || "",
    SCHOOL_NAME: data.schoolSettings?.schoolName || "",
    REGION: data.schoolSettings?.region || "",
    DIVISION: data.schoolSettings?.division || "",
    DISTRICT: data.schoolSettings?.district || "",
    SCHOOL_YEAR: data.schoolYear || "",
  };

  for (const { gradeLevel, token } of GRADE_TOKENS) {
    writeGradeTokens(fields, token, data.byGradeLevel?.[gradeLevel]);
  }

  writeGradeTokens(fields, "TOTAL", data.summary);

  return fields;
}
