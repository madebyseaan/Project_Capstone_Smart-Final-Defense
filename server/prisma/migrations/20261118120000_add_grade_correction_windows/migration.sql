-- Add correction-window states and fields for grade edit requests.

ALTER TYPE "EditRequestStatus" ADD VALUE IF NOT EXISTS 'WINDOW_OPEN';
ALTER TYPE "EditRequestStatus" ADD VALUE IF NOT EXISTS 'REFINALIZED';
ALTER TYPE "EditRequestStatus" ADD VALUE IF NOT EXISTS 'DECLINED';

ALTER TABLE "GradeEditRequest"
  ADD COLUMN IF NOT EXISTS "windowRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "approvedHours" INTEGER,
  ADD COLUMN IF NOT EXISTS "windowOpenedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "windowOpenedById" TEXT,
  ADD COLUMN IF NOT EXISTS "windowOpenedByName" TEXT,
  ADD COLUMN IF NOT EXISTS "windowClosedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "refinalizedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "refinalizedById" TEXT,
  ADD COLUMN IF NOT EXISTS "refinalizedByName" TEXT,
  ADD COLUMN IF NOT EXISTS "declineReason" TEXT,
  ADD COLUMN IF NOT EXISTS "unfinalizedGradeCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "baseline" JSONB;

CREATE INDEX IF NOT EXISTS "GradeEditRequest_status_schoolYear_idx"
  ON "GradeEditRequest"("status", "schoolYear");

CREATE INDEX IF NOT EXISTS "GradeEditRequest_windowRequired_status_idx"
  ON "GradeEditRequest"("windowRequired", "status");

CREATE INDEX IF NOT EXISTS "GradeEditRequest_classAssignmentId_term_idx"
  ON "GradeEditRequest"("classAssignmentId", "term");
