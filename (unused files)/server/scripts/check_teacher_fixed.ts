
import 'dotenv/config';
import { prisma } from "../src/lib/prisma";

async function main() {
  const teacherFirstName = "Ricardo";
  const teacherLastName = "Villanueva";
  
  const teacher = await prisma.teacher.findFirst({
    where: {
      user: {
        firstName: teacherFirstName,
        lastName: teacherLastName
      }
    },
    include: {
      advisorySections: true,
      user: true
    }
  });

  const settings = await prisma.systemSettings.findFirst();
  const currentYear = settings?.currentSchoolYear || "Unknown";

  console.log(`Current School Year (Settings): ${currentYear}`);

  if (teacher && teacher.advisorySections) {
    const currentYearAdvisories = teacher.advisorySections.filter(
      s => s.schoolYear === currentYear
    );
    console.log(`Advisory count in current year: ${currentYearAdvisories.length}`);

    const allAdvisories = [...teacher.advisorySections].sort((a, b) => 
      b.schoolYear.localeCompare(a.schoolYear)
    );

    if (allAdvisories.length > 0) {
      console.log(`Latest Advisory: ${allAdvisories[0].name} (${allAdvisories[0].schoolYear})`);
    } else {
      console.log("No advisories found for this teacher.");
    }
  } else {
    console.log(`Teacher "${teacherFirstName} ${teacherLastName}" not found or has no advisory sections.`);
  }
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
