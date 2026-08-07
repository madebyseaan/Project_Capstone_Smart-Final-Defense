
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

import { 
  getIntegrationV1Faculty,
} from '../src/lib/enrollproClient';

async function main() {
  const empId = "3520452";
  console.log(`Searching for EmpID ${empId} across SY IDs 1-50...`);
  
  for (let syId = 1; syId <= 50; syId++) {
    try {
      const faculty = await getIntegrationV1Faculty(syId);
      const found = faculty.find(f => f.employeeId === empId);
      if (found) {
        console.log(`✅ FOUND in SY ID ${syId}: ${found.fullName} | Section: ${found.advisorySectionName}`);
      }
    } catch {
      // Skip 404s
    }
  }
  console.log("Search complete.");
}

main();
