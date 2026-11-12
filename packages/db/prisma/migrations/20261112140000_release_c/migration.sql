-- AlterTable
ALTER TABLE "Occasion" ADD COLUMN     "programmeRevision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "publicPageOn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "publicSlug" TEXT;

-- CreateTable
CREATE TABLE "SeatingPlan" (
    "id" TEXT NOT NULL,
    "occasionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeatingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeatAssignment" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "tableRef" TEXT NOT NULL,
    "seat" TEXT,

    CONSTRAINT "SeatAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MealStage" (
    "id" TEXT NOT NULL,
    "occasionId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "guestCount" INTEGER NOT NULL,
    "result" JSONB,
    "checkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MealStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgrammeItem" (
    "id" TEXT NOT NULL,
    "occasionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3),
    "durationMin" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgrammeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cue" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "atLabel" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "note" TEXT,

    CONSTRAINT "Cue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvitationDesign" (
    "id" TEXT NOT NULL,
    "occasionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "content" JSONB NOT NULL,
    "pdfAssetId" TEXT,
    "proofApprovedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvitationDesign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Menu" (
    "id" TEXT NOT NULL,
    "occasionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Menu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuItem" (
    "id" TEXT NOT NULL,
    "menuId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dietTags" TEXT[],

    CONSTRAINT "MenuItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MealChoice" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,

    CONSTRAINT "MealChoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicRegistration" (
    "id" TEXT NOT NULL,
    "occasionId" TEXT NOT NULL,
    "householdId" TEXT,
    "name" TEXT NOT NULL,
    "contactHash" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'registered',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivateRequest" (
    "id" TEXT NOT NULL,
    "occasionId" TEXT NOT NULL,
    "householdId" TEXT,
    "kind" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrivateRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiftEstimate" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "inputs" JSONB NOT NULL,
    "rangeMinBani" INTEGER NOT NULL,
    "rangeMaxBani" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GiftEstimate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArrangementDesign" (
    "id" TEXT NOT NULL,
    "occasionId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "baseForm" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "indicativeCostBani" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "quoteEnquiryId" TEXT,
    "acceptedQuoteAssetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArrangementDesign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SeatingPlan_occasionId_idx" ON "SeatingPlan"("occasionId");

-- CreateIndex
CREATE UNIQUE INDEX "SeatAssignment_planId_householdId_key" ON "SeatAssignment"("planId", "householdId");

-- CreateIndex
CREATE UNIQUE INDEX "MealChoice_householdId_itemId_key" ON "MealChoice"("householdId", "itemId");

-- CreateIndex
CREATE INDEX "PublicRegistration_occasionId_idx" ON "PublicRegistration"("occasionId");

-- CreateIndex
CREATE INDEX "PrivateRequest_occasionId_idx" ON "PrivateRequest"("occasionId");

-- CreateIndex
CREATE UNIQUE INDEX "Occasion_publicSlug_key" ON "Occasion"("publicSlug");

-- AddForeignKey
ALTER TABLE "SeatingPlan" ADD CONSTRAINT "SeatingPlan_occasionId_fkey" FOREIGN KEY ("occasionId") REFERENCES "Occasion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeatAssignment" ADD CONSTRAINT "SeatAssignment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SeatingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeatAssignment" ADD CONSTRAINT "SeatAssignment_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealStage" ADD CONSTRAINT "MealStage_occasionId_fkey" FOREIGN KEY ("occasionId") REFERENCES "Occasion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgrammeItem" ADD CONSTRAINT "ProgrammeItem_occasionId_fkey" FOREIGN KEY ("occasionId") REFERENCES "Occasion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cue" ADD CONSTRAINT "Cue_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ProgrammeItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvitationDesign" ADD CONSTRAINT "InvitationDesign_occasionId_fkey" FOREIGN KEY ("occasionId") REFERENCES "Occasion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Menu" ADD CONSTRAINT "Menu_occasionId_fkey" FOREIGN KEY ("occasionId") REFERENCES "Occasion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealChoice" ADD CONSTRAINT "MealChoice_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealChoice" ADD CONSTRAINT "MealChoice_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicRegistration" ADD CONSTRAINT "PublicRegistration_occasionId_fkey" FOREIGN KEY ("occasionId") REFERENCES "Occasion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicRegistration" ADD CONSTRAINT "PublicRegistration_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivateRequest" ADD CONSTRAINT "PrivateRequest_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArrangementDesign" ADD CONSTRAINT "ArrangementDesign_occasionId_fkey" FOREIGN KEY ("occasionId") REFERENCES "Occasion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

