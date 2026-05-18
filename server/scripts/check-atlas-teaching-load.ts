import 'dotenv/config';
import { getAtlasTeachingLoadSummary, getAtlasSubjectStats } from '../src/lib/atlasSync';

async function main() {
  console.log('Checking ATLAS Teaching Loads...');
  try {
    const data = await getAtlasTeachingLoadSummary();
    console.log('Successfully reached ATLAS Teaching Load Summary.');
    const faculty = data.faculty ?? data.teachers ?? data.data ?? [];
    console.log('Faculty records returned:', faculty.length);
    
    if (faculty.length > 0) {
      console.log('Sample Faculty Record (1):', JSON.stringify(faculty[0], null, 2));
      const hasMinutes = faculty.filter((f: any) => f.totalMinutesPerWeek != null);
      console.log('Count of records with totalMinutesPerWeek:', hasMinutes.length);
      if (hasMinutes.length > 0) {
        console.log('Sample record with minutes:', JSON.stringify(hasMinutes[0], null, 2));
      }
    }

    const stats = await getAtlasSubjectStats();
    console.log('Subject Stats:', JSON.stringify(stats, null, 2));
  } catch (err: any) {
    console.error('Error reaching ATLAS:', err.message);
  }
}

main().catch(console.error);
