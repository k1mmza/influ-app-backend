-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "brandPhaseReady" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "influencerPhaseReady" BOOLEAN NOT NULL DEFAULT false;
