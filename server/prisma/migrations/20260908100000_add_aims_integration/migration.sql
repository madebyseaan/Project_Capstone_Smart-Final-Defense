-- AlterTable: Add enrollproId to Student
ALTER TABLE "Student" ADD COLUMN "enrollproId" INTEGER;

-- CreateIndex: Unique constraint on enrollproId
CREATE UNIQUE INDEX "Student_enrollproId_key" ON "Student"("enrollproId");

-- AlterTable: Add aimsCourseId to ClassAssignment
ALTER TABLE "ClassAssignment" ADD COLUMN "aimsCourseId" TEXT;

-- CreateTable: AimsScore
CREATE TABLE "AimsScore" (
    "id" TEXT NOT NULL,
    "classAssignmentId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "term" "Term" NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "assessmentTitle" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "pointsEarned" DOUBLE PRECISION NOT NULL,
    "maxPoints" DOUBLE PRECISION NOT NULL,
    "isRemedial" BOOLEAN NOT NULL DEFAULT false,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "gradedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importedAt" TIMESTAMP(3),

    CONSTRAINT "AimsScore_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: Unique constraint on (classAssignmentId, studentId, assessmentId)
CREATE UNIQUE INDEX "AimsScore_classAssignmentId_studentId_assessmentId_key" ON "AimsScore"("classAssignmentId", "studentId", "assessmentId");

-- CreateIndex: Index on (classAssignmentId, term)
CREATE INDEX "AimsScore_classAssignmentId_term_idx" ON "AimsScore"("classAssignmentId", "term");

-- CreateIndex: Index on (studentId)
CREATE INDEX "AimsScore_studentId_idx" ON "AimsScore"("studentId");

-- AddForeignKey: AimsScore → ClassAssignment
ALTER TABLE "AimsScore" ADD CONSTRAINT "AimsScore_classAssignmentId_fkey" FOREIGN KEY ("classAssignmentId") REFERENCES "ClassAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: AimsScore → Student
ALTER TABLE "AimsScore" ADD CONSTRAINT "AimsScore_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
