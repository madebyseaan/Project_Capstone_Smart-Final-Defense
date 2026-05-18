import 'dotenv/config';
import { getEnrollProEosySections } from '../src/lib/enrollproClient';
import { resolveEnrollProSchoolYear } from '../src/lib/enrollproClient';

async function main() {
  console.log('Checking EnrollPro EOSY Sections...');
  try {
    const sy = await resolveEnrollProSchoolYear();
    console.log(`Current School Year in EnrollPro: ${sy.yearLabel} (ID: ${sy.id})`);
    
    const data = await getEnrollProEosySections(sy.id);
    const sections = data.sections ?? data.data ?? data ?? [];
    console.log('Successfully reached EnrollPro EOSY endpoint.');
    console.log('EOSY Sections returned:', sections.length);
    
    if (sections.length > 0) {
      const targetSectionId = 2753; // ALTAIR
      console.log(`Checking records for Section ID: ${targetSectionId}...`);
      const { getEnrollProEosySectionRecords } = require('../src/lib/enrollproClient');
      const recordsData = await getEnrollProEosySectionRecords(targetSectionId);
      const records = recordsData.records ?? recordsData.learners ?? recordsData.data ?? [];
      console.log(`Records returned: ${records.length}`);
      
      if (records.length > 0) {
        console.log('Sample Record:', JSON.stringify(records[0], null, 2));
      }
    }
  } catch (err: any) {
    console.error('Error reaching EnrollPro:', err.message);
  }
}

main().catch(console.error);
