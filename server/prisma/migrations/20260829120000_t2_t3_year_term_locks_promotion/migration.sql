-- T2+T3 batch: per-year/per-term grade locks, persisted promotion status, non-promotional subject flag

CREATE TYPE "PromotionStatus" AS ENUM ('PROMOTED', 'CONDITIONALLY_PROMOTED', 'RETAINED', 'JHS_COMPLETER');

ALTER TABLE "Subject" ADD COLUMN "isNonPromotional" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Enrollment" ADD COLUMN "promotionStatus" "PromotionStatus";
ALTER TABLE "Enrollment" ADD COLUMN "promotedToGradeLevel" "GradeLevel";

CREATE TABLE "YearGradeLock" (
    "id" TEXT NOT NULL,
    "schoolYearId" TEXT NOT NULL,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "lockedBy" TEXT,
    "lockedAt" TIMESTAMP(3),
    "unlockedBy" TEXT,
    "unlockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "YearGradeLock_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TermGradeLock" (
    "id" TEXT NOT NULL,
    "schoolYearId" TEXT NOT NULL,
    "term" "Term" NOT NULL,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "lockedBy" TEXT,
    "lockedAt" TIMESTAMP(3),
    "unlockedBy" TEXT,
    "unlockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TermGradeLock_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "YearGradeLock_schoolYearId_key" ON "YearGradeLock"("schoolYearId");

CREATE UNIQUE INDEX "TermGradeLock_schoolYearId_term_key" ON "TermGradeLock"("schoolYearId", "term");

ALTER TABLE "YearGradeLock" ADD CONSTRAINT "YearGradeLock_schoolYearId_fkey" FOREIGN KEY ("schoolYearId") REFERENCES "SchoolYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TermGradeLock" ADD CONSTRAINT "TermGradeLock_schoolYearId_fkey" FOREIGN KEY ("schoolYearId") REFERENCES "SchoolYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;

UPDATE "Subject" SET "isNonPromotional" = true WHERE "code" ~* '^HG';

INSERT INTO "YearGradeLock" ("id", "schoolYearId", "isLocked", "lockedAt", "createdAt", "updatedAt")
SELECT md5(random()::text || clock_timestamp()::text), sy."id", true, now(), now(), now()
FROM "SchoolYear" sy
WHERE sy."status" = 'ARCHIVED'
ON CONFLICT ("schoolYearId") DO NOTHING;
