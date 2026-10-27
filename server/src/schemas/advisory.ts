import { z } from "zod";

const sf9Query = z.object({
  term: z.enum(["T1", "T2", "T3"]).optional(),
  schoolYear: z
    .string()
    .regex(/^\d{4}-\d{4}$/, "schoolYear must use YYYY-YYYY format")
    .optional(),
});

export const advisorySf9QuerySchema = z.object({
  body: z.object({}).optional(),
  query: sf9Query,
  params: z.object({}).optional(),
});

export const advisorySf9StudentParamsSchema = z.object({
  body: z.object({}).optional(),
  query: sf9Query,
  params: z.object({ studentId: z.string().min(1) }),
});

export const advisoryObservedValuesQuerySchema = z.object({
  body: z.object({}).optional(),
  query: z.object({
    term: z.enum(["T1", "T2", "T3"]),
    schoolYear: z
      .string()
      .regex(/^\d{4}-\d{4}$/, "schoolYear must use YYYY-YYYY format")
      .optional(),
  }),
  params: z.object({}).optional(),
});

export const advisoryObservedValuesUpdateSchema = z.object({
  body: z.object({
    term: z.enum(["T1", "T2", "T3"]),
    schoolYear: z
      .string()
      .regex(/^\d{4}-\d{4}$/, "schoolYear must use YYYY-YYYY format")
      .optional(),
    values: z
      .array(
        z.object({
          behaviorCode: z.string().min(1),
          rating: z.enum(["AO", "SO", "RO", "NO"]),
        }),
      )
      .max(20),
  }),
  query: z.object({}).optional(),
  params: z.object({ studentId: z.string().min(1) }),
});
