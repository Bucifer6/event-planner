-- CreateTable
CREATE TABLE "CheckIn" (
    "id" TEXT NOT NULL,
    "occasionId" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "qrId" TEXT NOT NULL,
    "checkedInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "via" TEXT NOT NULL DEFAULT 'qr',
    "correctionId" TEXT,

    CONSTRAINT "CheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfflineSyncItem" (
    "id" TEXT NOT NULL,
    "occasionId" TEXT NOT NULL,
    "clientKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAtUtc" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "result" JSONB,

    CONSTRAINT "OfflineSyncItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SustainabilityGoal" (
    "id" TEXT NOT NULL,
    "occasionId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "target" DOUBLE PRECISION,
    "measured" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SustainabilityGoal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CheckIn_correctionId_key" ON "CheckIn"("correctionId");

-- CreateIndex
CREATE INDEX "CheckIn_occasionId_idx" ON "CheckIn"("occasionId");

-- CreateIndex
CREATE UNIQUE INDEX "CheckIn_occasionId_householdId_key" ON "CheckIn"("occasionId", "householdId");

-- CreateIndex
CREATE INDEX "OfflineSyncItem_occasionId_state_idx" ON "OfflineSyncItem"("occasionId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "OfflineSyncItem_occasionId_clientKey_key" ON "OfflineSyncItem"("occasionId", "clientKey");

-- CreateIndex
CREATE INDEX "SustainabilityGoal_occasionId_idx" ON "SustainabilityGoal"("occasionId");

-- CreateIndex
CREATE UNIQUE INDEX "SustainabilityGoal_occasionId_metric_key" ON "SustainabilityGoal"("occasionId", "metric");

-- AddForeignKey
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_occasionId_fkey" FOREIGN KEY ("occasionId") REFERENCES "Occasion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfflineSyncItem" ADD CONSTRAINT "OfflineSyncItem_occasionId_fkey" FOREIGN KEY ("occasionId") REFERENCES "Occasion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SustainabilityGoal" ADD CONSTRAINT "SustainabilityGoal_occasionId_fkey" FOREIGN KEY ("occasionId") REFERENCES "Occasion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

