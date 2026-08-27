/**
 * templates.ts — Zod schemas for template management endpoints
 */

import { z } from 'zod';

const formTypeEnum = z.enum([
  'SF1', 'SF2', 'SF3', 'SF4', 'SF5', 'SF6', 'SF7', 'SF8', 'SF9', 'SF10',
  'SF11', 'SF12', 'SF13', 'SF14', 'SF15',
]);

export const templateUploadSchema = z.object({
  body: z.object({
    formType: z.union([formTypeEnum, z.array(formTypeEnum)]),
    formName: z.string().min(1, 'Form name is required').max(200),
    description: z.string().max(500).optional(),
    instructions: z.string().max(1000).optional(),
    uploadMode: z.enum(['replace', 'add']).optional(),
  }),
});

export const templateToggleSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'id is required'),
  }),
});

export const templateDeleteSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'id is required'),
  }),
});
