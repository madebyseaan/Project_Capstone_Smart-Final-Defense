import "dotenv/config";
import { prisma } from "../src/lib/prisma";

async function removeDevAccount() {
  console.log("=== CLEANING UP DEVELOPER ACCOUNT FOR DEPLOYMENT ===");

  // 1. Find Dev User
  const devUser = await prisma.user.findFirst({
    where: {
      OR: [
        { username: "999999" },
        { email: "dev.sean@smart.local" },
      ],
    },
    include: { teacher: true },
  });

  if (!devUser) {
    console.log("ℹ No developer user account (999999) found in the database. Nothing to delete.");
    return;
  }

  console.log(`Found Dev User: ${devUser.firstName} ${devUser.lastName} (ID: ${devUser.id})`);

  // 2. Delete Class Assignments linked to Dev Teacher
  if (devUser.teacher) {
    const deletedAssignments = await prisma.classAssignment.deleteMany({
      where: { teacherId: devUser.teacher.id },
    });
    console.log(`✓ Deleted ${deletedAssignments.count} class assignment(s) linked to dev teacher.`);

    // 3. Delete Teacher Profile
    await prisma.teacher.delete({
      where: { id: devUser.teacher.id },
    });
    console.log("✓ Deleted Dev Teacher profile.");
  }

  // 4. Delete Dev User
  await prisma.user.delete({
    where: { id: devUser.id },
  });
  console.log("✓ Deleted Dev User record from PostgreSQL.");

  console.log("\n=== DEVELOPER ACCOUNT CLEANUP COMPLETED SUCCESSFULLY ===");
}

removeDevAccount()
  .catch((e) => {
    console.error("Cleanup error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
