-- CreateTable
CREATE TABLE "ItineraryLeg" (
    "id" TEXT NOT NULL,
    "occasionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "startsAtUtc" TIMESTAMP(3) NOT NULL,
    "endsAtUtc" TIMESTAMP(3),
    "zone" TEXT NOT NULL DEFAULT 'Europe/Bucharest',
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItineraryLeg_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subgroup" (
    "id" TEXT NOT NULL,
    "occasionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Subgroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubgroupMember" (
    "id" TEXT NOT NULL,
    "subgroupId" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,

    CONSTRAINT "SubgroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "occasionId" TEXT NOT NULL,
    "subgroupId" TEXT,
    "title" TEXT NOT NULL,
    "startsAtUtc" TIMESTAMP(3) NOT NULL,
    "zone" TEXT NOT NULL DEFAULT 'Europe/Bucharest',
    "optional" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackingItem" (
    "id" TEXT NOT NULL,
    "occasionId" TEXT NOT NULL,
    "subgroupId" TEXT,
    "label" TEXT NOT NULL,
    "packed" BOOLEAN NOT NULL DEFAULT false,
    "packedAt" TIMESTAMP(3),

    CONSTRAINT "PackingItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportLeg" (
    "id" TEXT NOT NULL,
    "occasionId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fromPlace" TEXT NOT NULL,
    "toPlace" TEXT NOT NULL,
    "departsAtUtc" TIMESTAMP(3) NOT NULL,
    "seats" INTEGER NOT NULL DEFAULT 0,
    "zone" TEXT NOT NULL DEFAULT 'Europe/Bucharest',

    CONSTRAINT "TransportLeg_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "occasionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "occupants" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomAssignment" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,

    CONSTRAINT "RoomAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ItineraryLeg_occasionId_idx" ON "ItineraryLeg"("occasionId");

-- CreateIndex
CREATE INDEX "Subgroup_occasionId_idx" ON "Subgroup"("occasionId");

-- CreateIndex
CREATE UNIQUE INDEX "SubgroupMember_subgroupId_householdId_key" ON "SubgroupMember"("subgroupId", "householdId");

-- CreateIndex
CREATE INDEX "Room_occasionId_idx" ON "Room"("occasionId");

-- CreateIndex
CREATE UNIQUE INDEX "RoomAssignment_roomId_householdId_key" ON "RoomAssignment"("roomId", "householdId");

-- AddForeignKey
ALTER TABLE "ItineraryLeg" ADD CONSTRAINT "ItineraryLeg_occasionId_fkey" FOREIGN KEY ("occasionId") REFERENCES "Occasion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subgroup" ADD CONSTRAINT "Subgroup_occasionId_fkey" FOREIGN KEY ("occasionId") REFERENCES "Occasion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubgroupMember" ADD CONSTRAINT "SubgroupMember_subgroupId_fkey" FOREIGN KEY ("subgroupId") REFERENCES "Subgroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_occasionId_fkey" FOREIGN KEY ("occasionId") REFERENCES "Occasion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_subgroupId_fkey" FOREIGN KEY ("subgroupId") REFERENCES "Subgroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackingItem" ADD CONSTRAINT "PackingItem_occasionId_fkey" FOREIGN KEY ("occasionId") REFERENCES "Occasion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackingItem" ADD CONSTRAINT "PackingItem_subgroupId_fkey" FOREIGN KEY ("subgroupId") REFERENCES "Subgroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportLeg" ADD CONSTRAINT "TransportLeg_occasionId_fkey" FOREIGN KEY ("occasionId") REFERENCES "Occasion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_occasionId_fkey" FOREIGN KEY ("occasionId") REFERENCES "Occasion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomAssignment" ADD CONSTRAINT "RoomAssignment_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

