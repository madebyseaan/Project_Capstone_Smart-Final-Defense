/**
 * documents.ts — Batched document-availability index for former students.
 *
 * Read-only. Powers the registrar Records Vault so the UI only requests
 * documents that actually exist (avoids speculative 404s, which the e2e
 * smoke gate counts as regressions).
 *
 * REGISTRAR-only. No schema changes.
 */

import { Router, Response } from "express";
import { authenticateToken, AuthRequest } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { documentsIndexSchema } from "../../schemas/registrar";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";

export interface DocumentsIndexEntry {
  /** SMART Student record exists (SF10 can be built). */
  sf10: boolean;
  /** School years the learner has an enrollment for (SF9 candidates). */
  reportCardYears: string[];
  /** Saved prior-school (external) records, e.g. scanned SF10 from another school. */
  priorRecords: number;
  /** Any remedial record attached to the learner's enrollments. */
  remedial: boolean;
}

export default function registerDocumentRoutes(router: Router): void {
  router.post(
    "/students/documents-index",
    authenticateToken,
    validate(documentsIndexSchema),
    async (req: AuthRequest, res: Response): Promise<void> => {
      const user = req.user;
      if (!user || user.role !== "REGISTRAR") {
        res.status(403).json({ message: "Access denied. Registrar only." });
        return;
      }

      try {
        const requested = (req.body as { studentIds: string[] }).studentIds;
        const unique = Array.from(new Set(requested));
        // EnrollPro-only alumni use synthetic ids ("ep-<lrn>") that are not
        // SMART Student rows — report them as unavailable, never query them.
        const smartIds = unique.filter((id) => !id.startsWith("ep-"));

        const index: Record<string, DocumentsIndexEntry> = {};
        for (const id of unique) {
          index[id] = { sf10: false, reportCardYears: [], priorRecords: 0, remedial: false };
        }

        if (smartIds.length > 0) {
          const [students, enrollments, externalCounts, remedialRows] = await Promise.all([
            prisma.student.findMany({
              where: { id: { in: smartIds } },
              select: { id: true },
            }),
            prisma.enrollment.findMany({
              where: { studentId: { in: smartIds } },
              select: { studentId: true, schoolYear: true },
            }),
            prisma.externalSchoolRecord.groupBy({
              by: ["studentId"],
              where: { studentId: { in: smartIds } },
              _count: { _all: true },
            }),
            prisma.remedialClass.findMany({
              where: { enrollment: { studentId: { in: smartIds } } },
              select: { enrollment: { select: { studentId: true } } },
            }),
          ]);

          const studentSet = new Set(students.map((s) => s.id));
          const yearsByStudent = new Map<string, Set<string>>();
          for (const enrollment of enrollments) {
            const years = yearsByStudent.get(enrollment.studentId) ?? new Set<string>();
            years.add(enrollment.schoolYear);
            yearsByStudent.set(enrollment.studentId, years);
          }
          const priorByStudent = new Map(externalCounts.map((c) => [c.studentId, c._count._all]));
          const remedialSet = new Set(remedialRows.map((r) => r.enrollment.studentId));

          for (const id of smartIds) {
            index[id] = {
              sf10: studentSet.has(id),
              reportCardYears: Array.from(yearsByStudent.get(id) ?? []).sort(),
              priorRecords: priorByStudent.get(id) ?? 0,
              remedial: remedialSet.has(id),
            };
          }
        }

        res.json({ index });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "unknown error";
        logger.error("[registrar/documents-index]", message);
        res.status(500).json({ message: "Failed to build documents index" });
      }
    },
  );
}
