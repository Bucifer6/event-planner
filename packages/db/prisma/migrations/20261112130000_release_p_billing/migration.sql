-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "issuedAt" TIMESTAMP(3),
ADD COLUMN     "number" TEXT,
ADD COLUMN     "pdfAssetId" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'issued';

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stripeCustomerId" TEXT,
ADD COLUMN     "stripeSubscriptionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");

