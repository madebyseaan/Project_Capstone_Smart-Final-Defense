-- AIMS resync provenance
ALTER TABLE "AimsScore" ADD COLUMN "importedPointsEarned" DOUBLE PRECISION;
ALTER TABLE "AimsScore" ADD COLUMN "importedMaxPoints" DOUBLE PRECISION;
ALTER TABLE "AimsScore" ADD COLUMN "importedAttemptNumber" INTEGER;
ALTER TABLE "AimsScore" ADD COLUMN "importedTerm" "Term";
ALTER TABLE "Grade" ADD COLUMN "qaSource" TEXT;
ALTER TABLE "Grade" ADD COLUMN "qaAssessmentId" TEXT;

-- Backfill WW/PT baselines from the ledger value written at import time.
-- When AIMS already changed before this migration, the ledger value becomes the
-- baseline, so the change is correctly reported as drift.
UPDATE "AimsScore" a
SET "importedPointsEarned" = src.score,
    "importedMaxPoints" = src.maxscore,
    "importedAttemptNumber" = a."attemptNumber",
    "importedTerm" = a."term"
FROM (
  SELECT g."classAssignmentId", g."studentId", g."term",
         (item->>'assessmentId') AS "assessmentId",
         (item->>'score')::double precision AS score,
         (item->>'maxScore')::double precision AS maxscore
  FROM "Grade" g
  CROSS JOIN LATERAL jsonb_array_elements(
    COALESCE(g."writtenWorkScores", '[]'::jsonb) || COALESCE(g."perfTaskScores", '[]'::jsonb)
  ) item
  WHERE item->>'isAims' = 'true'
) src
WHERE a."classAssignmentId" = src."classAssignmentId"
  AND a."studentId" = src."studentId"
  AND a."term" = src."term"
  AND a."assessmentId" = src."assessmentId"
  AND a."importedAt" IS NOT NULL;

-- Backfill QA provenance where the grade's QA text matches an imported AIMS QA row.
UPDATE "Grade" g
SET "qaSource" = 'AIMS',
    "qaAssessmentId" = a."assessmentId"
FROM "AimsScore" a
WHERE a."classAssignmentId" = g."classAssignmentId"
  AND a."studentId" = g."studentId"
  AND a."term" = g."term"
  AND a."category" = 'QA'
  AND a."importedAt" IS NOT NULL
  AND g."qaDescription" = a."assessmentTitle";

UPDATE "AimsScore" a
SET "importedPointsEarned" = g."quarterlyAssessScore",
    "importedMaxPoints" = g."quarterlyAssessMax",
    "importedAttemptNumber" = a."attemptNumber",
    "importedTerm" = a."term"
FROM "Grade" g
WHERE g."classAssignmentId" = a."classAssignmentId"
  AND g."studentId" = a."studentId"
  AND g."term" = a."term"
  AND g."qaSource" = 'AIMS'
  AND g."qaAssessmentId" = a."assessmentId"
  AND a."importedAt" IS NOT NULL;

-- Remaining imported rows adopt their current AIMS values as the baseline so a
-- first "Check for updates" does not report a false change storm.
UPDATE "AimsScore"
SET "importedPointsEarned" = "pointsEarned",
    "importedMaxPoints" = "maxPoints",
    "importedAttemptNumber" = "attemptNumber",
    "importedTerm" = "term"
WHERE "importedAt" IS NOT NULL
  AND "importedPointsEarned" IS NULL;
