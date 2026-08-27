-- AlterTable: Make Subject weight columns nullable so overrides are optional
ALTER TABLE "Subject" ALTER COLUMN "writtenWorkWeight" DROP NOT NULL,
ALTER COLUMN "writtenWorkWeight" DROP DEFAULT,
ALTER COLUMN "perfTaskWeight" DROP NOT NULL,
ALTER COLUMN "perfTaskWeight" DROP DEFAULT,
ALTER COLUMN "quarterlyAssessWeight" DROP NOT NULL,
ALTER COLUMN "quarterlyAssessWeight" DROP DEFAULT;

-- Reset all subject weights to NULL (overrides off by default)
UPDATE "Subject" SET "writtenWorkWeight" = NULL, "perfTaskWeight" = NULL, "quarterlyAssessWeight" = NULL;
