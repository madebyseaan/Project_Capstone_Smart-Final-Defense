import 'dotenv/config';
import { runEnrollProSync } from '../src/lib/enrollproSync';

async function main() {
  console.log('Starting forced EnrollPro Sync...');
  const result = await runEnrollProSync();
  console.log('Sync result:', result);
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
