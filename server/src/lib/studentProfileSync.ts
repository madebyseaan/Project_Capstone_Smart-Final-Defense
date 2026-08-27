/**
 * studentProfileSync.ts
 *
 * Dedicated hourly sync for student profile enrichment fields.
 * Fetches ALL students from EnrollPro Integration v1, then fetches
 * /students/:id detail for each student needing enrichment.
 *
 * Runs as Step 4 in the sync coordinator (every 12th cycle = hourly).
 * Replaces the old on-demand enrichment approach.
 */

import { prisma } from './prisma';
import { logger } from './logger';
import {
  getAllIntegrationV1Learners,
  getEnrollProStudentDetail,
} from './enrollproClient';

const CONCURRENCY_LIMIT = 10;
const DELAY_BETWEEN_BATCHES_MS = 200;
const MAX_DETAIL_RETRIES = 2;

export interface StudentProfileSyncResult {
  enriched: number;
  skipped: number;
  errors: string[];
}

/**
 * Extract fields from EnrollPro student detail response.
 * Handles nested object format (currentAddress, guardianInfo, etc.)
 */
function extractDetailFields(incoming: any): Record<string, any> {
  const address = incoming.address
    || (incoming.currentAddress
      ? [incoming.currentAddress.houseNoStreet, incoming.currentAddress.barangay, incoming.currentAddress.cityMunicipality, incoming.currentAddress.province].filter(Boolean).join(', ')
      : null)
    || null;

  const guardianName = incoming.parentGuardianName
    || (incoming.guardianInfo ? `${incoming.guardianInfo.firstName ?? ''} ${incoming.guardianInfo.lastName ?? ''}`.trim() : null)
    || null;

  const guardianContact = incoming.parentGuardianContact
    || incoming.guardianInfo?.contactNumber
    || null;

  const barangay = incoming.barangay || incoming.currentAddress?.barangay || null;
  const city = incoming.city || incoming.municipality || incoming.currentAddress?.cityMunicipality || null;
  const province = incoming.province || incoming.currentAddress?.province || null;

  // fatherName/motherName may be string OR nested object {firstName, lastName, contactNumber}
  const fatherObj = (incoming.fatherName && typeof incoming.fatherName === 'object') ? incoming.fatherName : null;
  const motherObj = (incoming.motherName && typeof incoming.motherName === 'object') ? incoming.motherName : null;

  const fatherName = (typeof incoming.fatherName === 'string' ? incoming.fatherName : null)
    || (fatherObj ? `${fatherObj.firstName ?? ''} ${fatherObj.lastName ?? ''}`.trim() : null)
    || null;
  const fatherContact = incoming.fatherContact || fatherObj?.contactNumber || null;
  const motherName = (typeof incoming.motherName === 'string' ? incoming.motherName : null)
    || (motherObj ? `${motherObj.firstName ?? ''} ${motherObj.lastName ?? ''}`.trim() : null)
    || null;
  const motherContact = incoming.motherContact || motherObj?.contactNumber || null;

  const ipCommunity = incoming.ipCommunity === true || incoming.isIpCommunity === true
    || String(incoming.ipCommunity ?? '').toUpperCase() === 'YES'
    || String(incoming.isIpCommunity ?? '').toUpperCase() === 'YES';
  const is4PsBeneficiary = incoming.is4PsBeneficiary === true
    || String(incoming.is4PsBeneficiary ?? '').toUpperCase() === 'YES';
  const disability = incoming.disability || (incoming.isLearnerWithDisability ? 'Yes' : null) || null;
  const isBalikAral = incoming.isBalikAral === true
    || String(incoming.isBalikAral ?? '').toUpperCase() === 'YES';

  return {
    address,
    guardianName,
    guardianContact,
    religion: incoming.religion ?? null,
    motherTongue: incoming.motherTongue ?? null,
    barangay,
    city,
    province,
    fatherName,
    fatherContact,
    motherName,
    motherContact,
    ipCommunity,
    is4PsBeneficiary,
    disability,
    isBalikAral,
  };
}

/**
 * Run the student profile enrichment sync.
 * Fetches all learners from EnrollPro, then fetches detail for each.
 */
export async function runStudentProfileSync(): Promise<StudentProfileSyncResult> {
  const result: StudentProfileSyncResult = { enriched: 0, skipped: 0, errors: [] };
  const startTime = Date.now();

  logger.debug('[StudentProfileSync] Starting student profile enrichment sync...');

  try {
    // Step 1: Fetch all learners from EnrollPro Integration v1
    let allLearners: any[];
    try {
      allLearners = await getAllIntegrationV1Learners();
    } catch (err: any) {
      result.errors.push(`Failed to fetch learners: ${err.message}`);
      return result;
    }

    // Build LRN → EnrollPro student ID map
    const lrnToEpId = new Map<string, number>();
    for (const record of allLearners) {
      const learner = record.learner;
      if (learner?.lrn && learner?.id) {
        lrnToEpId.set(learner.lrn, Number(learner.id));
      }
    }

    logger.debug(`[StudentProfileSync] Mapped ${lrnToEpId.size} LRNs to EnrollPro student IDs`);

    // Step 2: Get all existing students from DB
    const existingStudents = await prisma.student.findMany({
      select: {
        id: true, lrn: true, address: true, guardianName: true, guardianContact: true,
        religion: true, motherTongue: true, barangay: true, city: true, province: true,
        fatherName: true, fatherContact: true, motherName: true, motherContact: true,
        ipCommunity: true, is4PsBeneficiary: true, disability: true, isBalikAral: true,
      },
    });

    // Filter to students needing enrichment
    const needsEnrichment = existingStudents.filter(s =>
      !s.address || !s.guardianName || !s.guardianContact ||
      !s.religion || !s.motherTongue || !s.fatherName || !s.motherName ||
      !s.barangay || !s.city || !s.province
    );

    logger.debug(`[StudentProfileSync] ${needsEnrichment.length} of ${existingStudents.length} students need enrichment`);

    if (needsEnrichment.length === 0) {
      logger.info('[StudentProfileSync] All students already enriched. Skipping.');
      return result;
    }

    // Step 3: Fetch detail for each student needing enrichment
    const updates: Array<{ id: string; data: Record<string, any> }> = [];

    for (let i = 0; i < needsEnrichment.length; i += CONCURRENCY_LIMIT) {
      const batch = needsEnrichment.slice(i, i + CONCURRENCY_LIMIT);

      const fetchPromises = batch.map(async (student) => {
        const epId = lrnToEpId.get(student.lrn);
        if (!epId) {
          result.skipped++;
          return;
        }

        let detail = null;
        for (let retry = 0; retry <= MAX_DETAIL_RETRIES; retry++) {
          try {
            detail = await getEnrollProStudentDetail(epId);
            break;
          } catch (err: any) {
            if (retry < MAX_DETAIL_RETRIES) {
              await new Promise(r => setTimeout(r, Math.pow(2, retry) * 500));
            } else {
              result.errors.push(`Detail fetch failed for LRN ${student.lrn}: ${err.message}`);
            }
          }
        }

        if (!detail) {
          result.skipped++;
          return;
        }

        // EnrollPro wraps response as { student: {...}, historicalGrades: [...] }
        const detailData = (detail as any)?.student ?? detail;
        const fields = extractDetailFields(detailData);

        // Only update fields that are currently null (non-destructive)
        const needsUpdate =
          (fields.address && !student.address) ||
          (fields.guardianName && !student.guardianName) ||
          (fields.guardianContact && !student.guardianContact) ||
          (fields.religion && !student.religion) ||
          (fields.motherTongue && !student.motherTongue) ||
          (fields.barangay && !student.barangay) ||
          (fields.city && !student.city) ||
          (fields.province && !student.province) ||
          (fields.fatherName && !student.fatherName) ||
          (fields.motherName && !student.motherName);

        if (needsUpdate) {
          updates.push({
            id: student.id,
            data: {
              address: fields.address || student.address,
              guardianName: fields.guardianName || student.guardianName,
              guardianContact: fields.guardianContact || student.guardianContact,
              religion: fields.religion || student.religion,
              motherTongue: fields.motherTongue || student.motherTongue,
              barangay: fields.barangay || student.barangay,
              city: fields.city || student.city,
              province: fields.province || student.province,
              fatherName: fields.fatherName || student.fatherName,
              fatherContact: fields.fatherContact || student.fatherContact,
              motherName: fields.motherName || student.motherName,
              motherContact: fields.motherContact || student.motherContact,
              ipCommunity: fields.ipCommunity ?? student.ipCommunity,
              is4PsBeneficiary: fields.is4PsBeneficiary ?? student.is4PsBeneficiary,
              disability: fields.disability || student.disability,
              isBalikAral: fields.isBalikAral ?? student.isBalikAral,
            },
          });
        } else {
          result.skipped++;
        }
      });

      await Promise.all(fetchPromises);

      // Delay between batches to respect rate limits
      if (i + CONCURRENCY_LIMIT < needsEnrichment.length) {
        await new Promise(r => setTimeout(r, DELAY_BETWEEN_BATCHES_MS));
      }
    }

    // Step 4: Batch update students
    if (updates.length > 0) {
      try {
        await prisma.$transaction(
          updates.map(u => prisma.student.update({ where: { id: u.id }, data: u.data }))
        );
        result.enriched = updates.length;
        logger.debug(`[StudentProfileSync] Batch updated ${updates.length} students`);
      } catch (err: any) {
        result.errors.push(`Batch update failed: ${err.message}`);
      }
    }

    const durationMs = Date.now() - startTime;
    logger.info(`[StudentProfileSync] Completed in ${durationMs}ms — enriched: ${result.enriched}, skipped: ${result.skipped}, errors: ${result.errors.length}`);

  } catch (err: any) {
    result.errors.push(`Sync failed: ${err.message}`);
    logger.error(`[StudentProfileSync] Failed: ${err.message}`);
  }

  return result;
}
