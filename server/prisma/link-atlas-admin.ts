/**
 * link-atlas-admin.ts
 *
 * Explicitly links one ATLAS identity subject to one existing SMART ADMIN.
 * SSO never creates or relinks accounts automatically.
 *
 * Usage:
 *   pnpm --prefix server exec ts-node prisma/link-atlas-admin.ts --list
 *   pnpm --prefix server exec ts-node prisma/link-atlas-admin.ts --username admin --subject "ATLAS_USER:123"
 *   pnpm --prefix server exec ts-node prisma/link-atlas-admin.ts --username admin --unlink
 */
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
      where: { role: "ADMIN" },
      select: { id: true, username: true, status: true, atlasSubject: true },
      orderBy: { username: "asc" },
    });
    for (const user of users) {
      console.log(`${user.username}\t${user.status}\tatlasSubject=${user.atlasSubject ?? "(none)"}`);
    }
    return;
  }

  const username = argValue("--username");
  if (!username) {
    console.error("Usage: --username <smart-admin-username> --subject <ATLAS_USER:id> | --unlink | --list");
    process.exitCode = 1;
    return;
  }

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    console.error(`SMART user not found: ${username}`);
    process.exitCode = 1;
    return;
  }
  if (user.role !== "ADMIN") {
    console.error(`Refusing to link ${username}: role is ${user.role}, not ADMIN.`);
    process.exitCode = 1;
    return;
  }

  if (process.argv.includes("--unlink")) {
    await prisma.user.update({ where: { id: user.id }, data: { atlasSubject: null } });
    console.log(`Unlinked ATLAS subject from ${username}.`);
    return;
  }

  const subject = argValue("--subject");
  if (!subject) {
    console.error("Missing --subject. Expected a stable ATLAS subject such as ATLAS_USER:123.");
    process.exitCode = 1;
    return;
  }

  try {
    await prisma.user.update({ where: { id: user.id }, data: { atlasSubject: subject } });
    console.log(`Linked ${username} to ${subject}.`);
  } catch (error) {
    console.error(`Could not link ${username} to ${subject}. The subject may already be linked to another account.`);
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
