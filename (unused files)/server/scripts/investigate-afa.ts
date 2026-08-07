import 'dotenv/config';
import { getAllIntegrationV1Sections } from '../src/lib/enrollproClient';

async function main() {
  const id = 55; // 2026-2027
  console.log(`--- Investigating Section: AFA - Crop Production - A in SY ${id} ---`);
  try {
    const sections = await getAllIntegrationV1Sections(id);
    const target = sections.find((s: any) => s.name.includes('AFA - Crop Production - A'));
    
    if (target) {
      console.log('Section Found in API:');
      console.log(JSON.stringify(target, null, 2));
    } else {
      console.log('Section NOT found in the list of 126 sections for SY 55.');
      // List a few to see naming convention
      console.log('Naming convention sample:');
      sections.slice(0, 5).forEach((s: any) => console.log(` - ${s.name} (${s.gradeLevel?.name})`));
    }

  } catch (err: any) {
    console.error(err.message);
  }
}

main().catch(console.error);
