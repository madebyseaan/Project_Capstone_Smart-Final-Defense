import 'dotenv/config';
import { prisma } from '../src/lib/prisma';

async function main() {
  const students = await prisma.student.findMany({
    where: {
      OR: [
        { firstName: 'SILANG' },
        { middleName: 'SILANG' },
        { lastName: 'SILANG' },
        { firstName: 'Gloria Silang' },
        { lastName: 'Gloria Silang' },
        { firstName: 'GLORIA SILANG' },
        { lastName: 'GLORIA SILANG' }
      ]
    },
    include: {
      grades: true,
      enrollments: true
    }
  });

  students.forEach(s => {
    console.log(`ID: ${s.id}, Name: ${s.firstName} ${s.middleName} ${s.lastName}, GradeCount: ${s.grades.length}`);
  });
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
