-- AlterTable
ALTER TABLE "Invitation" ADD COLUMN     "qrId" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_qrId_key" ON "Invitation"("qrId");

