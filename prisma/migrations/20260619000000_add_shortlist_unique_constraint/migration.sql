-- AddUniqueConstraint
CREATE UNIQUE INDEX IF NOT EXISTS "Shortlist_clientBrandId_influencerId_key" ON "Shortlist"("clientBrandId", "influencerId");
