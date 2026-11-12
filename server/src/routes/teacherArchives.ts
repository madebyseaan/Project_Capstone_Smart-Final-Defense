/**
 * routes/teacherArchives.ts
 *
 * Teacher self-service, read-only access to their own per-year archives.
 * Ownership is enforced from the JWT user id; teachers can never read another
 * teacher's bundle.
 */

import { Router, Response } from "express";
import { AuditAction, Prisma } from "@prisma/client";
import { authenticateToken, AuthRequest, authorizeRoles } from "../middleware/auth";
import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";
import { createAuditLog } from "../lib/audit";
import { deserializeTeacherArchive } from "../lib/teacherYearArchive";
import { buildTeacherYearArchiveWorkbook } from "../lib/teacherYearArchiveExcel";

const router = Router();

const METADATA_SELECT = {
  id: true,
  schoolYearId: true,
  schoolYear: true,
  teacherId: true,
  teacherUserId: true,
  employeeId: true,
  teacherName: true,
  status: true,
  schemaVersion: true,
  encoding: true,
  rawBytes: true,
  compressedBytes: true,
  checksum: true,
  stats: true,
  dataQuality: true,
  source: true,
  createdAt: true,
  completedAt: true,
  updatedAt: true,
} satisfies Prisma.TeacherYearArchiveSelect;

function safeFilenamePart(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || "teacher";
}

function ownArchiveWhere(
  userId: string,
  teacherId: string | null,
): Prisma.TeacherYearArchiveWhereInput {
  return {
    status: "COMPLETE",
    OR: [
      { teacherUserId: userId },
      ...(teacherId ? [{ teacherId, teacherUserId: null }] : []),
    ],
  };
}

router.get(
  "/",
  authenticateToken,
  authorizeRoles("TEACHER"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const teacher = await prisma.teacher.findUnique({
        where: { userId: req.user!.id },
        select: { id: true },
      });
      const where = ownArchiveWhere(req.user!.id, teacher?.id ?? null);

      const archives = await prisma.teacherYearArchive.findMany({
        where,
        select: METADATA_SELECT,
        orderBy: [{ schoolYear: "desc" }, { teacherName: "asc" }],
      });

      res.json({
        archives,
        totals: {
          count: archives.length,
          rawBytes: archives.reduce((sum, row) => sum + (row.rawBytes ?? 0), 0),
          compressedBytes: archives.reduce((sum, row) => sum + (row.compressedBytes ?? 0), 0),
        },
      });
    } catch (error) {
      logger.error("[TeacherArchive] Teacher list failed:", error);
      res.status(500).json({ message: "Failed to load your archives" });
    }
  },
);

router.get(
  "/:id/classes",
  authenticateToken,
  authorizeRoles("TEACHER"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const teacher = await prisma.teacher.findUnique({
        where: { userId: req.user!.id },
        select: { id: true },
      });
      const where = ownArchiveWhere(req.user!.id, teacher?.id ?? null);

      const row = await prisma.teacherYearArchive.findFirst({
        where: { ...where, id: String(req.params.id) },
        select: { id: true, schoolYear: true, teacherName: true, payload: true },
      });

      if (!row || !row.payload) {
        res.status(404).json({ message: "Archive not found" });
        return;
      }

      const payload = deserializeTeacherArchive(row) as Record<string, unknown>;
      const assignments = Array.isArray(payload.classAssignments)
        ? (payload.classAssignments as Array<Record<string, unknown>>)
        : [];
      const sections = Array.isArray(payload.sections)
        ? (payload.sections as Array<Record<string, unknown>>)
        : [];
      const grades = Array.isArray(payload.grades)
        ? (payload.grades as Array<Record<string, unknown>>)
        : [];

      const sectionNameById = new Map(
        sections.map((section) => [String(section.id), String(section.name ?? "")]),
      );
      const termsByAssignment = new Map<string, Set<string>>();
      for (const grade of grades) {
        const assignmentId = String(grade.classAssignmentId ?? "");
        const term = String(grade.term ?? "");
        if (!assignmentId || !term) continue;
        if (!termsByAssignment.has(assignmentId)) termsByAssignment.set(assignmentId, new Set());
        termsByAssignment.get(assignmentId)!.add(term);
      }

      const classRecords = assignments.map((assignment) => {
        const subject = (assignment.subject ?? {}) as Record<string, unknown>;
        return {
          classAssignmentId: String(assignment.id),
          subjectCode: String(subject.code ?? ""),
          subjectName: String(subject.displayName || subject.name || subject.code || ""),
          sectionId: String(assignment.sectionId ?? ""),
          sectionName: sectionNameById.get(String(assignment.sectionId ?? "")) ?? "",
          teachingMinutes: typeof assignment.teachingMinutes === "number" ? assignment.teachingMinutes : null,
          terms: [...(termsByAssignment.get(String(assignment.id)) ?? new Set<string>())].sort(),
        };
      });

      classRecords.sort((a, b) => {
        const subject = a.subjectName.localeCompare(b.subjectName);
        return subject !== 0 ? subject : a.sectionName.localeCompare(b.sectionName);
      });

      res.json({
        archive: { id: row.id, schoolYear: row.schoolYear, teacherName: row.teacherName },
        classes: classRecords,
      });
    } catch (error) {
      logger.error("[TeacherArchive] Class record list failed:", error);
      res.status(500).json({ message: "Failed to load class records" });
    }
  },
);

router.get(
  "/:id/download",
  authenticateToken,
  authorizeRoles("TEACHER"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const teacher = await prisma.teacher.findUnique({
        where: { userId: req.user!.id },
        select: { id: true },
      });
      const where = ownArchiveWhere(req.user!.id, teacher?.id ?? null);

      const row = await prisma.teacherYearArchive.findFirst({
        where: { ...where, id: String(req.params.id) },
        select: {
          id: true,
          schoolYear: true,
          teacherName: true,
          employeeId: true,
          status: true,
          encoding: true,
          checksum: true,
          payload: true,
        },
      });

      if (!row || row.status !== "COMPLETE" || !row.payload) {
        res.status(404).json({ message: "Archive not found" });
        return;
      }

      const base = safeFilenamePart(row.employeeId || row.teacherName);
      const format = String(req.query.format ?? "xlsx").toLowerCase();
      const isGzip = format === "json.gz" || format === "gz";
      const isXlsx = format === "xlsx" || format === "excel";

      if (isGzip) {
        res.setHeader("Content-Type", "application/gzip");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="TeacherArchive_${safeFilenamePart(row.schoolYear)}_${base}.json.gz"`,
        );
        res.send(Buffer.from(row.payload));
      } else if (isXlsx) {
        const payload = deserializeTeacherArchive(row) as Record<string, unknown>;
        const workbook = buildTeacherYearArchiveWorkbook(payload);
        const buffer = await workbook.xlsx.writeBuffer();
        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="TeacherArchive_${safeFilenamePart(row.schoolYear)}_${base}.xlsx"`,
        );
        res.send(Buffer.from(buffer));
      } else {
        const payload = deserializeTeacherArchive(row);
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="TeacherArchive_${safeFilenamePart(row.schoolYear)}_${base}.json"`,
        );
        res.send(JSON.stringify(payload, null, 2));
      }

      await createAuditLog(
        AuditAction.CONFIG,
        req.user!,
        `Teacher Archive Self-Download: ${row.schoolYear}`,
        "Export",
        `Teacher downloaded their own ${format === "xlsx" ? "Excel " : format === "json.gz" ? "gzip " : ""}archive ${row.id}`,
        req.ip,
      );
    } catch (error) {
      logger.error("[TeacherArchive] Teacher download failed:", error);
      if (!res.headersSent) res.status(500).json({ message: "Failed to download your archive" });
    }
  },
);

export default router;
