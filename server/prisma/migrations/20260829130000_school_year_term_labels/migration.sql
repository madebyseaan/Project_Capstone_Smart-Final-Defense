-- AlterTable: Add configurable term display labels to SchoolYear
ALTER TABLE "SchoolYear" ADD COLUMN "termLabelT1" TEXT NOT NULL DEFAULT 'Quarterly 1';
ALTER TABLE "SchoolYear" ADD COLUMN "termLabelT2" TEXT NOT NULL DEFAULT 'Quarterly 2';
ALTER TABLE "SchoolYear" ADD COLUMN "termLabelT3" TEXT NOT NULL DEFAULT 'Quarterly 3';
