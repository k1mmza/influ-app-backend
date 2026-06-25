-- Bridge approved Draft -> SubmittedContent for the tracking lineage.
-- AlterTable
ALTER TABLE "SubmittedContent" ADD COLUMN "draftId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SubmittedContent_draftId_key" ON "SubmittedContent"("draftId");

-- AddForeignKey
ALTER TABLE "SubmittedContent" ADD CONSTRAINT "SubmittedContent_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "Draft"("id") ON DELETE SET NULL ON UPDATE CASCADE;
