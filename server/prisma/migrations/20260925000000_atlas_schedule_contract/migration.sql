-- ATLAS term-aware published-schedule contract (pin 70a51608) companion state:
--  * AtlasCrosswalk - SMART-side ATLAS surrogate-id map (§4.3 room crosswalk +
--    §8A draft-entry name resolution)
--  * AtlasScheduleMeta - per-year `source` block: orderedTerms (label authority),
--    revisionMarker/activeRevisionId (change detection), snapshotState/snapshotGaps,
--    verbatim specialEvents[]/timeSlots[] (break bands)

-- CreateTable
CREATE TABLE "AtlasCrosswalk" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "atlasId" INTEGER NOT NULL,
    "schoolYear" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "detail" TEXT,
    "smartId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AtlasCrosswalk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AtlasScheduleMeta" (
    "id" SERIAL NOT NULL,
    "schoolYear" TEXT NOT NULL,
    "source" JSONB,
    "terms" JSONB,
    "specialEvents" JSONB,
    "timeSlots" JSONB,
    "activeTermIndex" INTEGER,
    "conflict" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AtlasScheduleMeta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AtlasCrosswalk_schoolYear_idx" ON "AtlasCrosswalk"("schoolYear");

-- CreateIndex
CREATE UNIQUE INDEX "AtlasCrosswalk_kind_atlasId_schoolYear_key" ON "AtlasCrosswalk"("kind", "atlasId", "schoolYear");

-- CreateIndex
CREATE UNIQUE INDEX "AtlasScheduleMeta_schoolYear_key" ON "AtlasScheduleMeta"("schoolYear");
