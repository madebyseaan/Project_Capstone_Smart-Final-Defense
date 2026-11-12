-- Per-teacher, per-school-year compressed archive bundles.
-- Additive only: no existing table or column is modified.
CREATE TABLE "TeacherYearArchive" (
    "id" TEXT NOT NULL,
    "schoolYearId" TEXT NOT NULL,
    "schoolYear" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "teacherUserId" TEXT,
    "employeeId" TEXT,
    "teacherName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "encoding" TEXT NOT NULL DEFAULT 'gzip',
    "payload" BYTEA,
    "rawBytes" INTEGER,
    "compressedBytes" INTEGER,
    "checksum" TEXT,
    "stats" JSONB,
    "dataQuality" JSONB,
    "source" TEXT NOT NULL DEFAULT 'ROLLOVER',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeacherYearArchive_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TeacherYearArchive_schoolYearId_teacherId_key"
    ON "TeacherYearArchive"("schoolYearId", "teacherId");

CREATE INDEX "TeacherYearArchive_schoolYear_status_idx"
    ON "TeacherYearArchive"("schoolYear", "status");

CREATE INDEX "TeacherYearArchive_teacherId_idx"
    ON "TeacherYearArchive"("teacherId");

ALTER TABLE "TeacherYearArchive"
    ADD CONSTRAINT "TeacherYearArchive_schoolYearId_fkey"
    FOREIGN KEY ("schoolYearId") REFERENCES "SchoolYear"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
