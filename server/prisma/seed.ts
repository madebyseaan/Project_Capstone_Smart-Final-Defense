import "dotenv/config";
import { PrismaClient, Role, GradeLevel, SubjectType, Term, AuditAction, AuditSeverity } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL,
  }),
});

// Filipino names for students
const firstNames = [
  "Juan", "Maria", "Jose", "Ana", "Pedro", "Rosa", "Carlos", "Elena", "Miguel", "Sofia",
  "Antonio", "Isabella", "Francisco", "Gabriela", "Manuel", "Andrea", "Rafael", "Carmen",
  "Gabriel", "Patricia", "Diego", "Lucia", "Fernando", "Mariana", "Ricardo", "Valentina",
  "Luis", "Camila", "Andres", "Paula", "Daniel", "Daniela", "Jorge", "Victoria", "Marco",
  "Samantha", "Adrian", "Nicole", "Christian", "Alexandra", "Javier", "Katherine", "Paolo",
  "Michelle", "Kenneth", "Jasmine", "Mark", "Angela"
];

const lastNames = [
  "Santos", "Reyes", "Cruz", "Garcia", "Mendoza", "Torres", "Flores", "Gonzales", "Bautista",
  "Villanueva", "Ramos", "Aquino", "Castro", "Rivera", "Dela Cruz", "Francisco", "Hernandez",
  "Lopez", "Morales", "Pascual", "Perez", "Rosario", "Salvador", "Tan", "Mercado", "Navarro",
  "Ortega", "Padilla", "Quinto", "Ramirez", "Santiago", "Valdez", "Velasco", "Aguilar",
  "Bernal", "Cabrera", "Diaz", "Espinosa", "Fernandez", "Gutierrez", "Ibarra", "Jimenez"
];

function generateLRN(counter: number): string {
  // LRN format: 1234567890XX (12 digits)
  const paddedCounter = counter.toString().padStart(11, '0');
  return `1${paddedCounter}`;
}

function randomElement<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Transmute to DepEd grading scale
function transmute(initial: number): number {
  if (initial >= 100) return 100;
  if (initial >= 98.40) return 99;
  if (initial >= 96.80) return 98;
  if (initial >= 95.20) return 97;
  if (initial >= 93.60) return 96;
  if (initial >= 92.00) return 95;
  if (initial >= 90.40) return 94;
  if (initial >= 88.80) return 93;
  if (initial >= 87.20) return 92;
  if (initial >= 85.60) return 91;
  if (initial >= 84.00) return 90;
  if (initial >= 82.40) return 89;
  if (initial >= 80.80) return 88;
  if (initial >= 79.20) return 87;
  if (initial >= 77.60) return 86;
  if (initial >= 76.00) return 85;
  if (initial >= 74.40) return 84;
  if (initial >= 72.80) return 83;
  if (initial >= 71.20) return 82;
  if (initial >= 69.60) return 81;
  if (initial >= 68.00) return 80;
  if (initial >= 66.40) return 79;
  if (initial >= 64.80) return 78;
  if (initial >= 63.20) return 77;
  if (initial >= 61.60) return 76;
  if (initial >= 60.00) return 75;
  if (initial >= 56.00) return 74;
  if (initial >= 52.00) return 73;
  if (initial >= 48.00) return 72;
  if (initial >= 44.00) return 71;
  if (initial >= 40.00) return 70;
  if (initial >= 36.00) return 69;
  if (initial >= 32.00) return 68;
  if (initial >= 28.00) return 67;
  if (initial >= 24.00) return 66;
  if (initial >= 20.00) return 65;
  if (initial >= 16.00) return 64;
  if (initial >= 12.00) return 63;
  if (initial >= 8.00) return 62;
  if (initial >= 4.00) return 61;
  return 60;
}

async function main() {
  console.log("Starting seed...");

  // Clean up existing data to avoid conflicts
  console.log("Cleaning up existing data...");
  await prisma.auditLog.deleteMany({});
  await prisma.gradingConfig.deleteMany({});
  await prisma.systemSettings.deleteMany({});
  await prisma.grade.deleteMany({});
  await prisma.enrollment.deleteMany({});
  await prisma.student.deleteMany({});
  await prisma.classAssignment.deleteMany({});
  await prisma.section.deleteMany({});
  
  console.log("Creating new seed data...");

  // Hash passwords
  const saltRounds = 10;
  const teacherPassword = await bcrypt.hash("DepEd2026!", saltRounds);
  const adminPassword = await bcrypt.hash("AdminSY2026!", saltRounds);
  const registrarPassword = await bcrypt.hash("Registrar2026!", saltRounds);

  // Create users - Teacher 1 (MATH - Advisory)
  const teacherUser = await prisma.user.upsert({
    where: { username: "3179586" },
    update: {
      firstName: "DIEGO",
      lastName: "AQUINO",
      email: "diego.aquino@deped.gov.ph",
      password: teacherPassword,
    },
    create: {
      username: "3179586",
      password: teacherPassword,
      role: Role.TEACHER,
      firstName: "DIEGO",
      lastName: "AQUINO",
      email: "diego.aquino@deped.gov.ph",
    },
  });

  // Create Admin
  await prisma.user.upsert({
    where: { username: "1000001" },
    update: {
      password: adminPassword,
      firstName: "System",
      lastName: "Admin",
    },
    create: {
      username: "1000001",
      password: adminPassword,
      role: Role.ADMIN,
      firstName: "System",
      lastName: "Admin",
    },
  });

  // Create Registrar
  await prisma.user.upsert({
    where: { username: "1000002" },
    update: {
      password: registrarPassword,
      firstName: "School",
      lastName: "Registrar",
    },
    create: {
      username: "1000002",
      password: registrarPassword,
      role: Role.REGISTRAR,
      firstName: "School",
      lastName: "Registrar",
    },
  });

  // Create Teacher profile
  const teacher = await prisma.teacher.upsert({
    where: { employeeId: "3179586" },
    update: {
      userId: teacherUser.id,
      specialization: "MATH",
    },
    create: {
      userId: teacherUser.id,
      employeeId: "3179586",
      specialization: "MATH",
    },
  });

  // Create Teacher 2 (English)
  const teacher2User = await prisma.user.upsert({
    where: { username: "teacher2" },
    update: {
      firstName: "Maria",
      lastName: "Santos",
      email: "maria.santos@school.edu.ph",
      password: teacherPassword,
    },
    create: {
      username: "teacher2",
      password: teacherPassword,
      role: Role.TEACHER,
      firstName: "Maria",
      lastName: "Santos",
      email: "maria.santos@school.edu.ph",
    },
  });

  const teacher2 = await prisma.teacher.upsert({
    where: { userId: teacher2User.id },
    update: {},
    create: {
      userId: teacher2User.id,
      employeeId: "EMP-2024-002",
      specialization: "English",
    },
  });

  // Create extra teachers for variety
  const otherTeachers = [
    { username: "teacher3", firstName: "Jose", lastName: "Reyes", spec: "Science" },
    { username: "teacher4", firstName: "Carmen", lastName: "Dela Cruz", spec: "Filipino" },
    { username: "teacher5", firstName: "Roberto", lastName: "Gonzales", spec: "Araling Panlipunan" },
    { username: "teacher6", firstName: "Patricia", lastName: "Ramos", spec: "MAPEH" },
  ];

  const createdTeachers = [];
  for (const t of otherTeachers) {
    const user = await prisma.user.upsert({
      where: { username: t.username },
      update: { password: teacherPassword },
      create: {
        username: t.username,
        password: teacherPassword,
        role: Role.TEACHER,
        firstName: t.firstName,
        lastName: t.lastName,
        email: `${t.username}@school.edu.ph`,
      },
    });
    const profile = await prisma.teacher.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        userId: user.id,
        employeeId: `EMP-2024-${t.username.slice(-1)}`,
        specialization: t.spec,
      },
    });
    createdTeachers.push(profile);
  }

  // Create Subjects for all grade levels
  const subjects = [
    { code: "MATH7", name: "Mathematics 7", type: SubjectType.CORE, ww: 30, pt: 50, qa: 20 },
    { code: "ENG7", name: "English 7", type: SubjectType.CORE, ww: 30, pt: 50, qa: 20 },
    { code: "SCI7", name: "Science 7", type: SubjectType.CORE, ww: 30, pt: 50, qa: 20 },
  ];

  for (const subject of subjects) {
    await prisma.subject.upsert({
      where: { code: subject.code },
      update: {},
      create: {
        code: subject.code,
        name: subject.name,
        type: subject.type,
        writtenWorkWeight: subject.ww,
        perfTaskWeight: subject.pt,
        quarterlyAssessWeight: subject.qa,
      },
    });
  }

  const math7 = await prisma.subject.findUnique({ where: { code: "MATH7" } });
  const eng7 = await prisma.subject.findUnique({ where: { code: "ENG7" } });

  // Create Sections
  const schoolYear = "2025-2026";
  const sectionEinstein = await prisma.section.upsert({
    where: { name_gradeLevel_schoolYear: { name: "Einstein", gradeLevel: GradeLevel.GRADE_7, schoolYear } },
    update: { adviserId: teacher.id },
    create: {
      name: "Einstein",
      gradeLevel: GradeLevel.GRADE_7,
      schoolYear,
      adviserId: teacher.id,
    },
  });

  // Create specific learner: ROXAS, SERGIO I. (122516700045)
  const specialLearner = await prisma.student.upsert({
    where: { lrn: "122516700045" },
    update: {
      firstName: "SERGIO",
      middleName: "I.",
      lastName: "ROXAS",
    },
    create: {
      lrn: "122516700045",
      firstName: "SERGIO",
      middleName: "I.",
      lastName: "ROXAS",
      gender: "Male",
      birthDate: new Date(2012, 0, 1),
      address: "Manila",
    },
  });

  await prisma.enrollment.create({
    data: {
      studentId: specialLearner.id,
      sectionId: sectionEinstein.id,
      schoolYear,
      status: "ENROLLED",
    },
  });

  // Create class assignments
  await prisma.classAssignment.upsert({
    where: { teacherId_subjectId_sectionId_schoolYear: { teacherId: teacher.id, subjectId: math7!.id, sectionId: sectionEinstein.id, schoolYear } },
    update: {},
    create: {
      teacherId: teacher.id,
      subjectId: math7!.id,
      sectionId: sectionEinstein.id,
      schoolYear,
    },
  });

  // System settings
  await prisma.systemSettings.upsert({
    where: { id: "main" },
    update: {},
    create: {
      id: "main",
      schoolName: "Hinigaran National High School",
      schoolId: "300847",
      division: "Division of Silay",
      region: "Region VI - Western Visayas",
      currentSchoolYear: "2025-2026",
      currentTerm: Term.T1,
    },
  });

  console.log("Seed completed successfully!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
