
import 'dotenv/config';
import { prisma } from "../src/lib/prisma";

async function main() {
  const teacherName = "Ricardo Villanueva";
  const teacher = await prisma.user.findFirst({
    where: { name: teacherName },
    include: {
      staffAdvisoryMemberships: {
        include: {
          advisory: {
            include: { schoolYear: true }
          }
        }
      }
    }
  });

  const settings = await prisma.systemSettings.findFirst();
  const currentYearId = settings?.currentSchoolYearId;
  const currentYear = await prisma.schoolYear.findUnique({ where: { id: currentYearId } });

  console.log(`Current School Year: ${currentYear?.label || "Unknown"}`);

  if (teacher && teacher.staffAdvisoryMemberships) {
    const currentYearAdvisories = teacher.staffAdvisoryMemberships.filter(
      m => m.advisory.schoolYearId === currentYearId
    );
    console.log(`Advisory count in current year: ${currentYearAdvisories.length}`);

    const allAdvisories = teacher.staffAdvisoryMemberships
      .map(m => m.advisory)
      .sort((a, b) => b.schoolYear.startDate.getTime() - a.schoolYear.startDate.getTime());

    if (allAdvisories.length > 0) {
      console.log(`Latest Advisory: ${allAdvisories[0].name} (${allAdvisories[0].schoolYear.label})`);
    } else {
      console.log("No advisories found.");
    }
  } else {
    console.log("Teacher not found.");
  }
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
