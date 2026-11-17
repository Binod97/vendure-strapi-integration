-- CreateTable
CREATE TABLE "ProductMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "strapiDocumentId" TEXT NOT NULL,
    "vendureProductId" TEXT NOT NULL,
    "contentHash" TEXT,
    "lastSyncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SyncLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "errorMessage" TEXT,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductMapping_strapiDocumentId_key" ON "ProductMapping"("strapiDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductMapping_vendureProductId_key" ON "ProductMapping"("vendureProductId");

-- CreateIndex
CREATE UNIQUE INDEX "SyncLog_eventId_key" ON "SyncLog"("eventId");

-- CreateIndex
CREATE INDEX "SyncLog_status_receivedAt_idx" ON "SyncLog"("status", "receivedAt");

-- CreateIndex
CREATE INDEX "SyncLog_entityType_entityId_idx" ON "SyncLog"("entityType", "entityId");
