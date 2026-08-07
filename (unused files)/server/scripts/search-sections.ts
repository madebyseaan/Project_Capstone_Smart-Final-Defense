import 'dotenv/config';
import { getAllIntegrationV1Sections } from '../src/lib/enrollproClient';

async function main() {
  const id = 55; // 2026-2027
  console.log(`--- Searching for "Crop Production" in SY ${id} ---`);
  try {
    const sections = await getAllIntegrationV1Sections(id);
    const matches = sections.filter((s: any) => s.name.toLowerCase().includes('crop production'));
    
    if (matches.length > 0) {
      console.log(`Found ${matches.length} matching sections:`);
      console.log(JSON.stringify(matches, null, 2));
    } else {
      console.log('No sections matching "crop production" found.');
      // Print ALL section names to a file so I can inspect manually
      const names = sections.map((s: any) => `${s.id}: ${s.name} (${s.gradeLevel?.name})`).join('\n');
      const fs = require('fs');
      fs.writeFileSync('sy55_sections.txt', names);
      console.log('Wrote 126 section names to sy55_sections.txt');
    }

  } catch (err: any) {
    console.error(err.message);
  }
}

main().catch(console.error);
