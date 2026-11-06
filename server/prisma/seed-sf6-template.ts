import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { ensureSf6Template, SF6_TEMPLATE_PATH } from "../src/lib/sf6Template";

async function main(): Promise<void> {
  const result = await ensureSf6Template(prisma);

  if (result.created) {
    console.log(`Registered SF6 template (${result.placeholderCount} placeholders).`);
    console.log(`Template file: ${SF6_TEMPLATE_PATH}`);
  } else {
    console.log("SF6 template already registered — leaving the existing template untouched.");
  }
}

main()
  .catch((error) => {
    console.error("Failed to register SF6 template:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
