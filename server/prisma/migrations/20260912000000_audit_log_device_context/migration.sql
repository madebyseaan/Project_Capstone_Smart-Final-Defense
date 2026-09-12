-- AlterTable: add device + network context to AuditLog
ALTER TABLE "AuditLog"
  ADD COLUMN "userAgent" TEXT,
  ADD COLUMN "browser" TEXT,
  ADD COLUMN "os" TEXT,
  ADD COLUMN "deviceType" TEXT,
  ADD COLUMN "network" TEXT,
  ADD COLUMN "outcome" TEXT,
  ADD COLUMN "requestMethod" TEXT,
  ADD COLUMN "requestPath" TEXT;

-- CreateIndex
CREATE INDEX "AuditLog_network_idx" ON "AuditLog"("network");

-- CreateIndex
CREATE INDEX "AuditLog_deviceType_idx" ON "AuditLog"("deviceType");

-- CreateIndex
CREATE INDEX "AuditLog_outcome_idx" ON "AuditLog"("outcome");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_action_idx" ON "AuditLog"("createdAt", "action");
