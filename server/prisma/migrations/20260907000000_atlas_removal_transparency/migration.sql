-- AlterTable: Add successorTeacherId and source to ClassAssignment
ALTER TABLE "ClassAssignment" ADD COLUMN "successorTeacherId" TEXT;
ALTER TABLE "ClassAssignment" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'SYNC';

-- AlterTable: Add atlasEmptyLoadSeenAt to SystemSettings
ALTER TABLE "SystemSettings" ADD COLUMN "atlasEmptyLoadSeenAt" TIMESTAMP(3);
