/**
 * admin.ts — Zod schemas for admin management endpoints
 */

import { z } from 'zod';

const roleEnum = z.enum(['TEACHER', 'ADMIN', 'REGISTRAR']);

export const userCreateSchema = z.object({
  body: z.object({
    username: z.string().min(1, 'Username is required').max(50),
    password: z.string().min(6, 'Password must be at least 6 characters').max(128),
    role: roleEnum,
    firstName: z.string().min(1, 'First name is required').max(100),
    lastName: z.string().min(1, 'Last name is required').max(100),
    email: z.string().email('Invalid email format').max(255),
    employeeId: z.string().max(50).optional(),
    specialization: z.string().max(100).optional(),
  }),
});

export const userUpdateSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'id is required'),
  }),
  body: z.object({
    username: z.string().min(1).max(50).optional(),
    password: z.string().min(6).max(128).optional(),
    role: roleEnum.optional(),
    firstName: z.string().min(1).max(100).optional(),
    lastName: z.string().min(1).max(100).optional(),
    email: z.string().email().max(255).optional(),
    employeeId: z.string().max(50).optional(),
    specialization: z.string().max(100).optional(),
  }),
});

export const userDeleteSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'id is required'),
  }),
});

export const userSuspendSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'id is required'),
  }),
  body: z.object({
    reason: z.string().min(1, 'Reason is required').max(500),
  }),
});

export const settingsUpdateSchema = z.object({
  body: z.object({
    schoolName: z.string().max(200).optional(),
    schoolId: z.string().max(50).optional(),
    division: z.string().max(100).optional(),
    region: z.string().max(100).optional(),
    address: z.string().max(300).optional(),
    contactNumber: z.string().max(20).optional(),
    email: z.string().email().max(255).optional(),
    currentSchoolYear: z.string().max(20).optional(),
    schoolYearId: z.string().optional(),
    currentTerm: z.enum(['T1', 'T2', 'T3']).optional(),
    primaryColor: z.string().max(7).optional(),
    secondaryColor: z.string().max(7).optional(),
    accentColor: z.string().max(7).optional(),
    sessionTimeout: z.number().min(5).max(1440).optional(),
    maxLoginAttempts: z.number().min(1).max(20).optional(),
    passwordMinLength: z.number().min(4).max(32).optional(),
    requireSpecialChar: z.boolean().optional(),
    autoAdvanceTerm: z.boolean().optional(),
  }),
});

export const colorSettingsSchema = z.object({
  body: z.object({
    primaryColor: z.string().max(7),
    secondaryColor: z.string().max(7),
    accentColor: z.string().max(7),
  }),
});

export const gradeLockSchema = z.object({
  body: z.object({
    locked: z.boolean(),
  }),
});

export const gradingConfigSchema = z.object({
  params: z.object({
    subjectType: z.string().min(1, 'subjectType is required'),
  }),
  body: z.object({
    writtenWorkWeight: z.number().min(0).max(100),
    performanceTaskWeight: z.number().min(0).max(100),
    quarterlyAssessWeight: z.number().min(0).max(100),
  }),
});

export const classAssignmentCreateSchema = z.object({
  body: z.object({
    teacherId: z.string().min(1, 'teacherId is required'),
    subjectId: z.string().min(1, 'subjectId is required'),
    sectionId: z.string().min(1, 'sectionId is required'),
    schoolYear: z.string().min(1, 'schoolYear is required'),
  }),
});

export const archiveYearSchema = z.object({
  body: z.object({
    schoolYear: z.string().min(1, 'schoolYear is required'),
  }),
});
