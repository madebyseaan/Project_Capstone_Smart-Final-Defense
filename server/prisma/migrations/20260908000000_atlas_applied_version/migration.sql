-- Migration: Add Atlas applied-version tracking fields to SystemSettings
-- Contract: idempotency per acceptance #3 — "A POPULATED payload is applied exactly once per version"

ALTER TABLE "SystemSettings" ADD COLUMN "atlasAppliedVersion" INTEGER;
ALTER TABLE "SystemSettings" ADD COLUMN "atlasAppliedScope" TEXT;
ALTER TABLE "SystemSettings" ADD COLUMN "atlasAppliedAt" TIMESTAMP(3);
