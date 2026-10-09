-- CreateTable
CREATE TABLE "EcrSync" (
    "id" TEXT NOT NULL,
    "classAssignmentId" TEXT NOT NULL,
    "term" "Term" NOT NULL,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EcrSync_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EcrSync_classAssignmentId_term_key" ON "EcrSync"("classAssignmentId", "term");

-- AddForeignKey
ALTER TABLE "EcrSync" ADD CONSTRAINT "EcrSync_classAssignmentId_fkey" FOREIGN KEY ("classAssignmentId") REFERENCES "ClassAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
