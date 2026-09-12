-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "alsAePasser" BOOLEAN DEFAULT false,
ADD COLUMN     "elementaryGeneralAverage" DOUBLE PRECISION,
ADD COLUMN     "elementarySchoolCompleter" BOOLEAN DEFAULT false,
ADD COLUMN     "elementarySchoolName" TEXT,
ADD COLUMN     "peptExamDate" TIMESTAMP(3),
ADD COLUMN     "peptPasser" BOOLEAN DEFAULT false,
ADD COLUMN     "peptRating" DOUBLE PRECISION;
