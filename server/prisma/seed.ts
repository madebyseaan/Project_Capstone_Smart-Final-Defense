import "dotenv/config";
import { PrismaClient, Role, Term } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const connectionString = process.env.DATABASE_URL!;
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

async function main() {
  console.log("Starting DB seeding...");

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

  const saltRounds = 10;
  const adminPasswordHash = bcrypt.hashSync("AdminPassword123!", saltRounds);
  const registrarPasswordHash = bcrypt.hashSync("RegistrarPassword123!", saltRounds);

  console.log("Seeding Admin User...");
  await prisma.user.create({
    data: {
      username: "admin",
      password: adminPasswordHash,
      role: Role.ADMIN,
      firstName: "Admin",
      lastName: "User",
      email: "admin@school.edu.ph",
    },
  });

  console.log("Seeding Registrar User...");
  await prisma.user.create({
    data: {
      username: "registrar",
      password: registrarPasswordHash,
      role: Role.REGISTRAR,
      firstName: "Registrar",
      lastName: "User",
      email: "registrar@school.edu.ph",
    },
  });

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
      currentSchoolYear: "",
      currentTerm: Term.T1,
    },
  });

  console.log("Seeding default transmutation table...");
  // Adjusted Transmutation Table (DepEd Order No. 015, s. 2026) — SY 2026-2027.
  const transmutationData = [
    { minGrade: 0.00, maxGrade: 4.67, transmutedGrade: 60 },
    { minGrade: 4.68, maxGrade: 9.34, transmutedGrade: 61 },
    { minGrade: 9.35, maxGrade: 14.00, transmutedGrade: 62 },
    { minGrade: 14.01, maxGrade: 18.67, transmutedGrade: 63 },
    { minGrade: 18.68, maxGrade: 23.34, transmutedGrade: 64 },
    { minGrade: 23.35, maxGrade: 28.00, transmutedGrade: 65 },
    { minGrade: 28.01, maxGrade: 32.67, transmutedGrade: 66 },
    { minGrade: 32.68, maxGrade: 37.33, transmutedGrade: 67 },
    { minGrade: 37.34, maxGrade: 42.00, transmutedGrade: 68 },
    { minGrade: 42.01, maxGrade: 46.66, transmutedGrade: 69 },
    { minGrade: 46.67, maxGrade: 51.33, transmutedGrade: 70 },
    { minGrade: 51.34, maxGrade: 56.00, transmutedGrade: 71 },
    { minGrade: 56.01, maxGrade: 60.66, transmutedGrade: 72 },
    { minGrade: 60.67, maxGrade: 65.33, transmutedGrade: 73 },
    { minGrade: 65.34, maxGrade: 69.99, transmutedGrade: 74 },
    { minGrade: 70.00, maxGrade: 71.17, transmutedGrade: 75 },
    { minGrade: 71.18, maxGrade: 72.35, transmutedGrade: 76 },
    { minGrade: 72.36, maxGrade: 73.53, transmutedGrade: 77 },
    { minGrade: 73.54, maxGrade: 74.71, transmutedGrade: 78 },
    { minGrade: 74.72, maxGrade: 75.89, transmutedGrade: 79 },
    { minGrade: 75.90, maxGrade: 77.07, transmutedGrade: 80 },
    { minGrade: 77.08, maxGrade: 78.25, transmutedGrade: 81 },
    { minGrade: 78.26, maxGrade: 79.43, transmutedGrade: 82 },
    { minGrade: 79.44, maxGrade: 80.61, transmutedGrade: 83 },
    { minGrade: 80.62, maxGrade: 81.79, transmutedGrade: 84 },
    { minGrade: 81.80, maxGrade: 82.97, transmutedGrade: 85 },
    { minGrade: 82.98, maxGrade: 84.15, transmutedGrade: 86 },
    { minGrade: 84.16, maxGrade: 85.33, transmutedGrade: 87 },
    { minGrade: 85.34, maxGrade: 86.51, transmutedGrade: 88 },
    { minGrade: 86.52, maxGrade: 87.69, transmutedGrade: 89 },
    { minGrade: 87.70, maxGrade: 88.87, transmutedGrade: 90 },
    { minGrade: 88.88, maxGrade: 90.05, transmutedGrade: 91 },
    { minGrade: 90.06, maxGrade: 91.23, transmutedGrade: 92 },
    { minGrade: 91.24, maxGrade: 92.41, transmutedGrade: 93 },
    { minGrade: 92.42, maxGrade: 93.59, transmutedGrade: 94 },
    { minGrade: 93.60, maxGrade: 94.77, transmutedGrade: 95 },
    { minGrade: 94.78, maxGrade: 95.95, transmutedGrade: 96 },
    { minGrade: 95.96, maxGrade: 97.13, transmutedGrade: 97 },
    { minGrade: 97.14, maxGrade: 98.31, transmutedGrade: 98 },
    { minGrade: 98.32, maxGrade: 99.49, transmutedGrade: 99 },
    { minGrade: 99.50, maxGrade: 100.00, transmutedGrade: 100 },
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
