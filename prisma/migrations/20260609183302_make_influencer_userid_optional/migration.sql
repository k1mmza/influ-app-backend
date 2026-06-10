-- DropForeignKey
ALTER TABLE "InfluencerProfile" DROP CONSTRAINT "InfluencerProfile_userId_fkey";

-- AlterTable
ALTER TABLE "InfluencerProfile" ALTER COLUMN "userId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "InfluencerProfile" ADD CONSTRAINT "InfluencerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
