-- AlterTable: self-reported media-kit audience (display fallback; synced data wins)
ALTER TABLE "InfluencerProfile" ADD COLUMN     "mediaKitAudience" JSONB;
