
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

import { 
  getIntegrationV1ActiveSchoolYear, 
  getIntegrationV1Faculty,
} from '../src/lib/enrollproClient';

async function main() {
  try {
    const activeSY = await getIntegrationV1ActiveSchoolYear();
    const faculty = await getIntegrationV1Faculty(activeSY.id);
    
    console.log(`Searching for any 'Villanueva' or 'Villanueve' in EnrollPro (SY ${activeSY.yearLabel})...`);
    const matches = faculty.filter(f => 
      f.lastName.toLowerCase().includes("villanueva") || 
      f.lastName.toLowerCase().includes("villanueve") ||
      f.firstName.toLowerCase().includes("villanueva")
    );

    if (matches.length > 0) {
      matches.forEach(m => {
        console.log(` - ${m.fullName} (${m.employeeId}) | Adviser: ${m.isClassAdviser} | Section: ${m.advisorySectionName}`);
      });
    } else {
      console.log("No one with that name found.");
    }

    console.log("\nSearching for EmpID 3520452...");
    const byEmpId = faculty.find(f => f.employeeId === "3520452");
    if (byEmpId) {
      console.log(`Found by EmpID: ${byEmpId.fullName} | Section: ${byEmpId.advisorySectionName}`);
    } else {
      console.log("No one with EmpID 3520452 found.");
    }

  } catch (err: any) {
    console.error(`Error: ${err.message}`);
  }
}

main();
