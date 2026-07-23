-- CreateEnum
CREATE TYPE "ProfileVisibility" AS ENUM ('PUBLIC', 'UNLISTED', 'PRIVATE');

-- AlterTable: creator-controlled settings (Profile → Settings)
ALTER TABLE "InfluencerProfile" ADD COLUMN     "visibility" "ProfileVisibility" NOT NULL DEFAULT 'PUBLIC';
ALTER TABLE "InfluencerProfile" ADD COLUMN     "messageAlerts" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "InfluencerProfile" ADD COLUMN     "campaignAlerts" BOOLEAN NOT NULL DEFAULT true;
