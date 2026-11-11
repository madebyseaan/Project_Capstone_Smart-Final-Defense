-- AIMS SSO identity link on User (AIMS -> SMART direction)
ALTER TABLE "User" ADD COLUMN "aimsUserId" TEXT;

-- EnrollPro section ID (year-scoped) for AIMS class deep links and reverse context
ALTER TABLE "Section" ADD COLUMN "enrollproSectionId" INTEGER;

-- Unique external links. PostgreSQL allows multiple NULLs in a unique index.
CREATE UNIQUE INDEX "User_aimsUserId_key" ON "User"("aimsUserId");
CREATE INDEX "Section_enrollproSectionId_schoolYear_idx" ON "Section"("enrollproSectionId", "schoolYear");
