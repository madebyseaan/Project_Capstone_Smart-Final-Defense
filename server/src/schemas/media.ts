/**
 * media.ts — Zod schemas for EnrollPro photo proxy endpoints
 */

import { z } from 'zod';

export const mediaEntityTypeSchema = z.enum(['learner', 'student', 'teacher', 'personnel']);

const mediaIdSchema = z.union([
  z.string().trim().min(1).max(64),
  z.number().int().nonnegative(),
]);

export const mediaSingleParamsSchema = z.object({
  params: z.object({
    entityType: mediaEntityTypeSchema,
    id: z.string().trim().min(1).max(64),
  }),
});

export const mediaBatchBodySchema = z.object({
  body: z.object({
    items: z
      .array(
        z.object({
          entityType: mediaEntityTypeSchema,
          id: mediaIdSchema,
        }),
      )
      .min(1)
      .max(200),
  }),
});
