-- Migration: Quarter → Term (3 Terms per DepEd 2026 policy)
-- Drops Q4 data, renames enum and columns

-- Step 1: Drop Q4 grade data
DELETE FROM "Grade" WHERE "quarter" = 'Q4';
DELETE FROM "GradeSnapshot" WHERE "quarter" = 'Q4';

-- Step 2: Create new Term enum
CREATE TYPE "Term" AS ENUM ('T1', 'T2', 'T3');

-- Step 3: Migrate Grade.quarter column
DO $$
BEGIN
  -- Drop the old unique constraint (Prisma naming convention)
  ALTER TABLE "Grade" DROP CONSTRAINT IF EXISTS "Grade_studentId_classAssignmentId_quarter_key";
  -- Change column type to text so we can update values
  ALTER TABLE "Grade" ALTER COLUMN "quarter" TYPE TEXT USING "quarter"::text;
  -- Map Q1→T1, Q2→T2, Q3→T3
  UPDATE "Grade" SET "quarter" = CASE "quarter"
    WHEN 'Q1' THEN 'T1'
    WHEN 'Q2' THEN 'T2'
    WHEN 'Q3' THEN 'T3'
    ELSE 'T1'
  END;
  -- Cast back to new enum
  ALTER TABLE "Grade" ALTER COLUMN "quarter" TYPE "Term" USING "quarter"::"Term";
  -- Rename column
  ALTER TABLE "Grade" RENAME COLUMN "quarter" TO "term";
  -- Re-add unique constraint
  ALTER TABLE "Grade" ADD CONSTRAINT "Grade_studentId_classAssignmentId_term_key"
    UNIQUE ("studentId", "classAssignmentId", "term");
END $$;

-- Step 4: Migrate GradeSnapshot.quarter column
DO $$
BEGIN
  -- Drop old indexes
  DROP INDEX IF EXISTS "GradeSnapshot_studentId_classAssignmentId_quarter_idx";
  DROP INDEX IF EXISTS "GradeSnapshot_classAssignmentId_quarter_idx";
  -- Change to text
  ALTER TABLE "GradeSnapshot" ALTER COLUMN "quarter" TYPE TEXT USING "quarter"::text;
  -- Map values
  UPDATE "GradeSnapshot" SET "quarter" = CASE "quarter"
    WHEN 'Q1' THEN 'T1'
    WHEN 'Q2' THEN 'T2'
    WHEN 'Q3' THEN 'T3'
    ELSE 'T1'
  END;
  -- Cast to new enum
  ALTER TABLE "GradeSnapshot" ALTER COLUMN "quarter" TYPE "Term" USING "quarter"::"Term";
  -- Rename column
  ALTER TABLE "GradeSnapshot" RENAME COLUMN "quarter" TO "term";
END $$;

-- Re-add GradeSnapshot indexes
CREATE INDEX IF NOT EXISTS "GradeSnapshot_studentId_classAssignmentId_term_idx"
  ON "GradeSnapshot"("studentId", "classAssignmentId", "term");
CREATE INDEX IF NOT EXISTS "GradeSnapshot_classAssignmentId_term_idx"
  ON "GradeSnapshot"("classAssignmentId", "term");

-- Step 5: Migrate SystemSettings
DO $$
BEGIN
  -- Migrate currentQuarter (drop default first so cast succeeds)
  ALTER TABLE "SystemSettings" ALTER COLUMN "currentQuarter" DROP DEFAULT;
  ALTER TABLE "SystemSettings" ALTER COLUMN "currentQuarter" TYPE TEXT USING "currentQuarter"::text;
  UPDATE "SystemSettings" SET "currentQuarter" = CASE "currentQuarter"
    WHEN 'Q1' THEN 'T1'
    WHEN 'Q2' THEN 'T2'
    WHEN 'Q3' THEN 'T3'
    WHEN 'Q4' THEN 'T3'
    ELSE 'T1'
  END;
  ALTER TABLE "SystemSettings" ALTER COLUMN "currentQuarter" TYPE "Term" USING "currentQuarter"::"Term";
  ALTER TABLE "SystemSettings" ALTER COLUMN "currentQuarter" SET DEFAULT 'T1'::"Term";
  ALTER TABLE "SystemSettings" RENAME COLUMN "currentQuarter" TO "currentTerm";

  -- Rename date fields
  ALTER TABLE "SystemSettings" RENAME COLUMN "q1StartDate" TO "t1StartDate";
  ALTER TABLE "SystemSettings" RENAME COLUMN "q1EndDate" TO "t1EndDate";
  ALTER TABLE "SystemSettings" RENAME COLUMN "q2StartDate" TO "t2StartDate";
  ALTER TABLE "SystemSettings" RENAME COLUMN "q2EndDate" TO "t2EndDate";
  ALTER TABLE "SystemSettings" RENAME COLUMN "q3StartDate" TO "t3StartDate";
  ALTER TABLE "SystemSettings" RENAME COLUMN "q3EndDate" TO "t3EndDate";
  ALTER TABLE "SystemSettings" DROP COLUMN IF EXISTS "q4StartDate";
  ALTER TABLE "SystemSettings" DROP COLUMN IF EXISTS "q4EndDate";

  -- Rename autoAdvanceQuarter
  ALTER TABLE "SystemSettings" RENAME COLUMN "autoAdvanceQuarter" TO "autoAdvanceTerm";
END $$;

-- Step 6: Drop old Quarter enum (now unused)
DROP TYPE "Quarter";
