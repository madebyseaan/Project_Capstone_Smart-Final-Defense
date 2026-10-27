-- CreateEnum
CREATE TYPE "ObservedValueRating" AS ENUM ('AO', 'SO', 'RO', 'NO');

-- CreateTable
CREATE TABLE "StudentObservedValue" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "schoolYear" TEXT NOT NULL,
    "term" "Term" NOT NULL,
    "behaviorCode" TEXT NOT NULL,
    "rating" "ObservedValueRating" NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentObservedValue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudentObservedValue_studentId_schoolYear_term_idx" ON "StudentObservedValue"("studentId", "schoolYear", "term");

-- CreateIndex
CREATE INDEX "StudentObservedValue_schoolYear_term_idx" ON "StudentObservedValue"("schoolYear", "term");

-- CreateIndex
CREATE UNIQUE INDEX "StudentObservedValue_studentId_schoolYear_term_behaviorCode_key" ON "StudentObservedValue"("studentId", "schoolYear", "term", "behaviorCode");

-- AddForeignKey
ALTER TABLE "StudentObservedValue" ADD CONSTRAINT "StudentObservedValue_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
