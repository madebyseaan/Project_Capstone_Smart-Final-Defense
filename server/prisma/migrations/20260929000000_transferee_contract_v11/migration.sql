-- CreateEnum
CREATE TYPE "Sf9EligibilityStatus" AS ENUM ('PROMOTED', 'CONDITIONALLY_PROMOTED', 'RETAINED');

-- AlterTable
ALTER TABLE "Enrollment" ADD COLUMN     "conditionalSubjectCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "hasSf9" BOOLEAN,
ADD COLUMN     "isTemporarilyEnrolled" BOOLEAN,
ADD COLUMN     "sf9EligibilityStatus" "Sf9EligibilityStatus",
ADD COLUMN     "transfereeDetailsSyncedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "hasPsa" BOOLEAN,
ADD COLUMN     "originatingSchoolId" TEXT,
ADD COLUMN     "previousGenAve" DOUBLE PRECISION;
