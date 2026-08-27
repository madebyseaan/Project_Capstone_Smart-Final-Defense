/**
 * integration.ts — Zod schemas for integration endpoints
 */

import { z } from 'zod';

export const aimsAuthSchema = z.object({
  body: z.object({
    aimsPassword: z.string().min(1, 'AIMS password is required'),
  }),
});
