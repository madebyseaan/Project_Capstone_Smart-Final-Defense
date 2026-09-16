/**
 * auth.ts — Zod schemas for authentication endpoints
 */

import { z } from 'zod';

export const loginSchema = z.object({
  body: z.object({
    email: z.string().min(1, 'Email is required').max(255),
    password: z.string().min(1, 'Password is required').max(128),
    // Optional expected portal — when present the authenticated role must match
    // (omitted for role-agnostic flows such as the companion SSO resume).
    portal: z.enum(['ADMIN', 'TEACHER', 'REGISTRAR']).optional(),
  }),
});

export const refreshSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(1, 'Refresh token is required'),
  }),
});
