import { Router, Request, Response } from "express";
import { Term } from "@prisma/client";
import { authenticateToken, AuthRequest } from "../../middleware/auth";
import { prisma } from "../../lib/prisma";
import { getActiveSchoolYearLabel } from "../../lib/schoolYearResolver";
import { logger } from "../../lib/logger";
import { mergeRotationSubjects, SubjectTermInput, PASSING_GRADE } from "../../lib/promotion";
import {
  resolveCurrentSchoolYearLabel,
  normalizeDisplaySex,
  computeAgeAsOfJune,
  mapRemarksCodes,
  isHomeroomGuidanceSubjectCode,
  isSubjectAlignedWithGrade,
  subjectCanonicalKey,
  toDisplayName,
  toTitleCase,
} from "./helpers";

export default function registerFormRoutes(router: Router): void {

// Get SF9 (Report Card) data for a student
router.get("/forms/sf9/:studentId", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user || user.role !== "REGISTRAR") {
      res.status(403).json({ message: "Access denied. Registrar only." });
      return;
    }

    const studentId = req.params.studentId as string;
    const { schoolYear } = req.query;
    const currentSchoolYear = (schoolYear as string) || await resolveCurrentSchoolYearLabel();

    // Get student data
    const student = await prisma.student.findUnique({
      where: { id: studentId }
    });

    if (!student) {
      res.status(404).json({ message: "Student not found" });
      return;
    }

    // Get active enrollment for school year — accepts any status (ENROLLED, DROPPED, TRANSFERRED)
    // This allows retrieving historical SF9s for students who have since left
    const enrollment = await prisma.enrollment.findFirst({
      where: {
        studentId: studentId,
        schoolYear: currentSchoolYear,
      },
      orderBy: [{ createdAt: 'desc' }],
      include: {
        section: {
          include: {
            adviser: {
              include: { user: true }
            }
          }
        }
      }
    });

    if (!enrollment) {
      res.status(404).json({ message: "Student not found for this school year" });
      return;
    }

    // Get current class assignments for this section/year.
    const classAssignments = await prisma.classAssignment.findMany({
      where: {
        sectionId: enrollment.sectionId,
        schoolYear: currentSchoolYear,
      },
      include: {
        subject: true,
        teacher: {
          include: { user: true }
        }
      }
    });

    // Get all grades for this student in this school year
    const grades = await prisma.grade.findMany({
      where: {
        studentId: studentId,
        classAssignment: {
          sectionId: enrollment.sectionId,
          schoolYear: currentSchoolYear,
        }
      },
      include: {
        classAssignment: {
          include: {
            subject: true,
            teacher: {
              include: { user: true }
            }
          }
        }
      }
    });

    const nonNullQuarterCountByAssignment = new Map<string, number>();
    grades.forEach((g: any) => {
      if (g.quarterlyGrade === null) return;
      nonNullQuarterCountByAssignment.set(
        g.classAssignmentId,
        (nonNullQuarterCountByAssignment.get(g.classAssignmentId) ?? 0) + 1,
      );
    });

    const gradePriority = (g: any): number => {
      const activeScore = g.classAssignment?.isActive ? 10_000 : 0;
      const densityScore = (nonNullQuarterCountByAssignment.get(g.classAssignmentId) ?? 0) * 100;
      const freshnessScore = new Date(g.updatedAt).getTime() / 1e12;
      return activeScore + densityScore + freshnessScore;
    };

    // Build canonical subject rows using learning-area identity (code+name), not subjectId,
    // so duplicate subject rows from sync do not appear as separate entries.
    // Each row now carries rotation metadata from the Subject model.
    const subjectGrades: Record<string, {
      subjectCode: string;
      subjectName: string;
      teacher: string;
      T1: number | null;
      T2: number | null;
      T3: number | null;
      finalGrade: number | null;
      // Atlas rotation fields — null = non-rotating subject
      rotationTermGroupId: string | null;
      rotationTermRank: number | null;
      rotationOutputLabel: string | null;
    }> = {};

    classAssignments.forEach((ca: any) => {
      if (isHomeroomGuidanceSubjectCode(ca.subject.code)) {
        return;
      }
      if (!isSubjectAlignedWithGrade(ca.subject.code, enrollment.section.gradeLevel)) {
        return;
      }
      const key = subjectCanonicalKey(ca.subject.code, ca.subject.name);
      if (!subjectGrades[key]) {
        subjectGrades[key] = {
          subjectCode: ca.subject.code,
          subjectName: ca.subject.name,
          teacher: ca.teacher?.user
            ? `${toDisplayName(ca.teacher.user.firstName)} ${toDisplayName(ca.teacher.user.lastName)}`
            : "Unknown",
          T1: null,
          T2: null,
          T3: null,
          finalGrade: null,
          rotationTermGroupId: ca.subject.rotationTermGroupId ?? null,
          rotationTermRank: ca.subject.rotationTermRank ?? null,
          rotationOutputLabel: ca.subject.rotationOutputLabel ?? null,
        };
      }
    });

    // Populate with actual grade records, preferring higher-priority assignment sources.
    [...grades].sort((a: any, b: any) => gradePriority(b) - gradePriority(a)).forEach((grade: any) => {
      const subject = grade.classAssignment.subject;
      if (isHomeroomGuidanceSubjectCode(subject.code)) {
        return;
      }
      if (!isSubjectAlignedWithGrade(subject.code, enrollment.section.gradeLevel)) {
        return;
      }

      const key = subjectCanonicalKey(subject.code, subject.name);
      if (!subjectGrades[key]) {
        subjectGrades[key] = {
          subjectCode: subject.code,
          subjectName: subject.name,
          teacher: grade.classAssignment.teacher?.user
            ? `${toDisplayName(grade.classAssignment.teacher.user.firstName)} ${toDisplayName(grade.classAssignment.teacher.user.lastName)}`
            : "Unknown",
          T1: null,
          T2: null,
          T3: null,
          finalGrade: null,
          rotationTermGroupId: subject.rotationTermGroupId ?? null,
          rotationTermRank: subject.rotationTermRank ?? null,
          rotationOutputLabel: subject.rotationOutputLabel ?? null,
        };
      }

      if (grade.quarterlyGrade !== null && subjectGrades[key][grade.term as Term] === null) {
        subjectGrades[key][grade.term as Term] = grade.quarterlyGrade;
      }
    });

    // ---------------------------------------------------------------------------
    // Merge rotating sub-subjects into one row per rotation group.
    //
    // Example: SCI_BIO (rank=1), SCI_CHEM (rank=2), SCI_ES (rank=3) all belong to
    // rotationTermGroupId="SCIENCE". They collapse into one "Science" row where:
    //   T1 = Bio grade (from rank=1 sub-subject)
    //   T2 = Chem grade (from rank=2 sub-subject)
    //   T3 = Earth Sci grade (from rank=3 sub-subject)
    //   teacher = "Bio Teacher / Chem Teacher / EarthSci Teacher"
    // Non-rotating subjects (no rotationTermGroupId) pass through unchanged.
    // ---------------------------------------------------------------------------

    // Separate rotating vs. standalone rows
    const rotationGroups: Record<string, typeof subjectGrades[string][]> = {};
    const standaloneRows: (typeof subjectGrades[string])[] = [];

    for (const row of Object.values(subjectGrades)) {
      if (row.rotationTermGroupId) {
        if (!rotationGroups[row.rotationTermGroupId]) {
          rotationGroups[row.rotationTermGroupId] = [];
        }
        rotationGroups[row.rotationTermGroupId].push(row);
      } else {
        standaloneRows.push(row);
      }
    }

    // Build one merged row per rotation group
    const mergedRotationRows: (typeof subjectGrades[string])[] = [];
    for (const [, groupRows] of Object.entries(rotationGroups)) {
      // Sort sub-subjects by their rotation rank so teacher list is ordered
      const sorted = [...groupRows].sort((a, b) => (a.rotationTermRank ?? 0) - (b.rotationTermRank ?? 0));

      const merged: typeof subjectGrades[string] = {
        subjectCode: sorted[0].rotationOutputLabel ?? sorted[0].subjectCode,
        subjectName: toTitleCase(sorted[0].rotationOutputLabel ?? sorted[0].subjectName),
        teacher: sorted.map(r => r.teacher).filter(Boolean).join(' / '),
        T1: null,
        T2: null,
        T3: null,
        finalGrade: null,
        rotationTermGroupId: sorted[0].rotationTermGroupId,
        rotationTermRank: null, // merged row has no single rank
        rotationOutputLabel: sorted[0].rotationOutputLabel,
      };

      // Place each sub-subject's best available term grade into the correct column
      // using rotationTermRank (1→T1, 2→T2, 3→T3) — authoritative from Atlas
      for (const sub of sorted) {
        if (!sub.rotationTermRank) continue;
        const termKey = `T${sub.rotationTermRank}` as 'T1' | 'T2' | 'T3';
        // Pick the best non-null grade across all term slots for this sub-subject
        const bestGrade = sub.T1 ?? sub.T2 ?? sub.T3 ?? null;
        if (bestGrade !== null) {
          merged[termKey] = bestGrade;
        }
      }

      // Final grade = average of available term slots on the merged row
      const availableTerms = [merged.T1, merged.T2, merged.T3].filter((v): v is number => v !== null);
      if (availableTerms.length > 0) {
        merged.finalGrade = Math.round(availableTerms.reduce((a, b) => a + b, 0) / availableTerms.length);
      }

      mergedRotationRows.push(merged);
    }

    // Combine: standalone rows + merged rotation rows
    const allRows = [...standaloneRows, ...mergedRotationRows];

    // Calculate final grades for standalone (non-rotation) subjects
    standaloneRows.forEach((subject: any) => {
      const terms = [subject.T1, subject.T2, subject.T3].filter((q: number | null) => q !== null);
      if (terms.length > 0) {
        subject.finalGrade = Math.round(terms.reduce((a: number, b: number) => a + b, 0) / terms.length);
      }
    });

    // Calculate general average across all rows (standalone + merged)
    const allFinals = allRows.map((s: any) => s.finalGrade).filter((g: number | null) => g !== null);
    const generalAverage = allFinals.length > 0
      ? Math.round(allFinals.reduce((a: number, b: number) => a + b, 0) / allFinals.length)
      : null;

    // Calculate student age from birthDate
    let age = null;
    if (student.birthDate) {
      const today = new Date();
      const birth = new Date(student.birthDate);
      age = today.getFullYear() - birth.getFullYear();
      const m = today.getMonth() - birth.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
        age--;
      }
    }

    // Use profile snapshot if available (historical), else current student data
    const snap = enrollment.profileSnapshot as Record<string, any> | null;

    res.json({
      student: {
        id: student.id,
        lrn: snap?.lrn ?? student.lrn,
        name: `${student.lastName}, ${student.firstName} ${student.middleName || ""} ${student.suffix || ""}`.trim(),
        gender: normalizeDisplaySex(snap?.gender ?? student.gender),
        birthDate: student.birthDate,
        age,
        section: enrollment.section.name,
        gradeLevel: enrollment.section.gradeLevel,
        schoolYear: enrollment.schoolYear,
        adviser: enrollment.section.adviser
          ? `${enrollment.section.adviser.user.firstName} ${enrollment.section.adviser.user.lastName}`
          : null
      },
      subjectGrades: allRows
        .sort((a, b) => a.subjectName.localeCompare(b.subjectName))
        .map((s: any) => ({
          subjectCode: s.subjectCode,
          subjectName: s.subjectName,
          teacher: s.teacher,
          T1: s.T1,
          T2: s.T2,
          T3: s.T3,
          final: s.finalGrade,
          remarks: s.finalGrade ? (s.finalGrade >= 75 ? "Passed" : "Failed") : null
        })),
      attendance: {},
      values: [],
      generalAverage,
      honors: generalAverage ? (generalAverage >= 98 ? "With Highest Honors" : generalAverage >= 95 ? "With High Honors" : generalAverage >= 90 ? "With Honors" : null) : null,
      promotionStatus: generalAverage ? (allRows.every((s: any) => !s.finalGrade || s.finalGrade >= 75) ? "Promoted" : "Retained") : null
    });
  } catch (error) {
    logger.error("Error fetching SF9 data:", error);
    res.status(500).json({ message: "Failed to fetch SF9 data" });
  }
});

// Get SF1 (School Register) data — DepEd-aligned with all required fields
router.get("/forms/sf1/:sectionId", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user || (user.role !== "REGISTRAR" && user.role !== "ADMIN")) {
      res.status(403).json({ message: "Access denied" });
      return;
    }

    const rawSectionId = req.params.sectionId;
    const sectionId = Array.isArray(rawSectionId) ? rawSectionId[0] : rawSectionId;
    const { schoolYear: querySY } = req.query;

    const schoolYear = (querySY as string) || await getActiveSchoolYearLabel();

    // Fetch section with adviser info
    const section = await prisma.section.findUnique({
      where: { id: sectionId },
      include: { adviser: { include: { user: true } } },
    });
    if (!section) {
      res.status(404).json({ message: "Section not found" });
      return;
    }

    // PRIMARY: Fetch from local DB (all extended fields already synced by studentProfileSync)
    const enrollments = await prisma.enrollment.findMany({
      where: { sectionId, schoolYear, status: "ENROLLED" },
      include: { student: true },
    });

    // Helper: prefer profileSnapshot (historical), then live student field, then empty string
    const field = (snap: Record<string, any> | null, student: any, key: string): any => {
      if (snap && snap[key] !== undefined && snap[key] !== null) return snap[key];
      if (student[key] !== undefined && student[key] !== null) return student[key];
      return null;
    };

    // Format students with ALL DepEd SF1 fields
    const allStudents = enrollments.map((enrollment) => {
      const snap = enrollment.profileSnapshot as Record<string, any> | null;
      const s = enrollment.student;
      const g = (key: string) => field(snap, s, key);

      const birthDate = g("birthDate");
      const gender = normalizeDisplaySex(g("gender"));

      return {
        lrn: g("lrn") || "",
        lastName: g("lastName") || "",
        firstName: g("firstName") || "",
        middleName: g("middleName") || "",
        suffix: g("suffix") || "",
        birthDate,
        ageAsOfJune: computeAgeAsOfJune(birthDate, schoolYear),
        gender,
        birthPlace: g("province") || "",
        motherTongue: g("motherTongue") || "",
        ipCommunity: g("ipCommunity") ? "IP" : "-",
        religion: g("religion") || "-",
        address: {
          houseStreet: g("address") || "",
          barangay: g("barangay") || "",
          municipality: g("city") || "",
          province: g("province") || "",
        },
        fatherName: g("fatherName") || "",
        motherName: g("motherName") || "",
        guardianName: g("guardianName") || "",
        guardianRelationship: "",
        guardianContact: g("guardianContact") || "",
        remarks: mapRemarksCodes(enrollment, s),
        enrollmentStatus: enrollment.status,
      };
    });

    // Sort: males first, then females; alphabetical by lastName within each group
    const males = allStudents
      .filter((s) => s.gender === "Male")
      .sort((a, b) => a.lastName.localeCompare(b.lastName));
    const females = allStudents
      .filter((s) => s.gender === "Female")
      .sort((a, b) => a.lastName.localeCompare(b.lastName));

    const formattedStudents = [
      ...males.map((s, i) => ({ ...s, index: i + 1 })),
      ...females.map((s, i) => ({ ...s, index: i + 1 })),
    ];

    // Fetch school settings
    const settings = await (prisma as any).systemSettings.findUnique({
      where: { id: "main" },
      select: { schoolName: true, schoolId: true, division: true, region: true },
    });

    res.json({
      section: {
        id: section.id,
        name: section.name,
        gradeLevel: section.gradeLevel,
        schoolYear,
        adviserName: section.adviser
          ? `${section.adviser.user.firstName} ${section.adviser.user.lastName}`
          : "Not Assigned",
      },
      schoolSettings: settings ? { ...settings, district: "" } : undefined,
      students: formattedStudents,
      summary: {
        maleCount: males.length,
        femaleCount: females.length,
        totalCount: formattedStudents.length,
      },
      source: "local",
    });
  } catch (error: any) {
    logger.error("Error fetching SF1 data:", error);
    res.status(500).json({ message: "Failed to fetch SF1 data" });
  }
});

// Get SF5 (Report on Promotion) data for a section
router.get("/forms/sf5/:sectionId", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user || user.role !== "REGISTRAR") {
      res.status(403).json({ message: "Access denied. Registrar only." });
      return;
    }

    const sectionId = req.params.sectionId as string;
    const { schoolYear } = req.query;
    const currentSchoolYear = (schoolYear as string) || await resolveCurrentSchoolYearLabel();

    const { composeSF5 } = await import("../../lib/sf5Composer");
    const data = await composeSF5(sectionId, currentSchoolYear);
    res.json(data);
  } catch (error) {
    logger.error("Error fetching SF5 data:", error);
    res.status(500).json({ message: "Failed to fetch SF5 data" });
  }
});

// Get SF6 (Summary Promotion Report) data — school-wide aggregate
router.get("/forms/sf6", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user || user.role !== "REGISTRAR") {
      res.status(403).json({ message: "Access denied. Registrar only." });
      return;
    }

    const { schoolYear } = req.query;
    const currentSchoolYear = (schoolYear as string) || await resolveCurrentSchoolYearLabel();

    // Get all sections for this school year
    const sections = await prisma.section.findMany({
      where: { schoolYear: currentSchoolYear },
      include: { adviser: { include: { user: true } } },
      orderBy: [{ gradeLevel: 'asc' }, { name: 'asc' }],
    });

    const gradeOrder = ['GRADE_7', 'GRADE_8', 'GRADE_9', 'GRADE_10'];
    const sectionResults: any[] = [];
    const byGradeLevel: Record<string, { total: number; promoted: number; retained: number; dropped: number; transferred: number }> = {};

    for (const section of sections) {
      // Get enrollments
      const enrollments = await prisma.enrollment.findMany({
        where: { sectionId: section.id, schoolYear: currentSchoolYear },
        include: { student: true },
      });

      // Get class assignments
      const classAssignments = await prisma.classAssignment.findMany({
        where: { sectionId: section.id, schoolYear: currentSchoolYear },
        include: { subject: true },
      });

      // Get grades
      const grades = await prisma.grade.findMany({
        where: {
          classAssignment: { sectionId: section.id, schoolYear: currentSchoolYear },
        },
        include: { classAssignment: { include: { subject: true } } },
      });

      // Compute per-student promotion status
      let promoted = 0, retained = 0, dropped = 0, transferred = 0;

      for (const enr of enrollments) {
        if (enr.status === 'DROPPED') { dropped++; continue; }
        if (enr.status === 'TRANSFERRED') { transferred++; continue; }

        const studentGrades = grades.filter((g) => g.studentId === enr.studentId);

        // Merge rotational subjects (TLE, Science) so each rotation group = one subject
        const rotationInputs: SubjectTermInput[] = classAssignments
          .filter((ca) => !ca.subject.code.toUpperCase().startsWith("HG"))
          .map((ca) => {
            const caGrades = studentGrades.filter((g) => g.classAssignmentId === ca.id);
            const terms: Record<string, number | null> = { T1: null, T2: null, T3: null };
            for (const g of caGrades) {
              if (g.quarterlyGrade !== null && !terms[g.term]) {
                terms[g.term] = g.quarterlyGrade;
              }
            }
            return {
              subjectCode: ca.subject.code,
              subjectName: ca.subject.name,
              T1: terms.T1,
              T2: terms.T2,
              T3: terms.T3,
              rotationTermGroupId: (ca.subject as any).rotationTermGroupId ?? null,
              rotationTermRank: (ca.subject as any).rotationTermRank ?? null,
              rotationOutputLabel: (ca.subject as any).rotationOutputLabel ?? null,
            };
          });

        const mergedSubjects = mergeRotationSubjects(rotationInputs);
        const subjectFinals: number[] = mergedSubjects
          .map((row) => {
            const vals = [row.T1, row.T2, row.T3].filter((v): v is number => v !== null);
            return vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
          })
          .filter((v): v is number => v !== null);

        const hasFailing = subjectFinals.some((g) => g < PASSING_GRADE);
        const hasGrades = subjectFinals.length > 0;
        if (!hasGrades || hasFailing) { retained++; } else { promoted++; }
      }

      const total = enrollments.length;
      const promotionRate = total > 0 ? Math.round((promoted / total) * 100) : 0;

      sectionResults.push({
        sectionId: section.id,
        sectionName: section.name,
        gradeLevel: section.gradeLevel,
        program: section.program || 'REGULAR',
        adviser: section.adviser ? `${section.adviser.user.firstName} ${section.adviser.user.lastName}` : null,
        totalStudents: total,
        promoted,
        retained,
        dropped,
        transferred,
        promotionRate,
      });

      // Aggregate by grade level
      const gl = section.gradeLevel;
      if (!byGradeLevel[gl]) byGradeLevel[gl] = { total: 0, promoted: 0, retained: 0, dropped: 0, transferred: 0 };
      byGradeLevel[gl].total += total;
      byGradeLevel[gl].promoted += promoted;
      byGradeLevel[gl].retained += retained;
      byGradeLevel[gl].dropped += dropped;
      byGradeLevel[gl].transferred += transferred;
    }

    // Sort section results by grade level then name
    sectionResults.sort((a, b) => {
      const gi = gradeOrder.indexOf(a.gradeLevel) - gradeOrder.indexOf(b.gradeLevel);
      return gi !== 0 ? gi : a.sectionName.localeCompare(b.sectionName);
    });

    // Overall summary
    const totalStudents = sectionResults.reduce((s, r) => s + r.totalStudents, 0);
    const totalPromoted = sectionResults.reduce((s, r) => s + r.promoted, 0);
    const totalRetained = sectionResults.reduce((s, r) => s + r.retained, 0);
    const totalDropped = sectionResults.reduce((s, r) => s + r.dropped, 0);
    const totalTransferred = sectionResults.reduce((s, r) => s + r.transferred, 0);

    res.json({
      schoolYear: currentSchoolYear,
      sections: sectionResults,
      summary: {
        totalStudents,
        promoted: totalPromoted,
        retained: totalRetained,
        dropped: totalDropped,
        transferred: totalTransferred,
        overallPromotionRate: totalStudents > 0 ? Math.round((totalPromoted / totalStudents) * 100) : 0,
      },
      byGradeLevel,
    });
  } catch (error) {
    logger.error("Error fetching SF6 data:", error);
    res.status(500).json({ message: "Failed to fetch SF6 data" });
  }
});

// Get SF10 (Permanent Record) data for a student
router.get("/forms/sf10/:studentId", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user || user.role !== "REGISTRAR") {
      res.status(403).json({ message: "Access denied. Registrar only." });
      return;
    }

    const studentId = req.params.studentId as string;

    // Get student data with enrollments
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      include: {
        enrollments: {
          include: {
            section: {
              include: {
                adviser: {
                  include: { user: true }
                }
              }
            }
          },
          orderBy: { schoolYear: 'asc' }
        }
      }
    });

    if (!student) {
      res.status(404).json({ message: "Student not found" });
      return;
    }

    // Resolve one canonical enrollment per school year, prioritizing ENROLLED entries.
    const enrollmentBySchoolYear = new Map<string, any>();
    student.enrollments.forEach((enrollment: any) => {
      const existing = enrollmentBySchoolYear.get(enrollment.schoolYear);
      if (!existing) {
        enrollmentBySchoolYear.set(enrollment.schoolYear, enrollment);
        return;
      }

      const existingScore = existing.status === 'ENROLLED' ? 2 : 1;
      const incomingScore = enrollment.status === 'ENROLLED' ? 2 : 1;
      if (incomingScore > existingScore) {
        enrollmentBySchoolYear.set(enrollment.schoolYear, enrollment);
        return;
      }

      if (incomingScore === existingScore && enrollment.createdAt > existing.createdAt) {
        enrollmentBySchoolYear.set(enrollment.schoolYear, enrollment);
      }
    });

    const canonicalEnrollments = Array.from(enrollmentBySchoolYear.values());

    // Sort canonicalEnrollments by school year desc to get the latest
    const sortedByYear = [...canonicalEnrollments].sort((a: any, b: any) => b.schoolYear.localeCompare(a.schoolYear));
    const currentEnrollment = sortedByYear[0];
    const currentSchoolYear = currentEnrollment?.schoolYear ?? await getActiveSchoolYearLabel();

    // SF10 shows ALL of the student's JHS enrollment history (Grades 7-10).
    // Retained students may have more years than their current grade level index.
    // Only exclude future school years (yearDiff < 0).
    const filteredCanonicalEnrollments = canonicalEnrollments.filter((e: any) => {
      const syStart = parseInt(e.schoolYear.split('-')[0]);
      const currentStart = parseInt(currentSchoolYear.split('-')[0]);
      const yearDiff = currentStart - syStart;
      return yearDiff >= 0;
    });

    // Build set of allowed school years for the grades loop
    const allowedSchoolYears = new Set(filteredCanonicalEnrollments.map((e: any) => e.schoolYear));

    // Get all section IDs from canonical enrollments
    const sectionIds = filteredCanonicalEnrollments.map((e: any) => e.sectionId);

    // Fetch all active class assignments for these sections
    const classAssignments = await prisma.classAssignment.findMany({
      where: {
        sectionId: { in: sectionIds },
      },
      include: {
        subject: true,
        teacher: {
          include: { user: true }
        }
      }
    });

    // Get all grades for this student across all school years
    let grades = await prisma.grade.findMany({
      where: { studentId: studentId },
      include: {
        classAssignment: {
          include: {
            subject: true,
            section: true,
            teacher: {
              include: { user: true }
            }
          }
        }
      }
    });

    // Fetch all remedial classes for this student (for SF10 remedial section)
    const enrollmentIds = filteredCanonicalEnrollments.map((e: any) => e.id);
    const allRemedialClasses = await prisma.remedialClass.findMany({
      where: { enrollmentId: { in: enrollmentIds } },
      orderBy: { subjectName: "asc" },
    });
    const remedialByEnrollment = new Map<string, typeof allRemedialClasses>();
    for (const rc of allRemedialClasses) {
      const list = remedialByEnrollment.get(rc.enrollmentId) ?? [];
      list.push(rc);
      remedialByEnrollment.set(rc.enrollmentId, list);
    }

    // Fallback: if no Grade records found, try GradeSnapshot
    if (grades.length === 0) {
      const snapshots = await prisma.gradeSnapshot.findMany({
        where: { studentId: studentId },
        orderBy: { createdAt: "desc" }
      });

      if (snapshots.length > 0) {
        // Reconstruct grade-like objects from snapshots
        const snapshotGrades: any[] = [];
        for (const snap of snapshots) {
          const snapData = snap.snapshot as any;
          snapshotGrades.push({
            id: snap.id,
            studentId: snap.studentId,
            classAssignmentId: snap.classAssignmentId,
            term: snap.term,
            quarterlyGrade: snapData?.quarterlyGrade ?? null,
            writtenWorkPS: snapData?.writtenWorkPS ?? null,
            perfTaskPS: snapData?.perfTaskPS ?? null,
            quarterlyAssessPS: snapData?.quarterlyAssessPS ?? null,
            initialGrade: snapData?.initialGrade ?? null,
            classAssignment: {
              id: snap.classAssignmentId,
              subjectCode: snap.subjectCode,
              subjectName: snap.subjectName,
              sectionName: snap.sectionName,
              schoolYear: snap.schoolYear,
              isActive: false,
              subject: { code: snap.subjectCode, name: snap.subjectName },
              section: { name: snap.sectionName },
              teacher: null
            }
          });
        }
        grades = snapshotGrades;
      }
    }

    const nonNullQuarterCountByAssignment = new Map<string, number>();
    grades.forEach((g: any) => {
      if (g.quarterlyGrade === null) return;
      nonNullQuarterCountByAssignment.set(
        g.classAssignmentId,
        (nonNullQuarterCountByAssignment.get(g.classAssignmentId) ?? 0) + 1,
      );
    });

    const gradePriority = (g: any): number => {
      const activeScore = g.classAssignment?.isActive ? 10_000 : 0;
      const densityScore = (nonNullQuarterCountByAssignment.get(g.classAssignmentId) ?? 0) * 100;
      const freshnessScore = new Date(g.updatedAt).getTime() / 1e12;
      return activeScore + densityScore + freshnessScore;
    };

    // Organize by school year
    const academicHistory: Record<string, any> = {};
    
    filteredCanonicalEnrollments.forEach((enrollment: any) => {
      const sy = enrollment.schoolYear;
      if (!academicHistory[sy]) {
        academicHistory[sy] = {
          schoolYear: sy,
          gradeLevel: enrollment.section.gradeLevel,
          section: enrollment.section.name,
          program: enrollment.section.program ?? 'REGULAR',
          subjects: {}
        };
      }

      // Populate subjects based on class assignments for this enrollment's section
      const sectionAssignments = classAssignments.filter(
        (ca: any) => ca.sectionId === enrollment.sectionId && ca.schoolYear === sy
      );
      sectionAssignments.forEach((ca: any) => {
        if (isHomeroomGuidanceSubjectCode(ca.subject.code)) {
          return;
        }
        if (!isSubjectAlignedWithGrade(ca.subject.code, enrollment.section.gradeLevel)) {
          return;
        }

        const key = subjectCanonicalKey(ca.subject.code, ca.subject.name);
        if (!academicHistory[sy].subjects[key]) {
        academicHistory[sy].subjects[key] = {
          subjectCode: ca.subject.code,
          subjectName: ca.subject.name,
          T1: null,
          T2: null,
          T3: null,
          finalGrade: null
        };
        }
      });
    });

    [...grades].sort((a: any, b: any) => gradePriority(b) - gradePriority(a)).forEach((grade: any) => {
      const sy = grade.classAssignment.schoolYear;
      // Skip grades for school years beyond the student's current grade level
      if (!allowedSchoolYears.has(sy)) return;

      if (!academicHistory[sy]) {
        academicHistory[sy] = {
          schoolYear: sy,
          gradeLevel: grade.classAssignment.section.gradeLevel,
          section: grade.classAssignment.section.name,
          program: grade.classAssignment.section.program ?? 'REGULAR',
          subjects: {}
        };
      }

      if (isHomeroomGuidanceSubjectCode(grade.classAssignment.subject.code)) {
        return;
      }
      if (!isSubjectAlignedWithGrade(grade.classAssignment.subject.code, grade.classAssignment.section.gradeLevel)) {
        return;
      }

      const key = subjectCanonicalKey(grade.classAssignment.subject.code, grade.classAssignment.subject.name);
      if (!academicHistory[sy].subjects[key]) {
        academicHistory[sy].subjects[key] = {
          subjectCode: grade.classAssignment.subject.code,
          subjectName: grade.classAssignment.subject.name,
          T1: null,
          T2: null,
          T3: null,
          finalGrade: null
        };
      }
      
      // Store term grade only if the slot is still empty (higher-priority rows run first).
      if (grade.term === 'T1' && academicHistory[sy].subjects[key].T1 === null) academicHistory[sy].subjects[key].T1 = grade.quarterlyGrade;
      if (grade.term === 'T2' && academicHistory[sy].subjects[key].T2 === null) academicHistory[sy].subjects[key].T2 = grade.quarterlyGrade;
      if (grade.term === 'T3' && academicHistory[sy].subjects[key].T3 === null) academicHistory[sy].subjects[key].T3 = grade.quarterlyGrade;
    });

    // Fetch school settings for SF10 metadata
    const schoolSettings = await (prisma as any).systemSettings.findUnique({
      where: { id: 'main' },
      select: { schoolName: true, schoolId: true, division: true, region: true }
    });

    // Calculate final grades for each school year — merge rotational subjects first
    const schoolRecords = Object.values(academicHistory).map((year: any) => {
      // Build SubjectTermInput[] from the raw subjects map for rotation merging
      const rotationInputs: SubjectTermInput[] = Object.values(year.subjects).map((subject: any) => ({
        subjectCode: subject.subjectCode,
        subjectName: subject.subjectName,
        T1: subject.T1,
        T2: subject.T2,
        T3: subject.T3,
        rotationTermGroupId: (subject as any).rotationTermGroupId ?? null,
        rotationTermRank: (subject as any).rotationTermRank ?? null,
        rotationOutputLabel: (subject as any).rotationOutputLabel ?? null,
      }));

      const merged = mergeRotationSubjects(rotationInputs);

      const subjectGrades = merged
        .sort((a: any, b: any) => a.subjectName.localeCompare(b.subjectName))
        .map((row: any) => {
        const terms = [row.T1, row.T2, row.T3].filter((q: number | null) => q !== null);
        const finalGrade = terms.length > 0 
          ? Math.round(terms.reduce((a: number, b: number) => a + b, 0) / terms.length)
          : null;
        return {
          subjectCode: row.subjectCode,
          subjectName: row.subjectName,
          T1: row.T1,
          T2: row.T2,
          T3: row.T3,
          final: finalGrade,
          remarks: finalGrade ? (finalGrade >= PASSING_GRADE ? "Passed" : "Failed") : null
        };
      });

      // Calculate general average from merged subjects
      const allFinals = subjectGrades.map((s: any) => s.final).filter((g: number | null) => g !== null) as number[];
      const generalAverage = allFinals.length > 0 
        ? Math.round(allFinals.reduce((a: number, b: number) => a + b, 0) / allFinals.length)
        : null;

      // Resolve adviser name from the enrollment's section
      const enrollment = filteredCanonicalEnrollments.find((e: any) => e.schoolYear === year.schoolYear);
      let adviserName: string | undefined;
      if (enrollment?.section?.adviser?.user) {
        adviserName = `${enrollment.section.adviser.user.firstName} ${enrollment.section.adviser.user.lastName}`;
      }

      // Include profile snapshot from enrollment for historical accuracy
      const enrollmentForYear = filteredCanonicalEnrollments.find((e: any) => e.schoolYear === year.schoolYear);
      const profileSnapshot = enrollmentForYear?.profileSnapshot ?? null;

      return {
        schoolYear: year.schoolYear,
        gradeLevel: year.gradeLevel,
        section: year.section,
        program: year.program,
        school: schoolSettings?.schoolName || '',
        schoolId: schoolSettings?.schoolId || '',
        district: schoolSettings?.division || '',
        division: schoolSettings?.division || '',
        region: schoolSettings?.region || '',
        adviserName,
        subjectGrades,
        generalAverage,
        honors: generalAverage ? (generalAverage >= 98 ? "With Highest Honors" : generalAverage >= 95 ? "With High Honors" : generalAverage >= 90 ? "With Honors" : null) : null,
        promotionStatus: generalAverage ? (subjectGrades.every((s: any) => !s.final || s.final >= 75) ? "Promoted" : "Retained") : null,
        remedialClasses: enrollmentForYear
          ? (remedialByEnrollment.get(enrollmentForYear.id) ?? []).map((rc) => ({
              learningAreas: rc.subjectName,
              finalRating: String(rc.originalGrade),
              remedialClassMark: rc.remedialMark != null ? String(rc.remedialMark) : undefined,
              conductedFrom: rc.conductedFrom?.toISOString(),
              conductedTo: rc.conductedTo?.toISOString(),
              status: rc.status,
              outcome: rc.outcome,
            }))
          : [],
        profileSnapshot,
      };
    });

    res.json({
      student: {
        id: student.id,
        lrn: student.lrn,
        name: `${student.lastName}, ${student.firstName} ${student.middleName || ""} ${student.suffix || ""}`.trim(),
        firstName: student.firstName,
        lastName: student.lastName,
        middleName: student.middleName || "",
        nameExtension: student.suffix || "",
        gender: normalizeDisplaySex(student.gender),
        birthDate: student.birthDate,
        address: student.address,
        guardianName: student.guardianName,
        guardianContact: student.guardianContact
      },
      schoolRecords: schoolRecords.sort((a, b) => a.schoolYear.localeCompare(b.schoolYear)),
      schoolSettings: {
        schoolName: schoolSettings?.schoolName || '',
        schoolId: schoolSettings?.schoolId || '',
        division: schoolSettings?.division || '',
        region: schoolSettings?.region || ''
      }
    });
  } catch (error) {
    logger.error("Error fetching SF10 data:", error);
    res.status(500).json({ message: "Failed to fetch SF10 data" });
  }
});

// Get SF8 (Class Record) data
router.get("/forms/sf8", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user || user.role !== "REGISTRAR") {
      res.status(403).json({ message: "Access denied. Registrar only." });
      return;
    }

    const { schoolYear, sectionId } = req.query;
    const currentSchoolYear = (schoolYear as string) || await resolveCurrentSchoolYearLabel();

    // Get all sections for school year
    const sections = await prisma.section.findMany({
      where: { schoolYear: currentSchoolYear },
      include: {
        adviser: {
          include: { user: true }
        },
        _count: {
          select: { 
            enrollments: {
              where: { status: "ENROLLED" }
            }
          }
        }
      },
      orderBy: [
        { gradeLevel: 'asc' },
        { name: 'asc' }
      ]
    });

    // If section is specified, get detailed class record
    if (sectionId && sectionId !== "all") {
      const section = sections.find(s => s.id === sectionId);
      if (!section) {
        res.status(404).json({ message: "Section not found" });
        return;
      }

      // Get all enrollments in this section
      const enrollments = await prisma.enrollment.findMany({
        where: {
          sectionId: sectionId as string,
          schoolYear: currentSchoolYear,
          status: "ENROLLED"
        },
        include: {
          student: true
        },
        orderBy: [
          { student: { lastName: 'asc' } },
          { student: { firstName: 'asc' } }
        ]
      });

      // Get all class assignments for this section
      const classAssignments = await prisma.classAssignment.findMany({
        where: {
          sectionId: sectionId as string,
          schoolYear: currentSchoolYear
        },
        include: {
          subject: true,
          teacher: {
            include: { user: true }
          }
        }
      });

      // Get all grades for students in this section
      const studentIds = enrollments.map(e => e.studentId);
      const grades = await prisma.grade.findMany({
        where: {
          studentId: { in: studentIds },
          classAssignment: {
            sectionId: sectionId as string,
            schoolYear: currentSchoolYear
          }
        }
      });

      // Organize data
      const students = enrollments.map(e => {
        const studentGrades: Record<string, any> = {};
        
        classAssignments.forEach(ca => {
          const subjectGrades = grades.filter(g => 
            g.studentId === e.studentId && g.classAssignmentId === ca.id
          );
          
          studentGrades[ca.subject.code] = {
            T1: subjectGrades.find(g => g.term === "T1")?.quarterlyGrade || null,
            T2: subjectGrades.find(g => g.term === "T2")?.quarterlyGrade || null,
            T3: subjectGrades.find(g => g.term === "T3")?.quarterlyGrade || null
          };
        });

        // Use profile snapshot if available (historical), else current student data
        const snap = e.profileSnapshot as Record<string, any> | null;

        return {
          id: e.student.id,
          lrn: snap?.lrn ?? e.student.lrn,
          firstName: snap?.firstName ?? e.student.firstName,
          middleName: snap?.middleName ?? e.student.middleName,
          lastName: snap?.lastName ?? e.student.lastName,
          gender: normalizeDisplaySex(snap?.gender ?? e.student.gender),
          grades: studentGrades
        };
      });

      const subjects = classAssignments.map(ca => ({
        code: ca.subject.code,
        name: ca.subject.name,
        teacher: `${ca.teacher.user.firstName} ${ca.teacher.user.lastName}`
      }));

      res.json({
        section: {
          id: section.id,
          name: section.name,
          gradeLevel: section.gradeLevel,
          program: section.program,
          schoolYear: currentSchoolYear,
          adviser: section.adviser 
            ? `${section.adviser.user.firstName} ${section.adviser.user.lastName}`
            : null,
          studentCount: section._count.enrollments
        },
        subjects,
        students
      });
      return;
    }

    // Return list of sections if no specific section requested
    res.json({
      sections: sections.map(s => ({
        id: s.id,
        name: s.name,
        gradeLevel: s.gradeLevel,
        program: s.program,
        studentCount: s._count.enrollments,
        adviser: s.adviser 
          ? `${s.adviser.user.firstName} ${s.adviser.user.lastName}`
          : null
      })),
      schoolYear: currentSchoolYear
    });
  } catch (error) {
    logger.error("Error fetching SF8 data:", error);
    res.status(500).json({ message: "Failed to fetch SF8 data" });
  }
});

} // end registerFormRoutes
