-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "briefImageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Backfill: seed the gallery from the existing single briefImageUrl (primary stays as element 0)
UPDATE "Campaign"
SET "briefImageUrls" = ARRAY["briefImageUrl"]
WHERE "briefImageUrl" IS NOT NULL
  AND ("briefImageUrls" IS NULL OR array_length("briefImageUrls", 1) IS NULL);
