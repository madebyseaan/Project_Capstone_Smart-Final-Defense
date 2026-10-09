/**
 * trigger-profile-sync.ts
 *
 * Manually runs the student profile enrichment sync (normally hourly via SyncCoordinator).
 * Backfills parent/guardian/address/religion/etc. from the EnrollPro /students/:id
 * detail endpoint (Integration v1 feeds are DPA-minimized and omit these fields).
 *
 * Usage: npx ts-node scripts/trigger-profile-sync.ts
 */

import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { runStudentProfileSync } from '../src/lib/studentProfileSync';
import { prisma } from '../src/lib/prisma';

async function main() {
  console.log('[trigger-profile-sync] Starting student profile enrichment...');
  const started = Date.now();
  const result = await runStudentProfileSync();
  const elapsed = Date.now() - started;

  console.log(
    `[trigger-profile-sync] Done in ${elapsed}ms — enriched: ${result.enriched}, skipped: ${result.skipped}, errors: ${result.errors.length}`,
  );
  for (const err of result.errors) {
    console.warn(`[trigger-profile-sync] Error: ${err}`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('[trigger-profile-sync] Failed:', err);
  await prisma.$disconnect();
  process.exit(1);
});
