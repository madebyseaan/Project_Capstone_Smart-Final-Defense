import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import { Role, GradeLevel, SubjectType, Term } from "@prisma/client";
import { shouldCreateDevAccount } from "../config/env";

/**
 * Ensures the universal developer account exists in PostgreSQL
 * along with a linked Teacher profile and class assignments so all 3 portals work.
 *
 * ONLY creates the dev account in development mode or when CREATE_DEV_ACCOUNT=true.
 */
export async function ensureDevAccount(): Promise<void> {
  // Only create dev account in development or when explicitly enabled
  if (!shouldCreateDevAccount()) {
    console.log("[DevAccount] Skipped — not in development mode. Set CREATE_DEV_ACCOUNT=true to enable.");
    return;
  }

  // Dev credentials from env vars (safe defaults for development only)
  const devUsername = process.env.DEV_USERNAME || "999999";
  const devEmail = process.env.DEV_EMAIL || "dev.sean@smart.local";
  const devPassword = process.env.DEV_PASSWORD || "dev123";
  const devFirstName = process.env.DEV_FIRST_NAME || "Dev Sean";
  const devLastName = process.env.DEV_LAST_NAME || "Roma";
  const devEmployeeId = process.env.DEV_EMPLOYEE_ID || "999999";

  try {
    const hashedPassword = await bcrypt.hash(devPassword, 10);

    // 1. Upsert Dev User
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { username: devUsername },
          { email: devEmail },
        ],
      },
    });

    let devUser;
    if (!existingUser) {
      devUser = await prisma.user.create({
        data: {
          username: devUsername,
          email: devEmail,
          password: hashedPassword,
          role: Role.ADMIN,
          firstName: devFirstName,
          lastName: devLastName,
        },
      });
      console.log(`[DevAuth] Created Dev user "${devUsername}" (${devFirstName} ${devLastName}).`);
    } else {
      devUser = await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          username: devUsername,
          email: devEmail,
          password: hashedPassword,
          role: Role.ADMIN,
          firstName: devFirstName,
          lastName: devLastName,
        },
      });
      console.log(`[DevAuth] Updated Dev user "${devUsername}" credentials.`);
    }

    // 2. Ensure Teacher Profile exists for Dev User
    let teacher = await prisma.teacher.findFirst({
      where: {
        OR: [
          { userId: devUser.id },
          { employeeId: devEmployeeId },
        ],
      },
    });

    if (!teacher) {
      teacher = await prisma.teacher.create({
        data: {
          userId: devUser.id,
          employeeId: devEmployeeId,
          specialization: "Full Stack Development / All Subjects",
        },
      });
      console.log(`[DevAuth] Created Teacher profile for Dev user (EMP: ${devEmployeeId}).`);
    } else {
      teacher = await prisma.teacher.update({
        where: { id: teacher.id },
        data: {
          userId: devUser.id,
          employeeId: devEmployeeId,
          specialization: "Full Stack Development / All Subjects",
        },
      });
    }

    // 3. Ensure dev teacher has at least 1 class assignment & advisory section for testing teacher views
    const systemSettings = await prisma.systemSettings.findUnique({ where: { id: "main" } });
    const currentSchoolYear = systemSettings?.currentSchoolYear ?? "2026-2027";

    const existingAssignments = await prisma.classAssignment.count({
      where: { teacherId: teacher.id },
    });

    if (existingAssignments === 0) {
      // Find or create a section
      let section = await prisma.section.findFirst({
        where: { schoolYear: currentSchoolYear },
      });

      if (!section) {
        section = await prisma.section.create({
          data: {
            name: "Diamond",
            gradeLevel: GradeLevel.GRADE_7,
            schoolYear: currentSchoolYear,
            adviserId: teacher.id,
          },
        });
      } else if (!section.adviserId) {
        await prisma.section.update({
          where: { id: section.id },
          data: { adviserId: teacher.id },
        });
      }

      // Find or create a subject
      let subject = await prisma.subject.findFirst();
      if (!subject) {
        subject = await prisma.subject.create({
          data: {
            code: "DEV101",
            name: "Software Development & Systems",
            type: SubjectType.CORE,
            writtenWorkWeight: 30,
            perfTaskWeight: 50,
            quarterlyAssessWeight: 20,
          },
        });
      }

      // Create class assignment
      await prisma.classAssignment.create({
        data: {
          teacherId: teacher.id,
          subjectId: subject.id,
          sectionId: section.id,
          schoolYear: currentSchoolYear,
          isActive: true,
        },
      });
      console.log(`[DevAuth] Linked default class assignment to Dev Teacher.`);
    }
  } catch (error: any) {
    console.error("[DevAuth] Error ensuring dev account:", error.message);
  }
}
