-- CreateEnum
CREATE TYPE "ExternalRecordSource" AS ENUM ('MANUAL', 'SF10_SCAN', 'SF9_SCAN', 'SF10_XLSX');

-- CreateTable
CREATE TABLE "ExternalSchoolRecord" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "schoolYear" TEXT NOT NULL,
    "gradeLevel" "GradeLevel" NOT NULL,
    "schoolName" TEXT NOT NULL,
    "schoolId" TEXT,
    "sectionName" TEXT,
    "adviserName" TEXT,
    "generalAverage" DOUBLE PRECISION,
    "promotionStatus" TEXT,
    "formType" TEXT NOT NULL DEFAULT 'SF10',
    "isPartialYear" BOOLEAN NOT NULL DEFAULT false,
    "source" "ExternalRecordSource" NOT NULL DEFAULT 'MANUAL',
    "ocrRawText" TEXT,
    "ocrParserVersion" TEXT,
    "confidence" DOUBLE PRECISION,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ExternalSchoolRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalSubjectRecord" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "subjectCode" TEXT,
    "subjectName" TEXT NOT NULL,
    "terms" JSONB,
    "finalRating" DOUBLE PRECISION,
    "remarks" TEXT,
    "isNonPromotional" BOOLEAN NOT NULL DEFAULT false,
    "confidence" DOUBLE PRECISION,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ExternalSubjectRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExternalSchoolRecord_studentId_idx" ON "ExternalSchoolRecord"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalSchoolRecord_studentId_schoolYear_gradeLevel_schoolName_key" ON "ExternalSchoolRecord"("studentId", "schoolYear", "gradeLevel", "schoolName");

-- CreateIndex
CREATE INDEX "ExternalSubjectRecord_recordId_idx" ON "ExternalSubjectRecord"("recordId");

-- AddForeignKey
ALTER TABLE "ExternalSchoolRecord" ADD CONSTRAINT "ExternalSchoolRecord_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalSubjectRecord" ADD CONSTRAINT "ExternalSubjectRecord_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "ExternalSchoolRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
