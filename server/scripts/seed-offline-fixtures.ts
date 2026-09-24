/**
 * seed-offline-fixtures.ts — synthetic data for the offline rig (*_test DB only).
 *
 * Creates the minimum needed to render the portals and run the offline specs:
 *   - admin / teacher / registrar users (passwords from SMART_TEST_* env)
 *   - one section (Grade 7), one subject, one class assignment
 *   - 6 students with enrollments
 *
 * Synthetic year only (2088-2089). Idempotent (upserts). Never touches real data.
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL ?? "";
const dbName = (() => {
  try {
    return new URL(connectionString).pathname.replace(/^\//, "");
  } catch {
    return "";
  }
})();

if (!/(^|_)test(_|$)/i.test(dbName)) {
  console.error(`[seed-offline-fixtures] Refusing: DATABASE_URL must target a *_test database (got "${dbName}").`);
  process.exit(1);
}

const REQUIRED = [
  "SMART_TEST_ADMIN_EMAIL",
  "SMART_TEST_ADMIN_PASSWORD",
  "SMART_TEST_TEACHER_EMAIL",
  "SMART_TEST_TEACHER_PASSWORD",
  "SMART_TEST_REGISTRAR_EMAIL",
  "SMART_TEST_REGISTRAR_PASSWORD",
];
const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`[seed-offline-fixtures] Missing env: ${missing.join(", ")}`);
  console.error("[seed-offline-fixtures] Set SMART_TEST_* credentials (see server/.env.example).");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const YEAR_LABEL = process.env.E2E_FIXTURE_YEAR ?? "2088-2089";

async function upsertUser(opts: {
  username: string;
  password: string;
  role: "ADMIN" | "TEACHER" | "REGISTRAR";
  firstName: string;
  lastName: string;
  email: string;
}) {
  const hashed = await bcrypt.hash(opts.password, 10);
  return prisma.user.upsert({
    where: { username: opts.username },
    update: { password: hashed, role: opts.role, status: "ACTIVE", firstName: opts.firstName, lastName: opts.lastName, email: opts.email },
    create: { username: opts.username, password: hashed, role: opts.role, status: "ACTIVE", firstName: opts.firstName, lastName: opts.lastName, email: opts.email },
  });
}

async function main() {
  const year =
    (await prisma.schoolYear.findUnique({ where: { externalId: 900003 } })) ??
    (await prisma.schoolYear.create({ data: { label: YEAR_LABEL, externalId: 900003, status: "ACTIVE" } }));

  await prisma.systemSettings.upsert({
    where: { id: "main" },
    update: { schoolYearId: year.id, currentSchoolYear: year.label, currentTerm: "T1", gradeLock: false },
    create: { id: "main", schoolYearId: year.id, currentSchoolYear: year.label, currentTerm: "T1", gradeLock: false },
  });

  const admin = await upsertUser({
    username: process.env.SMART_TEST_ADMIN_EMAIL!,
    password: process.env.SMART_TEST_ADMIN_PASSWORD!,
    role: "ADMIN",
    firstName: "Rig",
    lastName: "Admin",
    email: process.env.SMART_TEST_ADMIN_EMAIL!,
  });
  const registrar = await upsertUser({
    username: process.env.SMART_TEST_REGISTRAR_EMAIL!,
    password: process.env.SMART_TEST_REGISTRAR_PASSWORD!,
    role: "REGISTRAR",
    firstName: "Rig",
    lastName: "Registrar",
    email: process.env.SMART_TEST_REGISTRAR_EMAIL!,
  });
  const teacherUser = await upsertUser({
    username: process.env.SMART_TEST_TEACHER_EMAIL!,
    password: process.env.SMART_TEST_TEACHER_PASSWORD!,
    role: "TEACHER",
    firstName: "Rig",
    lastName: "Teacher",
    email: process.env.SMART_TEST_TEACHER_EMAIL!,
  });

  const teacher = await prisma.teacher.upsert({
    where: { employeeId: process.env.SMART_TEST_TEACHER_EMAIL! },
    update: { userId: teacherUser.id },
    create: { employeeId: process.env.SMART_TEST_TEACHER_EMAIL!, userId: teacherUser.id },
  });

  const section = await prisma.section.upsert({
    where: { name_gradeLevel_schoolYear: { name: "Rizal", gradeLevel: "GRADE_7", schoolYear: year.label } },
    update: { adviserId: teacher.id, status: "ACTIVE" },
    create: { name: "Rizal", gradeLevel: "GRADE_7", schoolYear: year.label, adviserId: teacher.id, status: "ACTIVE" },
  });

  const subject = await prisma.subject.upsert({
    where: { code: "RIG-MATH7" },
    update: {},
    create: {
      code: "RIG-MATH7",
      name: "Mathematics 7",
      displayName: "Mathematics",
      type: "CORE",
      writtenWorkWeight: 20,
      perfTaskWeight: 50,
      quarterlyAssessWeight: 30,
    },
  });

  let assignment = await prisma.classAssignment.findFirst({
    where: { teacherId: teacher.id, subjectId: subject.id, sectionId: section.id, schoolYear: year.label },
  });
  if (!assignment) {
    assignment = await prisma.classAssignment.create({
      data: {
        teacherId: teacher.id,
        subjectId: subject.id,
        sectionId: section.id,
        schoolYear: year.label,
        source: "MANUAL",
        isActive: true,
      },
    });
  }

  for (let i = 1; i <= 6; i += 1) {
    const lrn = `99000000000${i}`;
    const student = await prisma.student.upsert({
      where: { lrn },
      update: { firstName: `Student${i}`, lastName: "Rig", gender: i % 2 === 0 ? "FEMALE" : "MALE" },
      create: { lrn, firstName: `Student${i}`, lastName: "Rig", gender: i % 2 === 0 ? "FEMALE" : "MALE" },
    });
    await prisma.enrollment.upsert({
      where: { studentId_sectionId_schoolYear: { studentId: student.id, sectionId: section.id, schoolYear: year.label } },
      update: { status: "ENROLLED", isArchived: false },
      create: { studentId: student.id, sectionId: section.id, schoolYear: year.label, status: "ENROLLED", isArchived: false },
    });
  }

  console.log(
    `[seed-offline-fixtures] Ready: year=${year.label} admin=${admin.username} teacher=${teacherUser.username} registrar=${registrar.username} section=${section.name} subject=${subject.code} assignment=${assignment.id}`,
  );
}

main()
  .catch((e) => {
    console.error("[seed-offline-fixtures] Failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
