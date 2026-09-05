-- AlterTable: Add schoolSettingsSnapshot to SchoolYear, add schoolHeadName to SystemSettings
ALTER TABLE "SchoolYear" ADD COLUMN "schoolSettingsSnapshot" JSONB;
ALTER TABLE "SystemSettings" ADD COLUMN "schoolHeadName" TEXT;
