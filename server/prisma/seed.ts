import "dotenv/config";
import { PrismaClient, Role, GradeLevel, SubjectType, Term } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const connectionString = process.env.DATABASE_URL!;
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

async function main() {
  console.log("Starting DB seeding...");

  // Clean up existing data to prevent unique constraints or foreign key violations
  console.log("Cleaning up existing tables...");
  await prisma.auditLog.deleteMany({});
  await prisma.syncHistory.deleteMany({});
  await prisma.gradeSnapshot.deleteMany({});
  await prisma.grade.deleteMany({});
  await prisma.attendance.deleteMany({});
  await prisma.workloadEntry.deleteMany({});
  await prisma.enrollment.deleteMany({});
  await prisma.classAssignment.deleteMany({});
  await prisma.section.deleteMany({});
  await prisma.student.deleteMany({});
  await prisma.excelTemplate.deleteMany({});
  await prisma.teacher.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.systemSettings.deleteMany({});
  await prisma.gradingConfig.deleteMany({});
  await prisma.transmutationEntry.deleteMany({});
  await prisma.subject.deleteMany({});

  console.log("Tables cleaned.");

  // Password hashing
  const saltRounds = 10;
  const adminPasswordHash = bcrypt.hashSync("AdminPassword123!", saltRounds);
  const registrarPasswordHash = bcrypt.hashSync("RegistrarPassword123!", saltRounds);
  const teacherPasswordHash = bcrypt.hashSync("TeacherPassword123!", saltRounds);
  const devPasswordHash = bcrypt.hashSync("dev123", saltRounds);

  // 0. Create Dev Sean Roma (Universal Developer Account)
  console.log("Seeding Dev Sean Roma (Developer User)...");
  const devUser = await prisma.user.create({
    data: {
      username: "999999",
      password: devPasswordHash,
      role: Role.ADMIN,
      firstName: "Dev Sean",
      lastName: "Roma",
      email: "dev.sean@smart.local",
    },
  });

  const devTeacher = await prisma.teacher.create({
    data: {
      userId: devUser.id,
      employeeId: "999999",
      specialization: "Full Stack Development / All Subjects",
    },
  });

  // 1. Create Admin
  console.log("Seeding Admin User...");
  const adminUser = await prisma.user.create({
    data: {
      username: "admin",
      password: adminPasswordHash,
      role: Role.ADMIN,
      firstName: "Admin",
      lastName: "User",
      email: "admin@school.edu.ph",
    },
  });

  // 2. Create Registrar
  console.log("Seeding Registrar User...");
  const registrarUser = await prisma.user.create({
    data: {
      username: "registrar",
      password: registrarPasswordHash,
      role: Role.REGISTRAR,
      firstName: "Registrar",
      lastName: "User",
      email: "registrar@school.edu.ph",
    },
  });

  // 3. Create 5 Teachers
  console.log("Seeding 5 Teacher Users...");
  const teachersData = [
    { username: "teacher1", firstName: "Diego", lastName: "Aquino", specialization: "Mathematics", employeeId: "EMP-T01" },
    { username: "teacher2", firstName: "Maria", lastName: "Santos", specialization: "Science", employeeId: "EMP-T02" },
    { username: "teacher3", firstName: "Jose", lastName: "Reyes", specialization: "English", employeeId: "EMP-T03" },
    { username: "teacher4", firstName: "Carmen", lastName: "Dela Cruz", specialization: "Filipino", employeeId: "EMP-T04" },
    { username: "teacher5", firstName: "Roberto", lastName: "Gonzales", specialization: "Araling Panlipunan", employeeId: "EMP-T05" },
  ];

  const teachersList = [];
  for (const t of teachersData) {
    const user = await prisma.user.create({
      data: {
        username: t.username,
        password: teacherPasswordHash,
        role: Role.TEACHER,
        firstName: t.firstName,
        lastName: t.lastName,
        email: `${t.username}@school.edu.ph`,
      },
    });

    const teacher = await prisma.teacher.create({
      data: {
        userId: user.id,
        employeeId: t.employeeId,
        specialization: t.specialization,
      },
    });
    teachersList.push(teacher);
  }

  // 4. Create Section Einstein (Grade 7)
  const schoolYear = "2025-2026";
  console.log("Seeding Section & Advisory...");
  const section = await prisma.section.create({
    data: {
      name: "Diamond",
      gradeLevel: GradeLevel.GRADE_7,
      schoolYear,
      adviserId: teachersList[0].id, // 5. Advisory Assignment (Teacher 1 is Advisor)
    },
  });

  // Create 5 Core Subjects
  console.log("Seeding Subjects...");
  const subjectsData = [
    { code: "MATH7", name: "Mathematics 7", type: SubjectType.CORE },
    { code: "SCI7", name: "Science 7", type: SubjectType.CORE },
    { code: "ENG7", name: "English 7", type: SubjectType.CORE },
    { code: "FIL7", name: "Filipino 7", type: SubjectType.CORE },
    { code: "AP7", name: "Araling Panlipunan 7", type: SubjectType.CORE },
  ];

  const subjectsList = [];
  for (const s of subjectsData) {
    const subject = await prisma.subject.create({
      data: {
        code: s.code,
        name: s.name,
        type: s.type,
        writtenWorkWeight: null,
        perfTaskWeight: null,
        quarterlyAssessWeight: null,
      },
    });
    subjectsList.push(subject);
  }

  // 4. Interconnected Setup: Link 5 teachers to teach 5 subjects in Section Diamond
  console.log("Seeding Class Assignments...");
  for (let i = 0; i < 5; i++) {
    await prisma.classAssignment.create({
      data: {
        teacherId: teachersList[i].id,
        subjectId: subjectsList[i].id,
        sectionId: section.id,
        schoolYear,
        isActive: true,
      },
    });
  }

  // Also assign devTeacher to Mathematics 7 in Section Diamond for testing teacher portal
  await prisma.classAssignment.create({
    data: {
      teacherId: devTeacher.id,
      subjectId: subjectsList[0].id,
      sectionId: section.id,
      schoolYear,
      isActive: true,
    },
  });

  // 6. Bulk seed 45 Students inside Section Diamond
  console.log("Seeding 45 Students...");
  const firstNames = [
    "Juan", "Maria", "Jose", "Ana", "Pedro", "Rosa", "Carlos", "Elena", "Miguel", "Sofia",
    "Antonio", "Isabella", "Francisco", "Gabriela", "Manuel", "Andrea", "Rafael", "Carmen",
    "Gabriel", "Patricia", "Diego", "Lucia", "Fernando", "Mariana", "Ricardo", "Valentina",
    "Luis", "Camila", "Andres", "Paula", "Daniel", "Daniela", "Jorge", "Victoria", "Marco",
    "Samantha", "Adrian", "Nicole", "Christian", "Alexandra", "Javier", "Katherine", "Paolo",
    "Michelle", "Kenneth"
  ];

  const lastNames = [
    "Santos", "Reyes", "Cruz", "Garcia", "Mendoza", "Torres", "Flores", "Gonzales", "Bautista",
    "Villanueva", "Ramos", "Aquino", "Castro", "Rivera", "Dela Cruz", "Francisco", "Hernandez",
    "Lopez", "Morales", "Pascual", "Perez", "Rosario", "Salvador", "Tan", "Mercado", "Navarro",
    "Ortega", "Padilla", "Quinto", "Ramirez", "Santiago", "Valdez", "Velasco", "Aguilar",
    "Bernal", "Cabrera", "Diaz", "Espinosa", "Fernandez", "Gutierrez", "Ibarra", "Jimenez",
    "Coloma", "Legaspi", "De Leon"
  ];

  for (let i = 1; i <= 45; i++) {
    const lrn = `1225167${i.toString().padStart(5, "0")}`;
    const firstName = firstNames[(i - 1) % firstNames.length];
    const lastName = lastNames[(i - 1) % lastNames.length];

    const student = await prisma.student.create({
      data: {
        lrn,
        firstName,
        lastName,
        gender: i % 2 === 0 ? "Female" : "Male",
        birthDate: new Date(2013, 0, i),
        address: "Barangay Central",
      },
    });

    await prisma.enrollment.create({
      data: {
        studentId: student.id,
        sectionId: section.id,
        schoolYear,
        status: "ENROLLED",
      },
    });
  }

  // System Settings
  console.log("Seeding default system settings...");
  await prisma.systemSettings.upsert({
    where: { id: "main" },
    update: {},
    create: {
      id: "main",
      schoolName: "Hinigaran National High School",
      schoolId: "300847",
      division: "Division of Negros Occidental",
      region: "Region VI - Western Visayas",
      currentSchoolYear: schoolYear,
      currentTerm: Term.T1,
    },
  });

  // Transmutation Table (DepEd defaults)
  console.log("Seeding default transmutation table...");
  const transmutationData = [
    { minGrade: 99.50, maxGrade: 100.00, transmutedGrade: 100 },
    { minGrade: 97.50, maxGrade: 99.49, transmutedGrade: 99 },
    { minGrade: 96.00, maxGrade: 97.49, transmutedGrade: 98 },
    { minGrade: 95.00, maxGrade: 95.99, transmutedGrade: 97 },
    { minGrade: 94.00, maxGrade: 94.99, transmutedGrade: 96 },
    { minGrade: 93.00, maxGrade: 93.99, transmutedGrade: 95 },
    { minGrade: 92.00, maxGrade: 92.99, transmutedGrade: 94 },
    { minGrade: 91.00, maxGrade: 91.99, transmutedGrade: 93 },
    { minGrade: 90.00, maxGrade: 90.99, transmutedGrade: 92 },
    { minGrade: 89.00, maxGrade: 89.99, transmutedGrade: 91 },
    { minGrade: 88.00, maxGrade: 88.99, transmutedGrade: 90 },
    { minGrade: 87.00, maxGrade: 87.99, transmutedGrade: 89 },
    { minGrade: 86.00, maxGrade: 86.99, transmutedGrade: 88 },
    { minGrade: 85.00, maxGrade: 85.99, transmutedGrade: 87 },
    { minGrade: 84.00, maxGrade: 84.99, transmutedGrade: 86 },
    { minGrade: 83.00, maxGrade: 83.99, transmutedGrade: 85 },
    { minGrade: 82.00, maxGrade: 82.99, transmutedGrade: 84 },
    { minGrade: 81.00, maxGrade: 81.99, transmutedGrade: 83 },
    { minGrade: 80.00, maxGrade: 80.99, transmutedGrade: 82 },
    { minGrade: 79.00, maxGrade: 79.99, transmutedGrade: 81 },
    { minGrade: 78.00, maxGrade: 78.99, transmutedGrade: 80 },
    { minGrade: 77.00, maxGrade: 77.99, transmutedGrade: 79 },
    { minGrade: 76.00, maxGrade: 76.99, transmutedGrade: 78 },
    { minGrade: 75.00, maxGrade: 75.99, transmutedGrade: 77 },
    { minGrade: 73.00, maxGrade: 74.99, transmutedGrade: 76 },
    { minGrade: 70.00, maxGrade: 72.99, transmutedGrade: 75 },
    { minGrade: 68.00, maxGrade: 69.99, transmutedGrade: 74 },
    { minGrade: 66.00, maxGrade: 67.99, transmutedGrade: 73 },
    { minGrade: 64.00, maxGrade: 65.99, transmutedGrade: 72 },
    { minGrade: 62.00, maxGrade: 63.99, transmutedGrade: 71 },
    { minGrade: 60.00, maxGrade: 61.99, transmutedGrade: 70 },
    { minGrade: 58.00, maxGrade: 59.99, transmutedGrade: 69 },
    { minGrade: 56.00, maxGrade: 57.99, transmutedGrade: 68 },
    { minGrade: 54.00, maxGrade: 55.99, transmutedGrade: 67 },
    { minGrade: 52.00, maxGrade: 53.99, transmutedGrade: 66 },
    { minGrade: 50.00, maxGrade: 51.99, transmutedGrade: 65 },
    { minGrade: 48.00, maxGrade: 49.99, transmutedGrade: 64 },
    { minGrade: 46.00, maxGrade: 47.99, transmutedGrade: 63 },
    { minGrade: 43.00, maxGrade: 45.99, transmutedGrade: 62 },
    { minGrade: 40.00, maxGrade: 42.99, transmutedGrade: 61 },
    { minGrade: 0.00, maxGrade: 39.99, transmutedGrade: 60 },
  ];

  for (const entry of transmutationData) {
    await prisma.transmutationEntry.create({
      data: {
        minGrade: entry.minGrade,
        maxGrade: entry.maxGrade,
        transmutedGrade: entry.transmutedGrade,
        isDefault: true,
      },
    });
  }
  console.log(`Seeded ${transmutationData.length} transmutation entries.`);

  console.log("DB seeding completed successfully!");
}

main()
  .catch((e) => {
    console.error("Error during seeding:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
