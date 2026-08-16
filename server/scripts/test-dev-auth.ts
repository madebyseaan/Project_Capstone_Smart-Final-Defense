import "dotenv/config";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma";

async function verifyDevAuth() {
  console.log("=== UNIVERSAL DEVELOPER LOGIN VERIFICATION ===");

  // 1. Check Dev User in Database
  const user = await prisma.user.findFirst({
    where: { username: "999999" },
    include: { teacher: true },
  });

  if (!user) {
    throw new Error("Dev User 999999 not found in database!");
  }
  console.log(`✓ User found: ${user.firstName} ${user.lastName} (${user.username})`);
  console.log(`✓ Role: ${user.role}, Email: ${user.email}`);

  // 2. Verify Password Match
  const isMatch = await bcrypt.compare("dev123", user.password);
  if (!isMatch) {
    throw new Error("Password verification failed for dev123!");
  }
  console.log("✓ Password 'dev123' successfully matches bcrypt hash in DB.");

  // 3. Verify Teacher Profile
  if (!user.teacher) {
    throw new Error("Linked Teacher profile not found for dev user!");
  }
  console.log(`✓ Linked Teacher profile found (Employee ID: ${user.teacher.employeeId})`);

  // 4. Verify Class Assignments
  const assignments = await prisma.classAssignment.findMany({
    where: { teacherId: user.teacher.id },
    include: { subject: true, section: true },
  });
  console.log(`✓ Linked Class Assignments (${assignments.length}):`, assignments.map(a => `${a.subject.name} - ${a.section.name}`));

  // 5. Verify Token Generation & Authorization
  const token = jwt.sign(
    {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      isDeveloper: true,
    },
    process.env.JWT_SECRET || "fallback-secret",
    { expiresIn: "24h" }
  );

  const decoded = jwt.verify(token, process.env.JWT_SECRET || "fallback-secret") as any;
  console.log("✓ JWT Token generated and decoded successfully:", {
    id: decoded.id,
    username: decoded.username,
    role: decoded.role,
    isDeveloper: decoded.isDeveloper,
  });

  console.log("\n=== ALL DEVELOPER AUTHENTICATION CHECKS PASSED ===");
}

verifyDevAuth()
  .catch((e) => {
    console.error("Verification failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
