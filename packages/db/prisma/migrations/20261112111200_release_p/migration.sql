-- AlterTable
ALTER TABLE "Occasion" ADD COLUMN     "businessId" TEXT;

-- CreateTable
CREATE TABLE "Business" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "onrcRegistration" TEXT,
    "insuranceValidUntil" TIMESTAMP(3),
    "logoAssetId" TEXT,
    "accentColor" TEXT,
    "suspendedAt" TIMESTAMP(3),
    "suspensionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessMember" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "nameRo" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "sortKey" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "County" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameRo" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,

    CONSTRAINT "County_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Locality" (
    "id" TEXT NOT NULL,
    "countyId" TEXT NOT NULL,
    "nameRo" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,

    CONSTRAINT "Locality_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Listing" (
    "id" TEXT NOT NULL,
    "businessId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "claimed" BOOLEAN NOT NULL DEFAULT false,
    "publicContactRoute" TEXT,
    "sourceUrl" TEXT,
    "hideStats" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingCategory" (
    "listingId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "ListingCategory_pkey" PRIMARY KEY ("listingId","categoryId")
);

-- CreateTable
CREATE TABLE "ListingCounty" (
    "listingId" TEXT NOT NULL,
    "countyId" TEXT NOT NULL,

    CONSTRAINT "ListingCounty_pkey" PRIMARY KEY ("listingId","countyId")
);

-- CreateTable
CREATE TABLE "ListingLocality" (
    "listingId" TEXT NOT NULL,
    "localityId" TEXT NOT NULL,

    CONSTRAINT "ListingLocality_pkey" PRIMARY KEY ("listingId","localityId")
);

-- CreateTable
CREATE TABLE "ListingRevision" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "moderatorId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListingRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Drawing" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "spaceName" TEXT NOT NULL,
    "realWidthM" DOUBLE PRECISION,
    "realHeightM" DOUBLE PRECISION,
    "calibrationP1" JSONB,
    "calibrationP2" JSONB,
    "pixelsPerMeter" DOUBLE PRECISION,
    "revisionId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Drawing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TableInventory" (
    "id" TEXT NOT NULL,
    "drawingId" TEXT NOT NULL,
    "tableType" TEXT NOT NULL,
    "widthM" DOUBLE PRECISION,
    "heightM" DOUBLE PRECISION,
    "count" INTEGER NOT NULL,

    CONSTRAINT "TableInventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomTable" (
    "id" TEXT NOT NULL,
    "spaceModelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "widthM" DOUBLE PRECISION,
    "heightM" DOUBLE PRECISION,

    CONSTRAINT "CustomTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fixture" (
    "id" TEXT NOT NULL,
    "drawingId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "widthM" DOUBLE PRECISION,
    "heightM" DOUBLE PRECISION,

    CONSTRAINT "Fixture_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointOfInterest" (
    "id" TEXT NOT NULL,
    "drawingId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT,

    CONSTRAINT "PointOfInterest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParkingFacts" (
    "id" TEXT NOT NULL,
    "drawingId" TEXT NOT NULL,
    "onSite" BOOLEAN,
    "spaceCount" INTEGER,
    "onStreet" BOOLEAN,
    "paid" BOOLEAN,
    "accessibleSpaces" BOOLEAN,
    "walkingDistanceM" DOUBLE PRECISION,
    "drawingSpaceCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParkingFacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpaceModelVersion" (
    "id" TEXT NOT NULL,
    "occasionId" TEXT NOT NULL,
    "drawingId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedById" TEXT,

    CONSTRAINT "SpaceModelVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlowerCatalogue" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "revisionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlowerCatalogue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogueItem" (
    "id" TEXT NOT NULL,
    "catalogueId" TEXT NOT NULL,
    "variety" TEXT NOT NULL,
    "imageAssetId" TEXT,
    "seasonality" TEXT,
    "pricePerStemBani" INTEGER,
    "colours" TEXT[],

    CONSTRAINT "CatalogueItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Enquiry" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "occasionId" TEXT,
    "supplierId" TEXT,
    "plannerAccountId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'sent',
    "kind" TEXT NOT NULL DEFAULT 'enquiry',
    "payload" JSONB NOT NULL,
    "shareEmail" BOOLEAN NOT NULL DEFAULT false,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "resendCount" INTEGER NOT NULL DEFAULT 0,
    "lastResendAt" TIMESTAMP(3),
    "nudged48h" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Enquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnquiryMessage" (
    "id" TEXT NOT NULL,
    "enquiryId" TEXT NOT NULL,
    "fromBusiness" BOOLEAN NOT NULL DEFAULT false,
    "body" TEXT NOT NULL,
    "quoteAssetId" TEXT,
    "arrangementVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnquiryMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoverySource" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "rateLimitPerHour" INTEGER NOT NULL DEFAULT 60,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoverySource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryRun" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "itemsFound" INTEGER NOT NULL DEFAULT 0,
    "draftsCreated" INTEGER NOT NULL DEFAULT 0,
    "duplicatesSkipped" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DiscoveryRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryDraft" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryGuess" TEXT,
    "countyCode" TEXT,
    "locality" TEXT,
    "publicContactRoute" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "listingId" TEXT,
    "runId" TEXT,

    CONSTRAINT "DiscoveryDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimInvitation" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "codeHash" TEXT,

    CONSTRAINT "ClaimInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObjectionRecord" (
    "id" TEXT NOT NULL,
    "listingId" TEXT,
    "contactHash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "handledAt" TIMESTAMP(3),
    "handledBy" TEXT,

    CONSTRAINT "ObjectionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingStats" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "enquiriesSent" INTEGER NOT NULL DEFAULT 0,
    "enquiriesAnswered" INTEGER NOT NULL DEFAULT 0,
    "medianReplyHours" DOUBLE PRECISION,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListingStats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeaturedSlot" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeaturedSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'active',
    "priceBani" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RON',
    "periodEnd" TIMESTAMP(3),
    "graceUntil" TIMESTAMP(3),
    "processorRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "businessId" TEXT NOT NULL,
    "amountBani" INTEGER NOT NULL,
    "tvaBani" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'RON',
    "fiscalRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Business_accountId_key" ON "Business"("accountId");

-- CreateIndex
CREATE INDEX "BusinessMember_businessId_idx" ON "BusinessMember"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessMember_businessId_accountId_key" ON "BusinessMember"("businessId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "County_code_key" ON "County"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Locality_countyId_nameRo_key" ON "Locality"("countyId", "nameRo");

-- CreateIndex
CREATE INDEX "Listing_status_idx" ON "Listing"("status");

-- CreateIndex
CREATE INDEX "Listing_businessId_idx" ON "Listing"("businessId");

-- CreateIndex
CREATE INDEX "ListingRevision_listingId_state_idx" ON "ListingRevision"("listingId", "state");

-- CreateIndex
CREATE INDEX "Drawing_listingId_idx" ON "Drawing"("listingId");

-- CreateIndex
CREATE INDEX "TableInventory_drawingId_idx" ON "TableInventory"("drawingId");

-- CreateIndex
CREATE INDEX "CustomTable_spaceModelId_idx" ON "CustomTable"("spaceModelId");

-- CreateIndex
CREATE INDEX "Fixture_drawingId_idx" ON "Fixture"("drawingId");

-- CreateIndex
CREATE INDEX "PointOfInterest_drawingId_idx" ON "PointOfInterest"("drawingId");

-- CreateIndex
CREATE UNIQUE INDEX "ParkingFacts_drawingId_key" ON "ParkingFacts"("drawingId");

-- CreateIndex
CREATE INDEX "SpaceModelVersion_occasionId_idx" ON "SpaceModelVersion"("occasionId");

-- CreateIndex
CREATE INDEX "FlowerCatalogue_listingId_idx" ON "FlowerCatalogue"("listingId");

-- CreateIndex
CREATE INDEX "CatalogueItem_catalogueId_idx" ON "CatalogueItem"("catalogueId");

-- CreateIndex
CREATE INDEX "Enquiry_listingId_idx" ON "Enquiry"("listingId");

-- CreateIndex
CREATE INDEX "Enquiry_plannerAccountId_idx" ON "Enquiry"("plannerAccountId");

-- CreateIndex
CREATE INDEX "Enquiry_occasionId_idx" ON "Enquiry"("occasionId");

-- CreateIndex
CREATE INDEX "EnquiryMessage_enquiryId_idx" ON "EnquiryMessage"("enquiryId");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoverySource_name_key" ON "DiscoverySource"("name");

-- CreateIndex
CREATE INDEX "DiscoveryRun_sourceId_idx" ON "DiscoveryRun"("sourceId");

-- CreateIndex
CREATE INDEX "DiscoveryDraft_state_idx" ON "DiscoveryDraft"("state");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimInvitation_listingId_key" ON "ClaimInvitation"("listingId");

-- CreateIndex
CREATE INDEX "ObjectionRecord_handledAt_idx" ON "ObjectionRecord"("handledAt");

-- CreateIndex
CREATE UNIQUE INDEX "ListingStats_listingId_key" ON "ListingStats"("listingId");

-- CreateIndex
CREATE INDEX "FeaturedSlot_categoryId_active_idx" ON "FeaturedSlot"("categoryId", "active");

-- CreateIndex
CREATE INDEX "Subscription_businessId_idx" ON "Subscription"("businessId");

-- AddForeignKey
ALTER TABLE "Occasion" ADD CONSTRAINT "Occasion_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Business" ADD CONSTRAINT "Business_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessMember" ADD CONSTRAINT "BusinessMember_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Locality" ADD CONSTRAINT "Locality_countyId_fkey" FOREIGN KEY ("countyId") REFERENCES "County"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingCategory" ADD CONSTRAINT "ListingCategory_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingCategory" ADD CONSTRAINT "ListingCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingCounty" ADD CONSTRAINT "ListingCounty_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingCounty" ADD CONSTRAINT "ListingCounty_countyId_fkey" FOREIGN KEY ("countyId") REFERENCES "County"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingLocality" ADD CONSTRAINT "ListingLocality_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingLocality" ADD CONSTRAINT "ListingLocality_localityId_fkey" FOREIGN KEY ("localityId") REFERENCES "Locality"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingRevision" ADD CONSTRAINT "ListingRevision_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Drawing" ADD CONSTRAINT "Drawing_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TableInventory" ADD CONSTRAINT "TableInventory_drawingId_fkey" FOREIGN KEY ("drawingId") REFERENCES "Drawing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomTable" ADD CONSTRAINT "CustomTable_spaceModelId_fkey" FOREIGN KEY ("spaceModelId") REFERENCES "SpaceModelVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fixture" ADD CONSTRAINT "Fixture_drawingId_fkey" FOREIGN KEY ("drawingId") REFERENCES "Drawing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointOfInterest" ADD CONSTRAINT "PointOfInterest_drawingId_fkey" FOREIGN KEY ("drawingId") REFERENCES "Drawing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkingFacts" ADD CONSTRAINT "ParkingFacts_drawingId_fkey" FOREIGN KEY ("drawingId") REFERENCES "Drawing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaceModelVersion" ADD CONSTRAINT "SpaceModelVersion_occasionId_fkey" FOREIGN KEY ("occasionId") REFERENCES "Occasion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaceModelVersion" ADD CONSTRAINT "SpaceModelVersion_drawingId_fkey" FOREIGN KEY ("drawingId") REFERENCES "Drawing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowerCatalogue" ADD CONSTRAINT "FlowerCatalogue_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogueItem" ADD CONSTRAINT "CatalogueItem_catalogueId_fkey" FOREIGN KEY ("catalogueId") REFERENCES "FlowerCatalogue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enquiry" ADD CONSTRAINT "Enquiry_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnquiryMessage" ADD CONSTRAINT "EnquiryMessage_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "Enquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryRun" ADD CONSTRAINT "DiscoveryRun_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "DiscoverySource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryDraft" ADD CONSTRAINT "DiscoveryDraft_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "DiscoverySource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryDraft" ADD CONSTRAINT "DiscoveryDraft_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DiscoveryRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeaturedSlot" ADD CONSTRAINT "FeaturedSlot_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
