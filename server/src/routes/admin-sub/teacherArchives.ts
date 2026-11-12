/**
 * admin-sub/teacherArchives.ts
 *
 * Admin-only per-teacher year archive endpoints.
 * List/detail never select the compressed payload.
 */

import { Router, Response } from "express";
import { AuditAction, AuditSeverity, Prisma } from "@prisma/client";
import { authenticateToken, AuthRequest } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { createAuditLog } from "../../lib/audit";
import { requireAdmin } from "./helpers";
import {
  teacherArchiveBackfillSchema,
  teacherArchiveListSchema,
} from "../../schemas/admin";
import {
  collectExpectedTeachers,
  deserializeTeacherArchive,
  ensureTeacherArchivesQueued,
  generateTeacherYearArchives,
} from "../../lib/teacherYearArchive";
import { buildTeacherYearArchiveWorkbook } from "../../lib/teacherYearArchiveExcel";

const METADATA_SELECT = {
  id: true,
  schoolYearId: true,
  schoolYear: true,
  teacherId: true,
  teacherUserId: true,
  employeeId: true,
  teacherName: true,
  status: true,
  error: true,
  schemaVersion: true,
  encoding: true,
  rawBytes: true,
  compressedBytes: true,
  checksum: true,
  stats: true,
  dataQuality: true,
  source: true,
  createdBy: true,
  createdAt: true,
  completedAt: true,
  updatedAt: true,
} satisfies Prisma.TeacherYearArchiveSelect;

function safeFilenamePart(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || "teacher";
}

export default function (router: Router) {
  router.get(
    "/teacher-archives",
    authenticateToken,
    requireAdmin,
    validate(teacherArchiveListSchema),
    async (req: AuthRequest, res: Response): Promise<void> => {
      try {
        const query = req.query as {
          schoolYearId?: string;
          status?: "PENDING" | "COMPLETE" | "FAILED";
          search?: string;
          page?: number;
          pageSize?: number;
        };

        const year = query.schoolYearId
          ? await prisma.schoolYear.findUnique({ where: { id: query.schoolYearId } })
          : (await prisma.schoolYear.findFirst({
              where: { teacherYearArchives: { some: {} } },
              orderBy: { label: "desc" },
            })) ??
            (await prisma.schoolYear.findFirst({
              where: { status: { in: ["ARCHIVED", "COMPLETED"] } },
              orderBy: { label: "desc" },
            }));

        if (!year) {
          res.json({
            schoolYear: null,
            counts: {
              expectedTeachers: 0,
              complete: 0,
              pending: 0,
              failed: 0,
              total: 0,
              totalRawBytes: 0,
              totalCompressedBytes: 0,
            },
            pagination: { page: 1, pageSize: query.pageSize ?? 50, total: 0 },
            teachers: [],
          });
          return;
        }

        const page = query.page ?? 1;
        const pageSize = query.pageSize ?? 50;
        const where: Prisma.TeacherYearArchiveWhereInput = {
          schoolYearId: year.id,
          ...(query.status ? { status: query.status } : {}),
          ...(query.search
            ? {
                OR: [
                  { teacherName: { contains: query.search, mode: "insensitive" } },
                  { employeeId: { contains: query.search, mode: "insensitive" } },
                ],
              }
            : {}),
        };

        const [teachers, filteredTotal, coverageRows, expectedTeachers] = await Promise.all([
          prisma.teacherYearArchive.findMany({
            where,
            select: METADATA_SELECT,
            orderBy: [{ teacherName: "asc" }, { createdAt: "asc" }],
            skip: (page - 1) * pageSize,
            take: pageSize,
          }),
          prisma.teacherYearArchive.count({ where }),
          prisma.teacherYearArchive.findMany({
            where: { schoolYearId: year.id },
            select: { status: true, rawBytes: true, compressedBytes: true },
          }),
          collectExpectedTeachers(prisma, year.label),
        ]);

        const counts = {
          expectedTeachers: expectedTeachers.length,
          complete: coverageRows.filter((row) => row.status === "COMPLETE").length,
          pending: coverageRows.filter((row) => row.status === "PENDING").length,
          failed: coverageRows.filter((row) => row.status === "FAILED").length,
          total: coverageRows.length,
          totalRawBytes: coverageRows.reduce((sum, row) => sum + (row.rawBytes ?? 0), 0),
          totalCompressedBytes: coverageRows.reduce((sum, row) => sum + (row.compressedBytes ?? 0), 0),
        };

        res.json({
          schoolYear: {
            id: year.id,
            label: year.label,
            status: year.status,
            startDate: year.startDate,
            endDate: year.endDate,
            archivedAt: year.archivedAt,
          },
          counts,
          pagination: { page, pageSize, total: filteredTotal },
          teachers,
        });
      } catch (error) {
        logger.error("[TeacherArchive] List failed:", error);
        res.status(500).json({ message: "Failed to load teacher archives" });
      }
    },
  );

  router.get(
    "/teacher-archives/:id/download",
    authenticateToken,
    requireAdmin,
    async (req: AuthRequest, res: Response): Promise<void> => {
      try {
        const row = await prisma.teacherYearArchive.findUnique({
          where: { id: String(req.params.id) },
          select: {
            id: true,
            schoolYear: true,
            teacherName: true,
            employeeId: true,
            status: true,
            encoding: true,
            checksum: true,
            compressedBytes: true,
            payload: true,
          },
        });

        if (!row) {
          res.status(404).json({ message: "Teacher archive not found" });
          return;
        }
        if (row.status !== "COMPLETE" || !row.payload) {
          res.status(409).json({ message: `Teacher archive is not complete: ${row.status}` });
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
          `Teacher Archive Download: ${row.schoolYear} / ${row.teacherName}`,
          "Export",
          `Downloaded ${format === "json.gz" ? "gzip " : format === "xlsx" ? "Excel " : ""}teacher archive ${row.id}`,
          req.ip,
        );
      } catch (error) {
        logger.error("[TeacherArchive] Download failed:", error);
        if (!res.headersSent) res.status(500).json({ message: "Failed to download teacher archive" });
      }
    },
  );

  router.get(
    "/teacher-archives/:id",
    authenticateToken,
    requireAdmin,
    async (req: AuthRequest, res: Response): Promise<void> => {
      try {
        const row = await prisma.teacherYearArchive.findUnique({
          where: { id: String(req.params.id) },
          select: METADATA_SELECT,
        });
        if (!row) {
          res.status(404).json({ message: "Teacher archive not found" });
          return;
        }
        res.json({ teacher: row });
      } catch (error) {
        logger.error("[TeacherArchive] Detail failed:", error);
        res.status(500).json({ message: "Failed to load teacher archive" });
      }
    },
  );

  router.post(
    "/teacher-archives/backfill",
    authenticateToken,
    requireAdmin,
    validate(teacherArchiveBackfillSchema),
    async (req: AuthRequest, res: Response): Promise<void> => {
      try {
        const { schoolYearId, regenerate } = req.body as {
          schoolYearId: string;
          regenerate?: boolean;
        };

        const year = await prisma.schoolYear.findUnique({ where: { id: schoolYearId } });
        if (!year) {
          res.status(404).json({ message: "School year not found" });
          return;
        }
        if (!["ARCHIVED", "COMPLETED"].includes(year.status)) {
          res.status(400).json({ message: "Teacher archives can only be generated for archived years" });
          return;
        }

        const queued = await ensureTeacherArchivesQueued({
          schoolYearId: year.id,
          yearLabel: year.label,
          source: "BACKFILL",
          createdBy: req.user!.id,
        });
        const summary = await generateTeacherYearArchives(year.id, {
          regenerate: Boolean(regenerate),
          source: "BACKFILL",
          createdBy: req.user!.id,
        });

        await createAuditLog(
          AuditAction.CONFIG,
          req.user!,
          `Teacher Archives Backfill: ${year.label}`,
          "Export",
          `${regenerate ? "Regenerated" : "Generated"} teacher archives for ${year.label}: ` +
            `${summary.completed} complete, ${summary.failed} failed, ${summary.compressedBytes} compressed bytes`,
          req.ip,
          regenerate ? AuditSeverity.WARNING : AuditSeverity.INFO,
        );

        res.json({ queued, ...summary });
      } catch (error) {
        logger.error("[TeacherArchive] Backfill failed:", error);
        res.status(500).json({ message: "Failed to generate teacher archives" });
      }
    },
  );
}
