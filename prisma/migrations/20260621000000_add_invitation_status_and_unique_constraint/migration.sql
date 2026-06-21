-- AddColumn: provenance of a CampaignApplication row (APPLICATION | INVITATION)
ALTER TABLE "CampaignApplication" ADD COLUMN IF NOT EXISTS "origin" TEXT NOT NULL DEFAULT 'APPLICATION';

-- AddUniqueConstraint: one row per (campaign, influencer) — makes invite/apply find-or-create race-safe.
-- (Pre-checked for duplicates before creating this migration: none found.)
CREATE UNIQUE INDEX IF NOT EXISTS "CampaignApplication_campaignId_influencerId_key" ON "CampaignApplication"("campaignId", "influencerId");
