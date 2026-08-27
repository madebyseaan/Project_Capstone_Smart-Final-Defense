/**
 * attendance.ts — Zod schemas for attendance endpoints
 */

import { z } from 'zod';

const attendanceStatusEnum = z.enum(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED']);

const attendanceRecordSchema = z.object({
  studentId: z.string().min(1, 'studentId is required'),
  status: attendanceStatusEnum,
});

export const attendanceBulkSchema = z.object({
  body: z.object({
    sectionId: z.string().min(1, 'sectionId is required'),
    date: z.string().min(1, 'date is required'),
    attendance: z.array(attendanceRecordSchema).min(1, 'At least one attendance record required'),
  }),
});

export const attendanceClearSchema = z.object({
  body: z.object({
    sectionId: z.string().min(1, 'sectionId is required'),
    date: z.string().min(1, 'date is required'),
  }),
});
