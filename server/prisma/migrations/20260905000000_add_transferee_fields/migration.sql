-- AlterTable
ALTER TABLE "Student" ADD COLUMN "previousSchool" TEXT,
ADD COLUMN "lastGradeCompleted" TEXT,
ADD COLUMN "transferCertNo" TEXT;

-- AlterTable
ALTER TABLE "Enrollment" ADD COLUMN "transferInDate" TIMESTAMPTZ(3);
