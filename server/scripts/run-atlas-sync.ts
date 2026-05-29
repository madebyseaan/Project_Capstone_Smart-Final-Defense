import 'dotenv/config';
import { runAtlasSync } from '../src/lib/atlasSync';

async function main() {
  console.log('Running ATLAS sync...');
  const result = await runAtlasSync();
  console.log('ATLAS sync result:');
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => {
    process.exit(0);
  });
