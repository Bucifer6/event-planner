-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "hideDirectoryLinks" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "acceptedQuoteAssetId" TEXT;

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "planLapsedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "published" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "retiredAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "County" ADD COLUMN     "published" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Locality" ADD COLUMN     "published" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "MonetizationSwitch" ADD COLUMN     "noticeEndsAt" TIMESTAMP(3),
ADD COLUMN     "noticeStartedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Occasion" ADD COLUMN     "handedOverAt" TIMESTAMP(3),
ADD COLUMN     "handedOverToId" TEXT,
ADD COLUMN     "handoverById" TEXT;

-- AlterTable
ALTER TABLE "OccasionMember" ADD COLUMN     "hideDirectoryLinks" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "BusinessLibraryItem" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessLibraryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetUsageDaily" (
    "id" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "assetKind" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "uses" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AssetUsageDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DirectorySearchDaily" (
    "id" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "categoryId" TEXT NOT NULL,
    "countyId" TEXT NOT NULL,
    "searches" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DirectorySearchDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingAcceptance" (
    "id" TEXT NOT NULL DEFAULT 'main',
    "testModePassedAt" TIMESTAMP(3),
    "verifiedBy" TEXT,
    "notes" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceAccessRequest" (
    "id" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "approvals" TEXT[],
    "state" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceAccessRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformNotice" (
    "id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sentById" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformNotice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentReport" (
    "id" TEXT NOT NULL,
    "reporterContactHash" TEXT NOT NULL,
    "listingId" TEXT,
    "kind" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'open',
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "reason" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BusinessLibraryItem_businessId_kind_idx" ON "BusinessLibraryItem"("businessId", "kind");

-- CreateIndex
CREATE INDEX "AssetUsageDaily_listingId_idx" ON "AssetUsageDaily"("listingId");

-- CreateIndex
CREATE UNIQUE INDEX "AssetUsageDaily_day_assetKind_assetId_key" ON "AssetUsageDaily"("day", "assetKind", "assetId");

-- CreateIndex
CREATE UNIQUE INDEX "DirectorySearchDaily_day_categoryId_countyId_key" ON "DirectorySearchDaily"("day", "categoryId", "countyId");

-- AddForeignKey
ALTER TABLE "BusinessLibraryItem" ADD CONSTRAINT "BusinessLibraryItem_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
