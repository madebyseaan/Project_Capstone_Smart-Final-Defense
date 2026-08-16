/**
 * One-time migration: Normalize ALL Subject.name values.
 * Compares each name against resolveSubjectName(code) and fixes mismatches.
 *
 * Usage: npx ts-node scripts/fix-subject-names.ts [--dry-run]
 */
import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
import { resolveSubjectName } from '../src/lib/atlasUtils';

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log(`[fix-subject-names] Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);

  const subjects = await prisma.subject.findMany({
    select: { id: true, code: true, name: true },
    orderBy: { code: 'asc' },
  });

  let updated = 0;
  let skipped = 0;

  for (const subject of subjects) {
    const properName = resolveSubjectName(subject.code);

    if (properName === subject.name) {
      skipped++;
      continue;
    }

    console.log(`  ${subject.code}: "${subject.name}" → "${properName}"`);

    if (!dryRun) {
      await prisma.subject.update({
        where: { id: subject.id },
        data: { name: properName },
      });
    }
    updated++;
  }

  console.log(`\n[fix-subject-names] Done. Updated: ${updated}, Skipped (already correct): ${skipped}`);
}

main().catch((err) => {
  console.error('[fix-subject-names] Error:', err);
  process.exit(1);
});
