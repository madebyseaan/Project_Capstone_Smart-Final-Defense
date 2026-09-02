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
