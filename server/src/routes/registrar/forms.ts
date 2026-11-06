import { Router, Response } from "express";
import { authenticateToken, AuthRequest } from "../../middleware/auth";
import { prisma } from "../../lib/prisma";
import { getActiveSchoolYearLabel } from "../../lib/schoolYearResolver";
import { logger } from "../../lib/logger";
import { getSchoolIdentityForYear } from "../../lib/schoolSettingsSnapshot";
import { buildSf10Records } from "../../lib/sf10";
import { composeSf9ForStudent } from "../../lib/sf9Composer";
import { composeSF6 } from "../../lib/sf6Composer";
import {
  resolveCurrentSchoolYearLabel,
  normalizeDisplaySex,
  computeAgeAsOfJune,
  mapRemarksCodes,
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

    const student = await prisma.student.findUnique({ where: { id: studentId } });
    if (!student) {
      res.status(404).json({ message: "Student not found" });
      return;
    }

    const payload = await composeSf9ForStudent({
      studentId,
      schoolYear: currentSchoolYear,
    });

    if (!payload) {
      res.status(404).json({ message: "Student not found for this school year" });
      return;
    }

    res.json(payload);
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

    // Fetch school settings — use year snapshot instead of live (W6: fallback handled)
    const settings = await getSchoolIdentityForYear(schoolYear);

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
      schoolSettings: { ...settings, district: "" },
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

router.get("/forms/sf6", authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user;
    if (!user || user.role !== "REGISTRAR") {
      res.status(403).json({ message: "Access denied. Registrar only." });
      return;
    }

    const { schoolYear } = req.query;
    const currentSchoolYear = (schoolYear as string) || await resolveCurrentSchoolYearLabel();
    const data = await composeSF6(currentSchoolYear);

    res.json(data);
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

    const data = await buildSf10Records(req.params.studentId as string);
    if (!data) {
      res.status(404).json({ message: "Student not found" });
      return;
    }

    res.json(data);
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
        name: ca.subject.displayName ?? ca.subject.name,
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
