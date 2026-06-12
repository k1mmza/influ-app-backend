-- AlterTable
ALTER TABLE "PlatformAccount" ADD COLUMN     "accessToken" TEXT,
ADD COLUMN     "avgViewDuration" DOUBLE PRECISION,
ADD COLUMN     "avgViewPct" DOUBLE PRECISION,
ADD COLUMN     "channelId" TEXT,
ADD COLUMN     "refreshToken" TEXT,
ADD COLUMN     "subscribersGained" INTEGER,
ADD COLUMN     "tokenExpiry" TIMESTAMP(3),
ADD COLUMN     "topCountries" JSONB,
ADD COLUMN     "watchTimeMins" DOUBLE PRECISION;
