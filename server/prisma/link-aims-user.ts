import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

async function main(): Promise<void> {
  if (process.argv.includes("--list")) {
    const users = await prisma.user.findMany({
      where: { role: { in: ["ADMIN", "TEACHER"] } },
      select: { username: true, role: true, status: true, aimsUserId: true },
      orderBy: { username: "asc" },
    });
    for (const user of users) {
      console.log(`${user.username}\t${user.role}\t${user.status}\taimsUserId=${user.aimsUserId ?? "(none)"}`);
    }
    return;
  }

  const username = argValue("--username");
  if (!username) {
    console.error("Usage: --username <smart-username> --aims-user-id <aims-uuid> | --unlink | --list");
    process.exitCode = 1;
    return;
  }

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    console.error(`SMART user not found: ${username}`);
    process.exitCode = 1;
    return;
  }
  if (user.role !== "ADMIN" && user.role !== "TEACHER") {
    console.error(`Refusing to link ${username}: role is ${user.role}, not ADMIN or TEACHER.`);
    process.exitCode = 1;
    return;
  }

  if (process.argv.includes("--unlink")) {
    await prisma.user.update({ where: { id: user.id }, data: { aimsUserId: null } });
    console.log(`Unlinked AIMS identity from ${username}.`);
    return;
  }

  const aimsUserId = argValue("--aims-user-id");
  if (!aimsUserId) {
    console.error("Missing --aims-user-id. Use the identity.id from the AIMS assertion.");
    process.exitCode = 1;
    return;
  }

  try {
    await prisma.user.update({ where: { id: user.id }, data: { aimsUserId } });
    console.log(`Linked ${username} to AIMS identity ${aimsUserId}.`);
  } catch (error) {
    console.error(`Could not link ${username} to ${aimsUserId}. The AIMS identity may already be linked.`);
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
