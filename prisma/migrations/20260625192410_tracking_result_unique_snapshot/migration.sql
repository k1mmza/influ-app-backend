-- One snapshot per content per period per day.
-- CreateIndex
CREATE UNIQUE INDEX "TrackingResult_submittedContentId_recordedAt_snapshotPeriod_key" ON "TrackingResult"("submittedContentId", "recordedAt", "snapshotPeriod");
