-- CreateEnum
CREATE TYPE "GradingMode" AS ENUM ('TRANSMUTED', 'ZERO_BASED');

-- AlterTable
ALTER TABLE "SchoolYear" ADD COLUMN "gradingMode" "GradingMode" NOT NULL DEFAULT 'TRANSMUTED';
