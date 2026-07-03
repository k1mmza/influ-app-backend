-- AddColumn: optional brand logo (agency-created brands can carry a logo without an account).
ALTER TABLE "ClientBrand" ADD COLUMN IF NOT EXISTS "logoUrl" TEXT;

-- AddColumn: provenance of a ClientBrand row (SELF_REGISTERED | AGENCY_MANAGED).
-- Bare TEXT + DEFAULT — mirrors CampaignApplication.origin; no Postgres enum.
ALTER TABLE "ClientBrand" ADD COLUMN IF NOT EXISTS "origin" TEXT NOT NULL DEFAULT 'SELF_REGISTERED';

-- Backfill: an agency-owned brand with no linked account is agency-managed.
-- Rows with BOTH brandProfileId and agencyId NULL are intentionally left as the
-- SELF_REGISTERED default and NOT auto-classified (flagged separately: 0 such rows
-- in the current DB at migration authoring time).
UPDATE "ClientBrand"
SET "origin" = 'AGENCY_MANAGED'
WHERE "brandProfileId" IS NULL AND "agencyId" IS NOT NULL;
