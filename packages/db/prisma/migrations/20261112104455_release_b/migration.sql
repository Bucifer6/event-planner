-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OccasionStatus" ADD VALUE 'cancelled';
ALTER TYPE "OccasionStatus" ADD VALUE 'postponed';

-- CreateTable
CREATE TABLE "BudgetCategory" (
    "id" TEXT NOT NULL,
    "occasionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RON',
    "estimateBani" INTEGER NOT NULL DEFAULT 0,
    "committedBani" INTEGER NOT NULL DEFAULT 0,
    "invoicedBani" INTEGER NOT NULL DEFAULT 0,
    "paidBani" INTEGER NOT NULL DEFAULT 0,
    "forecastBani" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "occasionId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "amountBani" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RON',
    "receiptAssetId" TEXT,
    "approvalState" TEXT NOT NULL DEFAULT 'pending',
    "paymentState" TEXT NOT NULL DEFAULT 'unpaid',
    "approvedById" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "occasionId" TEXT,
    "businessId" TEXT,
    "uploaderId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "scanStatus" TEXT NOT NULL DEFAULT 'pending',
    "reEncoded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "occasionId" TEXT NOT NULL,
    "payerMemberId" TEXT NOT NULL,
    "amountBani" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RON',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerSplit" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "shareBani" INTEGER NOT NULL,

    CONSTRAINT "LedgerSplit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "occasionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactEmail" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "occasionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'enquired',
    "quoteAssetId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BriefingVersion" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedBy" TEXT,

    CONSTRAINT "BriefingVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderSnapshot" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "items" JSONB NOT NULL,
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderDelta" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "change" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderDelta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Delivery" (
    "id" TEXT NOT NULL,
    "occasionId" TEXT NOT NULL,
    "bookingId" TEXT,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "expectedQty" INTEGER NOT NULL,
    "receivedQty" INTEGER NOT NULL DEFAULT 0,
    "unitLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Correction" (
    "id" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "actorId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Correction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReadinessDecision" (
    "id" TEXT NOT NULL,
    "occasionId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReadinessDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentDeadline" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amountBani" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RON',
    "dueAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentDeadline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Closeout" (
    "id" TEXT NOT NULL,
    "occasionId" TEXT NOT NULL,
    "unpaidBalances" JSONB NOT NULL,
    "returns" JSONB NOT NULL,
    "deposits" JSONB NOT NULL,
    "lessons" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Closeout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffSession" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deploy" (
    "id" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "commitHash" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "approverId" TEXT,
    "result" TEXT NOT NULL DEFAULT 'queued',
    "ciStatus" TEXT,
    "emergency" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "rolledBackAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Deploy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "McpCallLog" (
    "id" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "error" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "McpCallLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BudgetCategory_occasionId_idx" ON "BudgetCategory"("occasionId");

-- CreateIndex
CREATE INDEX "Expense_occasionId_idx" ON "Expense"("occasionId");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_storageKey_key" ON "Asset"("storageKey");

-- CreateIndex
CREATE INDEX "Asset_occasionId_idx" ON "Asset"("occasionId");

-- CreateIndex
CREATE INDEX "Asset_businessId_idx" ON "Asset"("businessId");

-- CreateIndex
CREATE INDEX "LedgerEntry_occasionId_idx" ON "LedgerEntry"("occasionId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerSplit_entryId_memberId_key" ON "LedgerSplit"("entryId", "memberId");

-- CreateIndex
CREATE INDEX "Supplier_occasionId_idx" ON "Supplier"("occasionId");

-- CreateIndex
CREATE INDEX "Booking_occasionId_idx" ON "Booking"("occasionId");

-- CreateIndex
CREATE UNIQUE INDEX "BriefingVersion_bookingId_version_key" ON "BriefingVersion"("bookingId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "OrderSnapshot_bookingId_version_key" ON "OrderSnapshot"("bookingId", "version");

-- CreateIndex
CREATE INDEX "Delivery_occasionId_idx" ON "Delivery"("occasionId");

-- CreateIndex
CREATE INDEX "Correction_targetType_targetId_idx" ON "Correction"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "ReadinessDecision_occasionId_idx" ON "ReadinessDecision"("occasionId");

-- CreateIndex
CREATE INDEX "PaymentDeadline_dueAt_idx" ON "PaymentDeadline"("dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "Closeout_occasionId_key" ON "Closeout"("occasionId");

-- CreateIndex
CREATE INDEX "StaffSession_staffId_idx" ON "StaffSession"("staffId");

-- CreateIndex
CREATE INDEX "McpCallLog_tokenId_idx" ON "McpCallLog"("tokenId");

-- CreateIndex
CREATE INDEX "McpCallLog_at_idx" ON "McpCallLog"("at");

-- AddForeignKey
ALTER TABLE "BudgetCategory" ADD CONSTRAINT "BudgetCategory_occasionId_fkey" FOREIGN KEY ("occasionId") REFERENCES "Occasion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_occasionId_fkey" FOREIGN KEY ("occasionId") REFERENCES "Occasion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "BudgetCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_receiptAssetId_fkey" FOREIGN KEY ("receiptAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_occasionId_fkey" FOREIGN KEY ("occasionId") REFERENCES "Occasion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerSplit" ADD CONSTRAINT "LedgerSplit_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "LedgerEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_occasionId_fkey" FOREIGN KEY ("occasionId") REFERENCES "Occasion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_occasionId_fkey" FOREIGN KEY ("occasionId") REFERENCES "Occasion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BriefingVersion" ADD CONSTRAINT "BriefingVersion_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderSnapshot" ADD CONSTRAINT "OrderSnapshot_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderDelta" ADD CONSTRAINT "OrderDelta_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "OrderSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_occasionId_fkey" FOREIGN KEY ("occasionId") REFERENCES "Occasion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadinessDecision" ADD CONSTRAINT "ReadinessDecision_occasionId_fkey" FOREIGN KEY ("occasionId") REFERENCES "Occasion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentDeadline" ADD CONSTRAINT "PaymentDeadline_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Closeout" ADD CONSTRAINT "Closeout_occasionId_fkey" FOREIGN KEY ("occasionId") REFERENCES "Occasion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffSession" ADD CONSTRAINT "StaffSession_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpCallLog" ADD CONSTRAINT "McpCallLog_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "McpToken"("id") ON DELETE CASCADE ON UPDATE CASCADE;
