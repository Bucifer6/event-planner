-- AlterTable
ALTER TABLE "Occasion" ADD COLUMN     "lastProgrammeNoticeRevision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "publicQuestions" JSONB,
ADD COLUMN     "venueAddress" TEXT,
ADD COLUMN     "venueMapsUrl" TEXT;

