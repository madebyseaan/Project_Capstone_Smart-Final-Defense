import "dotenv/config";
import { ensureDevAccount } from "../src/lib/ensureDevAccount";
import { prisma } from "../src/lib/prisma";

async function run() {
  console.log("Ensuring Dev Account...");
  await ensureDevAccount();
  console.log("Checking Dev Account in DB...");
  const devUser = await prisma.user.findFirst({
    where: { username: "999999" },
    include: { teacher: { include: { classAssignments: true } } },
  });
  console.log("Dev User Details:", JSON.stringify(devUser, null, 2));
}

run()
  .catch((e) => {
    console.error("Error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
