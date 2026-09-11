-- AlterTable: Add examScores (ST1/ST2/TE breakdown) to Grade
ALTER TABLE "Grade" ADD COLUMN "examScores" JSONB;
