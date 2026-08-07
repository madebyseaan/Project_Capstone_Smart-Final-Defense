import 'dotenv/config';
import { getIntegrationV1LearnersPage } from '../src/lib/enrollproClient';

async function main() {
  for (let id = 50; id <= 60; id++) {
    try {
      const response = await fetch(`https://dev-jegs.buru-degree.ts.net/api/integration/v1/sections?schoolYearId=${id}&limit=1`);
      const result: any = await response.json();
      if (result.meta?.total > 0) {
        const syLabel = result.data?.[0]?.schoolYear?.yearLabel || 'Unknown';
        console.log(`SY ID ${id}: ${syLabel} | Sections: ${result.meta.total}`);
        if (JSON.stringify(result.data).includes('Crop Production')) {
            console.log(`>>> FOUND Crop Production in SY ID ${id}`);
        }
      }
    } catch (err) {}
  }
}

main().catch(console.error);
